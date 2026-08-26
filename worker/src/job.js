import { DurableObject } from 'cloudflare:workers';
import { json } from './lib.js';

// 每个 ref 一个实例：单线程执行天然串行，取代原先 workflow 的并发组；
// 72h 人工闸门超时由闹钟兜底，取代原先的定时扫描工作流。
const POLL_MS = 10_000;
const INITIAL_DISPATCH_DELAY_MS = 1_000;
const MAX_DISPATCH_ATTEMPTS = 3;
const MAX_RUN_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const ACTIVE_STATES = new Set(['queued', 'dispatching', 'running']);

function progress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

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
    if (running && ACTIVE_STATES.has(running.state)) {
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
    if (ACTIVE_STATES.has(job.state)) return { ok: false, reason: 'busy', phase: job.phase };
    if (job.phase === 'phase_b' && job.state === 'done') return { ok: true, already: true };
    return this.#launch('phase_b', { ref: job.params?.ref || job.ref });
  }

  async cancel() {
    await this.ctx.storage.deleteAlarm();
    const job = (await this.ctx.storage.get('job')) || {};
    await this.ctx.storage.put('job', {
      ...job, state: 'cancelled', stage: 'cancelled', progress: null,
      message: '作业已取消', wait: null, finishedAt: Date.now(),
    });
    return { ok: true };
  }

  async #launch(kind, params) {
    const job = {
      kind,
      phase: kind,
      params,
      ref: params.ref || kind,
      jobId: crypto.randomUUID(),
      state: 'queued',
      startedAt: Date.now(),
      attempts: 0,
      wait: 'dispatch',
      stage: 'queued',
      progress: 5,
      message: '已排队，正在准备处理器',
      result: null,
      error: null,
    };
    await this.ctx.storage.put('job', job);
    // 作业先落库并挂闹钟；首次容器触达由 alarm 完成，避免冷启动占住投稿请求。
    await this.ctx.storage.setAlarm(Date.now() + INITIAL_DISPATCH_DELAY_MS);
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
    if (job.state === 'queued' || job.state === 'dispatching') {
      await this.#dispatchQueued(job);
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
      await this.ctx.storage.put('job', {
        ...job,
        stage: status.stage || job.stage || 'processing',
        progress: progress(status.progress) ?? job.progress ?? 25,
        message: status.message || job.message || '正在处理投稿',
        updatedAt: status.updated_at || Date.now(),
        lastError: null,
      });
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return;
    }

    if (status.state === 'done') {
      await this.#succeed(job, status.result || {}, status.log || []);
      return;
    }

    // 容器重启会丢内存中的作业登记。以同一个 jobId 重投，容器仍在时可幂等恢复。
    if ((status.state === 'missing' || status.state === 'unreachable')
        && job.attempts < MAX_DISPATCH_ATTEMPTS) {
      await this.#requeue(job, status.error || '处理器连接中断');
      return;
    }
    await this.#fail(job, status.error || job.lastError || `容器状态异常: ${status.state}`,
                     status.log || []);
  }

  async #dispatchQueued(job) {
    const starting = {
      ...job,
      state: 'dispatching',
      stage: 'starting',
      progress: Math.max(progress(job.progress) || 0, 12),
      message: '正在启动处理器',
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put('job', starting);
    // 派发请求本身也可能被冷启动中断；先保留一次闹钟，重入同一 jobId 是幂等的。
    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    try {
      await this.#dispatch(starting);
      const running = {
        ...starting,
        state: 'running',
        wait: 'poll',
        stage: 'processing',
        progress: Math.max(progress(starting.progress) || 0, 20),
        message: '处理器已启动，正在处理投稿',
        dispatchedAt: Date.now(),
      };
      await this.ctx.storage.put('job', running);
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    } catch (e) {
      await this.#requeue(job, String(e));
    }
  }

  async #requeue(job, reason) {
    const attempts = (job.attempts || 0) + 1;
    if (attempts > MAX_DISPATCH_ATTEMPTS) {
      await this.#fail(job, reason);
      return;
    }
    const retry = {
      ...job,
      state: 'queued',
      wait: 'dispatch',
      attempts,
      stage: 'retrying',
      progress: Math.max(progress(job.progress) || 0, 10),
      message: '处理器暂不可用，正在重试',
      lastError: reason,
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put('job', retry);
    await this.ctx.storage.setAlarm(Date.now() + Math.min(POLL_MS * attempts, 30_000));
  }

  async #succeed(job, result, log) {
    const done = { ...job, state: 'done', result, log: log.slice(-60), finishedAt: Date.now(),
                   wait: null, stage: 'done', progress: 100, message: '处理完成' };
    // Phase A 收工即进人工闸门，起 72h 闹钟；其余阶段到此结束
    if (job.kind === 'phase_a' && result.result === 'ok') {
      done.phase = 'awaiting_review';
      done.wait = 'gate';
      done.stage = 'awaiting_review';
      done.message = '初稿已生成，等待人工审核';
      const hours = Number(this.env.REVIEW_TIMEOUT_HOURS || 72);
      await this.ctx.storage.setAlarm(Date.now() + hours * HOUR_MS);
    } else if (job.kind === 'phase_a') {
      await this.#fail(job, 'Phase A 未生成可审核草稿', log);
      return;
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    await this.ctx.storage.put('job', done);
    await this.#drainPending(done);
  }

  async #fail(job, error, log = []) {
    await this.ctx.storage.deleteAlarm();
    const failed = { ...job, state: 'failed', error, log: log.slice(-60),
                     finishedAt: Date.now(), wait: null, stage: 'failed',
                     progress: progress(job.progress), message: error };
    await this.ctx.storage.put('job', failed);
    await this.#drainPending(failed);
  }

  async #drainPending(job) {
    if (!job.pending || job.kind !== 'generate') return;
    await this.ctx.storage.put('job', { ...job, pending: false });
    await this.#launch('generate', job.params || {});
  }
}
