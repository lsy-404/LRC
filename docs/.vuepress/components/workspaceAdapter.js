export function createWorkspaceAdapter(request = fetch) {
  const json = async (url, init = {}) => {
    const response = await request(url, { credentials: 'same-origin', ...init });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(body.message || body.error || `HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return body;
  };
  const post = (path, body) => json(`/api/workspace/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ingestPost = (path, body) => json(`/api/ingest/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const binary = async (url, signal) => {
    const response = await request(url, { credentials: 'same-origin', signal });
    if (!response.ok) { const body = await response.json().catch(() => ({})); const error = new Error(body.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return response;
  };
  return {
    catalog: () => json('/api/workspace/catalog'),
    list: () => json('/api/workspace/list'),
    draft: (ref) => json(`/api/workspace/draft?ref=${encodeURIComponent(ref)}`),
    create: (album) => post('create', { album }),
    open: (slug) => post('open', { slug }),
    lrc: (ref, title) => post('lrc', { ref, title }),
    save: (ref, draft) => post('save', { ref, draft }),
    upload: (ref, n, file) => json(`/api/upload/r2?session=${encodeURIComponent(ref)}&n=${n}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file }),
    asset: (ref, asset) => post('asset', { ref, ...asset }),
    extract: (ref) => post('extract', { ref }),
    pending: () => json('/api/ingest/list'),
    state: (ref) => json(`/api/ingest/state?ref=${encodeURIComponent(ref)}`),
    saveReview: (ref, album, draft) => ingestPost('save', { ref, album, draft }),
    discard: async (ref, album) => {
      try {
        return await ingestPost('discard', { ref, album });
      } catch (err) {
        if (err.status === 404) return { ok: true, ref, album, removed: false };
        throw err;
      }
    },
    continue: (ref) => ingestPost('continue', { ref }),
    retry: (ref) => ingestPost('retry', { ref }),
    cover: (ref, album, ext, file) => json(`/api/ingest/cover?${new URLSearchParams({ ref, album, ext })}`, { method: 'POST', body: file }),
    audio: (ref, name, signal) => binary(`/api/ingest/audio?${new URLSearchParams({ ref, name })}`, signal),
    workspaceAudio: (ref, n, signal) => binary(`/api/workspace/audio?${new URLSearchParams({ ref, n })}`, signal),
    workspaceMedia: (ref, n, signal) => binary(`/api/workspace/media?${new URLSearchParams({ ref, n })}`, signal),
    workspaceCover: (ref, signal) => binary(`/api/workspace/cover?${new URLSearchParams({ ref })}`, signal),
    reviewCover: (ref, album, signal) => binary(`/api/ingest/cover?${new URLSearchParams({ ref, album })}`, signal),
    reviewMedia: (ref, name, signal) => binary(`/api/ingest/media?${new URLSearchParams({ ref, name })}`, signal),
    workspaceDiscard: (ref) => post('discard', { ref }),
  };
}
