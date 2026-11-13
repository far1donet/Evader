import { COURSES } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const g = makeRealityGame(COURSES[0], 'freeride', {}); const r = g.reality;
const seq = [[1.5, []], [.9, ['KeyD']], [.9, ['KeyA']], [.45, ['KeyE', 'Space']], [.12, ['KeyE']], [1.06, ['ShiftLeft']], [1.5, ['KeyS']], [3, []]];
let t = 0;
for (const [dur, keys] of seq) {
  g.keys.clear(); keys.forEach(k => g.keys.add(k));
  for (let i = 0; i < Math.round(dur * 120); i++) { g.update(1 / 120); t += 1 / 120; if (i % (t > 3.3 && t < 4.3 ? 3 : 24) === 0) console.log(`t ${t.toFixed(2)} keys ${keys.join('+').padEnd(14)} v ${(g.speed*3.6).toFixed(0)} slip ${(r.ctl.slipAngle(r.sim)*57.3).toFixed(0)} trav ${r.ctl.travelSign} twist ${r.sim.riderTwist.toFixed(2)} pivot ${r.ctl.cmd.pivotTorque.toFixed(0)} upper ${(r.ctl.cmd.upperTorque??0).toFixed(0)} pop ${r.ctl.pop} wp ${r.ctl.windPrep} air ${r.tricks.airborne} brake ${r.ctl.braking} dug ${r.ctl.brakeDug} K ${r.sim.twistK}`); }
}
console.log(g.log.map(e => e.type + ':' + (e.kind ?? e.name) + (e.landing ? '/' + e.landing : '')).join(' '));
