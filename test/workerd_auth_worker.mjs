import { hashPassword, verifyPassword } from '../functions/api/auth/_lib.js';
import { handleApi } from '../worker/src/api.js';
export { UserDirectory } from '../worker/src/users.js';

async function authFlow(env) {
  const statuses = {};
  const call = (path, method = 'GET', body, cookie) => handleApi(new Request(`https://local.test/api/auth/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
  const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0];
  const adminResponse = await call('bootstrap', 'POST', { token: 'bootstrap-secret', name: 'admin', password: 'original-password' });
  statuses.bootstrap = adminResponse.status;
  const adminCookie = cookieOf(adminResponse);
  statuses.bootstrapAgain = (await call('bootstrap', 'POST', { token: 'bootstrap-secret', name: 'admin-two', password: 'original-password' })).status;
  const inviteResponse = await call('invite', 'POST', { role: 'editor' }, adminCookie);
  statuses.invite = inviteResponse.status;
  const { code } = await inviteResponse.json();
  const registration = await call('register', 'POST', { name: 'editor', password: 'original-password', invite_code: code });
  statuses.register = registration.status;
  const editorCookie = cookieOf(registration);
  const editor = (await registration.json()).user;
  statuses.editorAdmin = (await call('users', 'GET', undefined, editorCookie)).status;
  statuses.anonymous = (await call('me')).status;
  const loginResponse = await call('login', 'POST', { name: 'editor', password: 'original-password' });
  statuses.login = loginResponse.status;
  const loginCookie = cookieOf(loginResponse);
  statuses.passwordChange = (await call('me', 'PATCH', { old_password: 'original-password', new_password: 'changed-password' }, editorCookie)).status;
  statuses.oldSession = (await call('me', 'GET', undefined, editorCookie)).status;
  statuses.otherSession = (await call('me', 'GET', undefined, loginCookie)).status;
  statuses.oldPassword = (await call('login', 'POST', { name: 'editor', password: 'original-password' })).status;
  const changedLogin = await call('login', 'POST', { name: 'editor', password: 'changed-password' });
  statuses.newPassword = changedLogin.status;
  statuses.disable = (await call('user', 'PATCH', { id: editor.id, status: 'disabled' }, adminCookie)).status;
  statuses.disabled = (await call('me', 'GET', undefined, cookieOf(changedLogin))).status;
  return statuses;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/flow') return Response.json(await authFlow(env));
    const started = Date.now();
    const hashed = await hashPassword('worker-password');
    const verified = await verifyPassword('worker-password', hashed);
    return Response.json({ verified, iterations: hashed.iterations, elapsedMs: Date.now() - started });
  },
};
