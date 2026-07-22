import {
  json, passwordOk, bearer, ghHeaders, cleanAlbum, cleanRelPath,
  buildTreeEntries, SHA_RE, GH_API, REPO, BRANCH,
} from './_lib.js';

async function gh(env, path, init = {}) {
  const resp = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: ghHeaders(env, init.body ? { 'content-type': 'application/json' } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

// 把已暂存的 blobs 缝成单 commit 推到 upload 分支——唯一产生 push 的时刻。
// base_tree 取当前 HEAD 树，保证投递箱常驻的 workflow/README 原样保留。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const album = cleanAlbum(body?.album);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!album || !rawFiles.length || rawFiles.length > 500) return json({ error: 'bad request' }, 400);

  const files = [];
  const seen = new Set();
  for (const f of rawFiles) {
    const path = cleanRelPath(f?.path);
    if (!path || !SHA_RE.test(f?.sha ?? '') || seen.has(path)) {
      return json({ error: 'invalid file entry', path: f?.path }, 400);
    }
    seen.add(path);
    files.push({ path, sha: f.sha });
  }

  const message = `upload: ${album} (web, ${files.length} files)`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh(env, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    if (!head.resp.ok) return json({ error: 'github', step: 'ref', message: head.data.message }, 502);
    const headSha = head.data.object.sha;

    const headCommit = await gh(env, `/repos/${REPO}/git/commits/${headSha}`);
    if (!headCommit.resp.ok) return json({ error: 'github', step: 'head-commit', message: headCommit.data.message }, 502);

    const tree = await gh(env, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: headCommit.data.tree.sha, tree: buildTreeEntries(album, files) }),
    });
    if (!tree.resp.ok) return json({ error: 'github', step: 'tree', message: tree.data.message }, 502);

    const commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.data.sha, parents: [headSha] }),
    });
    if (!commit.resp.ok) return json({ error: 'github', step: 'commit', message: commit.data.message }, 502);

    const ref = await gh(env, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.data.sha, force: false }),
    });
    if (ref.resp.ok) return json({ ok: true, commit: commit.data.sha, files: files.length });
    // 422 非快进 = 暂存期间投递箱动过（他人投稿或重置），重取 HEAD 再缝一次
    if (ref.resp.status !== 422 || attempt === 1) {
      return json({ error: 'github', step: 'ref-update', message: ref.data.message }, 502);
    }
  }
}
