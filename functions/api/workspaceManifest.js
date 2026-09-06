const META_KEYS = new Set(['year', 'produce', 'vocal', 'lyricist', 'composer', 'arranger', 'tuning', 'illustrator', 'mixer', 'mastering', 'video', 'planning', 'lyric_maker', 'release', 'purchase', 'electronic']);
const NAME_KEYS = new Set(['prefix', 'zh_name', 'en_name', 'suffix']);
const quote = (value) => JSON.stringify(String(value ?? ''));
const list = (values) => `[${values.map(quote).join(', ')}]`;
const basename = (path) => String(path || '').split('/').at(-1);

export function trackAudio(track, index, assets) {
  const songs = assets.filter((asset) => asset.role === 'song');
  const explicit = basename(track?.audio || track?.file);
  return songs.find((asset) => basename(asset.path) === explicit) || songs[index];
}

export function workspaceManifest(draft, assets) {
  const lines = [`album = ${quote(draft.album)}`, `submission_type = ${quote(draft.submission_type || 'album')}`];
  for (const [values, allowed] of [[draft.meta, META_KEYS], [draft.names, NAME_KEYS]]) {
    for (const [key, value] of Object.entries(values || {})) {
      if (!allowed.has(key) || value === '' || value == null) continue;
      if (typeof value === 'string' || typeof value === 'number') lines.push(`${quote(key)} = ${quote(value)}`);
      else if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string')) lines.push(`${quote(key)} = ${list(value)}`);
    }
  }
  const tracks = draft.tracks || [];
  const byOrder = new Map(assets.filter((asset) => asset.role === 'song').map((asset, index) => [index + 1, basename(asset.path)]));
  const inst = []; const original = [];
  tracks.forEach((track, index) => {
    const audio = trackAudio(track, index, assets);
    if (!audio) return;
    const name = basename(audio.path);
    byOrder.set(track.order || index + 1, name);
    if (track.inst === true) inst.push(name);
    if (track.inst === false) original.push(name);
  });
  const links = []; const albumPages = [];
  for (const asset of assets) {
    const name = basename(asset.path);
    if (asset.role === 'photo' && asset.linkTo?.length) {
      const names = [...new Set(asset.linkTo.map((order) => byOrder.get(order)).filter(Boolean))];
      if (names.length) links.push([name, names]);
    }
    if (asset.role === 'staff' || asset.linkTo?.includes('SP')) albumPages.push(name);
    if (asset.role === 'cover') lines.push(`cover = ${quote(asset.path)}`);
  }
  if (inst.length) lines.push(`${quote('伴奏')} = ${list(inst)}`);
  if (original.length) lines.push(`${quote('原曲')} = ${list(original)}`);
  if (albumPages.length) lines.push(`album_pages = ${list(albumPages)}`);
  if (links.length) {
    lines.push('', '[links]');
    for (const [name, names] of links) lines.push(`${quote(name)} = ${list(names)}`);
  }
  lines.push('', '[asset_roles]');
  for (const asset of assets) lines.push(`${quote(asset.path)} = ${quote(asset.role)}`);
  return `${lines.join('\n')}\n`;
}
