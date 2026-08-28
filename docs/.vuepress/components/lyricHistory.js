const clone = (value) => JSON.parse(JSON.stringify(value));

export function lyricSnapshot(track) {
  const rows = clone(track.rows || []);
  for (const row of rows) delete row._selection;
  const vocals = Array.isArray(track._vocals) ? track._vocals.map((vocal, index) => {
    const selected = index === Number(track._selectedVocal || 0);
    const vocalRows = clone(selected ? track.rows || [] : vocal.rows || []);
    for (const row of vocalRows) delete row._selection;
    return {
      id: vocal.id,
      name: vocal.name,
      _id: vocal._id,
      head: clone(selected ? track.head || [] : vocal.head || []),
      rows: vocalRows,
      text: selected ? track.text : vocal.text,
      timingLocked: selected ? !!track.timingLocked : !!vocal.timingLocked,
      _view: selected ? track._view : vocal._view,
    };
  }) : null;
  return {
    order: track.order,
    title: track.title,
    inst: !!track.inst,
    outputName: track.outputName,
    finalName: track.finalName,
    head: clone(track.head || []),
    rows,
    text: track.text,
    timingLocked: !!track.timingLocked,
    textDirty: !!track._textDirty,
    selectedVocal: Number(track._selectedVocal || 0),
    vocals,
  };
}

export function createLyricHistory(track, limit = 100) {
  return { limit, entries: [lyricSnapshot(track)], index: 0, dirty: false };
}

export function recordLyricHistory(history, track) {
  const snapshot = lyricSnapshot(track);
  const current = history.entries[history.index];
  history.dirty = false;
  if (JSON.stringify(current) === JSON.stringify(snapshot)) return false;
  history.entries.splice(history.index + 1);
  history.entries.push(snapshot);
  if (history.entries.length > history.limit) history.entries.shift();
  history.index = history.entries.length - 1;
  return true;
}

export function markLyricHistoryDirty(history) {
  if (history) history.dirty = true;
}

function restore(track, snapshot) {
  track.order = snapshot.order;
  track.title = snapshot.title;
  track.inst = snapshot.inst;
  track.outputName = snapshot.outputName;
  track.finalName = snapshot.finalName;
  track.head = clone(snapshot.head);
  track.rows = clone(snapshot.rows);
  track.text = snapshot.text;
  track.timingLocked = snapshot.timingLocked;
  track._textDirty = snapshot.textDirty;
  if (Array.isArray(snapshot.vocals) && snapshot.vocals.length) {
    track._vocals = clone(snapshot.vocals);
    track._selectedVocal = Math.max(0, Math.min(snapshot.selectedVocal || 0, track._vocals.length - 1));
    const selected = track._vocals[track._selectedVocal];
    track.head = selected.head;
    track.rows = selected.rows;
    track.text = selected.text;
    track.timingLocked = selected.timingLocked;
    track._view = selected._view;
  }
}

export function undoLyricHistory(history, track) {
  if (!history) return false;
  if (history.dirty) recordLyricHistory(history, track);
  if (history.index <= 0) return false;
  history.index -= 1;
  restore(track, history.entries[history.index]);
  return true;
}

export function redoLyricHistory(history, track) {
  if (!history) return false;
  if (history.dirty) recordLyricHistory(history, track);
  if (history.index >= history.entries.length - 1) return false;
  history.index += 1;
  restore(track, history.entries[history.index]);
  return true;
}

export function canUndoLyricHistory(history) { return !!history && (history.dirty || history.index > 0); }
export function canRedoLyricHistory(history) { return !!history && !history.dirty && history.index < history.entries.length - 1; }
