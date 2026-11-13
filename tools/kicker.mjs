import { COURSES, center } from '../lib/snow-game.ts';
import { kickerAt } from '../lib/park-jumps.ts';
import { makeRealityGame } from './gamebot.mjs';
const course = COURSES[+(process.argv[2] ?? 1)];
const k = kickerAt(+(process.argv[3] ?? 100), course), lip = k.base + k.profile.lip, line = center(lip, course);
console.log('kicker', JSON.stringify(k.profile), 'lip at', lip);
for (const v of [8, 10, 12, 14, 16, 18]) for (const pop of [false, true]) {
  const g = makeRealityGame(course, 'slopestyle', {});
  const ride = g.reality; ride.place(line, k.base - 25, v); g.syncReality(1/120);
  let take = null, n = 0, pitchMax = 0, out = null;
  g.readIntent = () => { const i = g.intent; Object.assign(i, { steer: Math.max(-1, Math.min(1, (line - g.x) * .08 - ride.sim.board.v.x * .22)), lean: 0, wind: 0, crouch: pop && g.d > lip - 5 && g.d < lip - .8 ? 1 : 0, brake: 0, tuck: false, grab: false, flip: 0 }); return i; };
  while (n++ < 120 * 8 && !out) {
    g.update(1 / 120);
    if (!take && ride.tricks.airborne) take = { d: g.d.toFixed(1), vy: ride.sim.board.v.y.toFixed(1), v: g.speed.toFixed(1) };
    pitchMax = Math.max(pitchMax, Math.abs(ride.tricks.pitch));
    for (const e of g.log) if (e.type === 'landed' || e.type === 'crash') out = e;
  }
  console.log(`v0 ${v} pop ${pop}: take ${JSON.stringify(take)} -> ${out ? (out.type === 'crash' ? 'CRASH ' + out.kind : out.landing + ' air ' + out.air.toFixed(2)) : 'none'} at d ${g.d.toFixed(1)} (knuckle ${k.base + k.profile.knuckle}, runout ${k.base + k.profile.runout}) pitchMax ${(pitchMax*57.3).toFixed(0)}`);
}
