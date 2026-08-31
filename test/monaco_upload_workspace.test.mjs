import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDraft, serializeDraft } from '../docs/.vuepress/components/uploadDraft.js';

const uploadPath = new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url);
const monacoPath = new URL('../docs/.vuepress/components/MonacoLrcEditor.vue', import.meta.url);

test('上传配置与文本歌词复用 Monaco，并仅在应用时写回文件模型', async () => {
  const source = await readFile(uploadPath, 'utf8');
  assert.match(source, /import MonacoLrcEditor from '\.\/MonacoLrcEditor\.vue'/);
  assert.match(source, /v-model="submissionSource" language="submission"/);
  assert.match(source, /@click="applySubmissionSource"/);
  assert.match(source, /function applySubmissionSource\(\)[\s\S]*?submissionSourceDirty\.value = false[\s\S]*?scheduleSave\(\)/);
  assert.match(source, /<MonacoLrcEditor v-model="textSource" :language="textLanguage"/);
  assert.match(source, /item\.file = new File\(\[textSource\.value\]/);
  assert.doesNotMatch(source, /v-model="album"|v-model="linkBili"|v-model="linkDizzy"|v-model="lyricMakerText"/);
});

test('投稿配置语言覆盖投稿字段、曲目、角色和链接，并随系统暗色主题切换', async () => {
  const source = await readFile(monacoPath, 'utf8');
  assert.match(source, /languages\.register\(\{ id: 'submission'/);
  assert.match(source, /投稿类型\|专辑\|发布 PV\|购买\|歌词制作/);
  assert.match(source, /trackId|role|url/);
  assert.match(source, /prefers-color-scheme: dark/);
});

test('应用投稿配置后的链接字段进入本地草稿并可恢复', () => {
  const draft = serializeDraft('专辑', [{ relPath: '音频/01.mp3', role: 'song' }], 1, '', [], 'album', {
    linkBili: 'https://www.bilibili.com/video/BV1', linkDizzy: 'https://www.dizzylab.net/d/1',
  });
  const restored = readDraft({ getItem: () => JSON.stringify(draft), removeItem() {} }, 2);
  assert.equal(restored.linkBili, 'https://www.bilibili.com/video/BV1');
  assert.equal(restored.linkDizzy, 'https://www.dizzylab.net/d/1');
});
