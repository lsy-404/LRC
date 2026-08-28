const FLAC_SIGNATURE = [0x66, 0x4c, 0x61, 0x43];
const PICTURE_BLOCK = 6;

async function readBytes(blob, start, length) {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function matches(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

// Remove only malformed picture metadata because some browsers reject an otherwise valid FLAC stream.
export async function stripFlacPictureBlocks(blob) {
  try {
    if (!(blob instanceof Blob) || blob.size < 8 || !matches(await readBytes(blob, 0, 4), FLAC_SIGNATURE)) return blob;

    const blocks = [];
    let offset = 4;
    let last = false;
    while (!last) {
      if (offset + 4 > blob.size) return blob;
      const header = await readBytes(blob, offset, 4);
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      const end = offset + 4 + length;
      if (end > blob.size) return blob;
      blocks.push({ start: offset, end, header, type: header[0] & 0x7f });
      last = Boolean(header[0] & 0x80);
      offset = end;
    }

    const kept = blocks.filter((block) => block.type !== PICTURE_BLOCK);
    if (kept.length === blocks.length || !kept.length) return blob;

    const parts = [blob.slice(0, 4)];
    for (const [index, block] of kept.entries()) {
      const header = new Uint8Array(block.header);
      header[0] = (header[0] & 0x7f) | (index === kept.length - 1 ? 0x80 : 0);
      parts.push(header, blob.slice(block.start + 4, block.end));
    }
    parts.push(blob.slice(offset));
    return new Blob(parts, { type: blob.type || 'audio/flac' });
  } catch {
    return blob;
  }
}
