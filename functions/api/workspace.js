import { json, callWorker, cleanAlbum, cleanIndex, cleanRelPath, MAX_FILES } from './upload/_lib.js';
import { requireUser } from './auth/_lib.js';
import { workspaceManifest, trackAudio } from './workspaceManifest.js';
import {
  readJson, writeJson, listPrefix, nowStamp,
  audioContentType, detectedAudioContentType, parseByteRange,
} from './ingest/_lib.js';

const ROOT = 'workspace';
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const MAX_TRACK_BYTES = 256 * 1024;
const MAX_ASSETS = MAX_FILES;
const MAX_ASSET_LINKS = 20;
const ASSET_ROLES = new Set(['song', 'photo', 'text', 'staff', 'cover', 'etc']);
const DOCUMENT_KINDS = new Set(['file', 'folder']);
const DOCUMENT_EXTENSIONS = /\.(?:txt|md|json)$/i;
const LYRIC_EXTENSIONS = /\.(?:lrc|elrc)$/i;
const RESERVED_NAMES = new Set(['meta.json', 'manifest.toml', 'manifest.json']);
const REF_RE = /^[0-9a-f]{32}$/;
const LIBRARY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const LIBRARY_AUDIO_EXTENSIONS = /^(?:mp3|flac|wav|m4a|aac|ogg|opus|wma|aiff?)$/i;

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

function elrcLine(time, text, words) {
  const tags = Array.isArray(words) ? words.map((word) => {
    const n = Math.max(0, Math.round(Number(word?.time) * 1000));
    const min = Math.floor(n / 60000);
    return `<${String(min).padStart(2, '0')}:${String(Math.floor((n % 60000) / 1000)).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}>${String(word?.text || '')}`;
  }).join('') : '';
  return `${lrcLine(time, '')}${tags || String(text || '')}`;
}

function catalogDraft(source) {
  const album = cleanAlbum(source?.folder);
  if (!album || !Array.isArray(source?.songs)) return null;
  const tracks = source.songs.slice(0, MAX_FILES).map((song, index) => {
    const rows = Array.isArray(song?.lyrics) ? song.lyrics.slice(0, 10000) : [];
    const lrc = rows.map((row) => lrcLine(row?.time, row?.text)).join('\n');
    const elrc = rows.map((row) => elrcLine(row?.time, row?.text, row?.words)).join('\n');
    return { order: index + 1, title: String(song?.title || '').slice(0, 200), lrc: lrc ? `${lrc}\n` : '', klrc: elrc ? `${elrc}\n` : '', timing_locked: true, edited: false };
  });
  const meta = {};
  for (const key of ['year', 'produce', 'vocal', 'lyricist', 'composer', 'arranger', 'tuning', 'illustrator', 'mixer', 'mastering', 'video', 'planning', 'lyric_maker', 'release', 'purchase', 'electronic']) {
    if (source[key] !== undefined) meta[key] = source[key];
  }
  return { album, submission_type: 'album', tracks, meta, names: {
    prefix: String(source.prefix || ''), zh_name: String(source.zh_name || ''), en_name: String(source.en_name || ''), suffix: String(source.suffix || ''),
  }, pages: [], assets: [], source: { kind: 'published', slug: String(source.slug || '') } };
}

function cleanAssetRole(value) {
  return typeof value === 'string' && ASSET_ROLES.has(value) ? value : null;
}

// linkTo：素材（多为歌词本照片）关联的曲目，元素是 track.order（正整数）或专辑内页标记 'SP'
function validAssetLink(item) {
  return item === 'SP' || (Number.isInteger(item) && item > 0 && item <= MAX_FILES);
}

// Library-backed audio lives in the music library; the draft keeps only its song id.
function validLibraryId(value) {
  return typeof value === 'string' && LIBRARY_ID_RE.test(value);
}

function validLibraryRef(library) {
  return !!library && typeof library === 'object' && !Array.isArray(library) && validLibraryId(library.id)
    && (library.path === undefined || (typeof library.path === 'string' && library.path.length <= 400));
}

function validAsset(asset) {
  return !!asset && typeof asset === 'object' && !Array.isArray(asset)
    && (asset.library === undefined || (asset.role === 'song' && validLibraryRef(asset.library)))
    && Number.isInteger(asset.n) && asset.n >= 0 && asset.n < MAX_FILES
    && typeof asset.path === 'string' && cleanRelPath(asset.path) === asset.path && asset.path.length <= 200
    && !isReservedPath(asset.path)
    && ASSET_ROLES.has(asset.role)
    && Number.isInteger(asset.size) && asset.size > 0
    && Array.isArray(asset.linkTo) && asset.linkTo.length <= MAX_ASSET_LINKS && asset.linkTo.every(validAssetLink);
}

function isReservedPath(path) {
  return RESERVED_NAMES.has(String(path).split('/').at(-1)?.toLowerCase());
}

function pathKey(path) {
  const clean = cleanRelPath(path);
  return clean ? clean.toLocaleLowerCase() : null;
}

function parentPaths(path) {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function pathIsWithin(parent, path) {
  return path === parent || path.startsWith(`${parent}/`);
}

function validDraftPaths(draft) {
  const documents = Array.isArray(draft.documents) ? draft.documents : [];
  const assets = Array.isArray(draft.assets) ? draft.assets : [];
  const entries = [];
  const documentFolders = new Set();
  const implicitDirectories = new Set();
  const seen = new Set();

  for (const asset of assets) {
    const key = pathKey(asset.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    entries.push({ key, kind: 'file' });
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) implicitDirectories.add(parts.slice(0, i).join('/'));
  }

  for (const item of documents) {
    const key = pathKey(item.path);
    if (!key || isReservedPath(item.path) || seen.has(key)) return false;
    seen.add(key);
    const kind = item.kind === 'folder' ? 'folder' : 'file';
    entries.push({ key, kind });
    if (kind === 'folder') documentFolders.add(key);
  }

  for (const track of draft.tracks) {
    if (track.lyric_stem === undefined) continue;
    const stem = pathKey(track.lyric_stem);
    if (!stem || isReservedPath(`${stem}.lrc`) || isReservedPath(`${stem}.elrc`)) return false;
    for (const parent of parentPaths(stem)) {
      if (!documentFolders.has(parent) && !implicitDirectories.has(parent)) return false;
    }
    const plainText = !track.lrc && !track.klrc
      && (Array.isArray(track.lines) ? track.lines.some((line) => typeof line === 'string' && line.trim()) : typeof track.lyrics === 'string' && track.lyrics.trim());
    for (const ext of ['.lrc', '.elrc', ...(plainText ? ['.txt'] : [])]) {
      const key = `${stem}${ext}`;
      if (seen.has(key)) return false;
      seen.add(key);
      entries.push({ key, kind: 'file' });
    }
  }

  for (const item of documents) {
    for (const parent of parentPaths(pathKey(item.path))) {
      if (!documentFolders.has(parent) && !implicitDirectories.has(parent)) return false;
    }
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]; const b = entries[j];
      if (a.key === b.key || (pathIsWithin(a.key, b.key) && a.kind === 'file') || (pathIsWithin(b.key, a.key) && b.kind === 'file')) return false;
    }
  }
  return true;
}

function parentDirectoriesExist(draft, path) {
  const folders = new Set((draft.documents || []).filter((item) => item.kind === 'folder').map((item) => pathKey(item.path)));
  const implicit = new Set();
  for (const asset of draft.assets || []) {
    const parts = pathKey(asset.path)?.split('/') || [];
    for (let i = 1; i < parts.length; i++) implicit.add(parts.slice(0, i).join('/'));
  }
  for (const track of draft.tracks || []) {
    const parts = pathKey(track.lyric_stem)?.split('/') || [];
    for (let i = 1; i < parts.length; i++) implicit.add(parts.slice(0, i).join('/'));
  }
  return parentPaths(pathKey(path)).every((parent) => folders.has(parent) || implicit.has(parent));
}

function validDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !cleanAlbum(draft.album)) return false;
  if (draft.submission_type !== undefined && !['album', 'single'].includes(draft.submission_type)) return false;
  if (!Array.isArray(draft.tracks) || draft.tracks.length > MAX_FILES) return false;
  if (draft.documents !== undefined && (!Array.isArray(draft.documents) || draft.documents.length > MAX_FILES || !draft.documents.every((item) => item && DOCUMENT_KINDS.has(item.kind) && typeof item.path === 'string' && item.path.length <= 200 && cleanRelPath(item.path) === item.path && !isReservedPath(item.path) && (item.kind === 'folder' || (DOCUMENT_EXTENSIONS.test(item.path) && typeof item.text === 'string')) && new TextEncoder().encode(item.text || '').byteLength <= MAX_TRACK_BYTES))) return false;
  if (draft.assets !== undefined) {
    if (!Array.isArray(draft.assets) || draft.assets.length > MAX_ASSETS || !draft.assets.every(validAsset)) return false;
    const seenAssetNumbers = new Set();
    for (const asset of draft.assets) {
      if (seenAssetNumbers.has(asset.n)) return false;
      seenAssetNumbers.add(asset.n);
    }
  }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    if (bytes > MAX_DRAFT_BYTES) return false;
  } catch { return false; }
  return draft.tracks.every((track) => track && typeof track === 'object'
    && typeof track.title === 'string' && track.title.length <= 200
    && (track.library_song === undefined || validLibraryId(track.library_song))
    && (track.lyric_stem === undefined || (typeof track.lyric_stem === 'string' && track.lyric_stem.length <= 200 && cleanRelPath(track.lyric_stem) === track.lyric_stem && !isReservedPath(`${track.lyric_stem}.lrc`)))
    && typeof (track.lrc || '') === 'string' && new TextEncoder().encode(track.lrc || '').byteLength <= MAX_TRACK_BYTES
    && typeof (track.klrc || '') === 'string' && new TextEncoder().encode(track.klrc || '').byteLength <= MAX_TRACK_BYTES)
    && validDraftPaths(draft);
}

async function newRef(env) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = crypto.randomUUID().replaceAll('-', '');
    if (!(await env.UPLOAD_BUCKET.head(`${ROOT}/${ref}/draft.json`))) return ref;
  }
  return null;
}

async function createWorkspace(env, draft, user) {
  const ref = await newRef(env);
  if (!ref) return null;
  await Promise.all([
    writeJson(env, `${ROOT}/${ref}/draft.json`, draft),
    writeJson(env, `${ROOT}/${ref}/status.json`, { created: nowStamp(), updated: nowStamp(), source: draft.source?.kind || 'new', owner: user.github || user.name, updated_by: user.github || user.name }),
  ]);
  return ref;
}

function emptyDraft(album, submissionType = 'album') {
  return { album, submission_type: submissionType, tracks: [], documents: [], meta: {}, names: { prefix: '', zh_name: album, en_name: '', suffix: '' }, pages: [], assets: [], source: { kind: 'new' } };
}

function workspaceLyricsStem(track, order, occupied, assets) {
  if (track.lyric_stem !== undefined) {
    const stem = cleanRelPath(track.lyric_stem);
    const plainText = !track.lrc && !track.klrc
      && (Array.isArray(track.lines) ? track.lines.some((line) => typeof line === 'string' && line.trim()) : typeof track.lyrics === 'string' && track.lyrics.trim());
    const extensions = ['.lrc', '.elrc', ...(plainText ? ['.txt'] : [])];
    if (!stem || extensions.some((ext) => occupied.has(`${stem}${ext}`.toLowerCase()))) return null;
    for (const ext of extensions) occupied.add(`${stem}${ext}`.toLowerCase());
    return stem;
  }
  const audio = trackAudio(track, order - 1, assets);
  const raw = String(audio?.path || track.title || '').normalize('NFC').replace(/\.[^./]+$/, '');
  const base = audio ? raw : `workspace/${String(order).padStart(3, '0')} ${raw.replace(/[^\p{L}\p{N} ._()-]/gu, '_').trim() || `track-${order}`}`.slice(0, 180);
  for (let suffix = 0; suffix < 1000; suffix++) {
    const stem = `${base}${suffix ? `-${suffix}` : ''}`;
    if (['.lrc', '.elrc', '.txt'].every((ext) => cleanRelPath(stem + ext) && !occupied.has((stem + ext).toLowerCase()))) {
      for (const ext of ['.lrc', '.elrc', '.txt']) occupied.add((stem + ext).toLowerCase());
      return stem;
    }
  }
  return null;
}

async function userFor(request, env) {
  if (!env.UPLOAD_BUCKET) return { error: json({ error: 'r2 not configured' }, 503) };
  const user = await requireUser({ request, env });
  return user ? { user } : { error: json({ error: 'unauthorized' }, 401) };
}

async function writableWorkspace(env, ref) {
  const status = await readJson(env, `${ROOT}/${ref}/status.json`) || {};
  return status.submitted || await env.UPLOAD_BUCKET.head(`web/${ref}/manifest.json`) ? null : status;
}

export async function onCatalogGet({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const catalog = await readAssetJson(request, env, '/api/albums.json');
  if (!catalog || !Array.isArray(catalog.albums)) return json({ error: 'catalog unavailable' }, 503);
  return json({ albums: catalog.albums.map(({ slug, folder, name, song_count, detail_url }) => ({ slug, folder, name, song_count, detail_url })) });
}

export async function onDraftGet({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const ref = cleanRef(new URL(request.url).searchParams.get('ref'));
  if (!ref) return json({ error: 'bad ref' }, 400);
  const [draft, status] = await Promise.all([readJson(env, `${ROOT}/${ref}/draft.json`), readJson(env, `${ROOT}/${ref}/status.json`)]);
  if (!draft) return json({ error: 'not found' }, 404);
  return json({ ref, draft, status: status || {} });
}

export async function onCreatePost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const album = cleanAlbum(body?.album);
  if (!album || (body?.submission_type !== undefined && !['album', 'single'].includes(body.submission_type))) return json({ error: 'bad album' }, 400);
  const draft = emptyDraft(album, body?.submission_type === 'single' ? 'single' : 'album');
  const ref = await createWorkspace(env, draft, auth.user);
  return ref ? json({ ok: true, ref, draft }) : json({ error: 'workspace unavailable' }, 503);
}

export async function onOpenPost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(body.slug) ? body.slug : null;
  if (!slug) return json({ error: 'bad album' }, 400);
  const source = await readAssetJson(request, env, `/api/albums/${slug}.json`);
  const draft = catalogDraft(source);
  if (!draft || !validDraft(draft)) return json({ error: 'album unavailable' }, 404);
  const ref = await createWorkspace(env, draft, auth.user);
  return ref ? json({ ok: true, ref, draft }) : json({ error: 'workspace unavailable' }, 503);
}

export async function onSavePost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const draft = body?.draft;
  if (!ref || !validDraft(draft)) return json({ error: 'bad draft' }, 400);
  const current = await writableWorkspace(env, ref);
  if (!current) return json({ error: 'workspace submitted' }, 409);
  if (!(await env.UPLOAD_BUCKET.head(`${ROOT}/${ref}/draft.json`))) return json({ error: 'not found' }, 404);
  const status = current;
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, draft), writeJson(env, `${ROOT}/${ref}/status.json`, { ...status, updated: nowStamp(), source: draft.source?.kind || 'new', updated_by: auth.user.github || auth.user.name })]);
  return json({ ok: true, ref });
}

// 在已有工作区中新建可编辑 LRC 文件；文件内容保存在草稿 tracks 中，不触及已发布专辑。
export async function onLrcPost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const title = typeof body?.title === 'string' ? body.title.normalize('NFC').trim() : '';
  if (!ref || !title || title.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(title)) return json({ error: 'bad file name' }, 400);
  const current = await writableWorkspace(env, ref);
  if (!current) return json({ error: 'workspace submitted' }, 409);
  const draft = await readJson(env, `${ROOT}/${ref}/draft.json`);
  if (!validDraft(draft)) return json({ error: 'not found' }, 404);
  if (draft.tracks.length >= MAX_FILES || draft.tracks.some((track) => track.title === title)) return json({ error: 'file exists or limit reached' }, 409);
  const track = { order: draft.tracks.length + 1, title, lrc: '', klrc: '', timing_locked: false, edited: true };
  draft.tracks.push(track);
  const status = current;
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, draft), writeJson(env, `${ROOT}/${ref}/status.json`, { ...status, updated: nowStamp(), source: draft.source?.kind || 'new', updated_by: auth.user.github || auth.user.name })]);
  return json({ ok: true, ref, track });
}

export async function onDocumentPost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref); const kind = body?.kind;
  const path = typeof body?.path === 'string' ? body.path.normalize('NFC').trim() : '';
  const cleanPath = cleanRelPath(path);
  const lyricMatch = kind === 'file' && cleanPath?.match(/^(.*)\.(lrc|elrc)$/i);
  if (!ref || !DOCUMENT_KINDS.has(kind) || cleanPath !== path || isReservedPath(path)
    || (kind === 'file' && (!(DOCUMENT_EXTENSIONS.test(path) || LYRIC_EXTENSIONS.test(path)) || path.length > 200))) return json({ error: 'bad document' }, 400);
  const current = await writableWorkspace(env, ref); if (!current) return json({ error: 'workspace submitted' }, 409);
  const draft = await readJson(env, `${ROOT}/${ref}/draft.json`); if (!validDraft(draft)) return json({ error: 'not found' }, 404);
  if (!parentDirectoriesExist(draft, lyricMatch ? lyricMatch[1] : path)) return json({ error: 'parent folder is required' }, 409);
  if (lyricMatch) {
    const lyric_stem = lyricMatch[1];
    const title = lyric_stem.split('/').at(-1);
    if (!title || draft.tracks.length >= MAX_FILES) return json({ error: 'file exists or limit reached' }, 409);
    const track = { order: draft.tracks.length + 1, title, lyric_stem, lrc: '', klrc: '', timing_locked: false, edited: true };
    const candidate = { ...draft, tracks: [...draft.tracks, track] };
    if (!validDraft(candidate)) return json({ error: 'file exists or limit reached' }, 409);
    const status = current;
    await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, candidate), writeJson(env, `${ROOT}/${ref}/status.json`, { ...status, updated: nowStamp(), source: candidate.source?.kind || 'new', updated_by: auth.user.github || auth.user.name })]);
    return json({ ok: true, ref, track });
  }
  const documents = Array.isArray(draft.documents) ? draft.documents : [];
  if (documents.length >= MAX_FILES) return json({ error: 'file exists or limit reached' }, 409);
  const document = { kind, path, ...(kind === 'file' ? { text: '' } : {}) };
  const candidate = { ...draft, documents: [...documents, document] };
  if (!validDraft(candidate)) return json({ error: 'file exists or limit reached' }, 409);
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, candidate), writeJson(env, `${ROOT}/${ref}/status.json`, { ...current, updated: nowStamp(), source: candidate.source?.kind || 'new', updated_by: auth.user.github || auth.user.name })]);
  return json({ ok: true, ref, document });
}

// 登记已通过 /api/upload/r2 或 /api/upload/multipart 直传到 web/{ref}/{n} 的素材；不搬运字节，只校验后写回草稿。
export async function onAssetPost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const n = cleanIndex(body?.n);
  const replace_n = body?.replace_n === undefined ? null : cleanIndex(body.replace_n);
  const path = cleanRelPath(body?.path);
  const role = cleanAssetRole(body?.role);
  const size = Number(body?.size);
  const linkTo = Array.isArray(body?.linkTo) ? body.linkTo : [];
  const library = body?.library === undefined ? undefined : body.library;
  if (!ref || n === null || (body?.replace_n !== undefined && replace_n === null) || !path || !role || !Number.isInteger(size) || size <= 0
    || linkTo.length > MAX_ASSET_LINKS || !linkTo.every(validAssetLink)
    || (library !== undefined && (role !== 'song' || !validLibraryRef(library)))) return json({ error: 'bad request' }, 400);
  const current = await writableWorkspace(env, ref);
  if (!current) return json({ error: 'workspace submitted' }, 409);
  const draft = await readJson(env, `${ROOT}/${ref}/draft.json`);
  if (!validDraft(draft)) return json({ error: 'not found' }, 404);
  const assets = Array.isArray(draft.assets) ? draft.assets : [];
  if (!assets.some((item) => item.n === n) && assets.length >= MAX_ASSETS) return json({ error: 'too many assets' }, 400);
  const replaced = replace_n === null ? null : assets.find((item) => item.n === replace_n);
  if (replace_n !== null && (!replaced || replace_n === n || assets.some((item) => item.n === n))) return json({ error: 'invalid replacement' }, 409);
  if (!library) {
    const object = await env.UPLOAD_BUCKET.head(`web/${ref}/${n}`);
    if (!object || object.size !== size) return json({ error: 'missing upload', n }, 409);
  }
  const asset = { n, path, role, size, linkTo, ...(library ? { library: { id: library.id, ...(library.path ? { path: library.path } : {}) } } : {}) };
  const candidate = { ...draft, assets: [...assets.filter((item) => item.n !== n && item.n !== replace_n), asset].sort((a, b) => a.n - b.n) };
  if (!validDraft(candidate)) return json({ error: 'file path conflict' }, 409);
  draft.assets = candidate.assets;
  const status = current;
  await Promise.all([writeJson(env, `${ROOT}/${ref}/draft.json`, draft), writeJson(env, `${ROOT}/${ref}/status.json`, { ...status, updated: nowStamp(), source: draft.source?.kind || 'new', updated_by: auth.user.github || auth.user.name })]);
  return json({ ok: true, ref, asset });
}

// GET /api/workspace/audio?ref=&n= — 调轴视图取工作草稿里已登记素材的原音；同样只从 R2 直流式读取。
export async function onAudioGet({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const url = new URL(request.url);
  const ref = cleanRef(url.searchParams.get('ref'));
  const n = cleanIndex(url.searchParams.get('n'));
  if (!ref || n === null) return json({ error: 'bad request' }, 400);
  const draft = await readJson(env, `${ROOT}/${ref}/draft.json`);
  const asset = validDraft(draft) && Array.isArray(draft.assets) ? draft.assets.find((item) => item.n === n) : null;
  const type = asset && audioContentType(asset.path);
  if (!asset || !type) return json({ error: 'audio not found' }, 404);
  if (asset.library) return env.STUDIO && env.STUDIO_SUBJECT ? env.STUDIO.library.stream(env, env.STUDIO_SUBJECT, asset.library.id, request) : json({ error: 'library unavailable' }, 503);

  const key = `web/${ref}/${n}`;
  const head = await env.UPLOAD_BUCKET.head?.(key);
  const size = Number(head?.size ?? asset.size);
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'audio not found' }, 404);
  const range = parseByteRange(request.headers.get('range'), size);
  if (range === undefined) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });

  const resolvedType = await detectedAudioContentType(env.UPLOAD_BUCKET, key, type);
  const object = await env.UPLOAD_BUCKET.get(key, range ? { range } : undefined);
  if (!object?.body) return json({ error: 'audio not found' }, 404);
  const headers = new Headers({
    'content-type': resolvedType, 'accept-ranges': 'bytes',
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  });
  if (range) {
    headers.set('content-length', String(range.length));
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(object.body, { headers });
}

export async function onListGet({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const objects = await listPrefix(env, `${ROOT}/`);
  const refs = objects.filter((item) => item.key.endsWith('/status.json')).map((item) => item.key.split('/')[1]).filter(cleanRef);
  const entries = await Promise.all(refs.map(async (ref) => {
    const [draft, status] = await Promise.all([readJson(env, `${ROOT}/${ref}/draft.json`), readJson(env, `${ROOT}/${ref}/status.json`)]);
    return draft ? { ref, album: draft.album, updated: status?.updated || '', source: status?.source || 'new', owner: status?.owner || '', updated_by: status?.updated_by || '' } : null;
  }));
  return json({ workspaces: entries.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated)) });
}

export async function onExtractPost({ request, env }) {
  const auth = await userFor(request, env); if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const draft = ref && await readJson(env, `${ROOT}/${ref}/draft.json`);
  const priorStatus = ref && await readJson(env, `${ROOT}/${ref}/status.json`) || {};
  const assets = Array.isArray(draft?.assets) ? draft.assets : [];
  const documentFiles = Array.isArray(draft?.documents) ? draft.documents.filter((item) => item.kind === 'file') : [];
  if (!ref || !validDraft(draft) || (!assets.length && !draft.tracks.length && !documentFiles.length) || assets.length > MAX_FILES) return json({ error: 'bad request' }, 400);
  const hasText = (track) => Array.isArray(track.lines) ? track.lines.some((line) => typeof line === 'string' && line.trim()) : typeof track.lyrics === 'string' && !!track.lyrics.trim();
  const plannedLrc = draft.tracks.reduce((n, track) => n + (track.lrc || track.klrc || hasText(track) ? 1 : 0) + (track.klrc ? 1 : 0), 0);
  const replacedStems = new Set(draft.tracks.filter((track) => track.lrc || track.klrc || hasText(track)).flatMap((track) => [track.lyric_stem, track.title, track.audio, track.file].filter(Boolean).map((name) => String(name).split('/').at(-1).replace(/\.(?:lrc|elrc|txt|wav|mp3|flac|m4a|ogg|opus)$/i, '').toLowerCase())));
  if (assets.length + documentFiles.length + plannedLrc + 1 > MAX_FILES) return json({ error: 'too many files' }, 400);
  if (await env.UPLOAD_BUCKET.head(`web/${ref}/manifest.json`)) {
    if (!priorStatus.job_started) {
      const retried = await callWorker(env, '/ingest', { ref });
      if (!retried.ok) return json({ error: 'ingest', status: retried.status, message: retried.data?.error }, 502);
      await writeJson(env, `${ROOT}/${ref}/status.json`, { ...priorStatus, job_started: true, job: retried.data?.state || 'queued' });
      return json({ ok: true, ref, retried: true, ...retried.data });
    }
    return json({ ok: true, ref, submitted: true, job: priorStatus.job || 'queued' });
  }
  if (assets.filter((asset) => asset.role === 'cover').length > 1) return json({ error: 'only one cover is allowed' }, 400);
  const subject = env.STUDIO_SUBJECT;
  const librarySong = async (id) => (env.STUDIO && subject ? env.STUDIO.library.song(env, subject, id) : null);
  const libraryTracks = draft.tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.library_song);
  const seenPaths = new Set(); const seenNumbers = new Set(); const manifestFiles = [];
  const existingObjectNumbers = new Set((await listPrefix(env, `web/${ref}/`))
    .map((item) => item.key.match(new RegExp(`^web/${ref}/(\\d+)$`))?.[1])
    .filter((value) => value !== undefined).map(Number));
  for (const asset of assets) {
    const path = cleanRelPath(asset?.path); const n = cleanIndex(asset?.n); const size = Number(asset?.size);
    if (/\.(?:lrc|elrc)$/i.test(path || '') && replacedStems.has(path.split('/').at(-1).replace(/\.(?:lrc|elrc)$/i, '').toLowerCase())) { seenNumbers.add(n); continue; }
    if (path?.toLowerCase() === 'manifest.toml') return json({ error: 'manifest.toml is generated by the workspace' }, 400);
    if (asset.role === 'cover' && !/\.(?:png|jpe?g|webp)$/i.test(path || '')) return json({ error: 'invalid cover format' }, 400);
    if (!path || n === null || !Number.isInteger(size) || size <= 0 || seenPaths.has(path.toLowerCase()) || seenNumbers.has(n)) return json({ error: 'invalid file entry' }, 400);
    if (asset.library) {
      const song = await librarySong(asset.library.id);
      if (!song?.size) return json({ error: 'library song unavailable', path }, 409);
      seenPaths.add(path.toLowerCase()); seenNumbers.add(n); manifestFiles.push({ path, n, size: song.size, library: asset.library.id });
      continue;
    }
    const object = await env.UPLOAD_BUCKET.head(`web/${ref}/${n}`);
    if (!object || object.size !== size) return json({ error: 'missing upload', n }, 409);
    seenPaths.add(path.toLowerCase()); seenNumbers.add(n); manifestFiles.push({ path, n, size });
  }
  for (const n of existingObjectNumbers) if (!seenNumbers.has(n)) seenNumbers.add(n);
  const occupiedPaths = new Set([...seenPaths, ...documentFiles.map((document) => document.path)].map((path) => path.toLocaleLowerCase()));
  // Tracks bound to a library song without an uploaded copy become manifest audio entries streamed at ingest time.
  const manifestTracks = draft.tracks.map((track) => ({ ...track }));
  const manifestAssets = [...assets];
  for (const { track, index } of libraryTracks) {
    const uploaded = assets.find((asset) => asset.library?.id === track.library_song);
    if (uploaded) { manifestTracks[index].audio = uploaded.path; continue; }
    const song = await librarySong(track.library_song);
    const suffix = String(song?.suffix || '').toLowerCase();
    if (!song?.size || !LIBRARY_AUDIO_EXTENSIONS.test(suffix)) return json({ error: 'library song unavailable', track: index + 1 }, 409);
    const base = `${String(track.order || index + 1).padStart(2, '0')} ${track.title || 'Track'}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
    let path = `${base}.${suffix}`;
    for (let copy = 2; occupiedPaths.has(path.toLocaleLowerCase()); copy += 1) path = `${base} (${copy}).${suffix}`;
    let n = 0;
    while (seenNumbers.has(n) && n < MAX_FILES) n += 1;
    if (n >= MAX_FILES || !cleanRelPath(path)) return json({ error: 'too many files' }, 400);
    seenNumbers.add(n); occupiedPaths.add(path.toLocaleLowerCase());
    manifestFiles.push({ path, n, size: song.size, library: track.library_song });
    manifestAssets.push({ n, path, role: 'song', size: song.size, linkTo: [track.order || index + 1] });
    manifestTracks[index].audio = path;
  }
  const documentFilesToWrite = [];
  for (const document of documentFiles) {
    let n = 0;
    while (seenNumbers.has(n) && n < MAX_FILES) n += 1;
    if (n >= MAX_FILES) return json({ error: 'too many files' }, 400);
    const content = String(document.text);
    const size = new TextEncoder().encode(content).byteLength;
    seenNumbers.add(n);
    documentFilesToWrite.push({ n, path: document.path, size, content });
  }
  await Promise.all(documentFilesToWrite.map((file) => env.UPLOAD_BUCKET.put(`web/${ref}/${file.n}`, file.content,
    { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })));
  manifestFiles.push(...documentFilesToWrite.map(({ n, path, size }) => ({ n, path, size })));
  const lrcFiles = [];
  for (const [index, track] of draft.tracks.entries()) {
    if (!track.lrc && !track.klrc && !hasText(track)) continue;
    let n = 0;
    while (seenNumbers.has(n) && n < MAX_FILES) n += 1;
    const stem = workspaceLyricsStem(track, index + 1, occupiedPaths, assets);
    const plainText = !track.lrc && !track.klrc;
    const path = stem && `${stem}${plainText ? '.txt' : '.lrc'}`;
    const content = plainText ? `${track.title}\n\n${Array.isArray(track.lines) ? track.lines.join('\n') : track.lyrics}\n` : String(track.lrc || track.klrc?.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '') || '');
    const size = new TextEncoder().encode(content).byteLength;
    if (n >= MAX_FILES || !path || size > MAX_TRACK_BYTES) return json({ error: 'cannot materialize draft' }, 400);
    seenNumbers.add(n);
    lrcFiles.push({ n, path, size, content });
    const elrcContent = String(track.klrc || '');
    if (elrcContent) {
      let elrcN = 0;
      while (seenNumbers.has(elrcN) && elrcN < MAX_FILES) elrcN += 1;
      const elrcPath = stem && `${stem}.elrc`;
      const elrcSize = new TextEncoder().encode(elrcContent).byteLength;
      if (elrcN >= MAX_FILES || !elrcPath || elrcSize > MAX_TRACK_BYTES) return json({ error: 'cannot materialize draft' }, 400);
      seenNumbers.add(elrcN);
      lrcFiles.push({ n: elrcN, path: elrcPath, size: elrcSize, content: elrcContent });
    }
  }
  await Promise.all(lrcFiles.map((file) => env.UPLOAD_BUCKET.put(`web/${ref}/${file.n}`, file.content,
    { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })));
  manifestFiles.push(...lrcFiles.map(({ n, path, size }) => ({ n, path, size })));
  let manifestN = 0;
  while (seenNumbers.has(manifestN)) manifestN += 1;
  if (manifestN >= MAX_FILES) return json({ error: 'too many files' }, 400);
  const lyric_maker = [...new Set((Array.isArray(draft.meta?.lyric_maker) ? draft.meta.lyric_maker : []).filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim().slice(0, 60)).slice(0, 20))];
  for (const name of [auth.user.display_name, env.REQUIRED_LYRIC_MAKER]) if (name && !lyric_maker.includes(name)) lyric_maker.push(name);
  const manifestText = workspaceManifest({ ...draft, tracks: manifestTracks, meta: { ...draft.meta, lyric_maker } }, manifestAssets);
  const manifestSize = new TextEncoder().encode(manifestText).byteLength;
  await env.UPLOAD_BUCKET.put(`web/${ref}/${manifestN}`, manifestText, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  manifestFiles.push({ n: manifestN, path: 'manifest.toml', size: manifestSize });
  const contributor = auth.user.github || auth.user.name;
  if (manifestFiles.some((file) => file.library) && !subject) return json({ error: 'library unavailable' }, 503);
  const manifest = { version: 3, album: draft.album, submission_type: draft.submission_type || 'album', session: ref, contributor, lyric_maker, files: manifestFiles, ...(subject ? { subject } : {}) };
  await writeJson(env, `web/${ref}/manifest.json`, manifest);
  await writeJson(env, `${ROOT}/${ref}/status.json`, { ...priorStatus, submitted: true, job_started: false, job: 'starting', updated: nowStamp() });
  const started = await callWorker(env, '/ingest', { ref });
  if (!started.ok) return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  await writeJson(env, `${ROOT}/${ref}/status.json`, { ...priorStatus, submitted: true, job_started: true, job: started.data?.state || 'queued', updated: nowStamp() });
  return json({ ok: true, ref, ...started.data });
}
