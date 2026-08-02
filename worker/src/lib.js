// 编排 Worker 的公共小工具：响应、鉴权、对象键校验。

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// 摘要后恒时比较，避免逐字符比较泄漏前缀信息
export async function authorized(request, env) {
  const candidate = bearer(request);
  if (!candidate || !env.INGEST_TOKEN) return false;
  const [a, b] = await Promise.all([digest(candidate), digest(env.INGEST_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ref = 上传会话号（原先是投递提交 SHA，迁移后不再有提交可依）
const REF_RE = /^[0-9a-f]{16,64}$/;
export function cleanRef(r) {
  return typeof r === 'string' && REF_RE.test(r) ? r : null;
}

// 容器经 /store 读写 R2，仅放行原料与草稿两个前缀，且拒绝路径穿越
const KEY_RE = /^(web|review)\/[^?#]{1,512}$/;
export function cleanKey(k) {
  if (typeof k !== 'string' || !KEY_RE.test(k)) return null;
  if (k.includes('..') || k.includes('//')) return null;
  return k;
}

export function cleanPrefix(p) {
  if (typeof p !== 'string' || !/^(web|review)\/[^?#]{0,512}$/.test(p)) return null;
  if (p.includes('..') || p.includes('//')) return null;
  return p;
}
