const clone = (value) => JSON.parse(JSON.stringify(value));

export function lyricSnapshot(track) {
  return clone({
    rows: track.rows,
    text: track.text,
    timingLocked: !!track.timingLocked,
    textDirty: !!track._textDirty,
  });
}

export function createLyricHistory(track, limit = 100) {
  return { limit, entries: [lyricSnapshot(track)], index: 0 };
}

export function recordLyricHistory(history, track) {
  const snapshot = lyricSnapshot(track);
  const current = history.entries[history.index];
  if (JSON.stringify(current) === JSON.stringify(snapshot)) return false;
  history.entries.splice(history.index + 1);
  history.entries.push(snapshot);
  if (history.entries.length > history.limit) history.entries.shift();
  history.index = history.entries.length - 1;
  return true;
}

function restore(track, snapshot) {
  track.rows = clone(snapshot.rows);
  track.text = snapshot.text;
  track.timingLocked = snapshot.timingLocked;
  track._textDirty = snapshot.textDirty;
}

export function undoLyricHistory(history, track) {
  if (!history || history.index <= 0) return false;
  history.index -= 1;
  restore(track, history.entries[history.index]);
  return true;
}

export function redoLyricHistory(history, track) {
  if (!history || history.index >= history.entries.length - 1) return false;
  history.index += 1;
  restore(track, history.entries[history.index]);
  return true;
}

export function canUndoLyricHistory(history) { return !!history && history.index > 0; }
export function canRedoLyricHistory(history) { return !!history && history.index < history.entries.length - 1; }
