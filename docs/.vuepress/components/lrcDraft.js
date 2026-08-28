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
