import {
  json, passwordOk, bearer, ghHeaders, GH_API, REPO,
  REVIEW_BRANCH, cleanRef, cleanAlbum,
} from './_lib.js';

async function gh(env, path, init = {}) {
  const resp = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: ghHeaders(env, init.body ? { 'content-type': 'application/json' } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

// 从递归 tree 里挑出 prefix 下的 blob，生成 sha:null 的删除条目（配合 base_tree 使用）。
// 只删 blob：git tree 不保留空目录，父目录随最后一个 blob 一起消失。
export function deletionEntries(treeItems, prefix) {
  return (treeItems || [])
    .filter((it) => it.type === 'blob' && it.path.startsWith(prefix))
    .map((it) => ({ path: it.path, mode: it.mode || '100644', type: 'blob', sha: null }));
}

// POST /api/ingest/discard { ref, album } — 人工判定该草稿不要了，直接删除 review bundle。
// 删除后 finalize 的 guard 与 72h 超时 sweep 都找不到 <ref>/，不会再入库。
// 原料在 Phase A 末已销毁，此处删的是派生态，无可恢复内容。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const album = cleanAlbum(body?.album);
  if (!ref || !album) return json({ error: 'bad request' }, 400);

  const prefix = `${ref}/${album}/`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh(env, `/repos/${REPO}/git/ref/heads/${REVIEW_BRANCH}`);
    if (!head.resp.ok) return json({ error: 'github', step: 'ref', message: head.data.message }, 502);
    const headSha = head.data.object.sha;

    const headCommit = await gh(env, `/repos/${REPO}/git/commits/${headSha}`);
    if (!headCommit.resp.ok) return json({ error: 'github', step: 'head-commit' }, 502);
    const baseTree = headCommit.data.tree.sha;

    const listed = await gh(env, `/repos/${REPO}/git/trees/${baseTree}?recursive=1`);
    if (!listed.resp.ok) return json({ error: 'github', step: 'tree-list' }, 502);
    if (listed.data.truncated) return json({ error: 'tree too large' }, 502);

    const entries = deletionEntries(listed.data.tree, prefix);
    if (!entries.length) return json({ error: 'not found', ref, album }, 404);

    const tree = await gh(env, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree: entries }),
    });
    if (!tree.resp.ok) return json({ error: 'github', step: 'tree', message: tree.data.message }, 502);

    const commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: `discard: ${album} (${ref})`, tree: tree.data.sha, parents: [headSha] }),
    });
    if (!commit.resp.ok) return json({ error: 'github', step: 'commit', message: commit.data.message }, 502);

    const upd = await gh(env, `/repos/${REPO}/git/refs/heads/${REVIEW_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.data.sha, force: false }),
    });
    if (upd.resp.ok) return json({ ok: true, ref, album, removed: entries.length, commit: commit.data.sha });
    // 422 非快进 = 他人同时改了 ingest-review，重取 HEAD 再删一次
    if (upd.resp.status !== 422 || attempt === 1) {
      return json({ error: 'github', step: 'ref-update', message: upd.data.message }, 502);
    }
  }
}
