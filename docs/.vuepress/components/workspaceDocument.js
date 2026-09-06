import {
  expandTimedTokens, fillInstrumentalFallback, isTrackEdited, linesToText,
  parseVocalDrafts, removeKnownSttWatermarkTokens, removeKnownSttWatermarks,
  serializeVocalDrafts, textToLines,
} from './lrcDraft.js';
import { createLyricHistory, recordLyricHistory } from './lyricHistory.js';

export const META_FIELDS = [
  { key: 'vocal', label: '演唱', list: true },
  { key: 'lyricist', label: '作词', list: true },
  { key: 'composer', label: '作曲', list: true },
  { key: 'arranger', label: '编曲', list: true },
  { key: 'tuning', label: '调校', list: true },
  { key: 'illustrator', label: '曲绘', list: true },
  { key: 'mixer', label: '混音', list: true },
  { key: 'mastering', label: '母带', list: true },
  { key: 'video', label: '视频', list: true },
  { key: 'planning', label: '策划', list: true },
  { key: 'produce', label: '出品', list: true },
  { key: 'lyric_maker', label: '歌词制作', list: true },
  { key: 'year', label: '发行日期', list: false },
  { key: 'release', label: '发布', list: false },
  { key: 'purchase', label: '购买', list: false },
];

export function selectedVocal(t) { return t._vocals[t._selectedVocal] || t._vocals[0]; }

export function persistVocal(t) {
  const vocal = selectedVocal(t); if (!vocal) return;
  vocal.head = t.head; vocal.rows = t.rows; vocal.text = t.text; vocal.timingLocked = t.timingLocked; vocal._view = t._view;
}

export function sanitizeGeneratedTrack(t, normalize = (text) => text) {
  const clean = (text) => removeKnownSttWatermarks(normalize(text));
  t.title = clean(t.title);
  for (const vocal of t._vocals) {
    vocal.head = vocal.head.map(clean);
    for (const row of vocal.rows) {
      row.text = clean(row.text);
      row.words = removeKnownSttWatermarkTokens(row.words).map((word) => ({ ...word, text: clean(word.text) }));
    }
    vocal.rows = fillInstrumentalFallback(vocal.rows.filter((row) => String(row.text || '').trim()));
    vocal.text = linesToText(vocal.rows.map((row) => row.text));
    if (vocal.rows.length && !vocal.untimed) vocal.timingLocked = true;
  }
  const selected = selectedVocal(t);
  t.head = selected.head;
  t.rows = selected.rows;
  t.text = selected.text;
  t.timingLocked = selected.timingLocked;
  t._view = selected._view;
}

const curTrack = (t) => ({
  order: t.order, title: t.title, inst: t.inst, lines: t.timingLocked ? t.rows.map((r) => r.text).filter(Boolean) : textToLines(t.text),
});
export const isDirty = (t) => !!(t._orig && t._orig.edited) || isTrackEdited(t._orig, curTrack(t));

export function cleanAlbumName(value, fallback) {
  const basename = String(value || '').replace(/\\/g, '/').split('/').pop().trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return basename && !/^\.+$/.test(basename) ? basename : fallback;
}

export function toEdit(album, draft, newId) {
  const meta = {};
  for (const f of META_FIELDS) {
    const v = draft.meta ? draft.meta[f.key] : undefined;
    meta[f.key] = f.list ? (Array.isArray(v) ? v.join('、') : '') : (v || '');
  }
  return {
    album: draft.album || album,
    _storageAlbum: album,
    _originalAlbum: draft.album || album,
    _draft: draft,
    meta,
    names: { prefix: '', zh_name: '', en_name: '', suffix: '', ...(draft.names || {}) },
    assets: (draft.assets || []).map((asset) => ({ ...asset, linkTo: [...(asset.linkTo || [])] })),
    submissionType: draft.submission_type || 'album',
    _activePane: 'meta',
    _selectedTrack: 0,
    tracks: (draft.tracks || []).map((t) => {
      const makeVocal = (part) => {
        const parsedRows = part.rows;
        const editorRows = parsedRows.map((r, index) => {
          const words = r.words.map((word) => ({ ...word, _id: newId() }));
          return { ...r, _id: newId(), words: part.timingLocked ? words : expandTimedTokens(words, newId, 100, Number(parsedRows[index + 1]?.time)) };
        });
        return { ...part, _id: newId(), rows: editorRows, _view: editorRows.length ? 'lrc' : 'text' };
      };
      const vocals = parseVocalDrafts(t).map(makeVocal);
      const primary = vocals[0];
      const track = {
        _id: newId(), order: t.order, title: t.title || '', inst: !!t.inst, authoritativeLrc: !!t.authoritative_lrc, outputName: t.output_name || '', finalName: t.final_name || '', confidence: t.confidence,
        coverage: t.coverage, audio: t.audio || '', klrc: t.klrc || '',
        head: primary.head, rows: primary.rows, timingLocked: primary.timingLocked, _view: primary._view, _playing: false, _speed: 1, _previewMs: 0, _textDirty: false,
        _audioUrl: '', _audioElement: null, _audioLoading: false, _audioAbort: null, _audioLoadId: 0, _audioProgress: -1, _audioErr: '', _audioDuration: 0, _sourcePlaying: false, _sourceTimer: null, _previewTimer: null, _volume: 1,
        text: primary.text, _orig: t, _vocals: vocals, _selectedVocal: 0,
        _editorMode: 'visual', _sourceFormat: 'lrc', _sourceText: '', _sourceMessage: '', _sourceError: false,
      };
      if (!track.authoritativeLrc) sanitizeGeneratedTrack(track);
      track._history = createLyricHistory(track);
      for (const vocal of vocals) { vocal._owner = track; vocal._history = track._history; vocal.name = vocal.id === 'main' ? '主唱' : '和声'; }
      return track;
    }),
    pages: draft.pages || [],
    coverExt: draft.cover_ext || '',
    coverRemoved: false,
    _coverNew: null, _coverPreview: '', _coverBusy: false,
    _saving: false, _msg: '', _err: false,
  };
}

export function toDraft(e) {
  const meta = { ...(e._draft.meta || {}) };
  for (const f of META_FIELDS) {
    if (f.list) {
      meta[f.key] = String(e.meta[f.key] || '').split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
    } else {
      meta[f.key] = String(e.meta[f.key] || '').trim();
    }
  }
  const tracks = e.tracks.map((t) => {
    if (t.authoritativeLrc) {
      return {
        ...t._orig,
        order: Number(t.order) || t._orig.order,
        title: t.title.trim(),
        inst: !!t.inst,
        output_name: t.outputName.trim(),
        final_name: t.finalName.trim(),
        edited: false,
      };
    }
    persistVocal(t);
    const timing = serializeVocalDrafts(t._vocals);
    return {
    ...t._orig,
    order: Number(t.order) || t._orig.order,
    title: t.title.trim(),
    inst: !!t.inst,
    output_name: t.outputName.trim(),
    final_name: t.inst ? t.finalName.trim() : '',
    lines: timing.main.timing_locked ? timing.main.lines : textToLines(t._vocals[0].text),
    ...(timing.main.timing_locked ? { lrc: timing.main.lrc, klrc: timing.main.klrc, timing_locked: true } : { lrc: '', klrc: '', timing_locked: false }),
    vocals: timing.vocals,
    edited: timing.main.timing_locked ? false : isDirty(t),
  }; });
  const album = cleanAlbumName(e.album, e._originalAlbum);
  const names = Object.fromEntries(Object.entries(e.names).map(([key, value]) => [key, String(value || '').trim()]));
  if (!names.zh_name && !names.en_name) names[/[\u3400-\u9fff]/.test(album) ? 'zh_name' : 'en_name'] = album;
  return { ...e._draft, album, submission_type: e.submissionType, names, meta, tracks, pages: e.pages, assets: e.assets.map((asset) => ({ ...asset, linkTo: [...asset.linkTo] })), cover_ext: e.coverRemoved ? '' : e.coverExt };
}

export function documentId(resource, view) {
  return JSON.stringify([resource.origin, resource.ref, resource.storageAlbum, resource.kind, resource.index ?? '', view]);
}

export function viewsFor(resource) {
  return resource.kind === 'track' ? ['timing', 'text:lrc', 'text:elrc'] : ['meta', 'text:json', 'assets'];
}

const AUDIO_RE = /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma|aiff?)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const TEXT_RE = /\.(e?lrc|txt|md)$/i;

export function assetRole(path) {
  const name = String(path || '');
  if (AUDIO_RE.test(name)) return 'song';
  if (IMAGE_RE.test(name)) return 'photo';
  if (TEXT_RE.test(name)) return 'text';
  return 'etc';
}

export function explorerTree(draft, origin) {
  const base = { origin: origin.origin, ref: origin.ref, storageAlbum: origin.storageAlbum };
  const albumResource = { ...base, kind: 'album' };
  const albumLabel = draft.album || origin.storageAlbum;
  const trackNodes = (draft.tracks || []).map((track, index) => {
    const trackResource = { ...base, kind: 'track', index };
    const label = `${String(track.order).padStart(2, '0')} ${track.title || ''}`.trim();
    return {
      id: documentId(trackResource, 'timing'),
      type: 'virtual',
      label,
      resource: trackResource,
      view: 'timing',
      children: [
        { id: documentId(trackResource, 'text:lrc'), type: 'file', label: `${label}.lrc`, resource: trackResource, view: 'text:lrc' },
        { id: documentId(trackResource, 'text:elrc'), type: 'file', label: `${label}.elrc`, resource: trackResource, view: 'text:elrc' },
      ],
    };
  });
  return [{
    id: documentId(albumResource, 'meta'),
    type: 'virtual',
    label: albumLabel,
    resource: albumResource,
    view: 'meta',
    children: [
      { id: documentId(albumResource, 'text:json'), type: 'file', label: 'meta.json', resource: albumResource, view: 'text:json' },
      { id: documentId(albumResource, 'assets'), type: 'virtual', label: '素材', resource: albumResource, view: 'assets' },
      ...trackNodes,
    ],
  }];
}

const lyricStem = (value) => String(value || '').normalize('NFC').replace(/\\/g, '/').split('/').at(-1)
  .replace(/\.(?:e?lrc|mp3|flac|wav|m4a|ogg|opus)$/i, '')
  .replace(/^\d+[.\s_-]+/, '')
  .replace(/(?:[（(\[]\s*)?(?:inst(?:rumental)?|off[\s_-]*vocal|伴奏)(?:\s*[）)\]])?[.\s_-]*$/i, '')
  .trim().toLocaleLowerCase();

export function linkedInstrumentalTracks(editor, source) {
  if (source.inst) return [];
  const sourceFile = source.audio || source._orig?.file || '';
  return editor.tracks.filter((target) => {
    if (target === source || !target.inst || target.authoritativeLrc) return false;
    const pair = target._orig?._pair_file;
    if (pair && sourceFile) return pair === sourceFile;
    return !!lyricStem(source.title) && lyricStem(target.title) === lyricStem(source.title);
  });
}

export function syncInstrumentalLyrics(editor, source, targetIds, newId) {
  persistVocal(source);
  const targets = linkedInstrumentalTracks(editor, source).filter((track) => targetIds.includes(track._id));
  for (const target of targets) {
    const vocals = source._vocals.map((part) => ({
      id: part.id, name: part.name, _id: newId(),
      head: [...part.head].filter((line) => !/^\[(?:ti|ar|al):/i.test(line)),
      rows: part.rows.map((row) => ({ ...row, _id: newId(), words: row.words.map((word) => ({ ...word, _id: newId() })) })),
      text: part.text, timingLocked: part.timingLocked, untimed: part.untimed, _view: part._view,
    }));
    const headers = target._vocals[0]?.head.filter((line) => /^\[(?:ti|ar|al):/i.test(line)) || [];
    vocals[0].head.unshift(...headers);
    target._vocals = vocals;
    target._selectedVocal = 0;
    const main = vocals[0];
    Object.assign(target, { head:main.head, rows:main.rows, text:main.text, timingLocked:main.timingLocked, _view:main._view, _textDirty:true, _sourceBuffers:{} });
    for (const vocal of vocals) { vocal._owner = target; vocal._history = target._history; }
    recordLyricHistory(target._history, target);
  }
  return targets;
}
