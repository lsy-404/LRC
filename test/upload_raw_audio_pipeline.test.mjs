import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Container configuration uses basic capacity for audio preparation', async () => {
  const config = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"instance_type": "basic"/);
});
