import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanAlbum, cleanRelPath, cleanSession, cleanIndex, callWorker,
} from '../../functions/api/upload/_lib.js';

test('cleanAlbum 接受正常专辑名', () => {
  assert.equal(cleanAlbum('测试专辑'), '测试专辑');
  assert.equal(cleanAlbum('Album Name (2026)'), 'Album Name (2026)');
  assert.equal(cleanAlbum('  溯流  '), '溯流');
});

test('cleanAlbum 拒绝非法输入', () => {
  assert.equal(cleanAlbum(''), null);
  assert.equal(cleanAlbum('   '), null);
  assert.equal(cleanAlbum('a/b'), null);
  assert.equal(cleanAlbum('a\\b'), null);
  assert.equal(cleanAlbum('a\u0000b'), null);
  assert.equal(cleanAlbum('a\u001fb'), null);
  assert.equal(cleanAlbum('.'), null);
  assert.equal(cleanAlbum('..'), null);
  assert.equal(cleanAlbum('.gitignore'), null);
  assert.equal(cleanAlbum('x'.repeat(121)), null);
  assert.equal(cleanAlbum(42), null);
});

test('cleanRelPath 接受并规范化正常路径', () => {
  assert.equal(cleanRelPath('01 告别如汐.txt'), '01 告别如汐.txt');
  assert.equal(cleanRelPath('歌词/01.txt'), '歌词/01.txt');
  assert.equal(cleanRelPath('歌词\\01.txt'), '歌词/01.txt');
  assert.equal(cleanRelPath('/abs/x.txt'), 'abs/x.txt');
  assert.equal(cleanRelPath('a//b.txt'), 'a/b.txt');
});

test('cleanRelPath 拒绝穿越与非法输入', () => {
  assert.equal(cleanRelPath('../x.txt'), null);
  assert.equal(cleanRelPath('a/../b.txt'), null);
  assert.equal(cleanRelPath('a/./b.txt'), null);
  assert.equal(cleanRelPath('a\u0000.txt'), null);
  assert.equal(cleanRelPath(''), null);
  assert.equal(cleanRelPath('///'), null);
  assert.equal(cleanRelPath(Array(12).fill('d').join('/')), null);
  assert.equal(cleanRelPath(null), null);
});

test('cleanSession 只认 16~64 位小写十六进制', () => {
  assert.equal(cleanSession('a'.repeat(32)), 'a'.repeat(32));
  assert.equal(cleanSession('a'.repeat(15)), null);
  assert.equal(cleanSession('a'.repeat(65)), null);
  assert.equal(cleanSession('A'.repeat(32)), null);
  assert.equal(cleanSession(null), null);
});

test('cleanIndex 允许 0 且拒绝越界', () => {
  assert.equal(cleanIndex(0), 0);
  assert.equal(cleanIndex('7'), 7);
  assert.equal(cleanIndex(-1), null);
  assert.equal(cleanIndex(500), null);
  assert.equal(cleanIndex(''), null);
  assert.equal(cleanIndex(1.5), null);
});

test('callWorker 缺少同一 Worker 的内部调度器时失败', async () => {
  const r = await callWorker({}, '/ingest', { ref: 'a'.repeat(32) });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test('callWorker 转交同一 Worker 内部调度器', async () => {
  const seen = [];
  const expected = { ok: true, status: 200, data: { queued: true } };
  const env = {
    INGEST_INTERNAL_CALL: async (path, body, method) => {
      seen.push({ path, body, method });
      return expected;
    },
  };
  const r = await callWorker(env, '/ingest', { ref: 'b'.repeat(32) });
  assert.equal(r, expected);
  assert.deepEqual(seen, [{ path: '/ingest', body: { ref: 'b'.repeat(32) }, method: 'POST' }]);
});
