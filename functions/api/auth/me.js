import { json, requireUser, sanitizeUser, directory, cleanDisplayName } from './_lib.js';
import { githubConfigured } from './_github.js';

// 当前账号、其在曲库中的权限动作与身份提供方名称；worker/src/api.js 已完成单点登录会话校验。
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const description = env.STUDIO ? await env.STUDIO.describe(request, env) : null;
  return json({
    user: sanitizeUser(user),
    actions: description?.actions || {},
    provider: description?.provider || '',
    githubConfigured: githubConfigured(env),
  });
}

// 只允许修改展示名：账号与密码由统一身份管理
export async function onRequestPatch(ctx) {
  const { request, env } = ctx;
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const display_name = cleanDisplayName(body.display_name, null);
  if (!display_name) return json({ error: 'bad display name' }, 400);
  const updated = await directory(env).updateDisplayName(user.id, display_name);
  return json({ user: sanitizeUser(updated) });
}
