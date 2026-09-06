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
import { onAssetPost, onAudioGet, onCatalogGet, onCreatePost, onDraftGet, onExtractPost, onListGet, onLrcPost, onOpenPost, onSavePost } from '../../functions/api/workspace.js';
import { onRequestPost as authBootstrap } from '../../functions/api/auth/bootstrap.js';
import { onRequestPost as authRegister } from '../../functions/api/auth/register.js';
import { onRequestPost as authLogin } from '../../functions/api/auth/login.js';
import { onRequestPost as authLogout } from '../../functions/api/auth/logout.js';
import { onRequestGet as authMeGet, onRequestPatch as authMePatch } from '../../functions/api/auth/me.js';
import { onRequestPost as authInvitePost, onRequestDelete as authInviteDelete } from '../../functions/api/auth/invite.js';
import { onRequestGet as authInvitesGet } from '../../functions/api/auth/invites.js';
import { onRequestGet as authUsersGet } from '../../functions/api/auth/users.js';
import { onRequestPatch as authUserPatch } from '../../functions/api/auth/user.js';

import { onRequestGet as authGithubStart } from '../../functions/api/auth/githubStart.js';
import { onRequestGet as authGithubCallback } from '../../functions/api/auth/githubCallback.js';
import { onRequestDelete as authGithubDelete } from '../../functions/api/auth/github.js';
import { onRequestGet as authSetupGet } from '../../functions/api/auth/setup.js';
import { onMediaGet, onWorkspaceCoverGet, onReviewCoverGet, onReviewMediaGet, onDiscardPost as discardWorkspace } from '../../functions/api/workspaceMedia.js';
import { json, cleanRef } from './lib.js';

const ROUTES = new Map([
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
  ['GET /api/workspace/media', onMediaGet],
  ['GET /api/workspace/cover', onWorkspaceCoverGet],
  ['GET /api/ingest/cover', onReviewCoverGet],
  ['GET /api/ingest/media', onReviewMediaGet],
  ['POST /api/workspace/discard', discardWorkspace],
  ['GET /api/workspace/catalog', onCatalogGet],
  ['GET /api/workspace/list', onListGet],
  ['GET /api/workspace/draft', onDraftGet],
  ['POST /api/workspace/create', onCreatePost],
  ['POST /api/workspace/open', onOpenPost],
  ['POST /api/workspace/lrc', onLrcPost],
  ['POST /api/workspace/save', onSavePost],
  ['POST /api/workspace/asset', onAssetPost],
  ['GET /api/workspace/audio', onAudioGet],
  ['POST /api/workspace/extract', onExtractPost],
  ['POST /api/auth/bootstrap', authBootstrap],
  ['POST /api/auth/register', authRegister],
  ['POST /api/auth/login', authLogin],
  ['GET /api/auth/setup', authSetupGet],
  ['POST /api/auth/logout', authLogout],
  ['GET /api/auth/me', authMeGet],
  ['PATCH /api/auth/me', authMePatch],
  ['POST /api/auth/invite', authInvitePost],
  ['DELETE /api/auth/invite', authInviteDelete],
  ['GET /api/auth/invites', authInvitesGet],
  ['GET /api/auth/users', authUsersGet],
  ['PATCH /api/auth/user', authUserPatch],
  ['GET /api/auth/github/start', authGithubStart],
  ['GET /api/auth/github/callback', authGithubCallback],
  ['DELETE /api/auth/github', authGithubDelete],
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

export async function handleApi(request, env) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'csrf' }, 403);
  }
  const handler = ROUTES.get(`${request.method} ${url.pathname}`);
  if (!handler) return json({ error: 'not found' }, 404);
  const apiEnv = Object.create(env);
  Object.defineProperty(apiEnv, 'INGEST_INTERNAL_CALL', {
    value: (path, body, method) => callIngest(env, path, body, method),
  });
  return handler({ request, env: apiEnv });
}
