import { onRequestPost as finalizeUpload } from '../../functions/api/upload/finalize.js';
import { onRequestPost as multipartUploadPost, onRequestPut as multipartUploadPut, onRequestDelete as multipartUploadDelete } from '../../functions/api/upload/multipart.js';
import { onRequestPost as uploadR2 } from '../../functions/api/upload/r2.js';
import { onRequestPost as continueIngest } from '../../functions/api/ingest/continue.js';
import { onRequestPost as uploadCover } from '../../functions/api/ingest/cover.js';
import { onRequestPost as discardIngest } from '../../functions/api/ingest/discard.js';
import { onRequestGet as listIngest } from '../../functions/api/ingest/list.js';
import { onRequestPost as retryIngest } from '../../functions/api/ingest/retry.js';
import { onRequestPost as saveIngest } from '../../functions/api/ingest/save.js';
import { onRequestGet as stateIngest } from '../../functions/api/ingest/state.js';
import { onRequestGet as audioIngest } from '../../functions/api/ingest/audio.js';
import { onAssetPost, onAudioGet, onCatalogGet, onCreatePost, onDocumentPost, onDraftGet, onExtractPost, onListGet, onLrcPost, onOpenPost, onSavePost } from '../../functions/api/workspace.js';
import { onRequestGet as authMeGet, onRequestPatch as authMePatch } from '../../functions/api/auth/me.js';
import { onRequestGet as authGithubStart } from '../../functions/api/auth/githubStart.js';
import { onRequestGet as authGithubCallback } from '../../functions/api/auth/githubCallback.js';
import { onRequestDelete as authGithubDelete } from '../../functions/api/auth/github.js';
import { onMediaGet, onWorkspaceCoverGet, onReviewCoverGet, onReviewMediaGet, onDiscardPost as discardWorkspace } from '../../functions/api/workspaceMedia.js';
import { studioServer } from './studio.js';
import { json, cleanRef } from './lib.js';

// 每条路由附带所需的工作站动作；动作由当前用户在曲库中的权限决定（见 worker/src/studio.js）。
// 'session' 只要求有效的单点登录会话，'public' 不校验（GitHub 回调由一次性 state 绑定发起者）。
export const ROUTES = new Map([
  ['POST /api/upload/r2', [uploadR2, 'edit']],
  ['POST /api/upload/multipart', [multipartUploadPost, 'edit']],
  ['PUT /api/upload/multipart', [multipartUploadPut, 'edit']],
  ['DELETE /api/upload/multipart', [multipartUploadDelete, 'edit']],
  ['POST /api/upload/finalize', [finalizeUpload, 'submit']],
  ['GET /api/ingest/list', [listIngest, 'browse']],
  ['GET /api/ingest/state', [stateIngest, 'browse']],
  ['GET /api/ingest/audio', [audioIngest, 'listen']],
  ['POST /api/ingest/save', [saveIngest, 'edit']],
  ['POST /api/ingest/cover', [uploadCover, 'edit']],
  ['POST /api/ingest/continue', [continueIngest, 'submit']],
  ['POST /api/ingest/discard', [discardIngest, 'discard']],
  ['POST /api/ingest/retry', [retryIngest, 'submit']],
  ['GET /api/workspace/media', [onMediaGet, 'browse']],
  ['GET /api/workspace/cover', [onWorkspaceCoverGet, 'browse']],
  ['GET /api/ingest/cover', [onReviewCoverGet, 'browse']],
  ['GET /api/ingest/media', [onReviewMediaGet, 'browse']],
  ['POST /api/workspace/discard', [discardWorkspace, 'discard']],
  ['GET /api/workspace/catalog', [onCatalogGet, 'browse']],
  ['GET /api/workspace/list', [onListGet, 'browse']],
  ['GET /api/workspace/draft', [onDraftGet, 'browse']],
  ['POST /api/workspace/create', [onCreatePost, 'edit']],
  ['POST /api/workspace/open', [onOpenPost, 'edit']],
  ['POST /api/workspace/lrc', [onLrcPost, 'edit']],
  ['POST /api/workspace/document', [onDocumentPost, 'edit']],
  ['POST /api/workspace/save', [onSavePost, 'edit']],
  ['POST /api/workspace/asset', [onAssetPost, 'edit']],
  ['GET /api/workspace/audio', [onAudioGet, 'listen']],
  ['POST /api/workspace/extract', [onExtractPost, 'submit']],
  ['GET /api/auth/me', [authMeGet, 'session']],
  ['PATCH /api/auth/me', [authMePatch, 'session']],
  ['GET /api/auth/github/start', [authGithubStart, 'session']],
  ['GET /api/auth/github/callback', [authGithubCallback, 'public']],
  ['DELETE /api/auth/github', [authGithubDelete, 'session']],
]);

async function callJob(env, name, path, body) {
  const response = await env.JOB.getByName(name).fetch(`http://job${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok && data.ok !== false,
    status: data.ok === false && response.ok ? 409 : response.status,
    data,
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

export async function handleApi(request, env, studio = studioServer()) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'csrf' }, 403);
  }
  const owned = await studio.handle(request, env);
  if (owned) return owned;
  const route = ROUTES.get(`${request.method} ${url.pathname}`);
  if (!route) return json({ error: 'not found' }, 404);
  const [handler, action] = route;
  const apiEnv = Object.create(env);
  Object.defineProperty(apiEnv, 'INGEST_INTERNAL_CALL', {
    value: (path, body, method) => callIngest(env, path, body, method),
  });
  Object.defineProperty(apiEnv, 'STUDIO', { value: studio });
  if (action !== 'public') {
    let account;
    if (action === 'session') {
      account = (await studio.describe(request, env))?.account;
      if (!account) return json({ error: 'unauthorized' }, 401);
    } else {
      const gate = await studio.authorize(request, env, action);
      if (!gate.ok) return gate.response;
      account = gate.session.account;
    }
    Object.defineProperty(apiEnv, 'STUDIO_USER', { value: account.user });
    Object.defineProperty(apiEnv, 'STUDIO_SUBJECT', { value: account.subject });
  }
  return handler({ request, env: apiEnv });
}
