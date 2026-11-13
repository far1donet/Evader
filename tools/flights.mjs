import { COURSES, center } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
import { kickerAt as K } from '../lib/park-jumps.ts';
const course = COURSES[+process.argv[2] || 1];
const g = makeRealityGame(course, 'slopestyle', { assistLevel: 'balanced' });
const ride = g.reality, tr = ride.tricks; let wasAir = false, take = null, n = 0;
const origUpd = tr.update.bind(tr);
while (g.state === 'ride' && n++ < 120 * 300) {
  const look = center(g.d + 18, course) - g.x;
  g.keys.clear(); if (look > 1.5) g.keys.add('KeyD'); if (look < -1.5) g.keys.add('KeyA'); if (g.speed > 19) g.keys.add('KeyS');
  const before = g.log.length;
  g.update(1 / 120);
  if (tr.airborne && !wasAir) { const k = K(g.d, course); take = { d: g.d.toFixed(0), kick: k.exists && g.d - k.base < k.profile.lip + 3 ? `k${k.profile.rise}` : '-', v: g.speed.toFixed(1), vy: g.vy.toFixed(1), wz: (ride.sim.board.w.x*ride.sim.board.dirToWorld({x:0,y:0,z:1},{x:0,y:0,z:0}).x + ride.sim.board.w.y*ride.sim.board.dirToWorld({x:0,y:0,z:1},{x:0,y:0,z:0}).y + ride.sim.board.w.z*ride.sim.board.dirToWorld({x:0,y:0,z:1},{x:0,y:0,z:0}).z).toFixed(2) }; }
  for (const e of g.log.slice(before)) if (e.type !== 'takeoff') console.log(e.type, e.kind ?? e.name, e.landing ?? '', 'take', JSON.stringify(take), 'air', tr.airTime.toFixed(2), 'pitch', (tr.pitch*57.3).toFixed(0), 'roll', (tr.roll*57.3).toFixed(0), 'spin', (tr.spin*57.3).toFixed(0), 'at d', g.d.toFixed(0));
  wasAir = tr.airborne;
}
