import {
  json, jsonWithHeaders, directory, sha256Hex, hashPassword,
  cleanUsername, validPassword, cleanDisplayName, issueSession, sanitizeUser,
} from './_lib.js';

const INVITE_RE = /^[0-9a-f]{16,64}$/;
const INVITE_ERROR = { not_found: 'invalid invite', used: 'invite already used', expired: 'invite expired' };

// 邀请制注册：角色取邀请码携带的 role，不信任客户端传入的 role 字段。
//
// 先原子占用邀请码（DO 内一条条件 UPDATE 完成），再做慢操作（PBKDF2 派生、建号）：
// 占用和「校验一次性/有效期」在同一次 DO 调用里做完，两个并发请求用同一个码时只有一个能占到，
// 不会像「先查 used_by 再回写」那样，在查完到写完之间留出被另一个请求也查到「未使用」的窗口。
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.invite_code === 'string' ? body.invite_code.trim() : '';
  if (!INVITE_RE.test(code)) return json({ error: 'invalid invite' }, 400);

  const name = cleanUsername(body.name);
  if (!name) return json({ error: 'bad name' }, 400);
  if (!validPassword(body.password)) return json({ error: 'weak password' }, 400);
  const display_name = cleanDisplayName(body.display_name, name);

  const dir = directory(env);
  const codeHash = await sha256Hex(code);
  const claimed = await dir.claimInvite(codeHash, Date.now());
  if (!claimed.ok) return json({ error: INVITE_ERROR[claimed.reason] || 'invalid invite' }, 400);

  const { password_hash, salt, iterations } = await hashPassword(body.password);
  const created = await dir.createUser({ name, display_name, role: claimed.role, password_hash, salt, iterations });
  if (!created.ok) {
    // 建号失败（撞用户名）不能让邀请码白白作废：放回未使用状态，换个用户名还能重试
    await dir.releaseInvite(codeHash);
    return json({ error: 'username taken' }, 409);
  }

  await dir.finalizeInvite(codeHash, created.user.id);

  const headers = new Headers();
  await issueSession(env, created.user.id, headers);
  return jsonWithHeaders({ user: sanitizeUser(created.user) }, 201, headers);
}
