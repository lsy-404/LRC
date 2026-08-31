import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('时间轴视觉权重与拖动换算共享同一毫秒/像素标尺', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /const TIMELINE_MS_PER_PIXEL = 5/);
  assert.match(source, /state\.startTime \+ \(state\.x - state\.startX\) \* TIMELINE_MS_PER_PIXEL/);
  assert.match(source, /boundedTimedSelectionOffset/);
  assert.match(source, /Command 或 Ctrl 选择多个标记后整体拖动/);
  assert.match(source, /return \{ '--eb-time-grow': Number\.isFinite\(start\)[\s\S]*?first - start/);
  assert.match(source, /return \{ '--eb-time-grow': Math\.max\(1, Number\(duration\) \|\| 1\) \};/);
  assert.match(source, /return \{ '--eb-time-grow': Math\.max\(0, Number\(duration\) \|\| 0\) \};/);
  assert.match(source, /\.eb-time-token \{[\s\S]*?flex: var\(--eb-time-grow, 1\) 0 0;/);
  const tokenStyle = source.match(/function timelineTokenStyle\([\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(tokenStyle, /timedSpanFlexWeight/);
  assert.doesNotMatch(source, /flex: var\(--eb-time-grow, 1\) 1 max-content/);
  assert.match(source, /\.eb-time-track \{[\s\S]*?width: max\(100%, var\(--eb-timeline-width, 100%\)\);[\s\S]*?padding: 0 4rem 3px;[\s\S]*?box-sizing: border-box;/);
  assert.doesNotMatch(source, /\.eb-time-track \{[^}]*min-width: max-content/);
});

test('pointer 位移使用 CSS 像素，不受设备像素比或缩放二次放大', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  const drag = source.match(/function moveTimeDrag\(event\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drag, /event\.clientX/);
  assert.match(source, /\(state\.x - state\.startX\) \* TIMELINE_MS_PER_PIXEL/);
  assert.doesNotMatch(drag, /devicePixelRatio|offsetWidth|scale\(/);
});
