import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLyricHistory, undoLyricHistory } from '../docs/.vuepress/components/lyricHistory.js';

test('输出文件名字段从工作台草稿读写并在伴奏时显示最终文件名', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /v-model="t\.outputName"/);
  assert.match(source, /v-if="t\.inst" v-model="t\.finalName"/);
  assert.match(source, /outputName: t\.output_name \|\| ''/);
  assert.match(source, /output_name: t\.outputName\.trim\(\)/);
  assert.match(source, /final_name: t\.inst \? t\.finalName\.trim\(\) : ''/);
});

test('输出文件名进入歌词编辑历史', () => {
  const track = { order: 1, title: '歌', inst: false, outputName: '', finalName: '', rows: [], text: '', timingLocked: false, _textDirty: false };
  const history = createLyricHistory(track);
  track.outputName = '导出名';
  track.finalName = '伴奏最终名';
  history.dirty = true;
  assert.equal(undoLyricHistory(history, track), true);
  assert.equal(track.outputName, '');
  assert.equal(track.finalName, '');
});
