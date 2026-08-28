import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLyricMakers, readDraft, serializeDraft } from '../docs/.vuepress/components/uploadDraft.js';
import { onRequestPost as finalizePost } from '../functions/api/upload/finalize.js';
import { authedRequest, fakeBucket } from './worker/_fakeR2.mjs';

test('打轴署名去重保序，并只在缺少时末尾追加武乙凌薇', () => {
  assert.deepEqual(normalizeLyricMakers('甲、乙，甲\n丙'), ['甲', '乙', '丙', '武乙凌薇']);
  assert.deepEqual(normalizeLyricMakers(['甲', '武乙凌薇', '甲', '乙']), ['甲', '武乙凌薇', '乙']);
});

test('上传草稿保存和恢复专辑级打轴署名', () => {
  const draft = serializeDraft('测试专辑', [{ relPath: '音频/01.mp3', role: 'song' }], 10, '', '甲，甲、乙');
  const storage = { getItem: () => JSON.stringify(draft), removeItem() {} };
  const restored = readDraft(storage, 11);
  assert.deepEqual(restored.lyricMakers, ['甲', '乙', '武乙凌薇']);
});

test('上传清单保留专辑级打轴署名，且不重复追加武乙凌薇', async () => {
  const bucket = fakeBucket();
  const ref = 'a'.repeat(32);
  const response = await finalizePost({
    request: authedRequest('https://x/api/upload/finalize', {
      method: 'POST', body: {
        album: '测试专辑', session: ref,
        lyric_maker: ['甲', '武乙凌薇', '甲', '乙'],
        files: [{ n: 0, path: '音频/01.mp3', size: 1 }],
      },
    }),
    env: {
      UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: bucket,
      INGEST_INTERNAL_CALL: async () => ({ ok: true, status: 200, data: { ok: true } }),
    },
  });
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${ref}/manifest.json`));
  assert.deepEqual(manifest.lyric_maker, ['甲', '武乙凌薇', '乙']);
});
