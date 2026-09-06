import { json, requireAdmin, directory, sha256Hex, randomHex, INVITE_BYTES } from './_lib.js';

const ROLES = new Set(['editor', 'admin']);
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 邀请码明文只在创建时回一次，库里只存摘要
export async function onRequestPost(ctx) {
  const admin = await requireAdmin(ctx);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const { request, env } = ctx;
  const body = await request.json().catch(() => ({}));
  const role = ROLES.has(body.role) ? body.role : 'editor';
  const ttlMs = Number.isFinite(body.ttl_hours) && body.ttl_hours > 0
    ? body.ttl_hours * 60 * 60 * 1000 : DEFAULT_TTL_MS;

  const code = randomHex(INVITE_BYTES);
  const now = Date.now();
  const expires_at = now + ttlMs;
  await directory(env).createInvite({
    code_hash: await sha256Hex(code), role, created_by: admin.id, created_at: now, expires_at,
  });
  return json({ code, role, expires_at }, 201);
}

export async function onRequestDelete(ctx) {
  const admin = await requireAdmin(ctx);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const { request, env } = ctx;
  const body = await request.json().catch(() => ({}));
  if (typeof body.code_hash !== 'string' || !body.code_hash) return json({ error: 'bad code_hash' }, 400);
  const deleted = await directory(env).deleteInvite(body.code_hash);
  return json({ ok: deleted });
}
