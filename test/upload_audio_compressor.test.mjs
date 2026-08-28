import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  COMPRESSED_MIME, MAX_COMPRESSED_AUDIO_BYTES, MAX_COMPRESSED_AUDIO_SECONDS, compressedPath, coverFileFromMetadata,
  isAudioCandidate, serializableAudioMetadata,
} from '../docs/.vuepress/components/audioCompressor.js';

test('错误扩展名的实际 FLAC 仍会进入音频解码链，文本与图片不进入', () => {
  assert.equal(isAudioCandidate('音频/01.wav'), true);
  assert.equal(isAudioCandidate('音频/伪装为 mp3 的 FLAC.mp3'), true);
  assert.equal(isAudioCandidate('歌词/01.lrc'), false);
  assert.equal(isAudioCandidate('cover.png'), false);
});

test('压缩输出路径统一为 webm，保留目录与曲名', () => {
  assert.equal(compressedPath('音频/01 原曲.mp3'), '音频/01 原曲.webm');
  assert.equal(compressedPath('无扩展名'), '无扩展名.webm');
  assert.equal(COMPRESSED_MIME, 'audio/webm');
  assert.equal(MAX_COMPRESSED_AUDIO_BYTES, 24 * 1024 * 1024);
  assert.equal(MAX_COMPRESSED_AUDIO_SECONDS, 30 * 60);
});

test('上传元数据只保留可序列化且消费端需要的字段', () => {
  assert.deepEqual(serializableAudioMetadata({
    title: ' 曲名 ', artist: '演唱者', album: '专辑', trackNumber: 2,
    discNumber: { current: '1/2' }, genre: 'Pop', comment: '备注', date: '2026-08-28',
    raw: { ignored: 'x' }, images: [{ ignored: true }],
  }), {
    title: '曲名', artist: '演唱者', album: '专辑', trackNumber: 2,
    discNumber: 1, genre: 'Pop', comment: '备注', date: '2026-08-28T00:00:00.000Z',
  });
});

test('内嵌封面会变为单独图像文件，供轻量 Worker 消费', () => {
  const OriginalFile = globalThis.File;
  class FakeFile {
    constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; }
  }
  globalThis.File = FakeFile;
  try {
    const cover = coverFileFromMetadata({
      images: [{ kind: 'coverFront', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
    }, 'cover');
    assert.equal(cover.name, 'cover.png');
    assert.equal(cover.type, 'image/png');
  } finally {
    globalThis.File = OriginalFile;
  }
});

test('压缩器按需加载 MediaBunny，不把 ffmpeg WASM 带进页面', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/audioCompressor.js', import.meta.url), 'utf8');
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  assert.match(source, /await import\('mediabunny'\)/);
  assert.match(source, /input\.getMimeType\(\)/);
  assert.doesNotMatch(manifest, /@ffmpeg\//i);
});

test('失败的音频会提供重试入口并在提交前被硬性拦截', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url), 'utf8');
  assert.match(source, /重试压缩/);
  assert.match(source, /await compressAudioItems\(\[it\]\)/);
  assert.match(source, /!it\.compressed \|\| it\.mime !== COMPRESSED_MIME/);
  assert.match(source, /upload_metadata: uploadMetadata\(\)/);
});
