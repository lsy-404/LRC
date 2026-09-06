import { jsonWithHeaders, directory, sha256Hex, readSessionToken, clearSessionCookie } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const token = readSessionToken(request);
  if (token) await directory(env).deleteSession(await sha256Hex(token));
  const headers = new Headers();
  clearSessionCookie(headers);
  return jsonWithHeaders({ ok: true }, 200, headers);
}
