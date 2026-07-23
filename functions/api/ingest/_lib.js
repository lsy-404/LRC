// ingest review 代理共享工具：复用 upload/_lib 的鉴权与 GitHub 头，附加 review 分支常量。

export {
  json, passwordOk, bearer, ghHeaders, GH_API, REPO, cleanAlbum,
} from '../upload/_lib.js';

export const REVIEW_BRANCH = 'ingest-review';

// ref = payload 提交 SHA（capture 已 tag 保护）；宽松接受 7~40 位小写十六进制
const REF_RE = /^[0-9a-f]{7,40}$/;
export function cleanRef(r) {
  return typeof r === 'string' && REF_RE.test(r) ? r : null;
}

// GitHub contents API 的 base64（可能带换行）↔ UTF-8 文本
// draft.json 含中文，必须走 UTF-8，不能直接 atob（latin1 会乱码）
export function b64ToText(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export function textToB64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// contents API 路径分段 encode（专辑名含中文/空格）
export function encodeContentsPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}
