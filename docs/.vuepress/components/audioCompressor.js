// 仅在用户选择音频后按需载入；MediaBunny 通过 WebCodecs 按块读取 Blob，避免 ffmpeg
// WASM 的数十 MiB 静态核心与整专辑的重复内存副本。
export const COMPRESSED_MIME = 'audio/webm';
export const COMPRESSED_EXTENSION = '.webm';
export const MAX_COMPRESSED_AUDIO_BYTES = 24 * 1024 * 1024;
export const MAX_COMPRESSED_AUDIO_SECONDS = 30 * 60;

const AUDIO_RE = /\.(?:flac|wav|mp3|m4a|ogg|aac|opus|webm)$/i;

export const isAudioCandidate = (path) => AUDIO_RE.test(String(path || ''));

export function compressedPath(path) {
  const clean = String(path || '').replace(/\\/g, '/');
  const dot = clean.lastIndexOf('.');
  return (dot > clean.lastIndexOf('/') ? clean.slice(0, dot) : clean) + COMPRESSED_EXTENSION;
}

export function serializableAudioMetadata(tags = {}) {
  const out = {};
  for (const key of ['title', 'artist', 'album', 'albumArtist', 'genre', 'comment']) {
    const value = tags[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  for (const key of ['trackNumber', 'discNumber']) {
    const value = tags[key];
    const raw = typeof value === 'object' && value ? (value.number ?? value.current ?? value.value) : value;
    const number = typeof raw === 'string' ? Number(raw.match(/^\s*(\d+)/)?.[1]) : Number(raw);
    if (Number.isInteger(number) && number > 0) out[key] = number;
  }
  const date = tags.date instanceof Date ? tags.date : typeof tags.date === 'string' ? new Date(tags.date) : null;
  if (date && !Number.isNaN(date.getTime())) out.date = date.toISOString();
  return out;
}

export function coverFileFromMetadata(tags, name = 'cover') {
  const cover = (tags?.images || []).find((image) => image?.kind === 'coverFront') || tags?.images?.[0];
  if (!cover?.data || !cover.mimeType?.startsWith('image/')) return null;
  const ext = cover.mimeType === 'image/png' ? '.png'
    : cover.mimeType === 'image/webp' ? '.webp' : '.jpg';
  return new File([cover.data], name + ext, { type: cover.mimeType });
}

function conversionError(conversion) {
  const reasons = (conversion.discardedTracks || []).map((item) => item.reason).filter(Boolean);
  return reasons.length ? `浏览器无法编解码此音频（${reasons.join('、')}）` : '浏览器无法编解码此音频';
}

/**
 * 将单条音频串行输出为 WebM/Opus。输入由 BlobSource 读取，输出上限低于 OpenAI 的
 * 单文件限制；调用方必须一次只运行一个任务。
 */
export async function compressAudioFile(file, path, { onProgress } = {}) {
  if (typeof globalThis.AudioEncoder !== 'function' || typeof globalThis.AudioDecoder !== 'function') {
    throw new Error('当前浏览器不支持 WebCodecs 音频压缩，请使用最新版 Chrome 或 Edge');
  }
  const {
    ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WebMOutputFormat,
  } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [audio, inputMime, tags, duration] = await Promise.all([
      input.getPrimaryAudioTrack(), input.getMimeType(), input.getMetadataTags(), input.computeDuration(),
    ]);
    if (!audio) throw new Error('文件不是可识别的音频');
    if (Number.isFinite(duration) && duration > MAX_COMPRESSED_AUDIO_SECONDS) {
      throw new Error('单曲超过 30 分钟，无法保证压缩后低于 24 MiB，请先剪分音频');
    }

    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      audio: {
        codec: 'opus',
        bitrate: 96_000,
        numberOfChannels: 2,
        sampleRate: 48_000,
        forceTranscode: true,
      },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error(conversionError(conversion));
    conversion.onProgress = (progress) => onProgress?.(Math.max(0, Math.min(1, progress)));
    await conversion.execute();
    if (!target.buffer) throw new Error('压缩器没有生成文件');
    if (target.buffer.byteLength > MAX_COMPRESSED_AUDIO_BYTES) {
      throw new Error('压缩后的单曲仍超过 24 MiB，请先剪分音频');
    }
    const outPath = compressedPath(path);
    const compressed = new File([target.buffer], outPath.split('/').pop(), { type: COMPRESSED_MIME });
    return {
      file: compressed,
      path: outPath,
      mime: COMPRESSED_MIME,
      sourceMime: inputMime || file.type || '',
      metadata: serializableAudioMetadata(tags),
      cover: coverFileFromMetadata(tags),
    };
  } finally {
    input.dispose();
  }
}
