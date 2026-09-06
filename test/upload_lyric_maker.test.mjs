import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as finalizePost } from '../functions/api/upload/finalize.js';
import { authedRequest, fakeBucket } from './worker/_fakeR2.mjs';

const USERS = { getByName: () => ({ resolveSession: () => ({ id: 1, name: 'editor', display_name: 'Editor', github: null, role: 'editor', status: 'active' }) }) };

test('上传清单保留专辑级打轴署名，且不重复追加固定署名', async () => {
  const bucket = fakeBucket();
  const ref = 'a'.repeat(32);
  const response = await finalizePost({
    request: authedRequest('https://x/api/upload/finalize', {
      method: 'POST', body: {
        album: '测试专辑', session: ref,
        lyric_maker: ['甲', '固定署名', '甲', '乙'],
        files: [{ n: 0, path: '音频/01.mp3', size: 1, mime: 'audio/mpeg' }],
      },
    }),
    env: {
      REQUIRED_LYRIC_MAKER: '固定署名', UPLOAD_BUCKET: bucket, USERS,
      INGEST_INTERNAL_CALL: async () => ({ ok: true, status: 200, data: { ok: true } }),
    },
  });
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${ref}/manifest.json`));
  assert.equal(manifest.version, 3);
  assert.deepEqual(manifest.lyric_maker, ['甲', '固定署名', '乙', 'Editor']);
});
