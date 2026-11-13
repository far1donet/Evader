import { COURSES } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const g = makeRealityGame(COURSES[0], 'freeride', {}); const r = g.reality, s = r.sim;
const seq = [[3, []], [.45, ['Space']], [1.2, []]];
let t = 0;
for (const [dur, keys] of seq) {
  g.keys.clear(); keys.forEach(k => g.keys.add(k));
  for (let i = 0; i < Math.round(dur * 120); i++) { g.update(1 / 120); t += 1 / 120; if (t > 3.2 && i % 4 === 0) console.log(`t ${t.toFixed(2)} keys ${keys.join('+').padEnd(6)} crouchIntent ${g.intent.crouch} pop ${r.ctl.pop} cmdCrouch ${r.ctl.cmd.crouch.toFixed(2)} leg ${s.legAxial.toFixed(0)} len ${r.ctl.legLength(s).toFixed(3)} c ${s.diag.contacts} gap ${r.ctl.gapBelow(s).toFixed(3)} air ${r.tricks.airborne} vy ${s.board.v.y.toFixed(2)} riderVy ${s.riderV.y.toFixed(2)}`); }
}
