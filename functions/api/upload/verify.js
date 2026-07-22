import { json, passwordOk } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  if (!(await passwordOk(body.password, env))) return json({ ok: false }, 401);
  return json({ ok: true });
}
