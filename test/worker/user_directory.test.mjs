// 直接加载生产源码 worker/src/users.js，backing store 换成 node:sqlite 的真实 SQLite 引擎，
// 校验 DO 里手写的 SQL 语句本身没问题（列名、UNIQUE 约束、RETURNING 子句等）。
// 和 orchestrator_job.test.mjs 一样用 vm.SourceTextModule 加载，需要 --experimental-vm-modules，
// 因此不在 `node --test 'test/*.test.mjs'` 的标准跑批范围内：
//   node --experimental-vm-modules --test test/worker/user_directory.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectory } from './_userDirectory.mjs';

test('建表幂等，且 users.name 有唯一约束', async () => {
  const dir = await createDirectory();
  assert.equal(dir.isEmpty(), true);
  const created = dir.createUser({
    name: 'alice', display_name: 'Alice', role: 'admin',
    password_hash: 'h', salt: 's', iterations: 1000,
  });
  assert.equal(created.ok, true);
  assert.equal(created.user.id, 1);
  assert.equal(dir.isEmpty(), false);

  const dup = dir.createUser({
    name: 'alice', display_name: 'Alice2', role: 'editor',
    password_hash: 'h2', salt: 's2', iterations: 1000,
  });
  assert.deepEqual(dup, { ok: false, reason: 'duplicate' });
});

test('会话查找、过期回收与 last_seen 续期', async () => {
  const dir = await createDirectory();
  const { user } = dir.createUser({
    name: 'bob', display_name: 'Bob', role: 'editor',
    password_hash: 'h', salt: 's', iterations: 1000,
  });
  const now = Date.now();
  dir.createSession({ token_hash: 'tok1', user_id: user.id, issued_at: now, expires_at: now + 10_000 });

  const resolved = dir.resolveSession('tok1', now + 1000);
  assert.equal(resolved.id, user.id);
  assert.equal(dir.getUserById(user.id).last_seen, now + 1000);

  const expired = dir.resolveSession('tok1', now + 20_000);
  assert.equal(expired, null);
  // 过期会话应已被清理，之后按更早的时间戳查也查不到
  assert.equal(dir.resolveSession('tok1', now + 1000), null);
});

test('统一身份首次登录：按用户名认领旧账号，否则新建编辑者', async () => {
  const dir = await createDirectory();
  const legacy = dir.createUser({ name: 'maker', display_name: '旧展示名', role: 'admin', password_hash: 'h', salt: 's', iterations: 1000 }).user;

  const claimed = dir.resolveIdentity({ subject: 'acct-1', preferred_username: 'Maker', display_name: 'Provider Name' });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.user.id, legacy.id);
  assert.equal(claimed.user.subject, 'acct-1');
  assert.equal(claimed.user.display_name, '旧展示名');

  const again = dir.resolveIdentity({ subject: 'acct-1', preferred_username: 'renamed' });
  assert.equal(again.user.id, legacy.id);

  const stranger = dir.resolveIdentity({ subject: 'acct-2', preferred_username: 'maker' });
  assert.deepEqual(stranger, { ok: false, reason: 'conflict' });

  const fresh = dir.resolveIdentity({ subject: 'acct-3', preferred_username: 'newcomer', display_name: '新人' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.user.name, 'newcomer');
  assert.equal(fresh.user.role, 'editor');
  assert.equal(fresh.user.display_name, '新人');

  const unusual = dir.resolveIdentity({ subject: 'ACCT/4', preferred_username: '中文名' });
  assert.match(unusual.user.name, /^u-acct4$/);
  const taken = dir.resolveIdentity({ subject: 'acct-5', preferred_username: 'newcomer-x' });
  assert.equal(taken.user.name, 'newcomer-x');
});

test('停用账号不能通过统一身份登录', async () => {
  const dir = await createDirectory();
  const { user } = dir.resolveIdentity({ subject: 'acct-1', preferred_username: 'maker' });
  dir.ctx.storage.sql.exec("UPDATE users SET status = 'disabled' WHERE id = ?", user.id);
  assert.deepEqual(dir.resolveIdentity({ subject: 'acct-1', preferred_username: 'maker' }), { ok: false, reason: 'disabled' });
});

test('单点登录会话：只认带身份主体的会话，可按主体或 sid 撤销', async () => {
  const dir = await createDirectory();
  const now = Date.now();
  const { user } = dir.resolveIdentity({ subject: 'acct-1', preferred_username: 'maker' });
  dir.createSession({ token_hash: 'sso', user_id: user.id, issued_at: now, expires_at: now + 60000, subject: 'acct-1', id_token: 'id.jwt', sid: 'sid-1' });
  dir.createSession({ token_hash: 'legacy', user_id: user.id, issued_at: now, expires_at: now + 60000 });
  dir.createSession({ token_hash: 'other-device', user_id: user.id, issued_at: now, expires_at: now + 60000, subject: 'acct-1', sid: 'sid-2' });

  assert.deepEqual(Object.keys(dir.sessionDetail('sso', now)), ['user', 'id_token']);
  assert.equal(dir.sessionDetail('sso', now).id_token, 'id.jwt');
  assert.equal(dir.sessionDetail('legacy', now), null);

  dir.revokeSessions({ sid: 'sid-1' });
  assert.equal(dir.sessionDetail('sso', now), null);
  assert.ok(dir.sessionDetail('other-device', now));
  dir.revokeSessions({ subject: 'acct-1' });
  assert.equal(dir.sessionDetail('other-device', now), null);
});

test('旧库在启动时补齐单点登录列', async () => {
  const dir = await createDirectory();
  const columns = (table) => dir.ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray().map((row) => row.name);
  assert.ok(columns('users').includes('subject'));
  assert.ok(['subject', 'id_token', 'sid'].every((name) => columns('sessions').includes(name)));
});

test('oauth state 一次性消费：查到即删，重放与过期都拿不到 user_id', async () => {
  const dir = await createDirectory();
  const { user } = dir.createUser({
    name: 'oauth-user', display_name: 'OAuth', role: 'editor', password_hash: 'h', salt: 's', iterations: 1000,
  });
  const now = Date.now();
  dir.createOAuthState({ state: 'state1', user_id: user.id, created_at: now, expires_at: now + 10_000 });

  assert.equal(dir.consumeOAuthState('state1', now), user.id);
  // 已被消费，重放拿不到
  assert.equal(dir.consumeOAuthState('state1', now), null);

  dir.createOAuthState({ state: 'state2', user_id: user.id, created_at: now, expires_at: now - 1000 });
  assert.equal(dir.consumeOAuthState('state2', now), null);
  assert.equal(dir.consumeOAuthState('forged-state', now), null);
});

test('bindGithub 靠 UNIQUE 约束拒绝重复绑定，unbindGithub 清空字段', async () => {
  const dir = await createDirectory();
  const { user: a } = dir.createUser({
    name: 'gh-a', display_name: 'A', role: 'editor', password_hash: 'h', salt: 's', iterations: 1000,
  });
  const { user: b } = dir.createUser({
    name: 'gh-b', display_name: 'B', role: 'editor', password_hash: 'h', salt: 's', iterations: 1000,
  });

  assert.deepEqual(dir.bindGithub(a.id, 'octocat').ok, true);
  assert.equal(dir.getUserById(a.id).github, 'octocat');

  // 同一个 GitHub handle 不能绑定到第二个账号
  assert.deepEqual(dir.bindGithub(b.id, 'octocat'), { ok: false, reason: 'taken' });
  assert.equal(dir.getUserById(b.id).github, null);

  const unbound = dir.unbindGithub(a.id);
  assert.equal(unbound.github, null);
  // 解绑之后，这个 handle 可以被另一个账号绑定
  assert.deepEqual(dir.bindGithub(b.id, 'octocat').ok, true);
});
