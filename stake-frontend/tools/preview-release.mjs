import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the built files at a CDN-like subpath. No dev-server transforms.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.mp3':'audio/mpeg'};
http.createServer((req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1');
    if (!url.pathname.startsWith('/candidate/')) { res.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice('/candidate/'.length)) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'content-type':types[path.extname(file)] ?? 'application/octet-stream','cache-control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400).end(); }
}).listen(5177,'127.0.0.1',()=>console.log('Production preview: http://127.0.0.1:5177/candidate/'));
