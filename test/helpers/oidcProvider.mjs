import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

// 最小 OIDC 提供方替身：发现文档、JWKS、PAR、授权码 + PKCE、JARM 签名响应、userinfo。
const b64url = (value) => Buffer.from(value).toString('base64url');

export function createOidcProvider({ issuer = 'https://id.test', clientId = 'lrc-studio', clientSecret = 's'.repeat(40), subject = 'acct-42', profile = {} } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const pending = new Map();
  const codes = new Map();
  const claims = { sub: subject, name: 'Lyric Maker', preferred_username: 'maker', email: 'maker@example.test', email_verified: true, ...profile };
  const jwt = (payload, typ = 'JWT') => {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };
  const now = () => Math.floor(Date.now() / 1000);
  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    end_session_endpoint: `${issuer}/oauth/logout`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'jwt'],
    code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['RS256'],
    authorization_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  };

  async function fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== issuer) return new Response('unexpected outbound request', { status: 502 });
    if (url.pathname === '/.well-known/openid-configuration') return Response.json(metadata);
    if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    if (url.pathname === '/oauth/par' && request.method === 'POST') {
      const requestUri = `urn:ietf:params:oauth:request_uri:${randomUUID()}`;
      pending.set(requestUri, new URLSearchParams(await request.text()));
      return Response.json({ request_uri: requestUri, expires_in: 60 }, { status: 201 });
    }
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const [id, secret] = Buffer.from((request.headers.get('authorization') || '').replace(/^Basic /, ''), 'base64').toString().split(':').map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
      if (id !== clientId || secret !== clientSecret) return Response.json({ error: 'invalid_client' }, { status: 401 });
      const body = new URLSearchParams(await request.text());
      const issued = codes.get(body.get('code'));
      codes.delete(body.get('code'));
      const verifier = createHash('sha256').update(body.get('code_verifier') || '').digest('base64url');
      if (!issued || verifier !== issued.challenge || body.get('redirect_uri') !== issued.redirectUri) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'access-1', token_type: 'Bearer', expires_in: 300, id_token: jwt({ iss: issuer, aud: clientId, sub: subject, nonce: issued.nonce, sid: 'sid-1', iat: now(), exp: now() + 300 }) });
    }
    if (url.pathname === '/oauth/userinfo') return request.headers.get('authorization') === 'Bearer access-1' ? Response.json(claims) : Response.json({ error: 'invalid_token' }, { status: 401 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 模拟浏览器在提供方处同意授权，返回带 JARM 响应的回调地址
  function approve(location, { error } = {}) {
    const params = pending.get(new URL(location).searchParams.get('request_uri'));
    if (!params) throw new Error('unknown authorization request');
    const fields = error ? { error, state: params.get('state') } : { code: randomUUID(), state: params.get('state') };
    if (!error) codes.set(fields.code, { challenge: params.get('code_challenge'), nonce: params.get('nonce'), redirectUri: params.get('redirect_uri') });
    const callback = new URL(params.get('redirect_uri'));
    callback.searchParams.set('response', jwt({ iss: issuer, aud: clientId, exp: now() + 300, ...fields }, 'oauth-authz-res+jwt'));
    return callback.href;
  }

  return { fetch, approve, issuer, clientId, clientSecret, subject };
}
