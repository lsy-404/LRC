import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as finalizePost } from '../functions/api/upload/finalize.js';
import { authedRequest, fakeBucket } from './worker/_fakeR2.mjs';

const REF = 'b'.repeat(32);
const USERS = { getByName: () => ({ resolveSession: () => ({ id: 1, name: 'editor', display_name: 'Editor', github: null, role: 'editor', status: 'active' }) }) };

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
      UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: bucket, USERS,
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
    env: { UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: fakeBucket(), USERS },
  });
  assert.equal(response.status, 400);
});
