import { WorkerEntrypoint } from 'cloudflare:workers';

// EdgeSonic StudioGateway 的替身：按主体返回权限，按 Subsonic 形状回答白名单内的读取与流。
const PERMISSIONS = {
  'acct-42': { browse: true, search: true, stream: true, upload: true, edit_tags: false, delete: false },
};

export class StudioGateway extends WorkerEntrypoint {
  async permissions(subject) {
    return PERMISSIONS[subject] ? { username: 'maker', level: 2, permissions: PERMISSIONS[subject] } : null;
  }

  async relay(subject, request) {
    if (!PERMISSIONS[subject]) return Response.json({ ok: false, error: 'identity_unavailable' }, { status: 401 });
    const url = new URL(request.url);
    const ok = (body) => Response.json({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });
    if (url.pathname === '/rest/search3') {
      return ok({ searchResult3: { artist: [], album: [{ id: 'al-1', name: '星河', artist: '歌手', coverArt: 'al-1', songCount: 1 }], song: [{ id: 'so-1', title: url.searchParams.get('query'), album: '星河', albumId: 'al-1', path: 'Music/private/path.flac', suffix: 'flac', size: 4, coverArt: 'so-1' }] } });
    }
    if (url.pathname === '/rest/stream') {
      return new Response('flac', { headers: { 'content-type': 'audio/flac', 'content-length': '4', 'set-cookie': 'edgesonic_session=leak', 'x-edgesonic-engine': 'r2' } });
    }
    return Response.json({ ok: false, error: 'operation_not_allowed' }, { status: 403 });
  }
}

export default { fetch: () => new Response('gateway') };
