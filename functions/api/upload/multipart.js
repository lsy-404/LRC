import { json, passwordOk, bearer, cleanSession, cleanIndex } from './_lib.js';

const MAX_PARTS = 10_000;

function context(request) {
  const url = new URL(request.url);
  const session = cleanSession(url.searchParams.get('session'));
  const n = cleanIndex(url.searchParams.get('n'));
  return { url, session, n, key: session && n !== null ? `web/${session}/${n}` : '' };
}

function cleanUploadId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function cleanPartNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PARTS ? n : null;
}

function cleanParts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) return null;
  const parts = [];
  for (let i = 0; i < value.length; i++) {
    const partNumber = cleanPartNumber(value[i]?.partNumber);
    const etag = value[i]?.etag;
    if (partNumber !== i + 1 || typeof etag !== 'string' || !etag || etag.length > 512) return null;
    parts.push({ partNumber, etag });
  }
  return parts;
}

async function allowed(request, env) {
  return passwordOk(bearer(request), env) && !!env.UPLOAD_BUCKET;
}

export async function onRequestPost({ request, env }) {
  if (!(await allowed(request, env))) return json({ error: 'unauthorized' }, 401);
  const { url, session, n, key } = context(request);
  if (!session || n === null) return json({ error: 'bad request' }, 400);

  const action = url.searchParams.get('action');
  if (action === 'create') {
    const upload = await env.UPLOAD_BUCKET.createMultipartUpload(key);
    return json({ ok: true, uploadId: upload.uploadId });
  }

  if (action === 'complete') {
    const uploadId = cleanUploadId(url.searchParams.get('uploadId'));
    const body = await request.json().catch(() => null);
    const parts = cleanParts(body?.parts);
    if (!uploadId || !parts) return json({ error: 'bad request' }, 400);
    try {
      const object = await env.UPLOAD_BUCKET.resumeMultipartUpload(key, uploadId).complete(parts);
      return json({ ok: true, size: object.size });
    } catch {
      return json({ error: 'multipart complete failed' }, 400);
    }
  }

  return json({ error: 'bad action' }, 400);
}

export async function onRequestPut({ request, env }) {
  if (!(await allowed(request, env))) return json({ error: 'unauthorized' }, 401);
  const { url, session, n, key } = context(request);
  const uploadId = cleanUploadId(url.searchParams.get('uploadId'));
  const partNumber = cleanPartNumber(url.searchParams.get('partNumber'));
  if (!session || n === null || url.searchParams.get('action') !== 'part'
      || !uploadId || !partNumber || !request.body) {
    return json({ error: 'bad request' }, 400);
  }
  try {
    const part = await env.UPLOAD_BUCKET.resumeMultipartUpload(key, uploadId)
      .uploadPart(partNumber, request.body);
    return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
  } catch {
    return json({ error: 'multipart part failed' }, 400);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!(await allowed(request, env))) return json({ error: 'unauthorized' }, 401);
  const { url, session, n, key } = context(request);
  const uploadId = cleanUploadId(url.searchParams.get('uploadId'));
  if (!session || n === null || url.searchParams.get('action') !== 'abort' || !uploadId) {
    return json({ error: 'bad request' }, 400);
  }
  try {
    await env.UPLOAD_BUCKET.resumeMultipartUpload(key, uploadId).abort();
    return json({ ok: true });
  } catch {
    return json({ error: 'multipart abort failed' }, 400);
  }
}
