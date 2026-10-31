// Serves public/ the way the published site does (gzip, extension-less /apex/ paths fall back to the page) so the
// end-to-end tests measure what visitors download. Usage: node scripts/serve-static.mjs [port]
import {createServer} from 'node:http';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {createGzip} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.argv[2] || 54140);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml'};
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml']);

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file) && url.pathname.startsWith('/apex/') && !path.extname(url.pathname)) file = path.join(root, 'apex', 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found'); return; }
  const ext = path.extname(file), headers = {'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache'};
  const stream = createReadStream(file);
  if (compressible.has(ext) && /\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
    response.writeHead(200, {...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding'});
    stream.pipe(createGzip({level: 6})).pipe(response);
  } else { response.writeHead(200, headers); stream.pipe(response); }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://127.0.0.1:${port}/apex/`));
