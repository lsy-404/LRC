import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricHistory, undoLyricHistory } from '../docs/.vuepress/components/lyricHistory.js';
import { toDraft, toEdit } from '../docs/.vuepress/components/workspaceDocument.js';

// outputName/finalName 与草稿字段的映射（toEdit()/toDraft()）阶段 1.1 已抽到
// workspaceDocument.js；这里改为对纯函数的真实输入输出断言，不再钉 EditBox.vue 源码。
test('输出文件名字段从工作台草稿读写并在伴奏时显示最终文件名', () => {
  let id = 1;
  const newId = () => id++;
  const draft = {
    album: '专辑', meta: {}, names: {}, pages: [],
    tracks: [{ order: 1, title: '曲', inst: true, output_name: '导出名', final_name: '伴奏最终名', lines: ['一', '二'] }],
  };
  const e = toEdit('storage', draft, newId);
  const track = e.tracks[0];
  assert.equal(track.outputName, '导出名');
  assert.equal(track.finalName, '伴奏最终名');

  track.outputName = '新导出名';
  track.finalName = '新伴奏名';
  const out = toDraft(e);
  assert.equal(out.tracks[0].output_name, '新导出名');
  assert.equal(out.tracks[0].final_name, '新伴奏名');

  track.inst = false;
  const outNonInst = toDraft(e);
  assert.equal(outNonInst.tracks[0].final_name, '', '非伴奏轨不落最终文件名');
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
