import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

async function loadWorker() {
  const source = await fs.readFile(new URL('../../worker/src/index.js', import.meta.url), 'utf8');
  const lib = new vm.SyntheticModule(['json', 'authorized', 'cleanRef', 'cleanKey', 'cleanPrefix'], function () {
    this.setExport('json', (data, status = 200) => Response.json(data, { status }));
    this.setExport('authorized', async () => false);
    this.setExport('cleanRef', () => null);
    this.setExport('cleanKey', () => null);
    this.setExport('cleanPrefix', () => null);
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

test('static requests bypass internal token validation and use the assets binding', async () => {
  const worker = await loadWorker();
  const paths = [];
  const env = { ASSETS: { fetch: async (request) => {
    paths.push(new URL(request.url).pathname);
    return new Response('asset');
  } } };
  const album = await worker.fetch(new Request('https://lrc.example/api/albums.json'), env);
  const home = await worker.fetch(new Request('https://lrc.example/'), env);
  assert.equal(await album.text(), 'asset');
  assert.equal(await home.text(), 'asset');
  assert.deepEqual(paths, ['/api/albums.json', '/']);
});
