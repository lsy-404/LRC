import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fakeBucket } from './_fakeR2.mjs';

const REF = 'a'.repeat(32);

async function loadWorker(studioFake = {}) {
  const source = await fs.readFile(new URL('../../worker/src/index.js', import.meta.url), 'utf8');
  const lib = new vm.SyntheticModule(['json', 'authorized', 'cleanRef', 'cleanKey', 'cleanPrefix'], function () {
    this.setExport('json', (data, status = 200) => Response.json(data, { status }));
    this.setExport('authorized', async () => true);
    this.setExport('cleanRef', (value) => value);
    this.setExport('cleanKey', (value) => /^(web|review)\/[^?#]+$/.test(value) ? value : null);
    this.setExport('cleanPrefix', (value) => /^(web|review)\/[^?#]*$/.test(value) ? value : null);
  });
  const api = new vm.SyntheticModule(['handleApi'], function () {
    this.setExport('handleApi', async () => Response.json({ api: true }));
  });
  const job = new vm.SyntheticModule(['IngestJob'], function () { this.setExport('IngestJob', class {}); });
  const runner = new vm.SyntheticModule(['PipelineRunner'], function () { this.setExport('PipelineRunner', class {}); });
  const users = new vm.SyntheticModule(['UserDirectory'], function () { this.setExport('UserDirectory', class {}); });
  const studio = new vm.SyntheticModule(['studioServer'], function () { this.setExport('studioServer', () => studioFake); });
  const module = new vm.SourceTextModule(source, { identifier: 'index.js' });
  await module.link((specifier) => ({
    './lib.js': lib,
    './api.js': api,
    './job.js': job,
    './runner.js': runner,
    './users.js': users,
    './studio.js': studio,
  })[specifier]);
  await module.evaluate();
  return module.namespace.default;
}

test('store retains completed web uploads while review bundles remain disposable', async () => {
  const worker = await loadWorker();
  const bucket = fakeBucket({
    [`web/${REF}/manifest.json`]: '{}',
    [`web/${REF}/0`]: 'original audio',
    [`web/${REF}/1`]: 'lyrics',
    [`review/${REF}/album/draft.json`]: '{}',
  });
  const env = { INGEST_TOKEN: 'token', UPLOAD_BUCKET: bucket };

  const single = await worker.fetch(new Request(`https://lrc.example/store/web/${REF}/0`, { method: 'DELETE' }), env);
  assert.equal(single.status, 409);
  assert.equal(bucket.store.get(`web/${REF}/0`), 'original audio');

  const prefix = await worker.fetch(new Request(`https://lrc.example/store?prefix=web/${REF}/`, { method: 'DELETE' }), env);
  assert.equal(prefix.status, 409);
  assert.equal(bucket.store.get(`web/${REF}/manifest.json`), '{}');
  assert.equal(bucket.store.get(`web/${REF}/1`), 'lyrics');

  const review = await worker.fetch(new Request(`https://lrc.example/store?prefix=review/${REF}/`, { method: 'DELETE' }), env);
  assert.equal(review.status, 200);
  assert.deepEqual(await review.json(), { deleted: 1 });
  assert.equal(bucket.store.has(`review/${REF}/album/draft.json`), false);
});

test('store streams manifest library audio as the submitter instead of reading R2', async () => {
  const streams = [];
  const worker = await loadWorker({ library: { stream: async (_env, subject, id) => { streams.push([subject, id]); return new Response('flac', { headers: { 'content-length': '4' } }); } } });
  const bucket = fakeBucket({
    [`web/${REF}/manifest.json`]: JSON.stringify({ version: 3, subject: 'acct-42', files: [{ n: 3, path: '01.flac', size: 4, library: 'so-1' }, { n: 4, path: 'scan.png', size: 2 }] }),
  });
  const env = { UPLOAD_BUCKET: bucket, INGEST_TOKEN: 'token' };
  const get = (n) => worker.fetch(new Request(`https://lrc.example/store/web/${REF}/${n}`, { headers: { authorization: 'Bearer token' } }), env);
  const audio = await get(3);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-length'), '4');
  assert.equal(await audio.text(), 'flac');
  assert.deepEqual(streams, [['acct-42', 'so-1']]);
  assert.equal((await get(4)).status, 404);
  assert.equal((await get(9)).status, 404);
});
