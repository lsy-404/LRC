import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

class FakeDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

async function loadJob() {
  const source = await fs.readFile(new URL('../../worker/src/job.js', import.meta.url), 'utf8');
  const workers = new vm.SyntheticModule(['DurableObject'], function () {
    this.setExport('DurableObject', FakeDurableObject);
  });
  const lib = new vm.SyntheticModule(['json'], function () {
    this.setExport('json', (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json' },
    }));
  });
  const module = new vm.SourceTextModule(source, { identifier: 'job.js' });
  await module.link((specifier) => {
    if (specifier === 'cloudflare:workers') return workers;
    if (specifier === './lib.js') return lib;
    throw new Error(`unexpected import: ${specifier}`);
  });
  await module.evaluate();
  return module.namespace.IngestJob;
}

function jobContext() {
  let job;
  let alarm = null;
  return {
    storage: {
      get: async () => job,
      put: async (_key, value) => { job = structuredClone(value); },
      setAlarm: async (value) => { alarm = value; },
      deleteAlarm: async () => { alarm = null; },
    },
    get job() { return job; },
    get alarm() { return alarm; },
  };
}

test('start 先持久化并排队，不等待容器冷启动', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const calls = [];
  const job = new IngestJob(ctx, { RUNNER: { getByName: () => ({ fetch: async (...args) => {
    calls.push(args);
    return new Response('', { status: 200 });
  } }) } });
  const response = await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'a'.repeat(32) } }),
  }));
  const body = await response.json();
  assert.deepEqual({ ok: body.ok, queued: body.queued, phase: body.phase },
    { ok: true, queued: true, phase: 'phase_a' });
  assert.equal(ctx.job.state, 'running');
  assert.ok(ctx.alarm > Date.now());
  assert.equal(calls.length, 0);
});

test('首次 alarm 检查容器后重投已持久化作业', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const calls = [];
  const job = new IngestJob(ctx, { RUNNER: { getByName: () => ({ fetch: async (url) => {
    calls.push(url);
    return url.includes('/status')
      ? new Response('{}', { status: 404 })
      : new Response('', { status: 200 });
  } }) } });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'b'.repeat(32) } }),
  }));
  await job.alarm();
  assert.equal(ctx.job.attempts, 1);
  assert.ok(calls[0].includes('/status?job_id='));
  assert.equal(calls[1], 'http://runner/run');
});
