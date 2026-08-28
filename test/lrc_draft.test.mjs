import test from 'node:test';
import assert from 'node:assert/strict';
import { activeIndexAt, clampWordTime, expandTimedTokens, mergeTimedRows, mergeTimedToken, moveTimedSelection, msToTimestamp, parseKaraokeRows, reconcileTimedRows, reconcileWordCharacters, serializeTimedLyrics, shiftTimedRow, splitRowAtTokenBoundary, splitTimedRow, splitTimedToken, timedLeadFlexWeight, timedRowBoundaryAction, timedSpanFlexWeight, timedTokenFlexWeight, timedTokenSpanMs, timestampToMs, utf16ToCodePointIndex } from '../docs/.vuepress/components/lrcDraft.js';

test('句级边界按上下文合并或拆分', () => {
  assert.equal(timedRowBoundaryAction(0, 0, 0), 'none');
  assert.equal(timedRowBoundaryAction(1, 0, 0), 'merge');
  assert.equal(timedRowBoundaryAction(0, 1, 0), 'split');
  assert.equal(timedRowBoundaryAction(1, 1, 0), 'split');
  assert.equal(timedRowBoundaryAction(1, 0, 1), 'split');
});

test('句首光标合并上一句，其余光标位置拆分', () => {
  assert.equal(timedRowBoundaryAction(2, 0, 0), 'merge');
  assert.equal(timedRowBoundaryAction(2, 0, 2), 'split');
});

test('时间戳支持厘秒和毫秒并稳定往返', () => {
  assert.equal(timestampToMs('01:02.34'), 62340);
  assert.equal(timestampToMs('01:02.345'), 62345);
  assert.equal(msToTimestamp(62345), '01:02.345');
});

test('逐字草稿可解析并以同一正文序列化 LRC/KLRC', () => {
  const rows = parseKaraokeRows('[00:01.000]你好\n', '[00:01.000]<00:01.000>你<00:01.200>好\n');
  assert.deepEqual(rows[0].words.map((word) => word.text), ['你', '好']);
  rows[0].words[1].time = 1350;
  const result = serializeTimedLyrics([], rows);
  assert.equal(result.lines[0], '你好');
  assert.match(result.lrc, /\[00:01.000\]你好/);
  assert.match(result.klrc, /<00:01.350>好/);
});

test('移动句首时按 delta 平移逐字绝对时间并保持句内偏移', () => {
  const row = { time: 1000, text: '你好', words: [{ _id: 1, time: 1100, text: '你' }, { _id: 2, time: 1350, text: '好' }] };
  const shifted = shiftTimedRow(row, 1800);
  assert.equal(shifted.time, 1800);
  assert.deepEqual(shifted.words.map((word) => word.time), [1900, 2150]);
  assert.deepEqual(shifted.words.map((word) => word.time - shifted.time), [100, 350]);
  assert.deepEqual(serializeTimedLyrics([], [shifted]), { lrc: '[00:01.800]你好\n', klrc: '[00:01.800]<00:01.900>你<00:02.150>好\n', lines: ['你好'] });
});

test('输入框已更新句首时仍以编辑前时间计算逐字平移', () => {
  const row = { time: 1800, text: '你好', words: [{ time: 1100, text: '你' }, { time: 1350, text: '好' }] };
  const shifted = shiftTimedRow(row, row.time, 1000);
  assert.deepEqual(shifted.words.map((word) => word.time), [1900, 2150]);
});

test('序列化保留头部并忽略空逐字项', () => {
  const result = serializeTimedLyrics(['[ti:标题]'], [{ time: 1000, text: '词', words: [{ time: 1000, text: '' }, { time: 1100, text: '词' }] }]);
  assert.match(result.lrc, /^\[ti:标题\]/);
  assert.match(result.klrc, /<00:01.100>词/);
  assert.doesNotMatch(result.klrc, /<00:01.000>/);
});

test('整行字符编辑以 LCS 保留未改字符的逐字时间与标识', () => {
  let nextId = 10;
  const words = [{ _id: 1, time: 100, text: '你' }, { _id: 2, time: 200, text: '好' }, { _id: 3, time: 300, text: '啊' }];
  const result = reconcileWordCharacters(words, '你们好啊', () => nextId++, 100);
  assert.deepEqual(result.map((word) => word.text), ['你', '们', '好', '啊']);
  assert.equal(result[0]._id, 1);
  assert.equal(result[2]._id, 2);
  assert.equal(result[3]._id, 3);
  assert.ok(result[1].time > 100 && result[1].time < 200);
});

test('整段文本插行或改单行仍保留其余行和未改字的时间标识', () => {
  let nextId = 20;
  const rows = [
    { _id: 1, time: 100, text: '你好', words: [{ _id: 11, time: 100, text: '你' }, { _id: 12, time: 200, text: '好' }] },
    { _id: 2, time: 500, text: '世界', words: [{ _id: 21, time: 500, text: '世' }, { _id: 22, time: 600, text: '界' }] },
  ];
  const result = reconcileTimedRows(rows, '你好呀\n世界\n再见', () => nextId++);
  assert.equal(result[0]._id, 1);
  assert.equal(result[0].words[0]._id, 11);
  assert.equal(result[1]._id, 2);
  assert.equal(result[1].words[1]._id, 22);
  assert.equal(result[2].text, '再见');
  assert.ok(result[2].time > 500);
});

test('emoji 光标按 code point 拆分，不截断代理对', () => {
  let id = 10;
  const rows = [{ _id: 1, time: 100, text: 'a😀b', words: [{ _id: 2, time: 100, text: 'a' }, { _id: 3, time: 200, text: '😀' }, { _id: 4, time: 300, text: 'b' }] }];
  const split = splitTimedRow(rows, 0, utf16ToCodePointIndex('a😀b', 3), () => id++);
  assert.deepEqual(split.map((row) => row.text), ['a😀', 'b']);
});

test('选中 emoji 跨句只搬该字符且保留逐字时间标识', () => {
  let id = 20;
  const rows = [
    { _id: 1, time: 100, text: 'a😀b', words: [{ _id: 2, time: 100, text: 'a' }, { _id: 3, time: 200, text: '😀' }, { _id: 4, time: 300, text: 'b' }] },
    { _id: 5, time: 400, text: 'c', words: [{ _id: 6, time: 400, text: 'c' }] },
  ];
  const moved = moveTimedSelection(rows, 0, 1, 2, () => id++);
  assert.equal(moved[0].text, 'ab');
  assert.equal(moved[1].text, '😀c');
  assert.equal(moved[1].words[0]._id, 3);
  assert.equal(moved[1].words[0].time, 200);
});

test('时间轨拆分多字符 token 与合并保留未改标签', () => {
  let id = 10;
  const row = { text: '你好呀', words: [{ _id: 1, time: 100, text: '你好' }, { _id: 2, time: 300, text: '呀' }] };
  const split = splitTimedToken(row, 0, 1, () => id++);
  assert.deepEqual(split.words.map((word) => word.text), ['你', '好', '呀']);
  assert.equal(split.words[0]._id, 1);
  assert.equal(split.words[2]._id, 2);
  const merged = mergeTimedToken(split, 1);
  assert.equal(merged.words[0]._id, 1);
  assert.equal(merged.words[0].time, 100);
  assert.equal(merged.text, '你好呀');
});

test('拖动时间不会越过相邻标签，emoji token 不截断', () => {
  const words = [{ time: 100, text: '😀' }, { time: 300, text: '好' }];
  assert.equal(clampWordTime(words, 0, 999, 10), 290);
  assert.equal(clampWordTime(words, 1, 0, 10), 110);
  const split = splitTimedToken({ text: '😀好', words: [{ _id: 1, time: 100, text: '😀好' }] }, 0, 1, () => 2);
  assert.deepEqual(split.words.map((word) => word.text), ['😀', '好']);
});

test('过密标签的拖动保持原时间，行和下一行界限也生效', () => {
  const tight = [{ time: 100, text: '甲' }, { time: 102, text: '乙' }, { time: 105, text: '丙' }];
  assert.equal(clampWordTime(tight, 1, 999, 10), 102);
  const words = [{ time: 120, text: '甲' }, { time: 200, text: '乙' }];
  assert.equal(clampWordTime(words, 0, 0, 10, 110, 190), 110);
  assert.equal(clampWordTime(words, 1, 999, 10, 110, 180), 180);
});

test('按 token 字符边界拆行只移动目标边界后的对象', () => {
  let id = 10;
  const first = { _id: 1, time: 100, text: '你好' };
  const second = { _id: 2, time: 300, text: '呀' };
  const rows = [{ _id: 9, time: 100, text: '你好呀', words: [first, second] }];
  const split = splitRowAtTokenBoundary(rows, 0, 1, 0, () => id++);
  assert.equal(split[0].words[0], first);
  assert.equal(split[1].words[0], second);
  assert.equal(split[1].words[0]._id, 2);
  const inside = splitRowAtTokenBoundary([{ _id: 9, time: 100, text: '你好呀', words: [first, second] }], 0, 0, 1, () => id++);
  assert.equal(inside[0].words[0]._id, 1);
  assert.equal(inside[1].words[1], second);
  assert.deepEqual(inside.map((row) => row.text), ['你', '好呀']);
  const unchanged = splitRowAtTokenBoundary(rows, 0, 0, 0, () => id++);
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0], rows[0]);
});

test('活动索引二分查找返回最后一个不晚于播放位置的标签', () => {
  const items = [{ time: 100 }, { time: 250 }, { time: 400 }];
  assert.equal(activeIndexAt(items, 99), -1);
  assert.equal(activeIndexAt(items, 250), 1);
  assert.equal(activeIndexAt(items, 999), 2);
});

test('多字符时间标签展开为每个 code point 的单独且单调时间戳', () => {
  let id = 10;
  const single = { _id: 1, time: 100, text: '你' };
  const expanded = expandTimedTokens([single, { _id: 2, time: 400, text: '好呀' }, { _id: 3, time: 800, text: '😀' }], () => id++);
  assert.equal(expanded[0], single);
  assert.deepEqual(expanded.map((word) => word.text), ['你', '好', '呀', '😀']);
  assert.deepEqual(expanded.map((word) => word.time), [100, 400, 600, 800]);
  assert.equal(expanded[1]._id, 2);
  assert.equal(expanded[2]._id, 10);
  assert.equal(expanded[3]._id, 3);
});

test('展开末 token 使用行末上界或默认间隔，emoji 不被截断', () => {
  let id = 20;
  const bounded = expandTimedTokens([{ _id: 1, time: 500, text: '甲乙丙' }], () => id++, 100, 800);
  assert.deepEqual(bounded.map((word) => word.time), [500, 600, 700]);
  const fallback = expandTimedTokens([{ _id: 2, time: 0, text: '😀好' }], () => id++, 75);
  assert.deepEqual(fallback.map((word) => word.text), ['😀', '好']);
  assert.deepEqual(fallback.map((word) => word.time), [0, 75]);
});

test('合并歌词行不改动任何 token 的对象身份或时间', () => {
  const first = { _id: 11, time: 100, text: '你' };
  const second = { _id: 12, time: 200, text: '好' };
  const third = { _id: 13, time: 300, text: '呀' };
  const rows = [
    { _id: 1, time: 100, text: '你好', words: [first, second] },
    { _id: 2, time: 300, text: '呀', words: [third] },
  ];
  const merged = mergeTimedRows(rows, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, '你好呀');
  assert.deepEqual(merged[0].words, [first, second, third]);
  assert.deepEqual(merged[0].words.map((word) => word.time), [100, 200, 300]);
});

test('时间轨区段持续表示相邻标签、末标签与过密标签', () => {
  const words = [{ time: 300, text: '你' }, { time: 900, text: '好' }];
  assert.equal(timedTokenSpanMs(words, 0, 1500), 600);
  assert.equal(timedTokenSpanMs(words, 1, 1500), 600);
  assert.equal(timedTokenSpanMs([{ time: 100, text: '密' }, { time: 100, text: '集' }], 0, 700), 600);
});

test('时间轨时长权重有上下限并支持前奏与逐字 token', () => {
  assert.equal(timedSpanFlexWeight(1), 0.7);
  assert.equal(timedSpanFlexWeight(200000), 3);
  const words = [{ time: 0, text: '短' }, { time: 100, text: '长' }];
  assert.equal(timedTokenFlexWeight(words, 0), 0.7);
  assert.equal(timedTokenFlexWeight(words, 1, 20000), 3);
  assert.equal(timedLeadFlexWeight(0, 1), 0.7);
  assert.equal(timedLeadFlexWeight(100, 100), 0);
  assert.equal(timedLeadFlexWeight(100, 90), 0);
  assert.equal(timedLeadFlexWeight(0, undefined), 0);
});
