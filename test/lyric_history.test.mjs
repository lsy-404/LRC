import test from 'node:test';
import assert from 'node:assert/strict';
import { canRedoLyricHistory, canUndoLyricHistory, createLyricHistory, markLyricHistoryDirty, recordLyricHistory, redoLyricHistory, undoLyricHistory } from '../docs/.vuepress/components/lyricHistory.js';

function track() {
  return {
    _id: 9, rows: [{ _id: 1, time: 100, text: '你好', words: [{ _id: 2, time: 100, text: '你' }, { _id: 3, time: 200, text: '好' }] }],
    text: '你好', timingLocked: false, _textDirty: false,
    _previewMs: 900, _playing: true, _sourcePlaying: true, _speed: 1.5,
  };
}

test('每轨歌词历史恢复文本、行和逐字时间而不触及播放状态', () => {
  const current = track();
  const history = createLyricHistory(current);
  current.title = '新标题';
  current.head = ['[ar:新演唱]'];
  current.rows[0].words[1].time = 260;
  current.rows.push({ _id: 4, time: 400, text: '呀', words: [{ _id: 5, time: 400, text: '呀' }] });
  current.text = '你好\n呀';
  current.timingLocked = true;
  current._textDirty = true;
  assert.equal(recordLyricHistory(history, current), true);

  current._previewMs = 1200;
  current._playing = false;
  assert.equal(canUndoLyricHistory(history), true);
  assert.equal(undoLyricHistory(history, current), true);
  assert.deepEqual(current.rows.map((row) => row.text), ['你好']);
  assert.equal(current.rows[0].words[1].time, 200);
  assert.equal(current._previewMs, 1200);
  assert.equal(current._playing, false);
  assert.equal(current._sourcePlaying, true);
  assert.equal(current._id, 9);
  assert.equal(current.title, undefined);
  assert.deepEqual(current.head, []);
  assert.equal(redoLyricHistory(history, current), true);
  assert.equal(current.title, '新标题');
  assert.deepEqual(current.head, ['[ar:新演唱]']);
  assert.equal(current.rows[1].text, '呀');
  assert.equal(current.rows[0].words[1].time, 260);
});

test('新修改丢弃恢复分支并限制历史长度', () => {
  const current = track();
  const history = createLyricHistory(current, 2);
  current.text = '第一';
  recordLyricHistory(history, current);
  current.text = '第二';
  recordLyricHistory(history, current);
  assert.equal(history.entries.length, 2);
  undoLyricHistory(history, current);
  assert.equal(current.text, '第一');
  current.text = '替换';
  recordLyricHistory(history, current);
  assert.equal(canRedoLyricHistory(history), false);
  assert.equal(redoLyricHistory(history, current), false);
});

test('不同曲目的历史互不影响', () => {
  const first = track();
  const second = track();
  second.text = '另一曲';
  const firstHistory = createLyricHistory(first);
  const secondHistory = createLyricHistory(second);
  first.text = '第一曲修改';
  second.text = '第二曲修改';
  recordLyricHistory(firstHistory, first);
  recordLyricHistory(secondHistory, second);
  undoLyricHistory(firstHistory, first);
  assert.equal(first.text, '你好');
  assert.equal(second.text, '第二曲修改');
  assert.equal(secondHistory.index, 1);
});

test('连续输入在撤回时提交为单条历史，光标位置不产生歌词快照', () => {
  const current = track();
  current.rows[0]._selection = { start: 1, end: 1 };
  const history = createLyricHistory(current);
  current.rows[0]._selection = { start: 2, end: 2 };
  assert.equal(recordLyricHistory(history, current), false);
  current.text = '你好呀';
  current.rows[0].text = '你好呀';
  markLyricHistoryDirty(history);
  assert.equal(canUndoLyricHistory(history), true);
  assert.equal(canRedoLyricHistory(history), false);
  assert.equal(undoLyricHistory(history, current), true);
  assert.equal(current.text, '你好');
  assert.equal(history.entries.length, 2);
  assert.equal(redoLyricHistory(history, current), true);
  assert.equal(current.text, '你好呀');
});

test('和声历史深拷贝移动后的句行与首字时间', () => {
  const harmony = track();
  harmony.rows = [{ _id: 8, time: 2100, text: '和声', words: [{ _id: 9, time: 2180, text: '和' }, { _id: 10, time: 2470, text: '声' }] }];
  const history = createLyricHistory(harmony);
  harmony.rows = [];
  recordLyricHistory(history, harmony);
  undoLyricHistory(history, harmony);
  assert.deepEqual(harmony.rows[0].words.map((word) => word.time), [2180, 2470]);
});

test('主唱与和声移动作为一个历史步骤原子撤回和恢复', () => {
  const current = track();
  current._selectedVocal = 0;
  current._view = 'lrc';
  current._vocals = [
    { id: 'main', name: '主唱', head: [], rows: current.rows, text: current.text, timingLocked: true, _view: 'lrc' },
    { id: 'harmony', name: '和声', head: [], rows: [], text: '', timingLocked: true, _view: 'lrc' },
  ];
  const history = createLyricHistory(current);
  const moved = current.rows[0];
  current.rows = [];
  current.text = '';
  current._vocals[0].rows = current.rows;
  current._vocals[0].text = current.text;
  current._vocals[1].rows = [moved];
  current._vocals[1].text = moved.text;
  recordLyricHistory(history, current);
  assert.equal(undoLyricHistory(history, current), true);
  assert.equal(current._vocals[0].rows.length, 1);
  assert.equal(current._vocals[1].rows.length, 0);
  assert.equal(redoLyricHistory(history, current), true);
  assert.equal(current._vocals[0].rows.length, 0);
  assert.equal(current._vocals[1].rows.length, 1);
  assert.equal(current._vocals[1].rows[0].words[0].time, 100);
});
