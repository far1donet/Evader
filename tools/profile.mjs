import { COURSES, center, height } from '../lib/snow-game.ts';
const c = COURSES[+(process.argv[2] ?? 1)], line = center(123, c);
let prev = height(line, 60, c), prevS = 0;
for (let d = 60; d <= 145; d += 2.5) { const h = height(line, d, c); const s = (h - prev) / 2.5; console.log(`d ${d.toFixed(1)} h ${h.toFixed(2)} slope ${(Math.atan(s)*57.3).toFixed(1)}° curv ${((s - prevS)/2.5).toFixed(3)}`); prev = h; prevS = s; }
