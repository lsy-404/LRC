import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDraft, serializeDraft } from '../docs/.vuepress/components/uploadDraft.js';
import { onRequestPost as finalizePost } from '../functions/api/upload/finalize.js';
import { authedRequest, fakeBucket } from './worker/_fakeR2.mjs';

const REF = 'b'.repeat(32);

test('单曲 finalize 强制落入单曲并保留同一 web session 前缀', async () => {
  const bucket = fakeBucket();
  const response = await finalizePost({
    request: authedRequest('https://x/api/upload/finalize', {
      method: 'POST', body: {
        album: '客户端不能指定的专辑', submission_type: 'single', session: REF,
        files: [{ n: 0, path: '音频/01.mp3', size: 1 }],
      },
    }),
    env: {
      UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: bucket,
      INGEST_INTERNAL_CALL: async () => ({ ok: true, status: 200, data: { ok: true } }),
    },
  });
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${REF}/manifest.json`));
  assert.equal(manifest.album, '单曲');
  assert.equal(manifest.submission_type, 'single');
  assert.equal(bucket.store.has(`web/${REF}/0`), false);
});

test('finalize 拒绝未知投稿类型', async () => {
  const response = await finalizePost({
    request: authedRequest('https://x/api/upload/finalize', {
      method: 'POST', body: {
        album: '测试', submission_type: 'collection', session: REF,
        files: [{ n: 0, path: '音频/01.mp3', size: 1 }],
      },
    }),
    env: { UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: fakeBucket() },
  });
  assert.equal(response.status, 400);
});

test('单曲草稿恢复投稿类型，旧草稿仍按专辑处理', () => {
  const item = { relPath: '音频/01.mp3', role: 'song' };
  const single = serializeDraft('', [item], 10, '', [], 'single');
  const storage = { getItem: () => JSON.stringify(single), removeItem() {} };
  assert.equal(readDraft(storage, 11).submissionType, 'single');
  const oldStorage = { getItem: () => JSON.stringify({ album: '旧专辑', at: 10, files: [item] }), removeItem() {} };
  assert.equal(readDraft(oldStorage, 11).submissionType, 'album');
});

test('单曲界面不提供目标专辑输入，提交与自动 manifest 均携带投稿类型', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url), 'utf8');
  assert.match(source, /submissionType === 'single'/);
  assert.match(source, /单曲投稿将进入「单曲」目录/);
  assert.match(source, /submission_type: submissionType\.value/);
  assert.match(source, /submission_type = "single"/);
  assert.match(source, /submissionType\.value = 'album'/);
});
