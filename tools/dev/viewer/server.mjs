// Dev-only model viewer server: serves the repo, with lib/*.ts stripped of types on the fly, so a plain browser page can
// import the game's own modules (lift vehicles, towers, stations, buildings) and render them close up.
// Run: node tools/dev/viewer/server.mjs [port]   then open http://127.0.0.1:<port>/tools/dev/viewer/index.html
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { stripTypeScriptTypes } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'), PORT = +(process.argv[2] ?? 4321);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png' };
http.createServer((q, r) => {
    let url = decodeURIComponent(q.url.split('?')[0]);
    if (url.includes('/resort/')) url = '/public/resort/' + url.split('/resort/')[1];   // the game fetches resort/... relative to the page
    const p = path.join(ROOT, url);
    if (!p.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
    fs.readFile(p, (e, d) => {
        if (e) { r.writeHead(404); return r.end(); }
        let body = d;
        if (p.endsWith('.ts')) { try { body = stripTypeScriptTypes(d.toString(), { mode: 'strip' }); } catch (err) { r.writeHead(500); return r.end(String(err)); } }
        r.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); r.end(body);
    });
}).listen(PORT, () => console.log(`viewer on http://127.0.0.1:${PORT}/tools/dev/viewer/index.html`));
