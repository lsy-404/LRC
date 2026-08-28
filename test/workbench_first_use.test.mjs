import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workbench = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

test('workbench shows a one-time, reopenable guide after explicit verification', async () => {
  const source = await readFile(workbench, 'utf8');

  assert.match(source, /if \(!silent && !hasSeenIntro\(\)\) showGuide\.value = true/);
  assert.match(source, /const INTRO_KEY = 'lrc-workstation-intro-seen'/);
  assert.match(source, /localStorage\.setItem\(INTRO_KEY, '1'\)/);
  assert.match(source, /之后可随时点击“使用指引”重新打开/);
});

test('guide documents the complete submission flow and editor shortcuts', async () => {
  const source = await readFile(workbench, 'utf8');

  for (const text of ['上传', '等待处理', '修改 / 试听', '保存 / 确认', '空格', '←', '→', '↑', '↓']) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /@keydown\.esc="closeGuide"/);
});
