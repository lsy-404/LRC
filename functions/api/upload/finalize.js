import {
  json, passwordOk, bearer, ghHeaders, cleanAlbum, cleanRelPath, cleanSession, cleanIndex,
  MAX_FILES, GH_API, REPO, BRANCH,
} from './_lib.js';

async function gh(env, path, init = {}) {
  const resp = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: ghHeaders(env, init.body ? { 'content-type': 'application/json' } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

// 文件本体已直传 R2（web/<session>/<n>），这里只把「取料清单」.r2-payload.json
// 提交到 upload 分支——唯一产生 push 的时刻，由它触发 upload_ingest 工作流从 R2
// 取回原料。清单路径固定：后一笔提交的树条目天然覆盖前一笔（若前一笔已被自己的
// 排队 run 在各自 tag 上消费，互不影响），每次投稿恰好被处理一次。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const album = cleanAlbum(body?.album);
  const session = cleanSession(body?.session);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!album || !session || !rawFiles.length || rawFiles.length > MAX_FILES) {
    return json({ error: 'bad request' }, 400);
  }

  const files = [];
  const seenPath = new Set();
  const seenN = new Set();
  for (const f of rawFiles) {
    const path = cleanRelPath(f?.path);
    const n = cleanIndex(f?.n);
    if (!path || seenPath.has(path) || n === null || seenN.has(n)) {
      return json({ error: 'invalid file entry', path: f?.path }, 400);
    }
    seenPath.add(path);
    seenN.add(n);
    files.push({ n, path, size: Number(f?.size) || 0 });
  }

  const manifest = JSON.stringify({ version: 1, album, session, files }, null, 1);
  const message = `upload: ${album} (web, ${files.length} files via r2)`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh(env, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    if (!head.resp.ok) return json({ error: 'github', step: 'ref', message: head.data.message }, 502);
    const headSha = head.data.object.sha;

    const headCommit = await gh(env, `/repos/${REPO}/git/commits/${headSha}`);
    if (!headCommit.resp.ok) return json({ error: 'github', step: 'head-commit', message: headCommit.data.message }, 502);

    const blob = await gh(env, `/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ encoding: 'utf-8', content: manifest }),
    });
    if (!blob.resp.ok) return json({ error: 'github', step: 'blob', message: blob.data.message }, 502);

    const tree = await gh(env, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: headCommit.data.tree.sha,
        tree: [{ path: '.r2-payload.json', mode: '100644', type: 'blob', sha: blob.data.sha }],
      }),
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
