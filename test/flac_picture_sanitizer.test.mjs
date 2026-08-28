import test from 'node:test';
import assert from 'node:assert/strict';
import { stripFlacPictureBlocks } from '../docs/.vuepress/lib/flac.js';

const bytes = (...values) => new Uint8Array(values);
const block = (type, payload, last = false) => bytes((last ? 0x80 : 0) | type, 0, 0, payload.length, ...payload);
const array = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('FLAC 图片块会移除，最后一个保留元数据块正确标记，音频帧尾保持原样', async () => {
  const streamInfo = block(0, bytes(1, 2, 3));
  const comment = block(4, bytes(4, 5));
  const picture = block(6, bytes(9, 8, 7), true);
  const frames = bytes(0xff, 0xf8, 0x55, 0xaa, 0x42);
  const input = new Blob([bytes(0x66, 0x4c, 0x61, 0x43), streamInfo, comment, picture, frames], { type: 'audio/flac' });
  const output = await stripFlacPictureBlocks(input);
  assert.equal(output.type, 'audio/flac');
  assert.deepEqual(await array(output), bytes(0x66, 0x4c, 0x61, 0x43, ...block(0, bytes(1, 2, 3)), ...block(4, bytes(4, 5), true), ...frames));
});

test('没有图片的 FLAC 和非 FLAC 均保持原 Blob 不变', async () => {
  const flac = new Blob([bytes(0x66, 0x4c, 0x61, 0x43), block(0, bytes(1), true), bytes(0xff, 0xf8)], { type: 'audio/flac' });
  const mp3 = new Blob([bytes(0x49, 0x44, 0x33, 0x04)], { type: 'audio/mpeg' });
  assert.equal(await stripFlacPictureBlocks(flac), flac);
  assert.equal(await stripFlacPictureBlocks(mp3), mp3);
});

test('截断的 FLAC 元数据安全保留原 Blob', async () => {
  const truncated = new Blob([bytes(0x66, 0x4c, 0x61, 0x43, 0x86, 0, 0, 4, 1)], { type: 'audio/flac' });
  assert.equal(await stripFlacPictureBlocks(truncated), truncated);
});
