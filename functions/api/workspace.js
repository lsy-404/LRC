import {
  json, passwordOk, bearer, callWorker, cleanAlbum, cleanIndex, cleanRelPath, MAX_FILES,
} from './upload/_lib.js';
import { readJson, writeJson, listPrefix, nowStamp } from './ingest/_lib.js';

const ROOT = 'workspace';
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const MAX_TRACK_BYTES = 256 * 1024;
const REF_RE = /^[0-9a-f]{32}$/;

function cleanRef(value) { return typeof value === 'string' && REF_RE.test(value) ? value : null; }

function assetRequest(request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  return new Request(url, { method: 'GET' });
}

async function readAssetJson(request, env, path) {
  if (!env.ASSETS?.fetch) return null;
  const response = await env.ASSETS.fetch(assetRequest(request, path));
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_DRAFT_BYTES) return null;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_DRAFT_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function lrcLine(time, text) {
  const n = Math.max(0, Math.round(Number(time) * 1000));
  const min = Math.floor(n / 60000);
  const sec = Math.floor((n % 60000) / 1000);
  return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}]${String(text || '')}`;
}

function catalogDraft(source) {
  const album = cleanAlbum(source?.folder);
  if (!album || !Array.isArray(source?.songs)) return null;
  const tracks = source.songs.slice(0, MAX_FILES).map((song, index) => {
    const rows = Array.isArray(song?.lyrics) ? song.lyrics.slice(0, 10000) : [];
    const lrc = rows.map((row) => lrcLine(row?.time, row?.text)).join('\n');
    return { order: index + 1, title: String(song?.title || '').slice(0, 200), lrc: lrc ? `${lrc}\n` : '', klrc: lrc ? `${lrc}\n` : '', timing_locked: true, edited: false };
  });
  const meta = {};
  for (const key of ['year', 'produce', 'vocal', 'lyricist', 'composer', 'arranger', 'tuning', 'illustrator', 'mixer', 'lyric_maker', 'release', 'purchase', 'electronic']) {
    if (source[key] !== undefined) meta[key] = source[key];
  }
  return { album, submission_type: 'album', tracks, meta, names: {
    prefix: String(source.prefix || ''), zh_name: String(source.zh_name || ''), en_name: String(source.en_name || ''), suffix: String(source.suffix || ''),
  }, pages: [], source: { kind: 'published', slug: String(source.slug || '') } };
}

function validDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !cleanAlbum(draft.album)) return false;
  if (!Array.isArray(draft.tracks) || draft.tracks.length > MAX_FILES) return false;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    if (bytes > MAX_DRAFT_BYTES) return false;
  } catch { return false; }
  return draft.tracks.every((track) => track && typeof track === 'object'
    && typeof track.title === 'string' && track.title.length <= 200
    && typeof (track.lrc || '') === 'string' && new TextEncoder().encode(track.lrc || '').byteLength <= MAX_TRACK_BYTES
    && typeof (track.klrc || '') === 'string' && new TextEncoder().encode(track.klrc || '').byteLength <= MAX_TRACK_BYTES);
}

async function newRef(env) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = crypto.randomUUID().replaceAll('-', '');
    if (!(await env.UPLOAD_BUCKET.head(`${ROOT}/${ref}/draft.json`))) return ref;
  }
  return null;
}

async function createWorkspace(env, draft) {
  const ref = await newRef(env);
  if (!ref) return null;
  await Promise.all([
    writeJson(env, `${ROOT}/${ref}/draft.json`, draft),
    writeJson(env, `${ROOT}/${ref}/status.json`, { created: nowStamp(), updated: nowStamp(), source: draft.source?.kind || 'new' }),
  ]);
  return ref;
}

function emptyDraft(album) {
  return { album, submission_type: 'album', tracks: [], meta: {}, names: { prefix: '', zh_name: album, en_name: '', suffix: '' }, pages: [], source: { kind: 'new' } };
}

async function authed(request, env) {
  return !!env.UPLOAD_BUCKET && await passwordOk(bearer(request), env);
}

export async function onCatalogGet({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const catalog = await readAssetJson(request, env, '/api/albums.json');
  if (!catalog || !Array.isArray(catalog.albums)) return json({ error: 'catalog unavailable' }, 503);
  return json({ albums: catalog.albums.map(({ slug, folder, name, song_count, detail_url }) => ({ slug, folder, name, song_count, detail_url })) });
}

export async function onDraftGet({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const ref = cleanRef(new URL(request.url).searchParams.get('ref'));
  if (!ref) return json({ error: 'bad ref' }, 400);
  const [draft, status] = await Promise.all([readJson(env, `${ROOT}/${ref}/draft.json`), readJson(env, `${ROOT}/${ref}/status.json`)]);
  if (!draft) return json({ error: 'not found' }, 404);
  return json({ ref, draft, status: status || {} });
}

export async function onCreatePost({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const body = await request.json().catch(() => null);
  const album = cleanAlbum(body?.album);
  if (!album) return json({ error: 'bad album' }, 400);
  const draft = emptyDraft(album);
  const ref = await createWorkspace(env, draft);
  return ref ? json({ ok: true, ref, draft }) : json({ error: 'workspace unavailable' }, 503);
}

export async function onOpenPost({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(body.slug) ? body.slug : null;
  if (!slug) return json({ error: 'bad album' }, 400);
  const source = await readAssetJson(request, env, `/api/albums/${slug}.json`);
  const draft = catalogDraft(source);
  if (!draft || !validDraft(draft)) return json({ error: 'album unavailable' }, 404);
  const ref = await createWorkspace(env, draft);
  return ref ? json({ ok: true, ref, draft }) : json({ error: 'workspace unavailable' }, 503);
}

export async function onSavePost({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const draft = body?.draft;
  if (!ref || !validDraft(draft)) return json({ error: 'bad draft' }, 400);
  if (!(await env.UPLOAD_BUCKET.head(`${ROOT}/${ref}/draft.json`))) return json({ error: 'not found' }, 404);
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, draft), writeJson(env, `${ROOT}/${ref}/status.json`, { updated: nowStamp(), source: draft.source?.kind || 'new' })]);
  return json({ ok: true, ref });
}

// 在已有工作区中新建可编辑 LRC 文件；文件内容保存在草稿 tracks 中，不触及已发布专辑。
export async function onLrcPost({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const title = typeof body?.title === 'string' ? body.title.normalize('NFC').trim() : '';
  if (!ref || !title || title.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(title)) return json({ error: 'bad file name' }, 400);
  const draft = await readJson(env, `${ROOT}/${ref}/draft.json`);
  if (!validDraft(draft)) return json({ error: 'not found' }, 404);
  if (draft.tracks.length >= MAX_FILES || draft.tracks.some((track) => track.title === title)) return json({ error: 'file exists or limit reached' }, 409);
  const track = { order: draft.tracks.length + 1, title, lrc: '', klrc: '', timing_locked: false, edited: true };
  draft.tracks.push(track);
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, draft), writeJson(env, `${ROOT}/${ref}/status.json`, { updated: nowStamp(), source: draft.source?.kind || 'new' })]);
  return json({ ok: true, ref, track });
}

export async function onListGet({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const objects = await listPrefix(env, `${ROOT}/`);
  const refs = objects.filter((item) => item.key.endsWith('/status.json')).map((item) => item.key.split('/')[1]).filter(cleanRef);
  const entries = await Promise.all(refs.map(async (ref) => {
    const [draft, status] = await Promise.all([readJson(env, `${ROOT}/${ref}/draft.json`), readJson(env, `${ROOT}/${ref}/status.json`)]);
    return draft ? { ref, album: draft.album, updated: status?.updated || '', source: status?.source || 'new' } : null;
  }));
  return json({ workspaces: entries.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated)) });
}

export async function onExtractPost({ request, env }) {
  if (!(await authed(request, env))) return json({ error: env.UPLOAD_BUCKET ? 'unauthorized' : 'r2 not configured' }, env.UPLOAD_BUCKET ? 401 : 503);
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const files = Array.isArray(body?.files) ? body.files : [];
  const draft = ref && await readJson(env, `${ROOT}/${ref}/draft.json`);
  if (!ref || !validDraft(draft) || !files.length || files.length > MAX_FILES) return json({ error: 'bad request' }, 400);
  if (await env.UPLOAD_BUCKET.head(`web/${ref}/manifest.json`)) return json({ error: 'already submitted' }, 409);
  const seenPaths = new Set(); const seenNumbers = new Set(); const manifestFiles = [];
  for (const file of files) {
    const path = cleanRelPath(file?.path); const n = cleanIndex(file?.n); const size = Number(file?.size);
    if (!path || n === null || !Number.isInteger(size) || size <= 0 || seenPaths.has(path) || seenNumbers.has(n)) return json({ error: 'invalid file entry' }, 400);
    const object = await env.UPLOAD_BUCKET.head(`web/${ref}/${n}`);
    if (!object || object.size !== size) return json({ error: 'missing upload', n }, 409);
    seenPaths.add(path); seenNumbers.add(n); manifestFiles.push({ path, n, size });
  }
  const manifest = { version: 3, album: draft.album, submission_type: 'album', session: ref, contributor: typeof body?.contributor === 'string' ? body.contributor.slice(0, 60) : 'workspace', lyric_maker: Array.isArray(draft.meta?.lyric_maker) ? draft.meta.lyric_maker.slice(0, 20) : [], files: manifestFiles };
  await writeJson(env, `web/${ref}/manifest.json`, manifest);
  const started = await callWorker(env, '/ingest', { ref });
  if (!started.ok) return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  return json({ ok: true, ref, ...started.data });
}
