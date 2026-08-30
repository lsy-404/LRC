import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPhotoLinks, normalizePhotoLinks, restoreItem,
} from '../docs/.vuepress/components/uploadDraft.js';

test('照片关联接受旧的单值草稿并去除重复目标', () => {
  assert.deepEqual(normalizePhotoLinks(3), [3]);
  assert.deepEqual(normalizePhotoLinks([3, '3', 'SP', 3]), [3, '3', 'SP']);
  const item = {};
  restoreItem(item, { linkTo: 4 });
  assert.deepEqual(item.linkTo, [4]);
});

test('共享照片生成一个含全部关联歌曲的 manifest 映射', () => {
  const links = collectPhotoLinks([
    { uid: 1, role: 'song', relPath: '音频/01.mp3' },
    { uid: 2, role: 'song', relPath: '音频/02.mp3' },
    { uid: 3, role: 'photo', relPath: '歌词本/page.jpg', linkTo: [1, 2, 1, 'SP'] },
  ]);
  assert.deepEqual(links, [['歌词本/page.jpg', ['01.mp3', '02.mp3']]]);
});
