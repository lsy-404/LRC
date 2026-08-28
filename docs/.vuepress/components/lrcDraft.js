// 草稿 LRC 解析：成品 LRC 正文 <-> 头部标签 / 未计时 credit 行 / 带时间轴正文行。

const TS_RE = /^\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\](.*)$/;
const KARAOKE_RE = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;
const WATERMARK_KEY_RE = /[^a-z0-9一-鿿]+/g;
const CONFIRMED_STT_WATERMARKS = new Set([
  '字幕由amaraorg社区提供', '字幕由amaraorg社群提供', '字幕由amaraorg字幕组提供',
  '由amaraorg社区提供的字幕', '由amaraorg社群提供的字幕', '由amaraorg字幕组提供的字幕',
  '优优独播剧场', 'yoyotelevisionseriesexclusive', '优优独播剧场yoyotelevisionseriesexclusive',
  '词曲李宗盛', '演唱李宗盛', '编曲李宗盛', '作词李宗盛', '作曲李宗盛',
]);
const MAX_WATERMARK_TOKEN_SPAN = Math.max(...Array.from(CONFIRMED_STT_WATERMARKS, (phrase) => phrase.length), 'zitherharp'.length);
const LI_ZONGSHENG_ATTRIBUTION_RE = /(?:词曲|演唱|编曲|作词|作曲)\s*[:：]?\s*李宗盛/g;

const nonEmpty = (s) => String(s == null ? '' : s).trim() !== '';
const watermarkKey = (text) => String(text == null ? '' : text).toLowerCase().replace(WATERMARK_KEY_RE, '');
const stripLiZongshengAttribution = (text) => String(text == null ? '' : text).replace(LI_ZONGSHENG_ATTRIBUTION_RE, '').trim();

function watermarkSpan(tokens, index) {
  const key = watermarkKey(tokens[index]);
  if (key === 'zitherharp') return 1;
  if (key === 'zither' && watermarkKey(tokens[index + 1]) === 'harp') return 2;
  let joined = '';
  for (let size = 1; size <= Math.min(MAX_WATERMARK_TOKEN_SPAN, tokens.length - index); size++) {
    joined += watermarkKey(tokens[index + size - 1]);
    if (CONFIRMED_STT_WATERMARKS.has(joined)) return size;
  }
  return 0;
}

// 只匹配已确认的完整水印短语。孤立的 zither/harp 和普通重复歌词保持不变。
export function removeKnownSttWatermarks(text) {
  return String(text == null ? '' : text).split('\n').map((line) => {
    const key = watermarkKey(line);
    if (key === 'zitherharp' || CONFIRMED_STT_WATERMARKS.has(key)) return '';
    return line
      .replace(/\bzither\s*harp\b/gi, '')
      .replace(/字幕由\s*amara\s*\.?\s*org\s*(?:社区|社群|字幕组)\s*提供/gi, '')
      .replace(/由\s*amara\s*\.?\s*org\s*(?:社区|社群|字幕组)\s*提供的?字幕/gi, '')
      .replace(/优优独播剧场(?:\s*[—-]*\s*yoyo\s*television\s*series\s*exclusive)?/gi, '')
      .replace(/\byoyo\s*television\s*series\s*exclusive\b/gi, '')
      .replace(LI_ZONGSHENG_ATTRIBUTION_RE, '')
      .replace(/[ \t]{2,}/g, ' ').trim();
  }).join('\n');
}

export function removeKnownSttWatermarkTokens(words) {
  const tokens = Array.isArray(words) ? words : [];
  const kept = [];
  for (let index = 0; index < tokens.length;) {
    const span = watermarkSpan(tokens.map((word) => word?.text), index);
    if (span) index += span;
    else {
      const text = stripLiZongshengAttribution(tokens[index]?.text);
      if (text) kept.push({ ...tokens[index], text });
      index += 1;
    }
  }
  return kept;
}

export function fillInstrumentalFallback(rows, text = '纯音乐请欣赏') {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((row) => String(row?.text || '').trim())) return list;
  const time = Math.max(0, Number(list[0]?.time) || 0);
  return [{ _id: list[0]?._id, time, text, words: [{ _id: list[0]?.words?.[0]?._id, time, text }] }];
}

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

// 句首移动时保持逐字时间相对句首的偏移不变。
export function shiftTimedRow(row, nextTime, previousTime = row?.time) {
  if (!row) return row;
  const previous = Number(previousTime) || 0;
  const time = Math.max(0, Math.round(Number(nextTime) || 0));
  const delta = time - previous;
  if (!delta) return { ...row, time };
  return { ...row, time, words: (row.words || []).map((word) => ({ ...word, time: Math.max(0, Math.round((Number(word.time) || previous) + delta)) })) };
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

// LRC/KLRC 本身不定义名称；草稿把主唱保留在原字段，和声各存自己的歌词流。
export function parseVocalDrafts(track) {
  const sources = [{ id: 'main', name: '主唱', lrc: track?.lrc, klrc: track?.klrc, lines: track?.lines, timing_locked: track?.timing_locked }, ...(Array.isArray(track?.vocals) ? track.vocals : [])];
  const usedIds = new Set();
  return sources.map((source, index) => {
    const { head, rows: plainRows } = parseLrc(source.lrc);
    const baseId = index ? String(source.id || 'harmony') : 'main';
    let id = baseId === 'main' && index ? `harmony-${index + 1}` : baseId;
    while (usedIds.has(id)) id = `${baseId || 'harmony'}-${index + 1}`;
    usedIds.add(id);
    return {
      id,
      name: index ? '和声' : '主唱',
      head,
      rows: parseKaraokeRows(source.lrc, source.klrc),
      text: linesToText(Array.isArray(source.lines) ? source.lines : plainRows.map((row) => row.text)),
      timingLocked: !!source.timing_locked,
    };
  });
}

export function serializeVocalDrafts(vocals) {
  const usedIds = new Set();
  const parts = (vocals || []).map((vocal, index) => {
    const baseId = index ? String(vocal.id || 'harmony') : 'main';
    let id = baseId === 'main' && index ? `harmony-${index + 1}` : baseId;
    while (usedIds.has(id)) id = `${baseId || 'harmony'}-${index + 1}`;
    usedIds.add(id);
    return { id, name: index ? '和声' : '主唱', ...serializeTimedLyrics(vocal.head, vocal.rows), timing_locked: !!vocal.timingLocked };
  });
  const [main = { lrc: '', klrc: '', lines: [], timing_locked: false }, ...vocalsOnly] = parts;
  return { main, vocals: vocalsOnly };
}

// 句子在主唱和声间移动时保留原行和逐字对象，目标歌词流只按时间稳定归并。
export function transferTimedVocalRow(vocals, sourceIndex, rowIndex, targetIndex) {
  const list = [...(vocals || [])];
  const source = list[sourceIndex]; const target = list[targetIndex];
  const row = source?.rows?.[rowIndex];
  if (!source || !target || sourceIndex === targetIndex || !row) return list;
  const sourceRows = [...source.rows]; sourceRows.splice(rowIndex, 1);
  const targetRows = [...(target.rows || []), row].sort((a, b) => Number(a.time) - Number(b.time));
  list[sourceIndex] = { ...source, rows: sourceRows, text: linesToText(sourceRows.map((item) => item.text)) };
  list[targetIndex] = { ...target, rows: targetRows, text: linesToText(targetRows.map((item) => item.text)) };
  return list;
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

export const utf16ToCodePointIndex = (text, offset) => Array.from(String(text || '').slice(0, Math.max(0, Number(offset) || 0))).length;

export function splitTimedRow(rows, index, codePointIndex, createId = () => undefined) {
  const list = [...(rows || [])]; const row = list[index]; const chars = Array.from(row?.text || '');
  if (!row || codePointIndex <= 0 || codePointIndex >= chars.length) return list;
  const words = reconcileWordCharacters(row.words, row.text, createId, row.time);
  const rightWords = words.slice(codePointIndex); const leftWords = words.slice(0, codePointIndex);
  list[index] = { ...row, text: chars.slice(0, codePointIndex).join(''), words: leftWords };
  list.splice(index + 1, 0, { _id: createId(), time: Number(rightWords[0]?.time || row.time + 1000), text: chars.slice(codePointIndex).join(''), words: rightWords });
  return list;
}

export function moveTimedSelection(rows, index, start, end, createId = () => undefined) {
  const list = [...(rows || [])]; const row = list[index];
  if (!row || end <= start) return list;
  const words = reconcileWordCharacters(row.words, row.text, createId, row.time);
  const moved = words.slice(start, end); if (!moved.length) return list;
  list[index] = { ...row, words: [...words.slice(0, start), ...words.slice(end)], text: [...words.slice(0, start), ...words.slice(end)].map((word) => word.text).join('') };
  const next = list[index + 1] || { _id: createId(), time: Number(moved[0]?.time || row.time + 1000), text: '', words: [] };
  const combined = [...moved, ...(next.words || [])].sort((a, b) => Number(a.time) - Number(b.time));
  list[index + 1] = { ...next, words: combined, text: combined.map((word) => word.text).join('') };
  return list;
}

export function clampWordTime(words, index, time, minimumGap = 10, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  const list = words || []; const before = list[index - 1]; const after = list[index + 1];
  const low = Math.max(Number(minimum) || 0, before ? Number(before.time) + minimumGap : 0);
  const high = Math.min(Number.isFinite(maximum) ? maximum : Number.POSITIVE_INFINITY, after ? Number(after.time) - minimumGap : Number.POSITIVE_INFINITY);
  if (high < low) return Math.round(Number(list[index]?.time) || 0);
  return Math.max(low, Math.min(high, Math.round(Number(time) || 0)));
}

export function splitTimedToken(row, wordIndex, codePointIndex, createId = () => undefined) {
  const words = [...(row.words || [])]; const word = words[wordIndex]; const chars = Array.from(word?.text || '');
  if (!word || codePointIndex <= 0 || codePointIndex >= chars.length) return row;
  const next = words[wordIndex + 1];
  const nextTime = next ? Number(next.time) : Number(word.time) + Math.max(100, chars.length * 80);
  const time = Math.round(Number(word.time) + (nextTime - Number(word.time)) * (codePointIndex / chars.length));
  words.splice(wordIndex, 1, { ...word, text: chars.slice(0, codePointIndex).join('') }, { _id: createId(), time, text: chars.slice(codePointIndex).join('') });
  return { ...row, words, text: words.map((item) => item.text).join('') };
}

// 替换整个时间标记单元；清空仅删除标记，保留正文以显示缺字补标槽位。
export function replaceTimedTokenText(row, wordIndex, text) {
  const words = [...(row?.words || [])]; const word = words[wordIndex];
  if (!word) return row;
  const next = String(text == null ? '' : text).replace(/[\r\n]/g, '');
  if (next === word.text) return row;
  if (!next) {
    words.splice(wordIndex, 1);
    return { ...row, words };
  }
  const { matched } = matchedTimedCharacters(row.words, row.text);
  const positions = [...matched.entries()].filter(([, item]) => item.wordIndex === wordIndex).map(([index]) => index);
  const chars = Array.from(String(row.text || ''));
  if (positions.length === Array.from(String(word.text || '')).length) {
    const start = positions[0]; const end = positions[positions.length - 1] + 1;
    chars.splice(start, end - start, ...Array.from(next));
  }
  words[wordIndex] = { ...word, text: next };
  return { ...row, words, text: positions.length ? chars.join('') : words.map((item) => item.text).join('') };
}

export function mergeTimedToken(row, wordIndex) {
  const words = [...(row.words || [])];
  if (wordIndex <= 0 || !words[wordIndex]) return row;
  const previous = words[wordIndex - 1]; const current = words[wordIndex];
  words.splice(wordIndex - 1, 2, { ...previous, text: previous.text + current.text });
  return { ...row, words, text: words.map((item) => item.text).join('') };
}

export function expandTimedTokens(words, createId = () => undefined, defaultGap = 100, rowEnd = undefined) {
  const list = words || []; const fallbackGap = Math.max(1, Math.round(Number(defaultGap) || 100));
  return list.flatMap((word, index) => {
    const chars = Array.from(String(word?.text || ''));
    if (chars.length <= 1) return [word];
    const start = Number(word.time) || 0;
    const nextStart = Number(list[index + 1]?.time);
    const end = Number.isFinite(nextStart) && nextStart > start ? nextStart : (Number.isFinite(rowEnd) && Number(rowEnd) > start ? Number(rowEnd) : start + fallbackGap * chars.length);
    return chars.map((text, charIndex) => ({ ...word, _id: charIndex ? createId() : word._id, time: Math.round(start + (end - start) * (charIndex / chars.length)), text }));
  });
}

export function mergeTimedRows(rows, rowIndex) {
  const list = [...(rows || [])];
  if (rowIndex <= 0 || !list[rowIndex]) return list;
  const previous = list[rowIndex - 1]; const current = list[rowIndex];
  list.splice(rowIndex - 1, 2, { ...previous, words: [...previous.words, ...current.words], text: previous.text + current.text });
  return list;
}

export function timedRowBoundaryAction(rowIndex, wordIndex, charIndex) {
  if (rowIndex > 0 && wordIndex === 0 && charIndex === 0) return 'merge';
  if (wordIndex > 0 || charIndex > 0) return 'split';
  return 'none';
}

export function activeIndexAt(items, ms) {
  let low = 0; let high = (items || []).length - 1; let result = -1;
  while (low <= high) { const mid = (low + high) >> 1; if (Number(items[mid].time) <= ms) { result = mid; low = mid + 1; } else high = mid - 1; }
  return result;
}

export function timedTokenSpanMs(words, index, rowEnd = undefined, defaultGap = 500) {
  const list = words || []; const current = list[index]; if (!current) return 0;
  const start = Number(current.time) || 0; const next = Number(list[index + 1]?.time);
  const end = Number.isFinite(next) && next > start ? next : (Number.isFinite(rowEnd) && Number(rowEnd) > start ? Number(rowEnd) : start + Math.max(1, Number(defaultGap) || 500));
  return Math.max(1, end - start);
}

// Keep duration influence bounded so layout remains usable for both dense and sparse timing.
export function timedSpanFlexWeight(duration, reference = 500) {
  const ms = Math.max(1, Number(duration) || 1);
  const base = Math.max(1, Number(reference) || 500);
  return Math.min(3, Math.max(0.7, Math.sqrt(Math.min(8000, ms) / base)));
}

export function timedTokenFlexWeight(words, index, rowEnd = undefined) {
  return timedSpanFlexWeight(timedTokenSpanMs(words, index, rowEnd));
}

export function timedLeadFlexWeight(rowTime, firstTime) {
  const start = Number(rowTime);
  const first = Number(firstTime);
  if (!Number.isFinite(start) || !Number.isFinite(first) || first <= start) return 0;
  return timedSpanFlexWeight(first - start);
}

export function timedCharacterAverageMs(row, nextRowTime, defaultMs = 500) {
  const times = (row?.words || []).map((word) => Number(word.time)).filter(Number.isFinite);
  const gaps = times.slice(1).map((time, index) => time - times[index]).filter((gap) => gap > 0);
  if (gaps.length) return Math.max(1, gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
  const fallback = Math.max(1, Number(defaultMs) || 500);
  const next = Number(nextRowTime);
  const last = times[times.length - 1];
  return Number.isFinite(last) && Number.isFinite(next) && next > last ? Math.max(1, Math.min(fallback, next - last)) : fallback;
}

export function timedLastTokenSpanMs(row, nextRowTime, defaultMs = 500) {
  const average = timedCharacterAverageMs(row, nextRowTime, defaultMs);
  const words = row?.words || [];
  const last = Number(words[words.length - 1]?.time);
  const next = Number(nextRowTime);
  return Number.isFinite(last) && Number.isFinite(next) && next > last ? Math.max(1, Math.min(average, next - last)) : average;
}

export function timedTrailingGapMs(row, nextRowTime, defaultMs = 500) {
  const average = timedCharacterAverageMs(row, nextRowTime, defaultMs);
  const words = row?.words || [];
  const start = Number(row?.time);
  const last = Number(words[words.length - 1]?.time);
  const anchor = Number.isFinite(last) ? Math.max(Number.isFinite(start) ? start : 0, last) : (Number.isFinite(start) ? start : 0);
  const contentEnd = anchor + (Number.isFinite(last) ? timedLastTokenSpanMs(row, nextRowTime, defaultMs) : 0);
  const next = Number(nextRowTime);
  if (Number.isFinite(next)) return Math.max(0, Math.min(average * 4, next - contentEnd));
  return average * 4;
}

export function timedSentenceEndMs(row, nextRowTime, defaultMs = 500) {
  const start = Number(row?.time);
  const words = row?.words || [];
  const last = Number(words[words.length - 1]?.time);
  const anchor = Number.isFinite(last) ? Math.max(Number.isFinite(start) ? start : 0, last) : (Number.isFinite(start) ? start : 0);
  const contentEnd = anchor + (Number.isFinite(last) ? timedLastTokenSpanMs(row, nextRowTime, defaultMs) : 0);
  return contentEnd + timedTrailingGapMs(row, nextRowTime, defaultMs);
}

export function splitRowAtTokenBoundary(rows, rowIndex, wordIndex, charIndex, createId = () => undefined) {
  const list = [...rows]; const row = list[rowIndex]; if (!row) return list;
  if (wordIndex === 0 && charIndex === 0) return list;
  const left = row.words.slice(0, wordIndex); const target = row.words[wordIndex]; const right = row.words.slice(wordIndex + 1);
  if (target && charIndex > 0 && charIndex < Array.from(target.text).length) { const split = splitTimedToken(row, wordIndex, charIndex, createId); left.push(split.words[wordIndex]); right.unshift(split.words[wordIndex + 1]); }
  else if (target) right.unshift(target);
  if (!right.length) return list;
  list[rowIndex] = { ...row, words: left, text: left.map((word) => word.text).join('') };
  list.splice(rowIndex + 1, 0, { _id: createId(), time: Number(right[0].time), words: right, text: right.map((word) => word.text).join('') });
  return list;
}

// 把整行文本变动贴回逐字对象：LCS 保留未改字符的原时间与标识，新增字符在相邻锚点间补时。
export function reconcileWordCharacters(words, text, createId = () => undefined, rowTime = 0) {
  const old = (words || []).flatMap((word) => Array.from(String(word.text || '')).map((char, index) => ({
    ...word, text: char, _id: index ? createId() : word._id,
  })));
  const next = Array.from(String(text || ''));
  const dp = Array.from({ length: old.length + 1 }, () => Array(next.length + 1).fill(0));
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
    dp[i][j] = old[i].text === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const matched = new Map();
  for (let i = 0, j = 0; i < old.length && j < next.length;) {
    if (old[i].text === next[j]) { matched.set(j, old[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return next.map((char, index) => {
    const found = matched.get(index);
    if (found) return found;
    let before = index - 1;
    while (before >= 0 && !matched.has(before)) before--;
    let after = index + 1;
    while (after < next.length && !matched.has(after)) after++;
    const left = before >= 0 ? Number(matched.get(before).time) : Number(rowTime) || 0;
    const right = after < next.length ? Number(matched.get(after).time) : left + Math.max(100, (after - before) * 100);
    const ratio = (index - before) / (after - before || 1);
    return { _id: createId(), text: char, time: Math.round(left + (right - left) * ratio) };
  });
}

function matchedTimedCharacters(words, text) {
  const old = (words || []).flatMap((word, wordIndex) => Array.from(String(word.text || '')).map((char) => ({ char, wordIndex })));
  const next = Array.from(String(text || ''));
  const dp = Array.from({ length: old.length + 1 }, () => Array(next.length + 1).fill(0));
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
    dp[i][j] = old[i].char === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const matched = new Map();
  for (let i = 0, j = 0; i < old.length && j < next.length;) {
    if (old[i].char === next[j]) { matched.set(j, old[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { next, matched };
}

// 正文比逐字标记多出的字符会作为可补建的槽位返回，不重写任何已有 token。
export function missingTimedCharacterSlots(row) {
  const words = row?.words || [];
  const { next, matched } = matchedTimedCharacters(words, row?.text);
  return next.flatMap((text, textIndex) => {
    if (matched.has(textIndex)) return [];
    let nextMatch = textIndex + 1;
    while (nextMatch < next.length && !matched.has(nextMatch)) nextMatch++;
    return [{ text, textIndex, wordIndex: nextMatch < next.length ? matched.get(nextMatch).wordIndex : words.length }];
  });
}

// 在缺字槽位补建单一 token；相邻 token 与句边界决定插值时间。
export function insertMissingTimedCharacter(row, textIndex, createId = () => undefined, rowEnd = undefined) {
  if (!row) return row;
  const slot = missingTimedCharacterSlots(row).find((item) => item.textIndex === textIndex);
  if (!slot) return row;
  const words = [...(row.words || [])];
  const before = words[slot.wordIndex - 1];
  const after = words[slot.wordIndex];
  const low = before ? Number(before.time) : Math.max(0, Number(row.time) || 0);
  const high = after ? Number(after.time) : Number(rowEnd);
  if (Number.isFinite(high) && high < low) return row;
  const time = Number.isFinite(high) ? Math.round(low + (high - low) / 2) : Math.round(low + 100);
  if ((before && time < Number(before.time)) || (after && time > Number(after.time))) return row;
  words.splice(slot.wordIndex, 0, { _id: createId(), text: slot.text, time });
  return { ...row, words };
}

export function reconcileTimedRows(rows, text, createId = () => undefined) {
  const old = Array.isArray(rows) ? rows : [];
  const next = textToLines(text);
  const dp = Array.from({ length: old.length + 1 }, () => Array(next.length + 1).fill(0));
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
    dp[i][j] = old[i].text === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const anchors = [];
  for (let i = 0, j = 0; i < old.length && j < next.length;) {
    if (old[i].text === next[j]) { anchors.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const paired = new Map(anchors.map(([i, j]) => [j, i]));
  let previousOld = -1; let previousNew = -1;
  for (const [anchorOld, anchorNew] of [...anchors, [old.length, next.length]]) {
    const count = Math.min(anchorOld - previousOld - 1, anchorNew - previousNew - 1);
    for (let k = 1; k <= count; k++) paired.set(previousNew + k, previousOld + k);
    previousOld = anchorOld; previousNew = anchorNew;
  }
  return next.map((line, index) => {
    const oldIndex = paired.get(index);
    if (oldIndex != null) {
      const row = old[oldIndex];
      if (row.text === line) return row;
      return { ...row, text: line, words: reconcileWordCharacters(row.words, line, createId, row.time) };
    }
    const before = [...paired.entries()].filter(([j]) => j < index).pop()?.[1];
    const after = [...paired.entries()].find(([j]) => j > index)?.[1];
    const left = before == null ? 0 : Number(old[before].time) || 0;
    const right = after == null ? left + 1000 : Number(old[after].time) || left + 1000;
    const time = Math.round(left + (right - left) / (after == null ? 1 : 2));
    return { _id: createId(), time, text: line, words: reconcileWordCharacters([], line, createId, time) };
  });
}

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
