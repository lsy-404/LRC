import { onRequestPost as finalizeUpload } from '../../functions/api/upload/finalize.js';
import { onRequestPost as multipartUploadPost, onRequestPut as multipartUploadPut, onRequestDelete as multipartUploadDelete } from '../../functions/api/upload/multipart.js';
import { onRequestPost as uploadR2 } from '../../functions/api/upload/r2.js';
import { onRequestPost as verifyUpload } from '../../functions/api/upload/verify.js';
import { onRequestPost as continueIngest } from '../../functions/api/ingest/continue.js';
import { onRequestPost as uploadCover } from '../../functions/api/ingest/cover.js';
import { onRequestPost as discardIngest } from '../../functions/api/ingest/discard.js';
import { onRequestGet as listIngest } from '../../functions/api/ingest/list.js';
import { onRequestPost as retryIngest } from '../../functions/api/ingest/retry.js';
import { onRequestPost as saveIngest } from '../../functions/api/ingest/save.js';
import { onRequestGet as stateIngest } from '../../functions/api/ingest/state.js';
import { onRequestGet as audioIngest } from '../../functions/api/ingest/audio.js';
import { onCatalogGet, onCreatePost, onDraftGet, onExtractPost, onListGet, onLrcPost, onOpenPost, onSavePost } from '../../functions/api/workspace.js';
import { json, cleanRef } from './lib.js';

const ROUTES = new Map([
  ['POST /api/upload/verify', verifyUpload],
  ['POST /api/upload/r2', uploadR2],
  ['POST /api/upload/multipart', multipartUploadPost],
  ['PUT /api/upload/multipart', multipartUploadPut],
  ['DELETE /api/upload/multipart', multipartUploadDelete],
  ['POST /api/upload/finalize', finalizeUpload],
  ['GET /api/ingest/list', listIngest],
  ['GET /api/ingest/state', stateIngest],
  ['GET /api/ingest/audio', audioIngest],
  ['POST /api/ingest/save', saveIngest],
  ['POST /api/ingest/cover', uploadCover],
  ['POST /api/ingest/continue', continueIngest],
  ['POST /api/ingest/discard', discardIngest],
  ['POST /api/ingest/retry', retryIngest],
  ['GET /api/workspace/catalog', onCatalogGet],
  ['GET /api/workspace/list', onListGet],
  ['GET /api/workspace/draft', onDraftGet],
  ['POST /api/workspace/create', onCreatePost],
  ['POST /api/workspace/open', onOpenPost],
  ['POST /api/workspace/lrc', onLrcPost],
  ['POST /api/workspace/save', onSavePost],
  ['POST /api/workspace/extract', onExtractPost],
]);

async function callJob(env, name, path, body) {
  const response = await env.JOB.getByName(name).fetch(`http://job${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

// API 处理与编排在同一 Worker 内，直接访问 DO，不经公网地址或共享桥接密钥。
async function callIngest(env, path, body, method) {
  const url = new URL(path, 'http://internal');
  const ref = cleanRef(url.searchParams.get('ref') || body?.ref);

  if (method === 'GET' && url.pathname === '/state') {
    if (!ref) return { ok: false, status: 400, data: { error: 'bad ref' } };
    return callJob(env, ref, '/state');
  }
  if (!ref) return { ok: false, status: 400, data: { error: 'bad ref' } };
  if (url.pathname === '/ingest') {
    const manifest = await env.UPLOAD_BUCKET.get(`web/${ref}/manifest.json`);
    if (!manifest) return { ok: false, status: 404, data: { error: 'no manifest' } };
    return callJob(env, ref, '/start', { kind: 'phase_a', params: { ref } });
  }
  if (url.pathname === '/finalize') return callJob(env, ref, '/continue');
  if (url.pathname === '/discard') return callJob(env, ref, '/cancel');
  return { ok: false, status: 404, data: { error: 'not found' } };
}

export async function handleApi(request, env) {
  const handler = ROUTES.get(`${request.method} ${new URL(request.url).pathname}`);
  if (!handler) return json({ error: 'not found' }, 404);
  const apiEnv = Object.create(env);
  Object.defineProperty(apiEnv, 'INGEST_INTERNAL_CALL', {
    value: (path, body, method) => callIngest(env, path, body, method),
  });
  return handler({ request, env: apiEnv });
}
