import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('权威 LRC 锁定歌词编辑控件而保留试听和元数据保存', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /:disabled="t\.authoritativeLrc" @click="simplifyTrack\(t\)"/);
  assert.match(source, /if \(t\.authoritativeLrc\) return;/);
  assert.match(source, /:readonly="t\.authoritativeLrc" @focus="beginRowTimeEdit/);
  assert.match(source, /:readonly="t\.authoritativeLrc" @input="syncRowText/);
  assert.match(source, /:contenteditable="t\.authoritativeLrc \? 'false' : 'plaintext-only'"/);
  assert.match(source, /:disabled="t\.authoritativeLrc" @click="addLine/);
  assert.match(source, /:disabled="t\.authoritativeLrc" @click="addVocal/);
  assert.match(source, /if \(t\.authoritativeLrc\) return; const time = Math\.max\(0, Number\(t\.rows/);
  assert.match(source, /if \(t\.authoritativeLrc\) return; t\.rows = reconcileTimedRows/);
  assert.match(source, /if \(t\.authoritativeLrc\) \{\s+return \{\s+\.\.\.t\._orig,/);
  assert.match(source, /inst: !!t\.inst,\s+output_name: t\.outputName\.trim\(\),\s+final_name: t\.finalName\.trim\(\),/);
  assert.match(source, /@click="toggleSource\(t\)"/);
  assert.match(source, /@click="togglePreview\(t\)"/);
});
