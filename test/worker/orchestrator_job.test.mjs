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
  assert.equal(ctx.job.state, 'queued');
  assert.ok(ctx.alarm > Date.now());
  assert.equal(calls.length, 0);
});

test('首次 alarm 直接派发已持久化作业', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const calls = [];
  const job = new IngestJob(ctx, { RUNNER: { getByName: () => ({ fetch: async (url, init) => {
    calls.push({ url, init });
    return new Response('', { status: 202 });
  } }) } });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'b'.repeat(32) } }),
  }));
  const jobId = ctx.job.jobId;
  await job.alarm();
  assert.equal(ctx.job.attempts, 0);
  assert.equal(ctx.job.state, 'running');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://runner/run');
  assert.equal(JSON.parse(calls[0].init.body).job_id, jobId);
});

test('轮询把容器阶段和进度持久化给状态接口', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const job = new IngestJob(ctx, { RUNNER: { getByName: () => ({ fetch: async (url) => {
    if (url.endsWith('/run')) return new Response('', { status: 202 });
    return new Response(JSON.stringify({
      state: 'running', stage: 'downloading', progress: 23,
      message: '正在读取原料（2/9）', updated_at: '2026-08-26T12:00:00Z',
    }), { status: 200 });
  } }) } });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'c'.repeat(32) } }),
  }));
  await job.alarm();
  await job.alarm();
  assert.equal(ctx.job.state, 'running');
  assert.equal(ctx.job.stage, 'downloading');
  assert.equal(ctx.job.progress, 23);
  assert.equal(ctx.job.message, '正在读取原料（2/9）');
  assert.equal(ctx.job.updatedAt, '2026-08-26T12:00:00Z');
});

test('派发失败后保留同一作业并排队重试', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const job = new IngestJob(ctx, { RUNNER: { getByName: () => ({ fetch: async () => {
    throw new Error('container warming');
  } }) } });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'd'.repeat(32) } }),
  }));
  const jobId = ctx.job.jobId;
  await job.alarm();
  assert.equal(ctx.job.state, 'queued');
  assert.equal(ctx.job.attempts, 1);
  assert.equal(ctx.job.jobId, jobId);
  assert.equal(ctx.job.stage, 'retrying');
});
