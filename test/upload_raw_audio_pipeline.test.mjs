import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('UploadBox keeps the selected audio file intact and does not load browser transcoding', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /MediaBunny|audioCompressor|compressAudioFile|uploadMetadata/);
  assert.match(source, /files: items\.value\.map\(\(i\) => \(\{ n: i\.n, path: i\.relPath, size: i\.size \}\)\)/);
  await assert.rejects(stat(new URL('../docs/.vuepress/components/audioCompressor.js', import.meta.url)));
});

test('Container configuration uses basic capacity for audio preparation', async () => {
  const config = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"instance_type": "basic"/);
});
