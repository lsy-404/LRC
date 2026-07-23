import {
  json, passwordOk, bearer, ghHeaders, GH_API, REPO,
  REVIEW_BRANCH, cleanRef, cleanAlbum, b64ToText, textToB64, encodeContentsPath,
} from './_lib.js';

async function gh(env, path, init = {}) {
  const resp = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: ghHeaders(env, init.body ? { 'content-type': 'application/json' } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

// POST /api/ingest/save { ref, album, draft } — 修改面板保存校正后的 draft。
// 缝单 commit 把 <ref>/<album>/draft.json 覆盖为新内容，并刷新 status.updated（避免编辑
// 期间被 72h 超时 sweep 抢跑）。base_tree=HEAD → 其余 bundle 原样保留。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const album = cleanAlbum(body?.album);
  const draft = body?.draft;
  if (!ref || !album || !draft || typeof draft !== 'object') return json({ error: 'bad request' }, 400);

  const base = `${ref}/${album}`;
  const mkBlob = (obj) => gh(env, `/repos/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: textToB64(JSON.stringify(obj, null, 2)), encoding: 'base64' }),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh(env, `/repos/${REPO}/git/ref/heads/${REVIEW_BRANCH}`);
    if (!head.resp.ok) return json({ error: 'github', step: 'ref', message: head.data.message }, 502);
    const headSha = head.data.object.sha;

    const headCommit = await gh(env, `/repos/${REPO}/git/commits/${headSha}`);
    if (!headCommit.resp.ok) return json({ error: 'github', step: 'head-commit' }, 502);

    // 读现有 status.json：保留 created/contributor/is_update，只刷 updated + 标记 edited
    let status = {};
    const stResp = await fetch(
      `${GH_API}/repos/${REPO}/contents/${encodeContentsPath(`${base}/status.json`)}?ref=${REVIEW_BRANCH}`,
      { headers: ghHeaders(env) },
    );
    if (stResp.ok) {
      const stData = await stResp.json().catch(() => null);
      if (stData?.content) {
        try { status = JSON.parse(b64ToText(stData.content)); } catch { status = {}; }
      }
    }
    status.updated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    status.edited = true;

    const draftBlob = await mkBlob(draft);
    if (!draftBlob.resp.ok) return json({ error: 'github', step: 'blob-draft' }, 502);
    const statusBlob = await mkBlob(status);
    if (!statusBlob.resp.ok) return json({ error: 'github', step: 'blob-status' }, 502);

    const tree = await gh(env, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: headCommit.data.tree.sha,
        tree: [
          { path: `${base}/draft.json`, mode: '100644', type: 'blob', sha: draftBlob.data.sha },
          { path: `${base}/status.json`, mode: '100644', type: 'blob', sha: statusBlob.data.sha },
        ],
      }),
    });
    if (!tree.resp.ok) return json({ error: 'github', step: 'tree', message: tree.data.message }, 502);

    const commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: `review-edit: ${album} (${ref})`, tree: tree.data.sha, parents: [headSha] }),
    });
    if (!commit.resp.ok) return json({ error: 'github', step: 'commit', message: commit.data.message }, 502);

    const upd = await gh(env, `/repos/${REPO}/git/refs/heads/${REVIEW_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.data.sha, force: false }),
    });
    if (upd.resp.ok) return json({ ok: true, ref, album, commit: commit.data.sha });
    // 422 非快进 = 他人同时改了 ingest-review，重取 HEAD 再缝一次
    if (upd.resp.status !== 422 || attempt === 1) {
      return json({ error: 'github', step: 'ref-update', message: upd.data.message }, 502);
    }
  }
}
