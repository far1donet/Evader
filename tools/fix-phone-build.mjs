// Post-process the static phone build: write literal U+FFFD characters in JS/CSS as the escape � (same value,
// pure-ASCII file), so hosts that reject replacement characters accept the files.
import fs from 'node:fs'; import path from 'node:path';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let n = 0;
for (const f of walk('out')) if (/\.(js|css)$/.test(f)) { const s = fs.readFileSync(f, 'utf8'); if (s.includes('�')) { fs.writeFileSync(f, s.replaceAll('�', '\\ufffd')); n++; } }
console.log(`fix-phone-build: ${n} file(s) escaped`);
