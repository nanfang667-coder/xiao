import http from 'node:http';
import { readFile } from 'node:fs/promises';

// Only explicit demo assets are exposed; no project files or database access.
const assets = new Map([
  ['/go/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/go/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/go/entry.mjs', ['entry.mjs', 'text/javascript; charset=utf-8']],
]);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const asset = assets.get(url.pathname);
  if (!asset || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end('Not Found');
    return;
  }
  try {
    const body = await readFile(new URL(asset[0], import.meta.url));
    res.writeHead(200, {
      'Content-Type': asset[1], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500).end('Unable to load preview');
  }
}).listen(8765, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:8765/go/index.html?code=NVG&preview=1'));
