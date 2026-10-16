import { DurableObject } from 'cloudflare:workers';

// 用户目录：单例 DO（getByName('directory')），SQLite 存用户、会话与 GitHub 绑定状态。
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
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

// Columns added for single sign-on; existing tables gain them in place.
const MIGRATIONS = [
  ['users', 'subject', 'ALTER TABLE users ADD COLUMN subject TEXT'],
  ['sessions', 'subject', 'ALTER TABLE sessions ADD COLUMN subject TEXT'],
  ['sessions', 'id_token', 'ALTER TABLE sessions ADD COLUMN id_token TEXT'],
  ['sessions', 'sid', 'ALTER TABLE sessions ADD COLUMN sid TEXT'],
];
const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS users_subject ON users(subject) WHERE subject IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS sessions_subject ON sessions(subject)',
];
const NAME_RE = /^[a-z0-9_-]{3,32}$/;

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return NAME_RE.test(name) ? name : null;
}

function cleanDisplay(value, fallback) {
  const text = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  return text && text.length <= 60 && !/[\u0000-\u001f\u007f]/.test(text) ? text : fallback;
}

function first(cursor) {
  const rows = cursor.toArray();
  return rows.length ? rows[0] : null;
}

export class UserDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    for (const statement of SCHEMA) sql.exec(statement);
    for (const [table, column, statement] of MIGRATIONS) {
      if (!sql.exec(`PRAGMA table_info(${table})`).toArray().some((row) => row.name === column)) sql.exec(statement);
    }
    for (const statement of INDEXES) sql.exec(statement);
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

  touchLastSeen(id, now) {
    this.ctx.storage.sql.exec('UPDATE users SET last_seen = ? WHERE id = ?', now, id);
  }

  // ---- single sign-on identities ----

  // Maps an identity subject to a local account in one synchronous call: an existing link wins, an
  // unlinked account whose name equals the provider's username is claimed, otherwise a new editor is created.
  resolveIdentity({ subject, preferred_username, display_name }) {
    const sql = this.ctx.storage.sql;
    if (typeof subject !== 'string' || !subject || subject.length > 255) return { ok: false, reason: 'conflict' };
    const linked = first(sql.exec('SELECT * FROM users WHERE subject = ?', subject));
    if (linked) return linked.status === 'active' ? { ok: true, user: linked } : { ok: false, reason: 'disabled' };
    const preferred = cleanName(preferred_username);
    const legacy = preferred && first(sql.exec('SELECT * FROM users WHERE name = ?', preferred));
    if (legacy) {
      if (legacy.subject) return { ok: false, reason: 'conflict' };
      if (legacy.status !== 'active') return { ok: false, reason: 'disabled' };
      return { ok: true, user: first(sql.exec('UPDATE users SET subject = ? WHERE id = ? RETURNING *', subject, legacy.id)) };
    }
    const base = preferred || `u-${subject.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'member'}`;
    let name = base;
    for (let suffix = 2; first(sql.exec('SELECT id FROM users WHERE name = ?', name)); suffix += 1) name = `${base.slice(0, 28)}-${suffix}`;
    const user = first(sql.exec(
      `INSERT INTO users (name, display_name, role, status, password_hash, salt, iterations, created_at, subject)
       VALUES (?, ?, 'editor', 'active', '', '', 0, ?, ?) RETURNING *`,
      name, cleanDisplay(display_name, name), Date.now(), subject));
    return { ok: true, user };
  }

  // ---- sessions ----

  createSession({ token_hash, user_id, issued_at, expires_at, subject = null, id_token = null, sid = null }) {
    // 顺手清理已过期会话，不需要单独的定时任务
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at < ?', issued_at);
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (token_hash, user_id, issued_at, expires_at, subject, id_token, sid) VALUES (?, ?, ?, ?, ?, ?, ?)',
      token_hash, user_id, issued_at, expires_at, subject, id_token, sid);
  }

  // Single sign-on sessions only: the session must carry the subject its account is linked to.
  sessionDetail(token_hash, now) {
    const session = first(this.ctx.storage.sql.exec('SELECT * FROM sessions WHERE token_hash = ?', token_hash));
    if (!session || !session.subject) return null;
    const user = this.resolveSession(token_hash, now);
    if (!user || user.subject !== session.subject) return null;
    return { user, id_token: session.id_token || null };
  }

  revokeSessions({ subject, sid }) {
    if (sid) this.ctx.storage.sql.exec('DELETE FROM sessions WHERE sid = ?', sid);
    if (subject) this.ctx.storage.sql.exec('DELETE FROM sessions WHERE subject = ?', subject);
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
