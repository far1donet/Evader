// Screenshots of the model viewer shots. Run: node tools/dev/viewer/shoot.mjs <out dir> [shot,shot,...]
import { createRequire } from 'node:module'; import { spawn } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
const require = createRequire(path.resolve('package.json')); const { chromium } = require('playwright');
const out = process.argv[2] ?? 'viewer-shots', shots = (process.argv[3] ?? 'chair,gondola,cablecar,tower,station-chair,station-gondola,mixed,chalet,village').split(',');
fs.mkdirSync(out, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 500), srv = spawn(process.execPath, ['--no-warnings', 'tools/dev/viewer/server.mjs', String(port)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 700));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const s of shots) {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } }), errs = [];
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/tools/dev/viewer/index.html#${s}`);
    try { await page.waitForFunction(() => window.__ready, null, { timeout: 120000 }); } catch { errs.push('timeout'); }
    await page.screenshot({ path: `${out}/${s}.png` }); console.log(s, errs.join(' | ') || 'ok'); await page.close();
}
await b.close(); srv.kill();
