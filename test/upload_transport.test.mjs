import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_UPLOAD_LIMIT, MULTIPART_PART_SIZE, uploadFile, uploadMultipart, uploadR2,
} from '../docs/.vuepress/components/uploadTransport.js';

// 伪造 XHR：同步记录调用参数，按需驱动 upload.onprogress / onload / onerror。
class FakeXHR {
  constructor() { this.upload = {}; this.headers = {}; FakeXHR.instances.push(this); }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) { this.body = body; FakeXHR.onSend?.(this); }
}
FakeXHR.instances = [];

test('DIRECT_UPLOAD_LIMIT/MULTIPART_PART_SIZE 保持原始阈值（95MB 直传 / 20MB 分片）', () => {
  assert.equal(DIRECT_UPLOAD_LIMIT, 95 * 1024 * 1024);
  assert.equal(MULTIPART_PART_SIZE, 20 * 1024 * 1024);
});

test('uploadR2：通过 XHR 直传，携带 session/n/同源会话，进度回调驱动 it.pct', async () => {
  FakeXHR.instances = [];
  const it = { n: 3, file: new Blob(['data']), pct: 0 };
  FakeXHR.onSend = (xhr) => {
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ ok: true });
    xhr.onload();
  };
  const ok = await uploadR2(it, { session: 'sess1', XHR: FakeXHR });
  assert.equal(ok, true);
  assert.equal(it.pct, 50);
  const xhr = FakeXHR.instances[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/upload/r2?session=sess1&n=3');
  assert.equal(xhr.withCredentials, true);
  assert.equal(xhr.headers.authorization, undefined);
  assert.equal(xhr.body, it.file);
});

test('uploadR2：HTTP 非 200 或响应体不是 { ok: true } 均判定失败', async () => {
  const it = { n: 0, file: new Blob(['x']), pct: 0 };
  FakeXHR.onSend = (xhr) => { xhr.status = 500; xhr.responseText = '{}'; xhr.onload(); };
  assert.equal(await uploadR2(it, { session: 's', XHR: FakeXHR }), false);

  const it2 = { n: 0, file: new Blob(['x']), pct: 0 };
  FakeXHR.onSend = (xhr) => { xhr.status = 200; xhr.responseText = JSON.stringify({ ok: false }); xhr.onload(); };
  assert.equal(await uploadR2(it2, { session: 's', XHR: FakeXHR }), false);
});

test('uploadR2：网络错误（onerror）判定失败而不抛异常', async () => {
  const it = { n: 0, file: new Blob(['x']), pct: 0 };
  FakeXHR.onSend = (xhr) => xhr.onerror();
  assert.equal(await uploadR2(it, { session: 's', XHR: FakeXHR }), false);
});

function fakeMultipartServer() {
  const calls = [];
  const request = async (url, init) => {
    calls.push([url, init]);
    const u = new URL(url, 'https://x');
    const action = u.searchParams.get('action');
    if (action === 'create') return new Response(JSON.stringify({ ok: true, uploadId: 'up-1' }), { status: 200 });
    if (action === 'part') {
      const partNumber = Number(u.searchParams.get('partNumber'));
      return new Response(JSON.stringify({ ok: true, partNumber, etag: `etag-${partNumber}` }), { status: 200 });
    }
    if (action === 'complete') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: false }), { status: 400 });
  };
  return { request, calls };
}

test('uploadMultipart：按 MULTIPART_PART_SIZE 分片，create/part.../complete 全部走通并回写 pct', async () => {
  const { request, calls } = fakeMultipartServer();
  const size = MULTIPART_PART_SIZE * 2 + 10; // 3 片
  const it = { n: 5, file: { slice: (s, e) => ({ start: s, end: e }) }, size, pct: 0, multipart: null };
  const ok = await uploadMultipart(it, { session: 'sess', request });
  assert.equal(ok, true);
  assert.equal(it.pct, 100);
  assert.equal(it.multipart, null, '完成后清空分片状态');
  const actions = calls.map(([url]) => new URL(url, 'https://x').searchParams.get('action'));
  assert.deepEqual(actions, ['create', 'part', 'part', 'part', 'complete']);
  assert.equal(calls[1][1].credentials, 'same-origin');
});

test('uploadMultipart：已有 it.multipart 状态时跳过已完成的分片（断点续传）', async () => {
  const { request, calls } = fakeMultipartServer();
  const size = MULTIPART_PART_SIZE * 2;
  const it = {
    n: 1, file: { slice: (s, e) => ({ start: s, end: e }) }, size, pct: 0,
    multipart: { uploadId: 'resume-1', parts: [{ partNumber: 1, etag: 'etag-1' }] },
  };
  const ok = await uploadMultipart(it, { session: 'sess', request });
  assert.equal(ok, true);
  const actions = calls.map(([url]) => new URL(url, 'https://x').searchParams.get('action'));
  // 第一片已存在于状态里，不应重新走 create 或重复上传 part 1
  assert.deepEqual(actions, ['part', 'complete']);
  assert.equal(new URL(calls[0][0], 'https://x').searchParams.get('partNumber'), '2');
});

test('uploadMultipart：create 失败（无 uploadId）时整体返回 false', async () => {
  const request = async () => new Response(JSON.stringify({ ok: false }), { status: 500 });
  const it = { n: 0, file: { slice: () => ({}) }, size: MULTIPART_PART_SIZE + 1, pct: 0, multipart: null };
  assert.equal(await uploadMultipart(it, { session: 's', request }), false);
});

test('uploadFile：按文件大小分派到直传或分片上传', async () => {
  const smallCalls = [];
  const small = { n: 0, file: new Blob(['x']), size: DIRECT_UPLOAD_LIMIT - 1, pct: 0 };
  FakeXHR.onSend = (xhr) => { smallCalls.push(xhr.url); xhr.status = 200; xhr.responseText = JSON.stringify({ ok: true }); xhr.onload(); };
  assert.equal(await uploadFile(small, { session: 's', XHR: FakeXHR }), true);
  assert.match(smallCalls[0], /^\/api\/upload\/r2\?/);

  const { request } = fakeMultipartServer();
  const big = { n: 1, file: { slice: (s, e) => ({ start: s, end: e }) }, size: DIRECT_UPLOAD_LIMIT + 1, pct: 0, multipart: null };
  assert.equal(await uploadFile(big, { session: 's', request }), true);
});
