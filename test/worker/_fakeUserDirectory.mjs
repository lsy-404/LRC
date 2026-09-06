// 手写内存版用户目录，供顶层 test/auth_*.test.mjs 用（走 `node --test 'test/*.test.mjs'`，
// 不能依赖 vm.SyntheticModule 需要的 --experimental-vm-modules）。方法签名和语义对齐
// worker/src/users.js 的真实 DO；真实 SQL 由 test/worker/user_directory.test.mjs 单独用
// node:sqlite 加载生产源码验证。

export function createFakeDirectory() {
  let nextId = 1;
  const users = new Map(); // id -> user
  const usersByName = new Map(); // name -> id
  const sessions = new Map(); // token_hash -> session
  const invites = new Map(); // code_hash -> invite
  const oauthStates = new Map(); // state -> { state, user_id, created_at, expires_at }

  function sanitize({ password_hash, salt, iterations, ...rest }) {
    return rest;
  }

  return {
    isEmpty() {
      return users.size === 0;
    },
    createUser({ name, display_name, role, password_hash, salt, iterations }) {
      if (usersByName.has(name)) return { ok: false, reason: 'duplicate' };
      const user = {
        id: nextId++, name, display_name, github: null, role, status: 'active',
        password_hash, salt, iterations, created_at: Date.now(), last_seen: null,
      };
      users.set(user.id, user);
      usersByName.set(name, user.id);
      return { ok: true, user: { ...user } };
    },
    getUserByName(name) {
      const id = usersByName.get(name);
      return id ? { ...users.get(id) } : null;
    },
    getUserById(id) {
      const user = users.get(id);
      return user ? { ...user } : null;
    },
    updateDisplayName(id, display_name) {
      const user = users.get(id);
      user.display_name = display_name;
      return { ...user };
    },
    updatePassword(id, { password_hash, salt, iterations }) {
      Object.assign(users.get(id), { password_hash, salt, iterations });
    },
    // 同步函数体一次做完「读 + 判断最后一名管理员 + 写」，和真实 DO 里单次方法调用天然原子
    // 一样：两个并发的 await dir.updateRoleAndStatus(...) 不会在方法体内部交错执行。
    updateRoleAndStatus(id, { role, status }) {
      const target = users.get(id);
      if (!target) return { ok: false, reason: 'not_found' };
      const nextRole = role !== undefined ? role : target.role;
      const nextStatus = status !== undefined ? status : target.status;
      const isActiveAdmin = target.role === 'admin' && target.status === 'active';
      const losesAdmin = nextRole !== 'admin' || nextStatus !== 'active';
      if (isActiveAdmin && losesAdmin) {
        let admins = 0;
        for (const u of users.values()) if (u.role === 'admin' && u.status === 'active') admins++;
        if (admins <= 1) return { ok: false, reason: 'last_admin' };
      }
      target.role = nextRole;
      target.status = nextStatus;
      return { ok: true, user: { ...target } };
    },
    touchLastSeen(id, now) {
      const user = users.get(id);
      if (user) user.last_seen = now;
    },
    countActiveAdmins() {
      let n = 0;
      for (const u of users.values()) if (u.role === 'admin' && u.status === 'active') n++;
      return n;
    },
    listUsers() {
      return [...users.values()].map(sanitize);
    },
    createSession({ token_hash, user_id, issued_at, expires_at }) {
      for (const [hash, s] of sessions) if (s.expires_at < issued_at) sessions.delete(hash);
      sessions.set(token_hash, { token_hash, user_id, issued_at, expires_at });
    },
    deleteSession(token_hash) {
      sessions.delete(token_hash);
    },
    deleteSessionsForUser(userId) {
      for (const [hash, session] of sessions) if (session.user_id === userId) sessions.delete(hash);
    },
    resolveSession(token_hash, now) {
      const session = sessions.get(token_hash);
      if (!session) return null;
      if (session.expires_at <= now) {
        sessions.delete(token_hash);
        return null;
      }
      const user = users.get(session.user_id);
      if (!user || user.status !== 'active') {
        sessions.delete(token_hash);
        return null;
      }
      user.last_seen = now;
      return { ...user };
    },
    createInvite({ code_hash, role, created_by, created_at, expires_at }) {
      invites.set(code_hash, { code_hash, role, created_by, created_at, expires_at, used_by: null, used_at: null });
    },
    getInvite(code_hash) {
      const invite = invites.get(code_hash);
      return invite ? { ...invite } : null;
    },
    // 同步函数体一次做完「查未用未过期 + 置位」，模拟真实 DO 里那条条件 UPDATE 的原子性：
    // 两个并发的 await dir.claimInvite(...) 里，无论哪个先跑，跑的时候都不会被另一个打断，
    // 后跑的那个必然看到前一个已经置位后的状态。
    claimInvite(code_hash, now) {
      const invite = invites.get(code_hash);
      if (!invite) return { ok: false, reason: 'not_found' };
      if (invite.used_by !== null) return { ok: false, reason: 'used' };
      if (invite.expires_at <= now) return { ok: false, reason: 'expired' };
      invite.used_by = 0;
      invite.used_at = now;
      return { ok: true, role: invite.role };
    },
    finalizeInvite(code_hash, used_by) {
      const invite = invites.get(code_hash);
      if (invite) invite.used_by = used_by;
    },
    releaseInvite(code_hash) {
      const invite = invites.get(code_hash);
      if (invite) {
        invite.used_by = null;
        invite.used_at = null;
      }
    },
    deleteInvite(code_hash) {
      return invites.delete(code_hash);
    },
    listInvites() {
      return [...invites.values()].sort((a, b) => b.created_at - a.created_at).map((i) => ({ ...i }));
    },
    createOAuthState({ state, user_id, created_at, expires_at }) {
      for (const [key, s] of oauthStates) if (s.expires_at < created_at) oauthStates.delete(key);
      oauthStates.set(state, { state, user_id, created_at, expires_at });
    },
    // 查到即删；伪造、重放（已被删）、过期都返回 null，不细分原因——和真实 DO 的
    // consumeOAuthState 一样，过期但未命中的行留在表里，交给下一次 createOAuthState 清理。
    consumeOAuthState(state, now) {
      const row = oauthStates.get(state);
      if (!row || row.expires_at <= now) return null;
      oauthStates.delete(state);
      return row.user_id;
    },
    bindGithub(id, github) {
      const user = users.get(id);
      if (!user) return { ok: false, reason: 'not_found' };
      for (const u of users.values()) {
        if (u.id !== id && u.github === github) return { ok: false, reason: 'taken' };
      }
      user.github = github;
      return { ok: true, user: { ...user } };
    },
    unbindGithub(id) {
      const user = users.get(id);
      if (user) user.github = null;
      return user ? { ...user } : null;
    },
    // 测试专用后门：直接把某个会话标记为已过期，模拟时间流逝而不用真的等待
    expireSessionForTest(token_hash) {
      const session = sessions.get(token_hash);
      if (session) session.expires_at = Date.now() - 1;
    },
  };
}

export function usersBinding(dir) {
  return { getByName: () => dir };
}
