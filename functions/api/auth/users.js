import { json, requireAdmin, directory } from './_lib.js';

export async function onRequestGet(ctx) {
  const admin = await requireAdmin(ctx);
  if (!admin) return json({ error: 'forbidden' }, 403);
  return json({ users: await directory(ctx.env).listUsers() });
}
