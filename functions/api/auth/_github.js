// GitHub OAuth 绑定专用工具：只用来读回真实 handle 供署名，不是登录手段。
// scope 留空，只读公开 profile；access token 用完即弃，调用方不得落库或记录。

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

// OAuth 回调固定为正式站点，避免其他绑定域名改变登记地址。
export const CALLBACK_URL = 'https://lrc.voidcarve.com/api/auth/github/callback';

export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATE_BYTES = 24;

export function githubConfigured(env) {
  return !!(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET);
}

// 测试注入点：env.GITHUB_FETCH 优先于全局 fetch。这里的调用方是路由表
// （handler({ request, env })，request 已经是"进来的请求"），没法像
// workspaceAdapter.js 的 createWorkspaceAdapter(password, request = fetch) 那样
// 用构造函数参数，所以借 env 挂一个可替换的 fetch。
function githubFetch(env) {
  return typeof env.GITHUB_FETCH === 'function' ? env.GITHUB_FETCH : fetch;
}

export function buildAuthorizeUrl(clientId, state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', CALLBACK_URL);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(env, code) {
  const res = await githubFetch(env)(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: CALLBACK_URL,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return typeof data.access_token === 'string' && data.access_token ? data.access_token : null;
}

export async function fetchGithubLogin(env, accessToken) {
  const res = await githubFetch(env)(USER_URL, {
    headers: {
      // 传统格式，比只在较新 API 版本确认过的 Bearer 更保险；GitHub API 强制要求 User-Agent
      authorization: `token ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'lrc-workstation',
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return typeof data.login === 'string' && data.login ? data.login : null;
}
