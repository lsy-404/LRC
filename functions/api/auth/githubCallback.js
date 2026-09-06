import { directory } from './_lib.js';
import { githubConfigured, exchangeCodeForToken, fetchGithubLogin } from './_github.js';

function redirect(params) {
  return new Response(null, { status: 302, headers: { location: `/contribute/workstation.html?${new URLSearchParams(params)}` } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';

  // 一次消费：查找、一次性/过期校验、失效收在同一次 DO 调用里，伪造/重放/过期
  // 统一按 invalid_state 处理——不细分原因，避免给探测请求额外信息。
  const userId = await directory(env).consumeOAuthState(state, Date.now());
  if (!userId) return redirect({ github: 'error', reason: 'invalid_state' });

  if (!githubConfigured(env)) return redirect({ github: 'error', reason: 'not_configured' });
  if (url.searchParams.get('error')) return redirect({ github: 'error', reason: 'denied' });

  const code = url.searchParams.get('code');
  if (!code) return redirect({ github: 'error', reason: 'missing_code' });

  const accessToken = await exchangeCodeForToken(env, code);
  if (!accessToken) return redirect({ github: 'error', reason: 'exchange_failed' });

  // login 读完这一行,accessToken 就没有用处了：不落库、不写日志
  const login = await fetchGithubLogin(env, accessToken);
  if (!login) return redirect({ github: 'error', reason: 'exchange_failed' });

  const bound = await directory(env).bindGithub(userId, login);
  if (!bound.ok) {
    return redirect({ github: 'error', reason: bound.reason === 'taken' ? 'taken' : 'exchange_failed' });
  }
  return redirect({ github: 'connected' });
}
