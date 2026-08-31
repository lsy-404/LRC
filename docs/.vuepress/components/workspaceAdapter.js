// 现有 ingest 服务的唯一工作区适配层；未来 workspace API 就在这里替换。
export function createWorkspaceAdapter(password, request = fetch) {
  const headers = () => ({ authorization: `Bearer ${encodeURIComponent(password || '')}` });
  const json = async (url, init = {}) => {
    const response = await request(url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
    return body;
  };
  return {
    list: () => json('/api/ingest/list'),
    state: (ref) => json(`/api/ingest/state?ref=${encodeURIComponent(ref)}`),
    save: (ref, album, draft) => json('/api/ingest/save', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, album, draft }),
    }),
    generate: (ref) => json('/api/ingest/continue', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }),
    }),
  };
}
