import test from 'node:test';
import assert from 'node:assert/strict';
import { timedCharacterAverageMs, timedLastTokenSpanMs, timedTrailingGapMs, timedSentenceEndMs } from '../docs/.vuepress/components/lrcDraft.js';

test('句尾留白取四倍字均时间与下一句剩余间隔的较小值', () => {
  const row = { time: 1000, text: 'abcd', words: [{ time: 1000, text: 'a' }, { time: 1200, text: 'b' }, { time: 1400, text: 'c' }, { time: 1600, text: 'd' }] };
  assert.equal(timedCharacterAverageMs(row, 3000), 200);
  assert.equal(timedLastTokenSpanMs(row, 3000), 200);
  assert.equal(timedTrailingGapMs(row, 3000), 800);
  assert.equal(timedSentenceEndMs(row, 3000), 3000);
});

test('末句在最后一个字之后保留四倍字均时间', () => {
  const row = { time: 1000, text: 'ab', words: [{ time: 1000, text: 'a' }, { time: 1500, text: 'b' }] };
  assert.equal(timedCharacterAverageMs(row, undefined), 500);
  assert.equal(timedLastTokenSpanMs(row, undefined), 500);
  assert.equal(timedTrailingGapMs(row, undefined), 2000);
  assert.equal(timedSentenceEndMs(row, undefined), 4000);
});

test('单字句被下一句起点截断且不产生额外留白', () => {
  const row = { time: 1000, text: 'a', words: [{ time: 1000, text: 'a' }] };
  assert.equal(timedCharacterAverageMs(row, 1400), 400);
  assert.equal(timedLastTokenSpanMs(row, 1400), 400);
  assert.equal(timedTrailingGapMs(row, 1400), 0);
  assert.equal(timedSentenceEndMs(row, 1400), 1400);
});

test('无效或倒序时间不会产生负数和非有限布局值', () => {
  const row = { time: 5000, text: '', words: [{ time: 1000, text: '' }] };
  assert.equal(timedTrailingGapMs(row, 4000), 0);
  assert.ok(timedSentenceEndMs(row, 4000) >= 5000);
  assert.ok(Number.isFinite(timedCharacterAverageMs({}, undefined)));
});
