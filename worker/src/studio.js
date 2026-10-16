import { createStudioServer } from '@platform-kit/solution-studio/server';
import {
  directory, randomHex, readSessionToken, sanitizeUser, sha256Hex,
  SESSION_COOKIE, SESSION_TTL_MS, TOKEN_BYTES,
} from '../../functions/api/auth/_lib.js';

// 工作站方案（私有包）的宿主实现：账号映射与会话落在 UserDirectory，曲库经 EDGESONIC 服务绑定访问。
function account(user) {
  return { id: String(user.id), subject: user.subject, name: user.name, displayName: user.display_name, user: sanitizeUser(user) };
}

const host = {
  async resolveIdentity(env, identity) {
    const result = await directory(env).resolveIdentity({
      subject: identity.subject,
      preferred_username: identity.preferredUsername,
      display_name: identity.displayName,
    });
    return result.ok ? { account: account(result.user) } : { denied: result.reason === 'disabled' ? 'disabled' : 'conflict' };
  },

  async issueSession(env, studioAccount, { idToken, sid }) {
    const token = randomHex(TOKEN_BYTES);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + SESSION_TTL_MS;
    await directory(env).createSession({
      token_hash: await sha256Hex(token), user_id: Number(studioAccount.id), issued_at: issuedAt, expires_at: expiresAt,
      subject: studioAccount.subject, id_token: idToken || null, sid: sid || null,
    });
    return `${SESSION_COOKIE}=${token}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Strict`;
  },

  async currentSession(env, request) {
    const token = readSessionToken(request);
    if (!token) return null;
    const detail = await directory(env).sessionDetail(await sha256Hex(token), Date.now());
    return detail ? { account: account(detail.user), idToken: detail.id_token || undefined } : null;
  },

  async endSession(env, request) {
    const token = readSessionToken(request);
    if (token) await directory(env).deleteSession(await sha256Hex(token));
    return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
  },

  async revokeSessions(env, criteria) {
    await directory(env).revokeSessions(criteria);
  },
};

let server;

export function studioServer() {
  server ||= createStudioServer({
    host,
    config: (env) => ({
      issuer: env.SSO_ISSUER,
      clientId: env.SSO_CLIENT_ID,
      clientSecret: env.SSO_CLIENT_SECRET || undefined,
      cookieSecret: env.STUDIO_COOKIE_SECRET,
      appPath: '/studio/',
      providerName: env.SSO_PROVIDER_NAME || 'Voidcarve Access',
      libraryRoot: env.LIBRARY_UPLOAD_ROOT || 'LRC',
    }),
    gateway: (env) => env.EDGESONIC,
  });
  return server;
}
