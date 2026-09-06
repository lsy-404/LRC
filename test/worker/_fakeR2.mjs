import { createHash } from 'node:crypto';
import { createFakeDirectory, usersBinding } from './_fakeUserDirectory.mjs';

export function authenticatedUsers({ github = null } = {}) {
  const dir = createFakeDirectory();
  const { user } = dir.createUser({ name: 'editor', display_name: 'Editor', role: 'editor' });
  if (github) dir.bindGithub(user.id, github);
  dir.createSession({ token_hash: createHash('sha256').update('test-session').digest('hex'), user_id: user.id, issued_at: Date.now(), expires_at: Date.now() + 3600000 });
  return usersBinding(dir);
}

// 内存版 R2 桶：够跑 list/get/put/delete，list 按 limit 分页以覆盖游标分支。

export function fakeBucket(init = {}) {
  const store = new Map();
  const multipart = new Map();
  let uploadSeq = 0;
  for (const [k, v] of Object.entries(init)) {
    store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const readValue = async (value) => {
    if (value instanceof ReadableStream || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return new Response(value).text();
    }
    return String(value);
  };
  return {
    store,
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const end = start + slice.length;
      return {
        objects: slice.map((k) => ({ key: k, size: store.get(k).length })),
        truncated: end < keys.length,
        cursor: String(end),
      };
    },
    async head(key) {
      if (!store.has(key)) return null;
      return { key, size: Buffer.byteLength(store.get(key)) };
    },
    async get(key, options = {}) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      const raw = Buffer.from(value);
      const range = options?.range;
      const body = range ? raw.subarray(range.offset, range.offset + range.length) : raw;
      return {
        key, size: raw.length, body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }),
        text: async () => value,
      };
    },
    async put(key, value) {
      const text = await readValue(value);
      store.set(key, text);
      return { key, size: text.length };
    },
    async createMultipartUpload(key) {
      const uploadId = `upload-${++uploadSeq}`;
      multipart.set(uploadId, { key, parts: new Map() });
      return { key, uploadId };
    },
    resumeMultipartUpload(key, uploadId) {
      const active = () => {
        const state = multipart.get(uploadId);
        if (!state || state.key !== key) throw new Error('missing upload');
        return state;
      };
      return {
        async uploadPart(partNumber, value) {
          const state = active();
          const text = await readValue(value);
          const etag = `etag-${partNumber}-${text.length}`;
          state.parts.set(partNumber, { text, etag });
          return { partNumber, etag };
        },
        async complete(parts) {
          const state = active();
          const text = parts.map(({ partNumber, etag }) => {
            const part = state.parts.get(partNumber);
            if (!part || part.etag !== etag) throw new Error('invalid part');
            return part.text;
          }).join('');
          store.set(key, text);
          multipart.delete(uploadId);
          return { key, size: text.length };
        },
        async abort() {
          active();
          multipart.delete(uploadId);
        },
      };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

export function authedRequest(url, { method = 'GET', body } = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: 'lrc_session=test-session',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
