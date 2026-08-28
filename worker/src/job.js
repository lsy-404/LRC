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
const MAX_UPLOAD_FILES = 500;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = 25 * 1000 * 1000;
const TRANSCRIPTION_BATCH_SIZE = 2;
const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const AUDIO_MIMES = new Set([
  'audio/flac', 'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/mpga',
  'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
]);

function progress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function preflightError(message) {
  return `原料预检失败：${message}`;
}

function bytesLabel(bytes) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function validAlbum(value) {
  return typeof value === 'string' && value.trim() && value.length <= 120
    && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

function validPath(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) return false;
  const parts = value.normalize('NFC').replaceAll('\\', '/').split('/');
  return parts.length <= 10 && parts.every((part) => part && part !== '.' && part !== '..'
    && part.length <= 200 && !/[\u0000-\u001f\u007f]/.test(part));
}

function validFile(file, ref, seen) {
  if (!file || typeof file !== 'object' || !Number.isInteger(file.n)
      || file.n < 0 || file.n >= MAX_UPLOAD_FILES || seen.has(file.n)
      || !validPath(file.path)
      || !Number.isSafeInteger(file.size) || file.size < 0) return null;
  seen.add(file.n);
  return `web/${ref}/${file.n}`;
}

function audioFile(file) {
  return typeof file?.mime === 'string' && AUDIO_MIMES.has(file.mime.toLowerCase());
}

function multipartStream(boundary, fields, file, body) {
  const encoder = new TextEncoder();
  const head = [
    ...fields.flatMap(([name, value]) => [
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ]),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.webm"\r\nContent-Type: ${file.mime}\r\n\r\n`,
  ].join('');
  const tail = `\r\n--${boundary}--\r\n`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(head));
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.enqueue(encoder.encode(tail));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function readError(response, limit = 300) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.slice(0, limit - size);
      chunks.push(part);
      size += part.byteLength;
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(chunks.length === 1 ? chunks[0] : chunks.reduce((out, part) => {
    const next = new Uint8Array(out.byteLength + part.byteLength);
    next.set(out); next.set(part, out.byteLength); return next;
  }, new Uint8Array()));
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
    await this.#stopContainer(job);
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

  async #preflightPhaseA(job) {
    const ref = job.params?.ref;
    if (typeof ref !== 'string' || !ref) return { error: preflightError('缺少投稿标识') };
    let manifestObject;
    try {
      manifestObject = await this.env.UPLOAD_BUCKET?.get(`web/${ref}/manifest.json`);
    } catch {
      return { error: preflightError('无法读取上传清单') };
    }
    if (!manifestObject) return { error: preflightError('找不到上传清单') };

    let manifest;
    try {
      manifest = JSON.parse(await manifestObject.text());
    } catch {
      return { error: preflightError('上传清单不是有效 JSON') };
    }
    if (!manifest || manifest.version !== 3 || !validAlbum(manifest.album)
        || manifest.session !== ref || !Array.isArray(manifest.files)
        || !manifest.files.length || manifest.files.length > MAX_UPLOAD_FILES) {
      return { error: preflightError('上传清单结构无效') };
    }

    const seen = new Set();
    const audioNames = new Set();
    let totalSize = 0;
    for (const file of manifest.files) {
      const key = validFile(file, ref, seen);
      if (!key) return { error: preflightError('上传文件条目无效') };
      if (audioFile(file) && file.size > MAX_TRANSCRIPTION_BYTES) {
        return { error: preflightError(`音频 ${file.path} 超过 OpenAI 的 25 MB 转写上限；请在上传前压缩`) };
      }
      if (audioFile(file)) {
        const name = file.path.split('/').at(-1).normalize('NFC').toLocaleLowerCase();
        if (audioNames.has(name)) return { error: preflightError(`音频文件名重复 ${file.path}`) };
        audioNames.add(name);
      }
      if (String(file.path).match(/\.(?:mp3|wav|flac|m4a|ogg|webm|mp4)$/i) && !audioFile(file)) {
        return { error: preflightError(`音频 ${file.path} 缺少有效 MIME；请重新选择并压缩该文件`) };
      }
      totalSize += file.size;
      if (totalSize > MAX_UPLOAD_BYTES) {
        return { error: preflightError(`上传总大小 ${bytesLabel(totalSize)} 超过 ${bytesLabel(MAX_UPLOAD_BYTES)} 上限；请压缩原始音频后重试`) };
      }
      let object;
      try {
        object = await this.env.UPLOAD_BUCKET.head(key);
      } catch {
        return { error: preflightError(`无法读取上传对象 ${file.n}`) };
      }
      if (!object) return { error: preflightError(`缺少上传对象 ${file.n}`) };
      if (object.size !== file.size) {
        return { error: preflightError(`上传对象 ${file.n} 大小不匹配（清单 ${file.size}，存储 ${object.size}）`) };
      }
    }
    return { manifest };
  }

  async #transcribe(job, file) {
    const object = await this.env.UPLOAD_BUCKET.get(`web/${job.ref}/${file.n}`);
    if (!object?.body) throw new Error(`无法读取音频 ${file.path}`);
    if (!this.env.LLM_API_KEY) throw new Error('未配置音频转写密钥');
    const boundary = `lrc-${crypto.randomUUID()}`;
    const response = await fetch(OPENAI_TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.env.LLM_API_KEY}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartStream(boundary, [
        ['model', 'whisper-1'],
        ['response_format', 'verbose_json'],
        ['timestamp_granularities[]', 'word'],
        ['timestamp_granularities[]', 'segment'],
      ], file, object.body),
    });
    if (!response.ok) {
      const detail = await readError(response);
      throw new Error(`OpenAI 转写失败 ${file.path}: ${response.status} ${detail}`);
    }
    const result = await response.json();
    await this.env.UPLOAD_BUCKET.put(`web/${job.ref}/stt/${file.n}.json`, JSON.stringify({
      n: file.n, path: file.path, mime: file.mime, result,
    }), { httpMetadata: { contentType: 'application/json' } });
  }

  async #prepareAudio(job, manifest) {
    const audio = manifest.files.filter(audioFile);
    const status = { ...(job.transcriptions || {}) };
    const pending = audio.filter((file) => status[file.n]?.state !== 'done');
    if (!pending.length) return { ready: true, job };
    const batch = pending.slice(0, TRANSCRIPTION_BATCH_SIZE);
    const processing = {
      ...job,
      state: 'queued', wait: 'transcribing', stage: 'transcribing',
      progress: Math.max(progress(job.progress) || 0, 15),
      message: `正在识别音频（${audio.length - pending.length + 1}-${audio.length - pending.length + batch.length}/${audio.length}）`,
      transcriptions: { ...status, ...Object.fromEntries(batch.map((file) => [file.n, { state: 'running', path: file.path }])) },
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put('job', processing);
    const settled = await Promise.allSettled(batch.map((file) => this.#transcribe(processing, file)));
    const transcriptions = { ...(processing.transcriptions || {}) };
    const failed = [];
    for (let index = 0; index < batch.length; index += 1) {
      const file = batch[index];
      const outcome = settled[index];
      if (outcome.status === 'fulfilled') transcriptions[file.n] = { state: 'done', path: file.path };
      else {
        const error = String(outcome.reason?.message || outcome.reason);
        transcriptions[file.n] = { state: 'failed', path: file.path, error };
        failed.push(error);
      }
    }
    if (failed.length) {
      await this.#fail({ ...processing, transcriptions }, failed.join('\n'), [], false);
      return { ready: false };
    }
    const complete = audio.every((file) => transcriptions[file.n]?.state === 'done');
    const doneCount = Object.values(transcriptions).filter((entry) => entry.state === 'done').length;
    const updated = {
      ...processing, transcriptions, wait: complete ? 'dispatch' : 'transcribing',
      stage: complete ? 'ready_to_align' : 'transcribing',
      progress: complete ? 35 : Math.max(15, Math.round(15 + (20 * doneCount / Math.max(audio.length, 1)))),
      message: complete ? '全部音频已识别，正在启动对齐' : '正在识别剩余音频',
      params: { ...processing.params, sttKey: `web/${job.ref}/stt` },
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put('job', updated);
    if (!complete) {
      await this.ctx.storage.setAlarm(Date.now() + INITIAL_DISPATCH_DELAY_MS);
      return { ready: false };
    }
    return { ready: true, job: updated };
  }

  async #verifyPreparedAudio(job, manifest) {
    for (const file of manifest.files.filter(audioFile)) {
      const object = await this.env.UPLOAD_BUCKET.get(`web/${job.ref}/stt/${file.n}.json`);
      if (!object) return `缺少音频预转写结果 ${file.path}`;
      let entry;
      try {
        entry = JSON.parse(await object.text());
      } catch {
        return `音频预转写结果无效 ${file.path}`;
      }
      if (entry?.n !== file.n || entry?.path !== file.path || entry?.mime !== file.mime
          || !entry?.result || typeof entry.result !== 'object') {
        return `音频预转写结果不匹配 ${file.path}`;
      }
    }
    return '';
  }

  async #stopContainer(job) {
    try {
      await this.#container(job).stop();
    } catch (e) {
      // 作业终态已持久化，停止失败只能留日志，不能把已知结果改成失败。
      console.error(`停止处理器失败 (${job.ref}): ${String(e)}`);
    }
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
      let dispatchJob = starting;
      if (starting.kind === 'phase_a') {
        const checking = {
          ...starting,
          stage: 'preflight',
          progress: Math.max(progress(starting.progress) || 0, 10),
          message: '正在核对上传原料',
          updatedAt: Date.now(),
        };
        await this.ctx.storage.put('job', checking);
        const preflight = await this.#preflightPhaseA(checking);
        if (preflight.error) {
          await this.#fail(checking, preflight.error, [], false);
          return;
        }
        const prepared = await this.#prepareAudio(checking, preflight.manifest);
        if (!prepared.ready) return;
        const sttError = await this.#verifyPreparedAudio(prepared.job, preflight.manifest);
        if (sttError) {
          await this.#fail(prepared.job, sttError, [], false);
          return;
        }
        dispatchJob = prepared.job;
      }
      await this.#dispatch(dispatchJob);
      const running = {
        ...dispatchJob,
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
    await this.#stopContainer(job);
    await this.#drainPending(done);
  }

  async #fail(job, error, log = [], stopContainer = true) {
    await this.ctx.storage.deleteAlarm();
    const failed = { ...job, state: 'failed', error, log: log.slice(-60),
                     finishedAt: Date.now(), wait: null, stage: 'failed',
                     progress: progress(job.progress), message: error };
    await this.ctx.storage.put('job', failed);
    if (stopContainer) await this.#stopContainer(job);
    await this.#drainPending(failed);
  }

  async #drainPending(job) {
    if (!job.pending || job.kind !== 'generate') return;
    await this.ctx.storage.put('job', { ...job, pending: false });
    await this.#launch('generate', job.params || {});
  }
}
