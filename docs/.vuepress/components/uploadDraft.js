// 投稿编辑状态本地草稿：File 本体进不了 localStorage，只存按 relPath 索引的元数据，
// 重选文件时按 relPath 匹配恢复用途/绑定/旋转/排序，并在文件大小一致时复用已传 sha。

export const DRAFT_KEY = 'lrc-upload-draft';

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function serializeDraft(album, items, at = Date.now()) {
  return {
    album: album || '',
    at,
    // 自动生成的 manifest 不入草稿：它由当前绑定关系重建，用户也不会重选它
    files: (items || []).filter((i) => i && !i.auto).map((i) => ({
      relPath: i.relPath,
      role: i.role,
      rotation: i.rotation || 0,
      linkTo: i.linkTo || 0,
      porder: i.porder == null ? null : i.porder,
      instConfirmed: !!i.instConfirmed,
      size: i.size || 0,
      sha: i.sha || null,
    })),
  };
}

export function writeDraft(draft, s = store()) {
  try { if (s) s.setItem(DRAFT_KEY, JSON.stringify(draft)); }
  catch { /* localStorage 不可用则跳过，不影响投稿 */ }
}

export function clearDraft(s = store()) {
  try { if (s) s.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export function readDraft(s = store()) {
  try {
    const d = JSON.parse((s && s.getItem(DRAFT_KEY)) || 'null');
    if (!d || !Array.isArray(d.files)) return null;
    const map = new Map();
    for (const f of d.files) if (f && typeof f.relPath === 'string') map.set(f.relPath, f);
    if (!map.size) return null;
    return { album: d.album || '', at: d.at || 0, map };
  } catch { return null; }
}

// 把草稿条目恢复到新建的 item 上（原地改），返回本次恢复了什么。
// sha 只在文件大小一致时复用：大小不同必然内容不同，复用会静默提交旧内容。
export function restoreItem(item, saved) {
  if (!item || !saved) return { restored: false, reusedSha: false };
  if (saved.role) item.role = saved.role;
  item.linkTo = saved.linkTo || 0;
  if (saved.porder != null) item.porder = saved.porder;
  if (saved.instConfirmed) item.instConfirmed = true;
  if (saved.rotation) item.rotation = saved.rotation;
  const reusedSha = !!saved.sha && !!saved.size && saved.size === item.size;
  if (reusedSha) {
    item.sha = saved.sha;
    item.status = 'done';
    item.pct = 100;
  }
  return { restored: true, reusedSha, rotated: !!saved.rotation };
}

// 防抖包装：编辑动作密集（连续旋转/拖排）时合并写盘
export function debounce(fn, ms = 400) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args) => {
    if (timer) { clearTimeout(timer); timer = null; }
    fn(...args);
  };
  return wrapped;
}
