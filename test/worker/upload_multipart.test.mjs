import test from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestPost, onRequestPut, onRequestDelete,
} from '../../functions/api/upload/multipart.js';
import { fakeBucket } from './_fakeR2.mjs';

const REF = 'a'.repeat(32);
const env = () => ({ UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: fakeBucket() });
const auth = { authorization: 'Bearer pw' };

test('multipart 拒绝未验证的上传请求', async () => {
  const target = env();
  const response = await onRequestPost({
    request: new Request(
      `https://x/api/upload/multipart?session=${REF}&n=0&action=create`, { method: 'POST' }),
    env: target,
  });
  assert.equal(response.status, 401);
});

test('multipart 将分片按顺序合并为 R2 原料对象', async () => {
  const target = env();
  const base = `https://x/api/upload/multipart?session=${REF}&n=0`;
  const create = await onRequestPost({
    request: new Request(base + '&action=create', { method: 'POST', headers: auth }), env: target,
  });
  const { uploadId } = await create.json();
  assert.ok(uploadId);

  const parts = [];
  for (const [partNumber, body] of [[1, 'hello '], [2, 'world']]) {
    const response = await onRequestPut({
      request: new Request(base + `&action=part&uploadId=${uploadId}&partNumber=${partNumber}`, {
        method: 'PUT', headers: auth, body,
      }), env: target,
    });
    const data = await response.json();
    assert.equal(data.ok, true);
    parts.push({ partNumber: data.partNumber, etag: data.etag });
  }

  const complete = await onRequestPost({
    request: new Request(base + `&action=complete&uploadId=${uploadId}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ parts }),
    }), env: target,
  });
  assert.equal(complete.status, 200);
  assert.equal(target.UPLOAD_BUCKET.store.get(`web/${REF}/0`), 'hello world');
});

test('multipart 拒绝乱序完成与无效上传编号', async () => {
  const target = env();
  const base = `https://x/api/upload/multipart?session=${REF}&n=0`;
  const create = await onRequestPost({
    request: new Request(base + '&action=create', { method: 'POST', headers: auth }), env: target,
  });
  const { uploadId } = await create.json();
  const complete = await onRequestPost({
    request: new Request(base + `&action=complete&uploadId=${uploadId}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 2, etag: 'x' }] }),
    }), env: target,
  });
  assert.equal(complete.status, 400);

  const bad = await onRequestPut({
    request: new Request(base + '&action=part&uploadId=bad&partNumber=0', {
      method: 'PUT', headers: auth, body: 'x',
    }), env: target,
  });
  assert.equal(bad.status, 400);
});

test('multipart 可中止未完成上传', async () => {
  const target = env();
  const base = `https://x/api/upload/multipart?session=${REF}&n=0`;
  const create = await onRequestPost({
    request: new Request(base + '&action=create', { method: 'POST', headers: auth }), env: target,
  });
  const { uploadId } = await create.json();
  const response = await onRequestDelete({
    request: new Request(base + `&action=abort&uploadId=${uploadId}`, { method: 'DELETE', headers: auth }),
    env: target,
  });
  assert.equal(response.status, 200);
});
