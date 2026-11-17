// Screenshots of the model viewer shots. Run: node tools/dev/viewer/shoot.mjs <out dir> [shot,shot,...]
import { createRequire } from 'node:module'; import { spawn } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(path.resolve('package.json')); const { chromium } = require('playwright');
// shots: one argument with comma-separated model shots, or several arguments (world shots: 'world:<station>,fx,cam=low')
const out = process.argv[2] ?? 'viewer-shots', rest = process.argv.slice(3);
const shots = rest.length > 1 || rest[0]?.startsWith('world:') ? rest : (rest[0] ?? 'chair,gondola,cablecar,tower,station-chair,station-gondola,mixed,chalet,village').split(',');
fs.mkdirSync(out, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 500), srv = spawn(process.execPath, ['--no-warnings', 'tools/dev/viewer/server.mjs', String(port)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 700));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const s of shots) {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } }), errs = [];
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    const world = s.startsWith('world:'), hash = world ? s.slice(6) : s;
    await page.goto(`http://127.0.0.1:${port}/tools/dev/viewer/${world ? 'free' : 'index'}.html#${hash}`);
    try { await page.waitForFunction(() => window.__ready, null, { timeout: world ? 900000 : 120000 }); } catch { errs.push('timeout'); }
    await page.screenshot({ path: `${out}/${hash.replace(/[^a-z0-9.=-]+/gi, '_')}.png`, timeout: 600000 }); console.log(s, errs.join(' | ') || 'ok'); await page.close();
}
await b.close(); srv.kill();
