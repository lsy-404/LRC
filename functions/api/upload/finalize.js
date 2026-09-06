import {
  json, callWorker,
  cleanAlbum, cleanRelPath, cleanSession, cleanIndex, MAX_FILES,
} from './_lib.js';
import { requireUser } from '../auth/_lib.js';

const SINGLE_ALBUM = '单曲';

function cleanSubmissionType(value) {
  if (value === undefined || value === null || value === '') return 'album';
  return value === 'single' || value === 'album' ? value : null;
}

function cleanLyricMakers(value, required) {
  const seen = new Set();
  const makers = [];
  for (const raw of (Array.isArray(value) ? value : [])) {
    const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    makers.push(name);
    if (makers.length >= 20) break;
  }
  if (required && !seen.has(required)) makers.push(required);
  return makers;
}

// 文件本体已直传 R2（web/<session>/<n>）。这里落一份取料清单到同一前缀下，
// 再直接叫醒同一 Worker 内的编排跑 Phase A——投稿不再经过任何 git 分支。
// ref 即 session：后续人工闸门、Phase B、原料清理都用它对账。
export async function onRequestPost({ request, env }) {
  const user = await requireUser({ request, env });
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const body = await request.json().catch(() => null);
  const submission_type = cleanSubmissionType(body?.submission_type);
  const requestedAlbum = cleanAlbum(body?.album);
  const album = submission_type === 'single' ? SINGLE_ALBUM : requestedAlbum;
  const session = cleanSession(body?.session);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!submission_type || !album || !session || !rawFiles.length || rawFiles.length > MAX_FILES) {
    return json({ error: 'bad request' }, 400);
  }

  if (await env.UPLOAD_BUCKET.head(`web/${session}/manifest.json`)) {
    const retried = await callWorker(env, '/ingest', { ref: session });
    return retried.ok ? json({ ok: true, ref: session, retried: true, job: retried.data }) : json({ error: 'ingest', status: retried.status }, 502);
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

  const contributor = user.github || user.name;
  const lyric_maker = cleanLyricMakers(body?.lyric_maker, env.REQUIRED_LYRIC_MAKER);
  if (!lyric_maker.includes(user.display_name)) lyric_maker.push(user.display_name);
  const manifest = { version: 3, album, submission_type, session, contributor, lyric_maker, files };
  await env.UPLOAD_BUCKET.put(`web/${session}/manifest.json`,
    JSON.stringify(manifest, null, 1),
    { httpMetadata: { contentType: 'application/json' } });

  const started = await callWorker(env, '/ingest', { ref: session });
  if (!started.ok) {
    return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  }
  return json({ ok: true, ref: session, files: files.length });
}
