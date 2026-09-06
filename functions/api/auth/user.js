import { json, requireAdmin, directory, sanitizeUser } from './_lib.js';

const ROLES = new Set(['editor', 'admin']);
const STATUSES = new Set(['active', 'disabled']);

// 改角色、停用。「是否会打掉最后一名在职管理员」的判断和落库收在 DO 的
// updateRoleAndStatus 一次调用里完成，避免两个并发的 PATCH 请求都在读到「还有别的管理员」
// 之后各自通过校验，最终一起把所有管理员降级掉。
export async function onRequestPatch(ctx) {
  const admin = await requireAdmin(ctx);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const { request, env } = ctx;
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'bad id' }, 400);
  if (body.role !== undefined && !ROLES.has(body.role)) return json({ error: 'bad role' }, 400);
  if (body.status !== undefined && !STATUSES.has(body.status)) return json({ error: 'bad status' }, 400);

  const result = await directory(env).updateRoleAndStatus(id, { role: body.role, status: body.status });
  if (!result.ok) {
    return json(
      { error: result.reason === 'not_found' ? 'not found' : 'cannot demote the last active admin' },
      result.reason === 'not_found' ? 404 : 409,
    );
  }
  return json({ user: sanitizeUser(result.user) });
}
