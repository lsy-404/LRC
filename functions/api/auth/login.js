import { json, jsonWithHeaders, directory, verifyPasswordOrDummy, issueSession, sanitizeUser } from './_lib.js';

// 「用户不存在」与「密码错误」返回同一个错误、耗时也相同：都会跑一次 PBKDF2
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const dir = directory(env);
  const found = name ? await dir.getUserByName(name) : null;
  const user = found && found.status === 'active' ? found : null;

  if (!(await verifyPasswordOrDummy(body.password, user))) return json({ error: 'invalid credentials' }, 401);

  await dir.touchLastSeen(user.id, Date.now());
  const headers = new Headers();
  await issueSession(env, user.id, headers);
  return jsonWithHeaders({ user: sanitizeUser(user) }, 200, headers);
}
