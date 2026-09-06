import { DurableObject } from 'cloudflare:workers';

// 用户目录：单例 DO（getByName('directory')），SQLite 存三张表。
// ctx.storage.sql 是同步 API，建表和增删改查都不需要 await。
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    github TEXT UNIQUE,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by INTEGER,
    used_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

function first(cursor) {
  const rows = cursor.toArray();
  return rows.length ? rows[0] : null;
}

export class UserDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    for (const statement of SCHEMA) this.ctx.storage.sql.exec(statement);
  }

  // ---- users ----

  isEmpty() {
    return first(this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM users')).n === 0;
  }

  // 唯一性约束交给 UNIQUE(name)：并发注册也不会产生重名
  createUser({ name, display_name, role, password_hash, salt, iterations }) {
    try {
      const cursor = this.ctx.storage.sql.exec(
        `INSERT INTO users (name, display_name, role, status, password_hash, salt, iterations, created_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?) RETURNING *`,
        name, display_name, role, password_hash, salt, iterations, Date.now(),
      );
      return { ok: true, user: first(cursor) };
    } catch {
      return { ok: false, reason: 'duplicate' };
    }
  }

  getUserByName(name) {
    return first(this.ctx.storage.sql.exec('SELECT * FROM users WHERE name = ?', name));
  }

  getUserById(id) {
    return first(this.ctx.storage.sql.exec('SELECT * FROM users WHERE id = ?', id));
  }

  updateDisplayName(id, display_name) {
    return first(this.ctx.storage.sql.exec(
      'UPDATE users SET display_name = ? WHERE id = ? RETURNING *', display_name, id));
  }

  updatePassword(id, { password_hash, salt, iterations }) {
    this.ctx.storage.sql.exec(
      'UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?',
      password_hash, salt, iterations, id);
  }

  // role/status 联动改，且「是否会打掉最后一名在职管理员」的判断和落库在同一次方法调用里做完：
  // DO 方法体内没有 await，中途不会被别的并发调用打断，判断用的行数就是落库时的行数。
  updateRoleAndStatus(id, { role, status }) {
    const target = first(this.ctx.storage.sql.exec('SELECT * FROM users WHERE id = ?', id));
    if (!target) return { ok: false, reason: 'not_found' };

    const nextRole = role !== undefined ? role : target.role;
    const nextStatus = status !== undefined ? status : target.status;
    const isActiveAdmin = target.role === 'admin' && target.status === 'active';
    const losesAdmin = nextRole !== 'admin' || nextStatus !== 'active';
    if (isActiveAdmin && losesAdmin && this.countActiveAdmins() <= 1) {
      return { ok: false, reason: 'last_admin' };
    }

    const updated = first(this.ctx.storage.sql.exec(
      'UPDATE users SET role = ?, status = ? WHERE id = ? RETURNING *', nextRole, nextStatus, id));
    return { ok: true, user: updated };
  }

  touchLastSeen(id, now) {
    this.ctx.storage.sql.exec('UPDATE users SET last_seen = ? WHERE id = ?', now, id);
  }

  countActiveAdmins() {
    return first(this.ctx.storage.sql.exec(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")).n;
  }

  listUsers() {
    return this.ctx.storage.sql.exec(
      'SELECT id, name, display_name, github, role, status, created_at, last_seen FROM users ORDER BY id',
    ).toArray();
  }

  // ---- sessions ----

  createSession({ token_hash, user_id, issued_at, expires_at }) {
    // 顺手清理已过期会话，不需要单独的定时任务
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at < ?', issued_at);
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (token_hash, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)',
      token_hash, user_id, issued_at, expires_at);
  }

  deleteSession(token_hash) {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', token_hash);
  }

  deleteSessionsForUser(userId) {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  // 会话查找 + 过期回收 + 账号状态校验 + last_seen 续期，一次做完
  resolveSession(token_hash, now) {
    const session = first(this.ctx.storage.sql.exec(
      'SELECT * FROM sessions WHERE token_hash = ?', token_hash));
    if (!session) return null;
    if (session.expires_at <= now) {
      this.deleteSession(token_hash);
      return null;
    }
    const user = this.getUserById(session.user_id);
    if (!user || user.status !== 'active') {
      this.deleteSession(token_hash);
      return null;
    }
    this.touchLastSeen(user.id, now);
    return user;
  }

  // ---- invites ----

  createInvite({ code_hash, role, created_by, created_at, expires_at }) {
    this.ctx.storage.sql.exec(
      'INSERT INTO invites (code_hash, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      code_hash, role, created_by, created_at, expires_at);
  }

  getInvite(code_hash) {
    return first(this.ctx.storage.sql.exec('SELECT * FROM invites WHERE code_hash = ?', code_hash));
  }

  // 原子占用：校验（未用、未过期）与置位在同一条 UPDATE 里完成，不留「读到可用」和「写入已用」
  // 之间的窗口。占位用 used_by = 0（AUTOINCREMENT 从 1 开始，0 不是合法用户 id），
  // 建号成功后 finalizeInvite 补上真实 id；建号失败（撞用户名）用 releaseInvite 放回未使用状态，
  // 邀请码不会因为一次失败的注册尝试就被烧掉。
  claimInvite(code_hash, now) {
    const claimed = first(this.ctx.storage.sql.exec(
      `UPDATE invites SET used_by = 0, used_at = ?
       WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?
       RETURNING role`, now, code_hash, now));
    if (claimed) return { ok: true, role: claimed.role };

    // 占用没抢到：再读一次只是为了给调用方一个准确的失败原因，不影响原子性判断本身
    const invite = this.getInvite(code_hash);
    if (!invite) return { ok: false, reason: 'not_found' };
    if (invite.used_by !== null) return { ok: false, reason: 'used' };
    return { ok: false, reason: 'expired' };
  }

  finalizeInvite(code_hash, used_by) {
    this.ctx.storage.sql.exec('UPDATE invites SET used_by = ? WHERE code_hash = ?', used_by, code_hash);
  }

  releaseInvite(code_hash) {
    this.ctx.storage.sql.exec(
      'UPDATE invites SET used_by = NULL, used_at = NULL WHERE code_hash = ?', code_hash);
  }

  deleteInvite(code_hash) {
    const cursor = this.ctx.storage.sql.exec(
      'DELETE FROM invites WHERE code_hash = ? RETURNING code_hash', code_hash);
    return first(cursor) !== null;
  }

  listInvites() {
    return this.ctx.storage.sql.exec(
      `SELECT code_hash, role, created_by, created_at, expires_at, used_by, used_at
       FROM invites ORDER BY created_at DESC`,
    ).toArray();
  }

  // ---- github oauth binding ----

  createOAuthState({ state, user_id, created_at, expires_at }) {
    // 顺手清理过期 state，时机和写法与 createSession 的会话清理一致
    this.ctx.storage.sql.exec('DELETE FROM oauth_states WHERE expires_at < ?', created_at);
    this.ctx.storage.sql.exec(
      'INSERT INTO oauth_states (state, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      state, user_id, created_at, expires_at);
  }

  // 一次性消费：查找、过期校验、失效收在同一条 DELETE ... RETURNING 里，不给
  // 「查到有效」和「标记已用」之间留重放窗口。过期但未被本条件命中的行留给
  // 下一次 createOAuthState 清理，不在这里单独处理。
  consumeOAuthState(state, now) {
    const row = first(this.ctx.storage.sql.exec(
      'DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING user_id', state, now));
    return row ? row.user_id : null;
  }

  // 唯一性交给 users.github UNIQUE 约束：并发绑定同一个 GitHub 账号也不会产生冲突
  bindGithub(id, github) {
    try {
      const updated = first(this.ctx.storage.sql.exec(
        'UPDATE users SET github = ? WHERE id = ? RETURNING *', github, id));
      return updated ? { ok: true, user: updated } : { ok: false, reason: 'not_found' };
    } catch {
      return { ok: false, reason: 'taken' };
    }
  }

  unbindGithub(id) {
    return first(this.ctx.storage.sql.exec(
      'UPDATE users SET github = NULL WHERE id = ? RETURNING *', id));
  }
}
