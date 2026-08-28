import test from 'node:test';
import assert from 'node:assert/strict';
import { timedCharacterAverageMs, timedTrailingGapMs, timedSentenceEndMs } from '../docs/.vuepress/components/lrcDraft.js';

test('trailing gap uses four average characters and is capped by next sentence', () => {
  const row = { time: 1000, text: 'abcd', words: [{ time: 1000, text: 'a' }, { time: 1200, text: 'b' }, { time: 1400, text: 'c' }, { time: 1600, text: 'd' }] };
  assert.equal(timedCharacterAverageMs(row, 3000), 500);
  assert.equal(timedTrailingGapMs(row, 3000), 1400);
  assert.equal(timedSentenceEndMs(row, 3000), 3000);
});

test('last sentence gets four average characters without a next row', () => {
  const row = { time: 1000, text: 'ab', words: [{ time: 1000, text: 'a' }, { time: 1500, text: 'b' }] };
  assert.equal(timedCharacterAverageMs(row, undefined), 500);
  assert.equal(timedTrailingGapMs(row, undefined), 2000);
  assert.equal(timedSentenceEndMs(row, undefined), 3500);
});

test('invalid and empty timing never produces negative or non-finite gaps', () => {
  const row = { time: 5000, text: '', words: [{ time: 1000, text: '' }] };
  assert.equal(timedTrailingGapMs(row, 4000), 2000);
  assert.equal(timedSentenceEndMs(row, 4000), 7000);
  assert.ok(Number.isFinite(timedCharacterAverageMs({}, undefined)));
});
