import { DurableObject } from 'cloudflare:workers';
import { json } from './lib.js';

// 每个 ref 一个实例：单线程执行天然串行，取代原先 workflow 的并发组；
// 72h 人工闸门超时由闹钟兜底，取代原先的定时扫描工作流。
const POLL_MS = 10_000;
const MAX_RUN_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class IngestJob extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    switch (url.pathname) {
      case '/start':
        return json(await this.start(body.kind, body.params || {}));
      case '/continue':
        return json(await this.continueNow());
      case '/cancel':
        return json(await this.cancel());
      case '/state':
        return json((await this.ctx.storage.get('job')) || { state: 'unknown' });
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  async start(kind, params) {
    const running = await this.ctx.storage.get('job');
    if (running && running.state === 'running') {
      // 生成作业单实例串行，跑的过程中又有新提交 → 记一笔，跑完补一轮，别丢更新
      if (kind === 'generate') {
        await this.ctx.storage.put('job', { ...running, pending: true });
        return { ok: true, queued: true };
      }
      return { ok: false, reason: 'busy', phase: running.phase };
    }
    return this.#launch(kind, params);
  }

  // 人工闸门确认：草稿已备好才放行，其余状态原样返回给调用方判断
  async continueNow() {
    const job = await this.ctx.storage.get('job');
    if (!job) return { ok: false, reason: 'unknown' };
    if (job.state === 'running') return { ok: false, reason: 'busy', phase: job.phase };
    if (job.phase === 'phase_b' && job.state === 'done') return { ok: true, already: true };
    return this.#launch('phase_b', { ref: job.params?.ref || job.ref });
  }

  async cancel() {
    await this.ctx.storage.deleteAlarm();
    const job = (await this.ctx.storage.get('job')) || {};
    await this.ctx.storage.put('job', { ...job, state: 'cancelled', wait: null });
    return { ok: true };
  }

  async #launch(kind, params) {
    const job = {
      kind,
      phase: kind,
      params,
      ref: params.ref || kind,
      jobId: crypto.randomUUID(),
      state: 'running',
      startedAt: Date.now(),
      attempts: 0,
      wait: 'poll',
      result: null,
      error: null,
    };
    await this.ctx.storage.put('job', job);
    // 作业先落库并挂闹钟；首次容器触达由 alarm 完成，避免冷启动占住投稿请求。
    // 容器不可达时 alarm 会把作业重投一次，且作业状态不依赖任一 HTTP 调用存活。
    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    return { ok: true, queued: true, jobId: job.jobId, phase: kind };
  }

  #container(job) {
    return this.env.RUNNER.getByName(job.kind === 'generate' ? 'generate' : job.ref);
  }

  async #dispatch(job) {
    const resp = await this.#container(job).fetch('http://runner/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: job.jobId, kind: job.kind, params: job.params }),
    });
    if (!resp.ok) throw new Error(`容器拒绝作业: ${resp.status}`);
  }

  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job) return;

    // 无人处理，按超时自动续跑对齐入库
    if (job.wait === 'gate') {
      await this.#launch('phase_b', { ref: job.ref });
      return;
    }
    if (job.state !== 'running') return;

    let status = null;
    try {
      const resp = await this.#container(job).fetch(
        `http://runner/status?job_id=${job.jobId}`);
      status = resp.ok ? await resp.json() : { state: resp.status === 404 ? 'missing' : 'error' };
    } catch (e) {
      status = { state: 'unreachable', error: String(e) };
    }

    if (status.state === 'running') {
      if (Date.now() - job.startedAt > MAX_RUN_MS) {
        await this.#fail(job, '作业超时');
        return;
      }
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return;
    }

    if (status.state === 'done') {
      await this.#succeed(job, status.result || {}, status.log || []);
      return;
    }

    // 容器重启（或冷启动没赶上）会丢内存里的作业登记，整单重投一次；再失败才算数
    if ((status.state === 'missing' || status.state === 'unreachable') && job.attempts < 1) {
      const retry = { ...job, attempts: job.attempts + 1, jobId: crypto.randomUUID(),
                      startedAt: Date.now() };
      await this.ctx.storage.put('job', retry);
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      try {
        await this.#dispatch(retry);
      } catch (e) {
        await this.ctx.storage.put('job', { ...retry, lastError: String(e) });
      }
      return;
    }
    await this.#fail(job, status.error || job.lastError || `容器状态异常: ${status.state}`,
                     status.log || []);
  }

  async #succeed(job, result, log) {
    const done = { ...job, state: 'done', result, log: log.slice(-60), finishedAt: Date.now(),
                   wait: null };
    // Phase A 收工即进人工闸门，起 72h 闹钟；其余阶段到此结束
    if (job.kind === 'phase_a' && result.result === 'ok') {
      done.phase = 'awaiting_review';
      done.wait = 'gate';
      const hours = Number(this.env.REVIEW_TIMEOUT_HOURS || 72);
      await this.ctx.storage.setAlarm(Date.now() + hours * HOUR_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    await this.ctx.storage.put('job', done);
    await this.#drainPending(done);
  }

  async #fail(job, error, log = []) {
    await this.ctx.storage.deleteAlarm();
    const failed = { ...job, state: 'failed', error, log: log.slice(-60),
                     finishedAt: Date.now(), wait: null };
    await this.ctx.storage.put('job', failed);
    await this.#drainPending(failed);
  }

  async #drainPending(job) {
    if (!job.pending || job.kind !== 'generate') return;
    await this.ctx.storage.put('job', { ...job, pending: false });
    await this.#launch('generate', job.params || {});
  }
}
