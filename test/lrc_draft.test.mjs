import test from 'node:test';
import assert from 'node:assert/strict';
import { activeIndexAt, clampWordTime, expandTimedTokens, fillInstrumentalFallback, insertMissingTimedCharacter, mergeTimedRows, mergeTimedToken, missingTimedCharacterSlots, moveTimedSelection, msToTimestamp, parseKaraokeRows, parseVocalDrafts, reconcileTimedRows, reconcileWordCharacters, removeKnownSttWatermarks, removeKnownSttWatermarkTokens, replaceTimedTokenText, serializeTimedLyrics, serializeVocalDrafts, shiftTimedRow, splitRowAtTokenBoundary, splitTimedRow, splitTimedToken, timedLeadFlexWeight, timedRowBoundaryAction, timedSpanFlexWeight, timedTokenFlexWeight, timedTokenSpanMs, timestampToMs, transferTimedVocalRow, utf16ToCodePointIndex } from '../docs/.vuepress/components/lrcDraft.js';

test('既有草稿仅清除确认的转写水印，保留孤立乐器词和重复歌词', () => {
  assert.equal(removeKnownSttWatermarks('Zither Harp\nZ ither Har p\n字幕由 Amara.org 社区提供\n由 Amaraorg 社群提供的字幕\n优优独播剧场——YoYoTelevisionSeriesExclusive\n词曲：李宗盛\n演唱 李宗盛 编曲李宗盛 作词：李宗盛 作曲李宗盛\n寂寞词曲李宗盛尾句\n李宗盛\n演唱\n作词\n演唱李宗\nkeep'), '\n\n\n\n\n\n\n寂寞尾句\n李宗盛\n演唱\n作词\n演唱李宗\nkeep');
  assert.equal(removeKnownSttWatermarks('zither and harp\nla la la'), 'zither and harp\nla la la');
  assert.equal(removeKnownSttWatermarks('[01:15.920]Z ither Har p\n[01:20.600]keep'), '\n[01:20.600]keep');
  const words = removeKnownSttWatermarkTokens([
    { text: 'Zither' }, { text: 'Harp' }, { text: 'zither' }, { text: 'and' }, { text: 'harp' },
  ]);
  assert.deepEqual(words.map((word) => word.text), ['zither', 'and', 'harp']);
  assert.deepEqual(removeKnownSttWatermarkTokens([
    { text: '由' }, { text: 'Amaraorg' }, { text: '社群' }, { text: '提供的字幕' },
    { text: '优优独播剧场' }, { text: 'YoYoTelevisionSeriesExclusive' },
    { text: '词曲' }, { text: '李宗盛' }, { text: '演唱' }, { text: '李宗盛' }, { text: '编曲' }, { text: '李宗盛' },
    { text: '作词' }, { text: '李宗盛' }, { text: '作曲' }, { text: '李宗盛' }, { text: '前奏演唱李宗盛尾句' }, { text: '李宗盛' }, { text: '演唱' }, { text: '编曲' }, { text: '演唱李宗' },
  ]).map((word) => word.text), ['前奏尾句', '李宗盛', '演唱', '编曲', '演唱李宗']);
});

test('清理后仅在歌词完全为空时填充纯音乐文案，并复用首个时间戳', () => {
  const fallback = fillInstrumentalFallback([{ _id: 'row', time: 2345, text: '', words: [{ _id: 'word', time: 2345, text: '' }] }]);
  assert.deepEqual(fallback, [{ _id: 'row', time: 2345, text: '纯音乐请欣赏', words: [{ _id: 'word', time: 2345, text: '纯音乐请欣赏' }] }]);
  const normal = [{ time: 500, text: '正常歌词', words: [{ time: 500, text: '正常歌词' }] }];
  assert.equal(fillInstrumentalFallback(normal), normal);
});

test('逐字符水印同时从正文和逐字层清除，普通长歌词保留', () => {
  const amara = '字幕由amaraorg社区提供';
  const yoyo = '优优独播剧场yoyotelevisionseriesexclusive';
  const attribution = '演唱李宗盛编曲李宗盛';
  const watermark = amara + yoyo + attribution;
  assert.equal(removeKnownSttWatermarks(watermark), '');
  assert.deepEqual(removeKnownSttWatermarkTokens([...watermark].map((text) => ({ text }))), []);
  const longLyric = '这是一句超过十二个字符的普通歌词不会被清理';
  assert.equal(removeKnownSttWatermarks(longLyric), longLyric);
  assert.deepEqual(removeKnownSttWatermarkTokens([...longLyric].map((text) => ({ text }))).map((word) => word.text), [...longLyric]);
});

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

test('主唱和声草稿保留主唱字段并允许重叠时间', () => {
  const parts = parseVocalDrafts({
    lrc: '[00:01.000]主唱\n', klrc: '[00:01.000]<00:01.000>主<00:01.200>唱\n', lines: ['主唱'], timing_locked: true,
    vocals: [{ id: 'harmony', name: '和声', lrc: '[00:01.000]和声\n', klrc: '[00:01.000]<00:01.000>和<00:01.200>声\n', lines: ['和声'], timing_locked: true }],
  });
  assert.equal(parts.length, 2);
  assert.equal(parts[1].name, '和声');
  assert.equal(parts[0].rows[0].time, parts[1].rows[0].time);
  const saved = serializeVocalDrafts(parts);
  assert.match(saved.main.klrc, /主[\s\S]*唱/);
  assert.equal(saved.vocals[0].name, '和声');
  assert.match(saved.vocals[0].klrc, /和[\s\S]*声/);
});

test('遗留旧名称规范为和声，主唱和声来回移动后可完整保存', () => {
  const parts = parseVocalDrafts({
    lrc: '[00:01.000]主唱\n', klrc: '[00:01.000]<00:01.050>主<00:01.200>唱\n', lines: ['主唱'], timing_locked: true,
    vocals: [{ id: 'harmony', name: '合音', lrc: '[00:01.500]和声\n', klrc: '[00:01.500]<00:01.550>和<00:01.700>声\n', lines: ['和声'], timing_locked: true }],
  });
  assert.deepEqual(parts.map((part) => part.name), ['主唱', '和声']);
  assert.deepEqual(parts.map((part) => part.id), ['main', 'harmony']);
  const moved = transferTimedVocalRow(parts, 0, 0, 1);
  assert.equal(moved[0].rows.length, 0);
  assert.deepEqual(moved[1].rows.map((row) => row.time), [1000, 1500]);
  assert.equal(moved[1].rows[0].words[0].time, 1050);
  const restored = transferTimedVocalRow(moved, 1, 0, 0);
  const saved = serializeVocalDrafts(restored);
  assert.deepEqual(saved.main.lines, ['主唱']);
  assert.equal(saved.vocals[0].name, '和声');
  assert.deepEqual(saved.vocals[0].lines, ['和声']);
});

test('多条和声保持唯一标识并完整往返序列化', () => {
  const parts = parseVocalDrafts({
    lrc: '[00:01.000]主唱\n', klrc: '[00:01.000]<00:01.000>主唱\n', lines: ['主唱'],
    vocals: [
      { id: 'harmony', name: '和声', lrc: '[00:01.200]和声一\n', klrc: '[00:01.200]<00:01.200>和声一\n', lines: ['和声一'] },
      { id: 'harmony', name: '旧名称', lrc: '[00:01.400]和声二\n', klrc: '[00:01.400]<00:01.400>和声二\n', lines: ['和声二'] },
    ],
  });
  assert.deepEqual(parts.map((part) => part.id), ['main', 'harmony', 'harmony-2']);
  assert.deepEqual(parts.slice(1).map((part) => part.name), ['和声', '和声']);
  const saved = serializeVocalDrafts(parts);
  assert.deepEqual(saved.vocals.map((part) => part.id), ['harmony', 'harmony-2']);
  assert.deepEqual(saved.vocals.map((part) => part.lines), [['和声一'], ['和声二']]);
});

test('已有 harmony-3 时再次撞名会继续递增后缀', () => {
  const parts = parseVocalDrafts({
    lrc: '[00:01.000]主唱\n',
    vocals: [
      { id: 'harmony', lrc: '[00:01.100]一\n', lines: ['一'] },
      { id: 'harmony-3', lrc: '[00:01.200]二\n', lines: ['二'] },
      { id: 'harmony-3', lrc: '[00:01.300]三\n', lines: ['三'] },
    ],
  });
  assert.deepEqual(parts.map((part) => part.id), ['main', 'harmony', 'harmony-3', 'harmony-3-2']);
  const saved = serializeVocalDrafts(parts);
  assert.deepEqual(saved.vocals.map((part) => part.id), ['harmony', 'harmony-3', 'harmony-3-2']);
});

test('句子可跨主唱和声稳定归并并移回主唱，保留首字时间和 token 身份', () => {
  const parts = parseVocalDrafts({
    lrc: '[00:01.000]主唱\n', klrc: '[00:01.000]<00:01.250>主<00:01.400>唱\n', lines: ['主唱'], timing_locked: true,
    vocals: [{ id: 'harmony', name: '和声', lrc: '[00:00.800]先到\n[00:01.000]同拍\n', klrc: '[00:00.800]<00:00.800>先到\n[00:01.000]<00:01.000>同拍\n', lines: ['先到', '同拍'], timing_locked: true }],
  });
  const row = parts[0].rows[0]; const firstWord = row.words[0];
  row._id = 'main-row'; firstWord._id = 'main-word';
  const moved = transferTimedVocalRow(parts, 0, 0, 1);
  assert.equal(moved[0].rows.length, 0);
  assert.equal(moved[1].rows[2], row);
  assert.deepEqual(moved[1].rows.map((item) => item.time), [800, 1000, 1000]);
  assert.equal(moved[1].rows[2].words[0], firstWord);
  const returned = transferTimedVocalRow(moved, 1, 2, 0);
  assert.equal(returned[0].rows[0], row);
  assert.equal(returned[0].rows[0].words[0], firstWord);
  assert.equal(firstWord.time, 1250);
  assert.match(serializeVocalDrafts(returned).main.klrc, /\[00:01.000\]<00:01.250>主/);
});

test('跨主唱和声移动句行后保留首字独立时间并分别序列化', () => {
  const moved = { _id: 7, time: 2100, text: '和声', words: [{ _id: 8, time: 2180, text: '和' }, { _id: 9, time: 2470, text: '声' }] };
  const saved = serializeVocalDrafts([
    { id: 'main', name: '主唱', head: [], rows: [{ _id: 1, time: 2100, text: '主唱', words: [{ _id: 2, time: 2100, text: '主' }, { _id: 3, time: 2300, text: '唱' }] }], timingLocked: true },
    { id: 'harmony', name: '和声', head: [], rows: [moved], timingLocked: true },
  ]);
  assert.match(saved.main.klrc, /^\[00:02.100\]<00:02.100>主<00:02.300>唱/m);
  assert.match(saved.vocals[0].klrc, /^\[00:02.100\]<00:02.180>和<00:02.470>声/m);
  assert.equal(saved.vocals[0].lines[0], '和声');
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

test('缺字槽位只补建点击的正文字符，并在相邻标记间插值', () => {
  let id = 10;
  const first = { _id: 1, time: 100, text: '你' };
  const last = { _id: 2, time: 300, text: '好' };
  const row = { _id: 9, time: 100, text: '你们好', words: [first, last] };
  assert.deepEqual(missingTimedCharacterSlots(row), [{ text: '们', textIndex: 1, wordIndex: 1 }]);
  const next = insertMissingTimedCharacter(row, 1, () => id++, 500);
  assert.equal(next.words[0], first);
  assert.equal(next.words[2], last);
  assert.deepEqual(next.words.map((word) => [word.text, word.time]), [['你', 100], ['们', 200], ['好', 300]]);
  assert.equal(next.words[1]._id, 10);
});

test('首尾缺字从句边界插值且已有标记严格有序', () => {
  let id = 10;
  const first = { _id: 1, time: 200, text: '好' };
  const row = { time: 100, text: '你好吗', words: [first] };
  const leading = insertMissingTimedCharacter(row, 0, () => id++, 500);
  assert.deepEqual(leading.words.map((word) => [word.text, word.time]), [['你', 150], ['好', 200]]);
  const trailing = insertMissingTimedCharacter(leading, 2, () => id++, 500);
  assert.deepEqual(trailing.words.map((word) => [word.text, word.time]), [['你', 150], ['好', 200], ['吗', 350]]);
  assert.ok(trailing.words.every((word, index, words) => index === 0 || words[index - 1].time < word.time));
});

test('句首或相邻标签没有空隙时仍可补标并共享边界时间', () => {
  const atStart = { time: 100, text: '你好吗', words: [{ _id: 1, time: 100, text: '好' }, { _id: 2, time: 100, text: '吗' }] };
  const leading = insertMissingTimedCharacter(atStart, 0, () => 3, 500);
  assert.deepEqual(leading.words.map((word) => [word.text, word.time]), [['你', 100], ['好', 100], ['吗', 100]]);
  const between = { time: 100, text: '你们好', words: [{ _id: 1, time: 100, text: '你' }, { _id: 2, time: 100, text: '好' }] };
  const inserted = insertMissingTimedCharacter(between, 1, () => 4, 500);
  assert.deepEqual(inserted.words.map((word) => [word.text, word.time]), [['你', 100], ['们', 100], ['好', 100]]);
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

test('逐字时间标记可替换为多字，保留时间标识并支持内部拆分', () => {
  let id = 10;
  const first = { _id: 1, time: 100, text: '你' };
  const second = { _id: 2, time: 300, text: '好' };
  const row = { time: 100, text: '你好', words: [first, second] };
  const replaced = replaceTimedTokenText(row, 0, '你们');
  assert.equal(replaced.words[0]._id, 1);
  assert.equal(replaced.words[0].time, 100);
  assert.equal(replaced.words[1], second);
  assert.equal(replaced.text, '你们好');
  const split = splitTimedToken(replaced, 0, 1, () => id++);
  assert.deepEqual(split.words.map((word) => word.text), ['你', '们', '好']);
  assert.equal(split.words[0]._id, 1);
});

test('清空时间标记保留正文并重新暴露缺字补标槽位', () => {
  const first = { _id: 1, time: 100, text: '你们' };
  const second = { _id: 2, time: 300, text: '好' };
  const row = { time: 100, text: '你们好', words: [first, second] };
  const cleared = replaceTimedTokenText(row, 0, '');
  assert.equal(cleared.text, '你们好');
  assert.equal(cleared.words[0], second);
  assert.deepEqual(missingTimedCharacterSlots(cleared), [
    { text: '你', textIndex: 0, wordIndex: 0 },
    { text: '们', textIndex: 1, wordIndex: 0 },
  ]);
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
