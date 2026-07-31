// 投稿编辑状态本地草稿：只记浏览器侧的人工编辑结果（用途/绑定/旋转/排序），
// 重选文件时按 relPath 匹配恢复，省去重做这些操作。文件本身照常上传。

export const DRAFT_KEY = 'lrc-upload-draft';

// 草稿保留 30 天：投稿完成后也留着，期内重投同一专辑不必重做旋转与绑定
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function serializeDraft(album, items, at = Date.now(), submittedRef = '') {
  return {
    album: album || '',
    at,
    submittedRef: submittedRef || '',
    // 自动生成的 manifest 不入草稿：它由当前绑定关系重建，用户也不会重选它
    files: (items || []).filter((i) => i && !i.auto).map((i) => ({
      relPath: i.relPath,
      role: i.role,
      rotation: i.rotation || 0,
      linkTo: i.linkTo || 0,
      porder: i.porder == null ? null : i.porder,
      instConfirmed: !!i.instConfirmed,
      instMarked: !!i.instMarked,
    })),
  };
}

// 空列表不覆盖已有草稿：清空文件或投下一张时不应抹掉上次的记录，真要丢弃走 clearDraft
export function writeDraft(draft, s = store()) {
  if (!draft || !draft.files || !draft.files.length) return false;
  try {
    if (s) s.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export function clearDraft(s = store()) {
  try { if (s) s.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export function readDraft(s = store(), now = Date.now()) {
  try {
    const d = JSON.parse((s && s.getItem(DRAFT_KEY)) || 'null');
    if (!d || !Array.isArray(d.files)) return null;
    if (d.at && now - d.at > MAX_AGE_MS) { clearDraft(s); return null; }
    const map = new Map();
    for (const f of d.files) if (f && typeof f.relPath === 'string') map.set(f.relPath, f);
    if (!map.size) return null;
    return {
      album: d.album || '', at: d.at || 0, submittedRef: d.submittedRef || '', map,
    };
  } catch { return null; }
}

// 把草稿条目恢复到新建的 item 上（原地改）。只恢复人工编辑结果，
// 上传状态不进草稿：文件本体每次都重新选取，照常上传。
export function restoreItem(item, saved) {
  if (!item || !saved) return { restored: false };
  if (saved.role) item.role = saved.role;
  item.linkTo = saved.linkTo || 0;
  if (saved.porder != null) item.porder = saved.porder;
  if (saved.instConfirmed) item.instConfirmed = true;
  if (saved.instMarked) item.instMarked = true;
  if (saved.rotation) item.rotation = saved.rotation;
  return { restored: true, rotated: !!saved.rotation };
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
