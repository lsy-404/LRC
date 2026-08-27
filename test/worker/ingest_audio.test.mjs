import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../../functions/api/ingest/audio.js';
import { fakeBucket, authedRequest } from './_fakeR2.mjs';

const REF = 'f'.repeat(32);
const bucket = () => fakeBucket({
  [`web/${REF}/manifest.json`]: JSON.stringify({ files: [
    { n: 7, path: '专辑/悸动.flac', size: 6 }, { n: 8, path: '专辑/readme.txt', size: 4 },
  ] }),
  [`web/${REF}/7`]: 'abcdef',
});
const env = (UPLOAD_BUCKET) => ({ UPLOAD_BUCKET, UPLOAD_PASSWORD: 'pw' });

test('审核原音只由 manifest 精确映射，且用认证流式返回', async () => {
  const response = await onRequestGet({
    request: authedRequest(`https://x/api/ingest/audio?ref=${REF}&name=${encodeURIComponent('悸动.flac')}`),
    env: env(bucket()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/flac');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), 'abcdef');
});

test('审核原音支持单段 Range，拒绝任意对象路径与越界范围', async () => {
  const response = await onRequestGet({
    request: authedRequest(`https://x/api/ingest/audio?ref=${REF}&name=${encodeURIComponent('悸动.flac')}`, {
      password: 'pw',
    }),
    env: env(bucket()),
  });
  assert.equal(response.status, 200);
  const ranged = await onRequestGet({
    request: new Request(`https://x/api/ingest/audio?ref=${REF}&name=${encodeURIComponent('悸动.flac')}`, {
      headers: { authorization: 'Bearer pw', range: 'bytes=2-4' },
    }), env: env(bucket()),
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-4/6');
  assert.equal(await ranged.text(), 'cde');
  const blocked = await onRequestGet({
    request: authedRequest(`https://x/api/ingest/audio?ref=${REF}&name=../7`), env: env(bucket()),
  });
  assert.equal(blocked.status, 400);
  const missing = await onRequestGet({
    request: authedRequest(`https://x/api/ingest/audio?ref=${REF}&name=readme.txt`), env: env(bucket()),
  });
  assert.equal(missing.status, 400);
});

test('审核原音拒绝未认证和清单外同名文件', async () => {
  const unauthorized = await onRequestGet({
    request: new Request(`https://x/api/ingest/audio?ref=${REF}&name=x.mp3`), env: env(bucket()),
  });
  assert.equal(unauthorized.status, 401);
  const notFound = await onRequestGet({
    request: authedRequest(`https://x/api/ingest/audio?ref=${REF}&name=别的.mp3`), env: env(bucket()),
  });
  assert.equal(notFound.status, 404);
});
