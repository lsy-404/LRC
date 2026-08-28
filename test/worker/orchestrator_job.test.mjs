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

function readyBucket() {
  return {
    get: async (key) => {
      const ref = key.split('/')[1];
      return { text: async () => JSON.stringify({
        version: 2, album: '测试专辑', session: ref,
        files: [{ n: 0, path: '测试专辑/音轨.mp3', size: 4 }],
      }) };
    },
    head: async () => ({ size: 4 }),
  };
}

function runnerEnv(fetch) {
  return { UPLOAD_BUCKET: readyBucket(), RUNNER: { getByName: () => ({ fetch }) } };
}

test('start 先持久化并排队，不等待容器冷启动', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  const calls = [];
  const job = new IngestJob(ctx, runnerEnv(async (...args) => {
    calls.push(args);
    return new Response('', { status: 200 });
  }));
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
  const job = new IngestJob(ctx, runnerEnv(async (url, init) => {
    calls.push({ url, init });
    return new Response('', { status: 202 });
  }));
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
  const job = new IngestJob(ctx, runnerEnv(async (url) => {
    if (url.endsWith('/run')) return new Response('', { status: 202 });
    return new Response(JSON.stringify({
      state: 'running', stage: 'downloading', progress: 23,
      message: '正在读取原料（2/9）', updated_at: '2026-08-26T12:00:00Z',
    }), { status: 200 });
  }));
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
  const job = new IngestJob(ctx, runnerEnv(async () => {
    throw new Error('container warming');
  }));
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

test('Phase A 原料缺失时记录明确失败且绝不触达 Container', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  let calls = 0;
  const bucket = {
    get: async () => ({ text: async () => JSON.stringify({
      version: 2, album: '测试专辑', session: 'e'.repeat(32),
      files: [{ n: 7, path: '测试专辑/丢失.mp3', size: 12 }],
    }) }),
    head: async () => null,
  };
  const job = new IngestJob(ctx, {
    UPLOAD_BUCKET: bucket,
    RUNNER: { getByName: () => ({ fetch: async () => { calls += 1; return new Response(); } }) },
  });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'e'.repeat(32) } }),
  }));
  await job.alarm();
  assert.equal(ctx.job.state, 'failed');
  assert.match(ctx.job.error, /原料预检失败：缺少上传对象 7/);
  assert.equal(calls, 0);
});

test('Phase A 对象大小不符时记录清单与存储大小且绝不触达 Container', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  let calls = 0;
  const bucket = {
    get: async () => ({ text: async () => JSON.stringify({
      version: 2, album: '测试专辑', session: 'f'.repeat(32),
      files: [{ n: 1, path: '测试专辑/音轨.mp3', size: 12 }],
    }) }),
    head: async () => ({ size: 11 }),
  };
  const job = new IngestJob(ctx, {
    UPLOAD_BUCKET: bucket,
    RUNNER: { getByName: () => ({ fetch: async () => { calls += 1; return new Response(); } }) },
  });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: 'f'.repeat(32) } }),
  }));
  await job.alarm();
  assert.equal(ctx.job.state, 'failed');
  assert.match(ctx.job.error, /大小不匹配（清单 12，存储 11）/);
  assert.equal(calls, 0);
});

test('Phase A 总大小超过基础盘安全上限时不触达 Container', async () => {
  const IngestJob = await loadJob();
  const ctx = jobContext();
  let calls = 0;
  const bucket = {
    get: async () => ({ text: async () => JSON.stringify({
      version: 2, album: '测试专辑', session: '1'.repeat(32),
      files: [{ n: 0, path: '测试专辑/超大.flac', size: Math.ceil(1.26 * 1024 * 1024 * 1024) }],
    }) }),
    head: async () => ({ size: Math.ceil(1.26 * 1024 * 1024 * 1024) }),
  };
  const job = new IngestJob(ctx, {
    UPLOAD_BUCKET: bucket,
    RUNNER: { getByName: () => ({ fetch: async () => { calls += 1; return new Response(); } }) },
  });
  await job.fetch(new Request('https://job/start', {
    method: 'POST', body: JSON.stringify({ kind: 'phase_a', params: { ref: '1'.repeat(32) } }),
  }));
  await job.alarm();
  assert.equal(ctx.job.state, 'failed');
  assert.match(ctx.job.error, /上传总大小 1\.26 GiB 超过 1\.25 GiB 上限；请拆分专辑后重试/);
  assert.equal(calls, 0);
});

test('成功、失败和取消都会停止对应处理器，停止失败不覆盖终态', async () => {
  const IngestJob = await loadJob();
  const cases = [
    { name: 'success', status: { state: 'done', result: { result: 'ok' } }, expected: 'done' },
    { name: 'failure', status: { state: 'error', error: 'pipeline failed' }, expected: 'failed' },
    { name: 'cancel', status: null, expected: 'cancelled' },
  ];
  for (const scenario of cases) {
    const ctx = jobContext();
    let stops = 0;
    const runner = {
      fetch: async (url) => {
        if (url.endsWith('/run')) return new Response('', { status: 202 });
        return new Response(JSON.stringify(scenario.status), { status: 200 });
      },
      stop: async () => {
        stops += 1;
        if (scenario.name === 'failure') throw new Error('stop unavailable');
      },
    };
    const job = new IngestJob(ctx, { RUNNER: { getByName: () => runner } });
    await job.fetch(new Request('https://job/start', {
      method: 'POST', body: JSON.stringify({ kind: 'phase_b', params: { ref: scenario.name.repeat(8) } }),
    }));
    if (scenario.name === 'cancel') {
      await job.alarm();
      await job.fetch(new Request('https://job/cancel', { method: 'POST' }));
    } else {
      await job.alarm();
      await job.alarm();
    }
    assert.equal(stops, 1, scenario.name);
    assert.equal(ctx.job.state, scenario.expected, scenario.name);
  }
});
