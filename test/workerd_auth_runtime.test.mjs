import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { Miniflare } = createRequire(new URL('../worker/package.json', import.meta.url))('miniflare');

test('workerd executes the production PBKDF2 password path at 600k iterations', async () => {
  const mf = new Miniflare({ modules: true, scriptPath: new URL('./workerd_auth_worker.mjs', import.meta.url).pathname, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2026-08-06' });
  try {
    const response = await mf.dispatchFetch('https://local.test/');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.verified, true);
    assert.equal(result.iterations, 600000);
    assert.ok(result.elapsedMs > 0);
  } finally {
    await mf.dispose();
  }
});

test('workerd and the real SQLite UserDirectory execute bootstrap, invite, login, password invalidation and disabled guards', async () => {
  const mf = new Miniflare({ modules: true, scriptPath: new URL('./workerd_auth_worker.mjs', import.meta.url).pathname, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2026-08-06', durableObjects: { USERS: { className: 'UserDirectory', useSQLite: true } }, bindings: { UPLOAD_PASSWORD: 'bootstrap-secret' } });
  try {
    const response = await mf.dispatchFetch('https://local.test/flow');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { bootstrap: 201, bootstrapAgain: 409, invite: 201, register: 201, editorAdmin: 403, anonymous: 401, login: 200, passwordChange: 200, oldSession: 401, otherSession: 401, oldPassword: 401, newPassword: 200, disable: 200, disabled: 401 });
  } finally { await mf.dispose(); }
});
