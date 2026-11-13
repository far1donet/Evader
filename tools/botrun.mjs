import { COURSES } from '../lib/snow-game.ts';
import { makeRealityGame, botIntent } from './gamebot.mjs';
const opts = { kickSpeed: +(process.argv[3] || 13), grab: process.argv[4] === 'grab' };
for (const course of COURSES) {
  const g = makeRealityGame(course, 'slopestyle', { assistLevel: process.argv[2] || 'balanced' });
  g.readIntent = () => { Object.assign(g.intent, botIntent(g, opts)); return g.intent; };
  let n = 0, maxV = 0;
  while (g.state === 'ride' && n++ < 120 * 600) { g.update(1 / 120); maxV = Math.max(maxV, g.speed); }
  const by = t => g.log.filter(e => e.type === t);
  console.log(course.name, JSON.stringify({ time: +g.time.toFixed(1), maxKmh: +(maxV * 3.6).toFixed(0), score: g.score, crashes: by('crash').map(e => e.kind), landed: by('landed').map(e => `${e.name}/${e.landing}/${e.air.toFixed(2)}`) }));
}
