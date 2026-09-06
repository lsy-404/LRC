import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { workspaceManifest } from '../functions/api/workspaceManifest.js';

function parseToml(text) {
  const localPython = new URL('./.venv/bin/python', import.meta.url).pathname;
  const parsed = spawnSync(process.env.PYTHON || (existsSync(localPython) ? localPython : 'python3'), ['-c', 'import sys,json,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: text, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  return JSON.parse(parsed.stdout);
}

test('workspace manifest is valid TOML and carries actual audio bindings, metadata and roles', () => {
  const result = parseToml(workspaceManifest({
    album: '专辑', submission_type: 'single', meta: { vocal: ['歌手'], year: '2026', album: 'Injected', 'bad\nkey': 'bad', '__proto__': {}, cover: '../outside' },
    names: { prefix: 'P', zh_name: '中', en_name: 'EN', suffix: 'S', submission_type: 'injected' },
    tracks: [{ order: 1, title: 'Display title', audio: 'audio/first.mp3', inst: false }, { order: 2, title: 'INST title', file: 'second.mp3', inst: true }],
  }, [
    { path: 'book.jpg', role: 'photo', linkTo: [1, 2, 'SP'] },
    { path: 'nested/front.png', role: 'cover', linkTo: [] },
    { path: 'audio/first.mp3', role: 'song', linkTo: [] },
    { path: 'second.mp3', role: 'song', linkTo: [] },
    { path: 'staff.txt', role: 'staff', linkTo: [] },
    { path: 'unused.mp3', role: 'etc', linkTo: [] },
  ]));
  assert.equal(result.album, '专辑');
  assert.equal(result.submission_type, 'single');
  assert.deepEqual(result.vocal, ['歌手']);
  assert.deepEqual(result.links['book.jpg'], ['first.mp3', 'second.mp3']);
  assert.deepEqual(result['伴奏'], ['second.mp3']);
  assert.deepEqual(result['原曲'], ['first.mp3']);
  assert.deepEqual(result.album_pages, ['book.jpg', 'staff.txt']);
  assert.equal(result.cover, 'nested/front.png');
  assert.equal(result.asset_roles['unused.mp3'], 'etc');
  assert.equal(result['bad\nkey'], undefined);
});

test('photo bindings resolve upload audio order before any draft tracks exist', () => {
  const result = parseToml(workspaceManifest({ album: 'A', tracks: [] }, [
    { path: '01 第一首.flac', role: 'song' }, { path: '02 第二首.flac', role: 'song' },
    { path: 'book.jpg', role: 'photo', linkTo: [1, 2] },
  ]));
  assert.deepEqual(result.links['book.jpg'], ['01 第一首.flac', '02 第二首.flac']);
});
