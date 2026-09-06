import { json, requireUser, directory, randomHex } from './_lib.js';
import { githubConfigured, buildAuthorizeUrl, STATE_TTL_MS, STATE_BYTES } from './_github.js';

// 一次性 state 存进 UserDirectory 的 oauth_states 表（绑定 user_id），不放进 sessions：
// GitHub 授权完成后跳回 callback 是跨站顶层导航，SameSite=Strict 的会话 Cookie 在这种
// 请求上不会被带回来，callback 没法靠 requireUser() 认出发起者，只能靠 state 本身。
export async function onRequestGet(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!githubConfigured(env)) return json({ error: 'github oauth not configured' }, 501);

  const state = randomHex(STATE_BYTES);
  const now = Date.now();
  await directory(env).createOAuthState({
    state, user_id: user.id, created_at: now, expires_at: now + STATE_TTL_MS,
  });

  return new Response(null, {
    status: 302,
    headers: { location: buildAuthorizeUrl(env.GITHUB_OAUTH_CLIENT_ID, state) },
  });
}
