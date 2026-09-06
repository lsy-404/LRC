export function createAuthAdapter(request = fetch) {
  const json = async (path, init = {}) => {
    const response = await request(path, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  };
  const post = (path, body) => json(path, { method: 'POST', body: JSON.stringify(body) });
  const patch = (path, body) => json(path, { method: 'PATCH', body: JSON.stringify(body) });
  return {
    setup: () => json('/api/auth/setup'),
    me: () => json('/api/auth/me'),
    login: (name, password) => post('/api/auth/login', { name, password }),
    register: (invite_code, name, password, display_name) => post('/api/auth/register', { invite_code, name, password, display_name }),
    bootstrap: (token, name, password, display_name) => post('/api/auth/bootstrap', { token, name, password, display_name }),
    logout: () => post('/api/auth/logout', {}),
    updateMe: (body) => patch('/api/auth/me', body),
    unlinkGithub: () => json('/api/auth/github', { method: 'DELETE' }),
    users: () => json('/api/auth/users'),
    updateUser: (body) => patch('/api/auth/user', body),
    invites: () => json('/api/auth/invites'),
    createInvite: (role, ttl_hours) => post('/api/auth/invite', { role, ttl_hours }),
    revokeInvite: (code_hash) => json('/api/auth/invite', { method: 'DELETE', body: JSON.stringify({ code_hash }) }),
  };
}
