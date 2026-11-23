// Static server that behaves like Netlify / Cloudflare Pages / Firebase "pretty URLs":
// /index.html  →  308 redirect to  /     (also optionally 404 for chosen paths, to simulate a flaky host)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), port = Number(process.argv[3] || 8777);
const miss = (process.env.MISS || '').split(',').filter(Boolean);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream', '.bcmap': 'application/octet-stream', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/index.html') { res.writeHead(308, { Location: '/' }); return res.end(); }
  if (miss.some(m => u.includes(m))) { res.writeHead(404); return res.end('nope'); }
  if (u === '/') u = '/index.html';
  const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('listening', port));
