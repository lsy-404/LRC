// 「最近投稿」本地缓存：上传面板写入、修改面板回查。

export const REFS_KEY = 'lrc-upload-refs';

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);
const short = (r) => String(r || '').slice(0, 7);

export function readRefs(s = store()) {
  try {
    const list = JSON.parse((s && s.getItem(REFS_KEY)) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.ref === 'string') : [];
  } catch { return []; }
}

export function writeRefs(list, s = store()) {
  try { if (s) s.setItem(REFS_KEY, JSON.stringify(list.slice(0, 20))); }
  catch { /* localStorage 不可用则跳过，不影响投稿 */ }
}

export function addRef(album, ref, s = store(), at = Date.now()) {
  const next = [{ ref, album, at }, ...readRefs(s).filter((x) => short(x.ref) !== short(ref))];
  writeRefs(next, s);
  return next;
}

export function removeRef(ref, s = store()) {
  const next = readRefs(s).filter((x) => short(x.ref) !== short(ref));
  writeRefs(next, s);
  return next;
}

// 下拉展示用：剔除已在待处理列表中的 ref（那边已能点选，避免同一投稿列两次），
// 同一 ref 与同一专辑各只保留最新一条（旧 ref 多为已入库或已失效的残留）。
export function dedupeRecent(cached, pending = []) {
  const inPending = new Set((pending || []).map((p) => short(p && p.ref)));
  const seenRef = new Set();
  const seenAlbum = new Set();
  return [...(cached || [])]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .filter((c) => {
      const r = short(c.ref);
      const a = c.album || '';
      if (!r || inPending.has(r) || seenRef.has(r) || seenAlbum.has(a)) return false;
      seenRef.add(r);
      seenAlbum.add(a);
      return true;
    });
}
