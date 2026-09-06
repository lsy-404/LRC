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

test('邀请生命周期：创建、原子占用、终态确认、释放、吊销', async () => {
  const dir = await createDirectory();
  const { user: admin } = dir.createUser({
    name: 'root', display_name: 'Root', role: 'admin',
    password_hash: 'h', salt: 's', iterations: 1000,
  });
  const now = Date.now();
  dir.createInvite({ code_hash: 'codehash1', role: 'editor', created_by: admin.id, created_at: now, expires_at: now + 10_000 });

  const invite = dir.getInvite('codehash1');
  assert.equal(invite.role, 'editor');
  assert.equal(invite.used_by, null);

  const claimed = dir.claimInvite('codehash1', now);
  assert.deepEqual(claimed, { ok: true, role: 'editor' });
  assert.equal(dir.getInvite('codehash1').used_by, 0);

  // 占用期间（建号还没跑完）再抢一次必须失败，这正是本次要修的并发缺陷的核心断言
  assert.deepEqual(dir.claimInvite('codehash1', now), { ok: false, reason: 'used' });

  dir.finalizeInvite('codehash1', 42);
  assert.equal(dir.getInvite('codehash1').used_by, 42);

  assert.equal(dir.listInvites().length, 1);
  assert.equal(dir.deleteInvite('codehash1'), true);
  assert.equal(dir.getInvite('codehash1'), null);
  assert.equal(dir.deleteInvite('codehash1'), false);
});

test('建号失败后 releaseInvite 把邀请码放回未使用状态', async () => {
  const dir = await createDirectory();
  const { user: admin } = dir.createUser({
    name: 'root2', display_name: 'Root2', role: 'admin',
    password_hash: 'h', salt: 's', iterations: 1000,
  });
  const now = Date.now();
  dir.createInvite({ code_hash: 'codehash2', role: 'editor', created_by: admin.id, created_at: now, expires_at: now + 10_000 });

  assert.deepEqual(dir.claimInvite('codehash2', now), { ok: true, role: 'editor' });
  dir.releaseInvite('codehash2');
  const released = dir.getInvite('codehash2');
  assert.equal(released.used_by, null);
  assert.equal(released.used_at, null);

  // 放回未使用后应该能被重新占用
  assert.deepEqual(dir.claimInvite('codehash2', now), { ok: true, role: 'editor' });
});

test('过期邀请码占用失败，且不会被误判为已使用', async () => {
  const dir = await createDirectory();
  const now = Date.now();
  dir.createInvite({ code_hash: 'codehash3', role: 'editor', created_by: 1, created_at: now - 20_000, expires_at: now - 1000 });
  assert.deepEqual(dir.claimInvite('codehash3', now), { ok: false, reason: 'expired' });
});

test('countActiveAdmins 只数在职管理员，listUsers 不泄漏口令字段', async () => {
  const dir = await createDirectory();
  dir.createUser({ name: 'a1', display_name: 'A1', role: 'admin', password_hash: 'h', salt: 's', iterations: 1000 });
  const { user: a2 } = dir.createUser({ name: 'a2', display_name: 'A2', role: 'admin', password_hash: 'h', salt: 's', iterations: 1000 });
  dir.createUser({ name: 'e1', display_name: 'E1', role: 'editor', password_hash: 'h', salt: 's', iterations: 1000 });
  assert.equal(dir.countActiveAdmins(), 2);

  dir.updateRoleAndStatus(a2.id, { status: 'disabled' });
  assert.equal(dir.countActiveAdmins(), 1);

  const listed = dir.listUsers();
  assert.equal(listed.length, 3);
  for (const u of listed) {
    assert.equal('password_hash' in u, false);
    assert.equal('salt' in u, false);
    assert.equal('iterations' in u, false);
  }
});

test('updateRoleAndStatus 拒绝打掉最后一名在职管理员', async () => {
  const dir = await createDirectory();
  const { user: admin } = dir.createUser({
    name: 'sole-admin', display_name: 'Sole', role: 'admin', password_hash: 'h', salt: 's', iterations: 1000,
  });
  assert.deepEqual(dir.updateRoleAndStatus(admin.id, { role: 'editor' }), { ok: false, reason: 'last_admin' });
  assert.equal(dir.getUserById(admin.id).role, 'admin');
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
