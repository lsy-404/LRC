// 工作区 API 的唯一浏览器边界；组件不再回落到旧 upload/edit 或 ingest 状态接口。
export function createWorkspaceAdapter(password, request = fetch) {
  const headers = () => ({ authorization: `Bearer ${encodeURIComponent(password || '')}` });
  const json = async (url, init = {}) => {
    const response = await request(url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
    return body;
  };
  const post = (path, body) => json(`/api/workspace/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    catalog: () => json('/api/workspace/catalog'),
    list: () => json('/api/workspace/list'),
    draft: (ref) => json(`/api/workspace/draft?ref=${encodeURIComponent(ref)}`),
    create: (album) => post('create', { album }),
    open: (slug) => post('open', { slug }),
    lrc: (ref, title) => post('lrc', { ref, title }),
    save: (ref, draft) => post('save', { ref, draft }),
    upload: (ref, n, file) => json(`/api/upload/r2?session=${encodeURIComponent(ref)}&n=${n}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file }),
    extract: (ref, files) => post('extract', { ref, files }),
  };
}
