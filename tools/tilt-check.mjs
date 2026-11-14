// Emulated phone (landscape, touch): tilt + gesture controls, and the fallback to buttons when no tilt sensor answers.
import { createRequire } from 'node:module'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const root = path.resolve('out'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { let p = q.url.split('?')[0].slice(6) || 'index.html'; fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); r.end(d); } }); }).listen(4183);
const b = await chromium.launch({ args: ['--use-angle=swiftshader'] });
async function run(withSensor) {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  if (withSensor) await page.addInitScript(() => { window.__tilt = { beta: 40, gamma: 0 }; setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: window.__tilt.beta, gamma: window.__tilt.gamma })), 30); });
  await page.goto('http://127.0.0.1:4183/play/?debug=1');
  await page.waitForSelector('button.drop-button:not([disabled])', { timeout: 180000, state: 'attached' });
  await page.locator('button.drop-button').first().scrollIntoViewIfNeeded(); await page.tap('button.drop-button:not([disabled])');
  await page.waitForTimeout(3500);
  const st = () => page.evaluate(() => { const g = window.evaderDebug; return { steer: +g.intent.steer.toFixed(2), lean: +g.intent.lean.toFixed(2), crouch: g.intent.crouch, wind: +g.intent.wind.toFixed(2), grab: g.intent.grab, air: !g.ground, edgeDeg: +(g.reality.sim.edgeAngle * 57.3).toFixed(0), angle: screen.orientation?.angle, gs: +g.gesture.steer.toFixed(2), gl: +g.gesture.lean.toFixed(2), crashed: g.reality.crashed, kind: g.reality.crashKind, t: +g.time.toFixed(1) }; });
  const ui = await page.evaluate(() => ({ gestureLayer: !!document.querySelector('.gesture-layer'), buttons: document.querySelectorAll('.touch-controls button').length, stick: !!document.querySelector('.touch-stick'), notice: document.querySelector('.notification')?.textContent ?? '' }));
  console.log(withSensor ? '== with tilt sensor' : '== no tilt sensor', JSON.stringify(ui));
  if (!withSensor) { await ctx.close(); return errors; }
  console.log('level phone      ', JSON.stringify(await st()));
  await page.evaluate(() => { window.__tilt.beta = 25; }); await page.waitForTimeout(1200); console.log('beta 25 (side)   ', JSON.stringify(await st()));
  await page.evaluate(() => { window.__tilt.beta = 55; }); await page.waitForTimeout(1200); console.log('beta 55 (side)   ', JSON.stringify(await st()));
  await page.evaluate(() => { window.__tilt.beta = 40; window.__tilt.gamma = -12; }); await page.waitForTimeout(1200); console.log('gamma -12 (pitch)', JSON.stringify(await st()));
  await page.evaluate(() => { window.__tilt.gamma = 0; }); await page.waitForTimeout(800);
  await page.evaluate(() => { window.__tilt.beta = 40; }); await page.waitForTimeout(800);
  await page.mouse.move(600, 200); await page.mouse.down(); { const t0 = (await st()).t; while ((await st()).t - t0 < .45) await page.waitForTimeout(50); } console.log('hold screen      ', JSON.stringify(await st()));
  await page.mouse.move(690, 200, { steps: 5 }); await page.waitForTimeout(600); console.log('drag right       ', JSON.stringify(await st()));
  await page.mouse.up(); let air = false; const t0 = (await st()).t; for (let i = 0; i < 400 && !air; i++) { await page.waitForTimeout(50); const q = await st(); air = q.air; if (q.t - t0 > 1.5) break; }
  console.log('lift -> airborne ', air);
  if (air) { await page.mouse.move(200, 200); await page.mouse.down(); for (let i = 0; i < 100; i++) { await page.waitForTimeout(50); if ((await st()).grab || !(await st()).air) break; } console.log('touch in air     ', JSON.stringify(await st())); await page.mouse.up(); }
  await page.screenshot({ path: 'docs/screenshots/phone/05-tilt-mode.png', timeout: 120000 });
  await ctx.close(); return errors;
}
const e1 = await run(true), e2 = [];
console.log('errors:', [...e1, ...e2].join('\n') || 'none');
await b.close(); server.close();
