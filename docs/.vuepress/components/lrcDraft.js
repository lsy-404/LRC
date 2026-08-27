// 草稿 LRC 解析：成品 LRC 正文 <-> 头部标签 / 未计时 credit 行 / 带时间轴正文行。

const TS_RE = /^\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\](.*)$/;
const KARAOKE_RE = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;

const nonEmpty = (s) => String(s == null ? '' : s).trim() !== '';

// 去掉逐字增强 LRC 的行内 <mm:ss.xx> 标记
export function stripKaraoke(text) {
  return String(text == null ? '' : text).replace(KARAOKE_RE, '');
}

// lrc 正文 -> { head: 只读头部与 credit 行, rows: [{ ts, text }] }
export function parseLrc(lrc) {
  const head = [];
  const rows = [];
  for (const raw of String(lrc == null ? '' : lrc).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = TS_RE.exec(line);
    if (m) rows.push({ ts: m[1], text: stripKaraoke(m[2]).trim() });
    else head.push(line);
  }
  return { head, rows };
}

export function timestampToMs(ts) {
  const m = /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/.exec(String(ts || '').trim());
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] || '').padEnd(3, '0'));
}

export function msToTimestamp(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  const min = Math.floor(n / 60000);
  const sec = Math.floor((n % 60000) / 1000);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}`;
}

export function parseKaraokeRows(lrc, klrc) {
  const base = parseLrc(lrc);
  const timed = String(klrc || lrc).split('\n').map((line) => {
    const m = TS_RE.exec(line.trim());
    return m ? { ts: m[1], text: m[2] } : null;
  }).filter(Boolean);
  return base.rows.map((row, i) => {
    const source = timed[i] || row;
    const pieces = [];
    const re = /<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>([^<]*)/g;
    let m;
    while ((m = re.exec(source.text))) pieces.push({ time: timestampToMs(m[1]), text: m[2] });
    return { time: timestampToMs(row.ts), text: row.text, words: pieces.length ? pieces : [{ time: timestampToMs(row.ts), text: row.text }] };
  });
}

export function serializeTimedLyrics(head, rows) {
  const clean = (rows || []).filter((row) => String(row.text || '').trim());
  const lrc = [...(head || []), ...clean.map((row) => `[${msToTimestamp(row.time)}]${row.text}`)].join('\n') + '\n';
  const klrc = [...(head || []), ...clean.map((row) => {
    const words = (row.words || []).filter((word) => String(word.text || ''));
    const body = words.length ? words.map((word) => `<${msToTimestamp(word.time)}>${word.text}`).join('') : row.text;
    return `[${msToTimestamp(row.time)}]${body}`;
  })].join('\n') + '\n';
  return { lrc, klrc, lines: clean.map((row) => row.text) };
}

// 把时间轴按序贴回歌词行；行数不符时 matched=false，时间戳留空
export function alignTimestamps(rows, lines) {
  const list = Array.isArray(rows) ? rows : [];
  const stamps = lines.map(() => '');
  const idx = [];
  lines.forEach((l, i) => { if (nonEmpty(l)) idx.push(i); });
  const matched = list.length > 0 && list.length === idx.length;
  if (matched) idx.forEach((li, k) => { stamps[li] = list[k].ts; });
  return { stamps, matched };
}

// 文本 <-> 歌词行（与保存时写回 draft 的规则一致）
export const textToLines = (text) => String(text == null ? '' : text).split('\n').filter(nonEmpty);
export const linesToText = (lines) => (Array.isArray(lines) ? lines : []).join('\n');

// 人工是否改过该轨（词/标题/序号/伴奏标记），决定 Phase B 是否重跑对齐
export function isTrackEdited(orig, cur) {
  if (!orig || !cur) return true;
  if ((Number(cur.order) || Number(orig.order)) !== Number(orig.order)) return true;
  if (String(cur.title == null ? '' : cur.title).trim() !== String(orig.title == null ? '' : orig.title).trim()) return true;
  if (!!cur.inst !== !!orig.inst) return true;
  const a = (Array.isArray(orig.lines) ? orig.lines : []).filter(nonEmpty);
  const b = (Array.isArray(cur.lines) ? cur.lines : []).filter(nonEmpty);
  return a.length !== b.length || a.some((l, i) => l !== b[i]);
}

// 对齐覆盖率提示阈值
export const LOW_COVERAGE = 0.7;
export const isLowCoverage = (c) => typeof c === 'number' && Number.isFinite(c) && c < LOW_COVERAGE;
