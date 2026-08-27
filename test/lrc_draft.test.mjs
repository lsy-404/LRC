import test from 'node:test';
import assert from 'node:assert/strict';
import { msToTimestamp, parseKaraokeRows, reconcileTimedRows, reconcileWordCharacters, serializeTimedLyrics, timestampToMs } from '../docs/.vuepress/components/lrcDraft.js';

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
