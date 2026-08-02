import { json, authorized, cleanRef, cleanKey, cleanPrefix } from './lib.js';

export { IngestJob } from './job.js';
export { PipelineRunner } from './runner.js';

// 生成作业自己提交回 main，会再触发一次 webhook——按提交者跳过，避免自激
const BOT_NAME = 'lrc-ingest[bot]';
const WATCHED = ['res/', '.github/'];

function jobStub(env, name) {
  return env.JOB.getByName(name);
}

// 自检实例名：只放行 diag 前缀的别名，避免任意字符串开出无主的编排实例
function diagName(v) {
  return typeof v === 'string' && /^diag[a-z0-9-]{0,24}$/.test(v) ? v : null;
}

async function callJob(env, name, path, body) {
  const resp = await jobStub(env, name).fetch(`http://job${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return resp.json();
}

async function verifySignature(env, raw, header) {
  if (!env.GITHUB_WEBHOOK_SECRET || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const want = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const got = header.slice(7);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

function touchesWatched(payload) {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  for (const c of commits) {
    for (const p of [...(c.added || []), ...(c.modified || []), ...(c.removed || [])]) {
      if (WATCHED.some((w) => p.startsWith(w))) return true;
    }
  }
  return false;
}

// 容器内没有 R2 绑定，读写原料与草稿一律经此代读代写；键前缀已在 cleanKey 收窄
async function store(request, env, url) {
  const bucket = env.UPLOAD_BUCKET;
  const rawKey = decodeURIComponent(url.pathname.slice('/store/'.length));
  const prefix = url.searchParams.get('prefix');

  if (request.method === 'GET' && prefix !== null) {
    const p = cleanPrefix(prefix);
    if (!p) return json({ error: 'bad prefix' }, 400);
    const keys = [];
    let cursor;
    do {
      const page = await bucket.list({ prefix: p, cursor, limit: 1000 });
      for (const o of page.objects) keys.push({ key: o.key, size: o.size });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json({ keys });
  }

  if (request.method === 'DELETE' && prefix !== null) {
    const p = cleanPrefix(prefix);
    if (!p) return json({ error: 'bad prefix' }, 400);
    let deleted = 0;
    let cursor;
    do {
      const page = await bucket.list({ prefix: p, cursor, limit: 1000 });
      const batch = page.objects.map((o) => o.key);
      if (batch.length) {
        await bucket.delete(batch);
        deleted += batch.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json({ deleted });
  }

  const key = cleanKey(rawKey);
  if (!key) return json({ error: 'bad key' }, 400);

  if (request.method === 'GET') {
    const obj = await bucket.get(key);
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(obj.size),
      },
    });
  }
  if (request.method === 'PUT') {
    const obj = await bucket.put(key, request.body);
    return json({ ok: true, size: obj.size });
  }
  if (request.method === 'DELETE') {
    await bucket.delete(key);
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/hooks/github') {
      const raw = await request.text();
      if (!(await verifySignature(env, raw, request.headers.get('x-hub-signature-256')))) {
        return json({ error: 'bad signature' }, 401);
      }
      if (request.headers.get('x-github-event') !== 'push') return json({ ok: true, skip: 'event' });
      const payload = JSON.parse(raw);
      if (payload.ref !== 'refs/heads/main') return json({ ok: true, skip: 'ref' });
      if (payload.head_commit?.author?.name === BOT_NAME) return json({ ok: true, skip: 'bot' });
      if (!touchesWatched(payload)) return json({ ok: true, skip: 'paths' });
      return json(await callJob(env, 'generate', '/start', { kind: 'generate', params: {} }));
    }

    if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);

    if (url.pathname === '/store' || url.pathname.startsWith('/store/')) {
      return store(request, env, url);
    }

    if (url.pathname === '/state') {
      const raw = url.searchParams.get('ref') || '';
      const name = raw === 'generate' ? raw : (diagName(raw) || cleanRef(raw));
      if (!name) return json({ error: 'bad ref' }, 400);
      const resp = await jobStub(env, name).fetch('http://job/state');
      return new Response(resp.body, { headers: { 'content-type': 'application/json' } });
    }

    if (request.method !== 'POST') return json({ error: 'not found' }, 404);
    const body = await request.json().catch(() => ({}));

    switch (url.pathname) {
      case '/ingest': {
        const ref = cleanRef(body.ref);
        if (!ref) return json({ error: 'bad ref' }, 400);
        const manifest = await env.UPLOAD_BUCKET.get(`web/${ref}/manifest.json`);
        if (!manifest) return json({ error: 'no manifest' }, 404);
        return json(await callJob(env, ref, '/start', { kind: 'phase_a', params: { ref } }));
      }
      case '/finalize': {
        const ref = cleanRef(body.ref);
        if (!ref) return json({ error: 'bad ref' }, 400);
        return json(await callJob(env, ref, '/continue', {}));
      }
      case '/discard': {
        const ref = cleanRef(body.ref);
        if (!ref) return json({ error: 'bad ref' }, 400);
        return json(await callJob(env, ref, '/cancel', {}));
      }
      case '/generate':
        return json(await callJob(env, 'generate', '/start',
                                  { kind: 'generate', params: { force: !!body.force } }));
      // 部署后自检：确认容器起得来、外部命令齐、对象存储往返通。
      // 可给实例起别名：容器实例休眠前一直用旧镜像，换个名字就能立刻验新版本
      case '/diag': {
        const name = diagName(body.name) || 'diag';
        return json(await callJob(env, name, '/start', { kind: 'diag', params: { ref: name } }));
      }
      default:
        return json({ error: 'not found' }, 404);
    }
  },
};
