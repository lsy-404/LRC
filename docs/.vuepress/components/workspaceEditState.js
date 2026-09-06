import { parseKaraokeRows, parseLrc, serializeTimedLyrics } from './lrcDraft.js';
import { recordLyricHistory } from './lyricHistory.js';

export function lyricSource(track, format) {
  if (!track) return '';
  if (track.authoritativeLrc) return track._orig?.[format === 'elrc' ? 'klrc' : 'lrc'] || '';
  if (!track.timingLocked && !track.rows?.length) return track.text || '';
  return serializeTimedLyrics(track.head || [], track.rows || [])[format === 'elrc' ? 'klrc' : 'lrc'];
}

export function sourceBuffer(track, format) {
  return track?._sourceBuffers?.[format]?.text ?? lyricSource(track, format);
}

export function setSourceBuffer(track, format, text) {
  if (!track || track.authoritativeLrc) return;
  track._sourceBuffers ||= {};
  if (text === lyricSource(track, format)) delete track._sourceBuffers[format];
  else track._sourceBuffers[format] = { text, vocal: Number(track._selectedVocal || 0) };
}

export function validateSource(text, format) {
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[') && !/^\[(?:\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?|[a-zA-Z][\w-]*:[^\]]*)\]/.test(line)) return '行首时间标签格式错误';
    if (format === 'elrc' && /[<>]/.test(line)) {
      const stripped = line.replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, '');
      if (/[<>]/.test(stripped)) return '逐字时间标签格式错误';
    }
  }
  return '';
}

export function applySourceBuffer(track, format, newId, confirm = () => true) {
  const buffer = track?._sourceBuffers?.[format];
  if (!buffer) return false;
  if (track.authoritativeLrc) throw new Error('权威歌词为只读');
  const issue = validateSource(buffer.text, format);
  if (issue) throw new Error(issue);
  if (format === 'lrc' && track.rows?.some(row => row.words?.length > 1) && !confirm('修改 LRC 会重新生成逐字时间。继续应用吗？')) throw new Error('未应用 LRC 修改');
  const parsed = parseLrc(buffer.text);
  const rows = parseKaraokeRows(buffer.text, format === 'elrc' ? buffer.text : '').map((row, index) => ({
    ...row, _id: track.rows?.[index]?._id || newId(),
    words: row.words.map((word, wi) => ({ ...word, _id: track.rows?.[index]?.words?.[wi]?._id || newId() })),
  }));
  const selected = track._vocals?.[buffer.vocal];
  const state = { head: parsed.head, rows, text: rows.length ? rows.map(row => row.text).join('\n') : buffer.text, timingLocked: rows.length > 0, _view: rows.length ? 'lrc' : 'text' };
  if (selected) Object.assign(selected, state);
  if (buffer.vocal === Number(track._selectedVocal || 0)) Object.assign(track, state);
  track._textDirty = true;
  delete track._sourceBuffers[format];
  track.klrc = serializeTimedLyrics(track.head, track.rows).klrc;
  if (track._history) recordLyricHistory(track._history, track);
  return true;
}

export function nextAssetNumber(entry) {
  const used = [...entry.edit.assets.map(asset => asset.n), ...entry.pendingFiles.map(item => item.transfer?.n)].map(Number).filter(Number.isInteger);
  return Math.max(-1, ...used) + 1;
}
