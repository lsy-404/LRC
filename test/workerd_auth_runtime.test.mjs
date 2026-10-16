import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createOidcProvider } from './helpers/oidcProvider.mjs';

const require = createRequire(new URL('../worker/package.json', import.meta.url));
const { Miniflare } = require('miniflare');
const esbuild = require('esbuild');

// 真实 workerd：生产 API 路由 + 私有工作站方案 + SQLite UserDirectory；外部只替换身份提供方与曲库网关。
async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
    conditions: ['workerd', 'worker', 'browser', 'import'], mainFields: ['module', 'main'],
    external: ['cloudflare:workers'],
  });
  return result.outputFiles[0].text;
}

async function start(idp) {
  const [site, gateway] = await Promise.all([bundle('./workerd_studio_worker.mjs'), bundle('./workerd_fake_gateway.mjs')]);
  return new Miniflare({
    workers: [
      {
        name: 'lrc',
        modules: true,
        script: site,
        compatibilityDate: '2026-08-06',
        durableObjects: { USERS: { className: 'UserDirectory', useSQLite: true } },
        r2Buckets: ['UPLOAD_BUCKET'],
        serviceBindings: { EDGESONIC: { name: 'edgesonic', entrypoint: 'StudioGateway' } },
        bindings: {
          SSO_ISSUER: idp.issuer, SSO_CLIENT_ID: idp.clientId, SSO_CLIENT_SECRET: idp.clientSecret,
          STUDIO_COOKIE_SECRET: 'c'.repeat(43), SSO_PROVIDER_NAME: 'Test Access',
        },
        outboundService: (request) => idp.fetch(request),
      },
      { name: 'edgesonic', modules: true, script: gateway, compatibilityDate: '2026-08-06' },
    ],
  });
}

const cookieOf = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(';')[0];

test('workerd runs single sign-on, permission-gated workspace access, library proxying and logout end to end', async () => {
  const idp = createOidcProvider();
  const mf = await start(idp);
  try {
    const call = (path, init = {}) => mf.dispatchFetch(`https://lrc.test${path}`, { redirect: 'manual', ...init });

    assert.equal((await call('/api/auth/me')).status, 401);
    const begin = await call('/api/auth/sso/start?return=%2Fstudio%2F');
    assert.equal(begin.status, 302);
    const location = begin.headers.get('location');
    assert.ok(location.startsWith(`${idp.issuer}/oauth/authorize?`));
    const transaction = cookieOf(begin, 'studio_oidc');

    const callback = await mf.dispatchFetch(idp.approve(location), { redirect: 'manual', headers: { cookie: transaction } });
    assert.equal(callback.status, 303, await callback.clone().text());
    assert.equal(callback.headers.get('location'), '/studio/');
    const session = cookieOf(callback, 'lrc_session');
    assert.ok(session);
    const authed = (path, init = {}) => call(path, { ...init, headers: { cookie: session, ...(init.headers || {}) } });

    const me = await (await authed('/api/auth/me')).json();
    assert.equal(me.user.name, 'maker');
    assert.equal(me.provider, 'Test Access');
    assert.deepEqual(me.actions, { browse: true, listen: true, edit: true, discard: false, submit: false, download: false });

    const search = await (await authed('/api/library/search?q=%E6%98%9F%E6%B2%B3')).json();
    assert.equal(search.songs[0].title, '星河');
    assert.equal('path' in search.songs[0], false);
    const stream = await authed('/api/library/stream/so-1', { headers: { range: 'bytes=0-3' } });
    assert.equal(await stream.text(), 'flac');
    assert.equal(stream.headers.get('set-cookie'), null);
    assert.equal(stream.headers.get('x-edgesonic-engine'), null);

    assert.equal((await authed('/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ album: '星河' }) })).status, 200);
    assert.equal((await authed('/api/workspace/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'a'.repeat(32) }) })).status, 403);

    const logout = await authed('/api/auth/sso/logout', { method: 'POST' });
    const { redirect } = await logout.json();
    assert.ok(redirect.startsWith(`${idp.issuer}/oauth/logout?`));
    assert.equal((await authed('/api/auth/me')).status, 401);
  } finally {
    await mf.dispose();
  }
});

test('workerd maps a returning identity to the same account and rejects a signed provider denial', async () => {
  const idp = createOidcProvider();
  const mf = await start(idp);
  try {
    const login = async (options) => {
      const begin = await mf.dispatchFetch('https://lrc.test/api/auth/sso/start', { redirect: 'manual' });
      return mf.dispatchFetch(idp.approve(begin.headers.get('location'), options), { redirect: 'manual', headers: { cookie: cookieOf(begin, 'studio_oidc') } });
    };
    const first = await login();
    const second = await login();
    const ids = [];
    for (const response of [first, second]) {
      const me = await (await mf.dispatchFetch('https://lrc.test/api/auth/me', { headers: { cookie: cookieOf(response, 'lrc_session') } })).json();
      ids.push(me.user.id);
    }
    assert.equal(ids[0], ids[1]);
    const denied = await login({ error: 'access_denied' });
    assert.equal(denied.headers.get('location'), '/studio/?sso_error=denied');
    assert.equal(cookieOf(denied, 'lrc_session'), undefined);
  } finally {
    await mf.dispose();
  }
});
