import test from 'node:test';
import assert from 'node:assert/strict';
import { msToTimestamp, parseKaraokeRows, serializeTimedLyrics, timestampToMs } from '../docs/.vuepress/components/lrcDraft.js';

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
