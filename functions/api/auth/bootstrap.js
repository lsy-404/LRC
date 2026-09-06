import {
  json, jsonWithHeaders, directory, secretEquals, hashPassword,
  cleanUsername, validPassword, cleanDisplayName, issueSession, sanitizeUser,
} from './_lib.js';

// 首个管理员引导：凭 env.UPLOAD_PASSWORD 开号，仅在用户表为空时可用一次
export async function onRequestPost({ request, env }) {
  const dir = directory(env);
  if (!(await dir.isEmpty())) return json({ error: 'already bootstrapped' }, 409);

  const body = await request.json().catch(() => ({}));
  if (!(await secretEquals(body.token, env.UPLOAD_PASSWORD))) return json({ error: 'unauthorized' }, 401);

  const name = cleanUsername(body.name);
  if (!name) return json({ error: 'bad name' }, 400);
  if (!validPassword(body.password)) return json({ error: 'weak password' }, 400);
  const display_name = cleanDisplayName(body.display_name, name);

  const { password_hash, salt, iterations } = await hashPassword(body.password);
  const created = await dir.createUser({ name, display_name, role: 'admin', password_hash, salt, iterations });
  if (!created.ok) return json({ error: 'bad name' }, 400);

  const headers = new Headers();
  await issueSession(env, created.user.id, headers);
  return jsonWithHeaders({ user: sanitizeUser(created.user) }, 201, headers);
}
