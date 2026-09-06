import { json, requireUser, directory, sanitizeUser } from './_lib.js';

// 解绑：幂等，未绑定时也直接返回当前用户
export async function onRequestDelete(ctx) {
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const updated = await directory(ctx.env).unbindGithub(user.id);
  return json({ user: sanitizeUser(updated) });
}
