import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
for (const [v, deg, brake, steer] of [[8, 8, 1, 0], [12, 8, 1, 0], [15, 10, 1, 0], [15, 10, .5, 0], [12, 8, 1, .6], [12, 8, 1, -.6]]) {
  const r = rig(deg, 'groomed', 'balanced', v); let tStop = -1, maxSlip = 0, minUp = 1, dist = 0, air = 0;
  run(r, 12, t => ({ ...IDLE_INTENT, brake: t > .3 ? brake : 0, steer }), (t, s, c) => { maxSlip = Math.max(maxSlip, Math.abs(c.slipAngle(s))); minUp = Math.min(minUp, s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0}).y); if (tStop < 0 && s.speed < .6 && t > .3) { tStop = t; dist = -s.board.p.z; } air = Math.max(air, s.diag.contacts ? 0 : air); });
  console.log(`v${v} slope${deg} brake${brake} steer${steer}: stop at ${tStop.toFixed(2)}s, ${dist.toFixed(1)} m, maxSlip ${(maxSlip*57.3).toFixed(0)}, minUp ${minUp.toFixed(2)}, endV ${r.sim.speed.toFixed(2)} x ${r.sim.board.p.x.toFixed(1)}`);
}
