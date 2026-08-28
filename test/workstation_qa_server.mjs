import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/.vuepress/dist/', import.meta.url));
const port = Number(process.argv[2]) || 4174;

const timestamp = (ms) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

const characters = Array.from('悸动仍在此刻发亮');
const lines = [];
const lrc = [];
const klrc = [];
for (let row = 0; row < 180; row += 1) {
  const text = Array.from({ length: 12 }, (_, index) => characters[(row + index) % characters.length]).join('');
  const start = row * 4000;
  lines.push(text);
  lrc.push(`[${timestamp(start)}]${text}`);
  klrc.push(`[${timestamp(start)}]${Array.from(text).map((char, index) => `<${timestamp(start + index * 250)}>${char}`).join('')}`);
}

const draft = {
  meta: {},
  tracks: [{
    order: 1,
    title: '本地长歌词',
    inst: false,
    confidence: 0.96,
    coverage: 0.93,
    audio: '',
    lrc: lrc.join('\n'),
    klrc: klrc.join('\n'),
    lines,
    timing_locked: true,
  }],
  pages: [],
  cover_ext: '',
};

const json = (response, body, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  if (url.pathname === '/api/upload/verify') return json(response, { ok: true });
  if (url.pathname === '/api/ingest/list') return json(response, { pending: [{ ref: '0123456789abcdef', album: '本地压力测试' }] });
  if (url.pathname === '/api/ingest/state') return json(response, { status: 'awaiting_review', albums: [{ album: '本地压力测试', draft }] });
  if (url.pathname.startsWith('/api/')) return json(response, { ok: true });

  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const candidates = [relative || 'index.html'];
  if (!extname(relative)) candidates.push(`${relative}.html`, join(relative, 'index.html'));
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (!path.startsWith(root)) continue;
    try {
      if (!(await stat(path)).isFile()) continue;
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': contentTypes[extname(path)] || 'application/octet-stream' });
      response.end(body);
      return;
    } catch { /* try the next candidate */ }
  }
  response.writeHead(404);
  response.end('Not found');
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`workstation QA server listening on ${port}\n`);
});
