import {
  json, passwordOk, bearer, callWorker,
  cleanAlbum, cleanRelPath, cleanSession, cleanIndex, MAX_FILES,
} from './_lib.js';

const REQUIRED_LYRIC_MAKER = '武乙凌薇';

function cleanLyricMakers(value) {
  const seen = new Set();
  const makers = [];
  for (const raw of (Array.isArray(value) ? value : [])) {
    const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    makers.push(name);
    if (makers.length >= 20) break;
  }
  if (!seen.has(REQUIRED_LYRIC_MAKER)) makers.push(REQUIRED_LYRIC_MAKER);
  return makers;
}

// 文件本体已直传 R2（web/<session>/<n>）。这里落一份取料清单到同一前缀下，
// 再直接叫醒同一 Worker 内的编排跑 Phase A——投稿不再经过任何 git 分支。
// ref 即 session：后续人工闸门、Phase B、原料清理都用它对账。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const body = await request.json().catch(() => null);
  const album = cleanAlbum(body?.album);
  const session = cleanSession(body?.session);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!album || !session || !rawFiles.length || rawFiles.length > MAX_FILES) {
    return json({ error: 'bad request' }, 400);
  }

  const files = [];
  const seenPath = new Set();
  const seenN = new Set();
  for (const f of rawFiles) {
    const path = cleanRelPath(f?.path);
    const n = cleanIndex(f?.n);
    if (!path || seenPath.has(path) || n === null || seenN.has(n)) {
      return json({ error: 'invalid file entry', path: f?.path }, 400);
    }
    seenPath.add(path);
    seenN.add(n);
    files.push({ n, path, size: Number(f?.size) || 0 });
  }

  const contributor = typeof body?.contributor === 'string'
    ? body.contributor.slice(0, 60) : 'web';
  const lyric_maker = cleanLyricMakers(body?.lyric_maker);
  const manifest = { version: 3, album, session, contributor, lyric_maker, files };
  await env.UPLOAD_BUCKET.put(`web/${session}/manifest.json`,
    JSON.stringify(manifest, null, 1),
    { httpMetadata: { contentType: 'application/json' } });

  const started = await callWorker(env, '/ingest', { ref: session });
  if (!started.ok) {
    return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  }
  return json({ ok: true, ref: session, files: files.length });
}
