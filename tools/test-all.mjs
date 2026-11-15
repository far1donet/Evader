// Runs the test files in parallel (one Node process each) and reports them in order. Exit code 1 if any fails.
// The suites are independent; run alone with: node --experimental-strip-types tests/<name>.mjs
import { spawn } from 'node:child_process';
import os from 'node:os';
const files = ['physics', 'motion', 'sim', 'reality', 'verbier'];
const limit = Math.max(1, Math.min(files.length, os.cpus().length));
const t0 = Date.now(), results = new Map();
const run = name => new Promise(done => {
    const started = Date.now(), p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', `tests/${name}.mjs`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', code => { results.set(name, { code, out, s: (Date.now() - started) / 1000 }); console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name} (${((Date.now() - started) / 1000).toFixed(0)} s)`); done(); });
});
// longest first, so the slow Verbier suite starts at once
const queue = [...files].reverse(); const workers = Array.from({ length: limit }, async () => { while (queue.length) await run(queue.shift()); });
await Promise.all(workers);
let failed = 0;
for (const name of files) { const r = results.get(name); if (r.code !== 0) { failed++; console.log(`\n==== ${name} ====\n${r.out}`); } }
console.log(`\n${files.length - failed}/${files.length} suites passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
