import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fakeBucket } from './_fakeR2.mjs';

const REF = 'a'.repeat(32);

async function loadWorker() {
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
  const module = new vm.SourceTextModule(source, { identifier: 'index.js' });
  await module.link((specifier) => ({
    './lib.js': lib,
    './api.js': api,
    './job.js': job,
    './runner.js': runner,
    './users.js': users,
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
