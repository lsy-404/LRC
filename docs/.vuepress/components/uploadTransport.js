export const DIRECT_UPLOAD_LIMIT = 95 * 1024 * 1024;
export const MULTIPART_PART_SIZE = 20 * 1024 * 1024;

export function uploadR2(it, { session, XHR = XMLHttpRequest, signal, onUnauthorized }) {
  return new Promise((resolve) => {
    const xhr = new XHR();
    xhr.open('POST', `/api/upload/r2?session=${session}&n=${it.n}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.withCredentials = true;
    const cancel = () => xhr.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', cancel);
    xhr.onabort = () => resolve(false);
    xhr.timeout = 120000;
    xhr.ontimeout = () => resolve(false);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) it.pct = Math.round(e.loaded / e.total * 100);
    };
    xhr.onload = () => {
      if (xhr.status === 401) onUnauthorized?.();
      try { resolve(xhr.status === 200 && JSON.parse(xhr.responseText).ok === true); }
      catch { resolve(false); }
    };
    xhr.onerror = () => resolve(false);
    if (signal?.aborted) { resolve(false); return; }
    xhr.send(it.file);
  });
}

async function multipartResponse(url, init, request) {
  const response = await request(url, init);
  const data = await response.json().catch(() => ({}));
  return response.ok && data.ok ? data : null;
}

export async function uploadMultipart(it, { session, request = fetch, signal, onUnauthorized }) {
  const transport = async (...args) => { const response = await request(...args); if (response.status === 401) onUnauthorized?.(); return response; };
  const uploadHeaders = () => ({});
  let state = it.multipart;
  if (!state) {
    const created = await multipartResponse(
      `/api/upload/multipart?action=create&session=${session}&n=${it.n}`,
      { method: 'POST', credentials: 'same-origin', signal, headers: uploadHeaders() }, transport);
    if (!created?.uploadId) return false;
    state = { uploadId: created.uploadId, parts: [] };
    it.multipart = state;
  }

  const uploaded = new Map(state.parts.map((part) => [part.partNumber, part]));
  const partCount = Math.ceil(it.size / MULTIPART_PART_SIZE);
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const start = (partNumber - 1) * MULTIPART_PART_SIZE;
    const end = Math.min(start + MULTIPART_PART_SIZE, it.size);
    if (!uploaded.has(partNumber)) {
      const part = await multipartResponse(
        `/api/upload/multipart?action=part&session=${session}&n=${it.n}`
          + `&uploadId=${encodeURIComponent(state.uploadId)}&partNumber=${partNumber}`,
        {
          method: 'PUT', credentials: 'same-origin', signal,
          headers: { ...uploadHeaders(), 'content-type': 'application/octet-stream' },
          body: it.file.slice(start, end),
        }, transport);
      if (!part || part.partNumber !== partNumber || !part.etag) return false;
      uploaded.set(partNumber, { partNumber, etag: part.etag });
      state.parts = [...uploaded.values()].sort((a, b) => a.partNumber - b.partNumber);
    }
    it.pct = Math.round(end / it.size * 100);
  }

  const completed = await multipartResponse(
    `/api/upload/multipart?action=complete&session=${session}&n=${it.n}`
      + `&uploadId=${encodeURIComponent(state.uploadId)}`,
    {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { ...uploadHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ parts: state.parts }),
    }, transport);
  if (!completed) return false;
  it.multipart = null;
  return true;
}

export const uploadFile = (it, ctx) => it.size <= DIRECT_UPLOAD_LIMIT ? uploadR2(it, ctx) : uploadMultipart(it, ctx);
