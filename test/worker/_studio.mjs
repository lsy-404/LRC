import { createHash } from 'node:crypto';
import { handleApi as routeApi } from '../../worker/src/api.js';
import { sanitizeUser } from '../../functions/api/auth/_lib.js';

export const ALL_ACTIONS = Object.freeze({ browse: true, listen: true, edit: true, discard: true, submit: true, download: true });

const reply = (body, status) => Response.json(body, { status });

// 工作站方案的测试替身：沿用会话 Cookie 识别账号，按给定动作放行，曲库读取走内存表。
export function fakeStudio({ actions = {}, songs = {}, handle = async () => null } = {}) {
  const granted = { ...ALL_ACTIONS, ...actions };
  const calls = { library: [] };
  async function session(request, env) {
    const token = /(?:^|;\s*)lrc_session=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
    if (!token) return null;
    const user = await env.USERS.getByName('directory').resolveSession(createHash('sha256').update(token).digest('hex'), Date.now());
    if (!user) return null;
    return { account: { id: String(user.id), subject: user.subject || `sub-${user.id}`, name: user.name, displayName: user.display_name, user: sanitizeUser(user) } };
  }
  return {
    calls,
    handle,
    async authorize(request, env, action) {
      const current = await session(request, env);
      if (!current) return { ok: false, response: reply({ ok: false, error: 'unauthorized' }, 401) };
      if (!granted[action]) return { ok: false, response: reply({ ok: false, error: 'forbidden' }, 403) };
      return { ok: true, session: current, actions: granted };
    },
    async describe(request, env) {
      const current = await session(request, env);
      return current ? { account: current.account, actions: granted, provider: 'Test Access' } : null;
    },
    library: {
      async song(_env, subject, id) { calls.library.push(['song', subject, id]); return songs[id] || null; },
      async stream(_env, subject, id) {
        calls.library.push(['stream', subject, id]);
        const song = songs[id];
        return song ? new Response(song.body ?? 'x'.repeat(song.size), { headers: { 'content-type': 'audio/flac', 'content-length': String(song.size) } }) : reply({ ok: false, error: 'not found' }, 404);
      },
    },
  };
}

export function handleApi(request, env, studio = fakeStudio()) {
  return routeApi(request, env, studio);
}
