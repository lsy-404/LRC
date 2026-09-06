import {
  json, requireUser, sanitizeUser, directory,
  verifyPassword, hashPassword, validPassword, cleanDisplayName,
} from './_lib.js';

export async function onRequestGet(ctx) {
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);
  return json({ user: sanitizeUser(user) });
}

// 改展示名、改密码（改密码要求提供旧密码）
export async function onRequestPatch(ctx) {
  const { request, env } = ctx;
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const dir = directory(env);
  let current = user;

  if (body.display_name !== undefined) {
    const display_name = cleanDisplayName(body.display_name, null);
    if (!display_name) return json({ error: 'bad display_name' }, 400);
    current = await dir.updateDisplayName(current.id, display_name);
  }

  if (body.new_password !== undefined) {
    if (!(await verifyPassword(body.old_password || '', current))) {
      return json({ error: 'bad old password' }, 400);
    }
    if (!validPassword(body.new_password)) return json({ error: 'weak password' }, 400);
    const { password_hash, salt, iterations } = await hashPassword(body.new_password);
    await dir.updatePassword(current.id, { password_hash, salt, iterations });
    await dir.deleteSessionsForUser(current.id);
  }

  return json({ user: sanitizeUser(current) });
}
