import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../../worker/src/api.js';
import { fakeBucket, authedRequest } from './_fakeR2.mjs';

const REF = 'e'.repeat(32);

test('workstation API uses its local Durable Object instead of a public Worker request', async () => {
  const requests = [];
  const env = {
    UPLOAD_PASSWORD: 'pw',
    UPLOAD_BUCKET: fakeBucket(),
    JOB: { getByName: (name) => ({ fetch: async (request) => {
      requests.push({ name, request });
      return new Response(JSON.stringify({ state: 'running', stage: 'processing', progress: 20 }), {
        headers: { 'content-type': 'application/json' },
      });
    } }) },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('public fetch must not be used'); };
  try {
    const response = await handleApi(
      authedRequest(`https://lrc.example/api/ingest/state?ref=${REF}`), env);
    const data = await response.json();
    assert.equal(data.status, 'processing');
    assert.equal(data.job.progress, 20);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].name, REF);
    assert.equal(new URL(requests[0].request).pathname, '/state');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown workstation API route remains a JSON 404', async () => {
  const response = await handleApi(new Request('https://lrc.example/api/ingest/missing'), {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not found' });
});
