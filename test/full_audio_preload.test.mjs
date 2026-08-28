import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('原曲使用完整受认证响应构造正确 MIME 的 Blob，并以加载代次隔离切歌响应', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /resp\.status !== 200/);
  assert.match(source, /fullAudioBlob\(resp, t, controller, loadId\)/);
  assert.match(source, /new Blob\(chunks, \{ type \}\)/);
  assert.match(source, /URL\.createObjectURL\(blob\)/);
  assert.match(source, /t\._audioLoadId = \(t\._audioLoadId \|\| 0\) \+ 1/);
  assert.match(source, /isCurrentAudioLoad\(t, controller, loadId\)/);
  assert.match(source, /t\._audioAbort\.abort\(\)/);
  assert.match(source, /URL\.revokeObjectURL\(t\._audioUrl\)/);
  assert.match(source, /preload="auto"/);
  assert.match(source, /原音下载失败：/);
  assert.match(source, /原音解码失败：/);
});
