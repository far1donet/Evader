import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const r = rig(8, 'groomed', 'balanced', 12); let k = 0;
run(r, 5, t => ({ ...IDLE_INTENT, brake: t > .3 ? 1 : 0 }), (t, s, c) => { if (k++ % 48) return;
  console.log(`t${t.toFixed(1)} v ${s.speed.toFixed(1)} slip ${(c.slipAngle(s)*57.3).toFixed(0)} edge ${(s.edgeAngle*57.3).toFixed(0)} cmdEdge ${(c.cmd.edge*57.3).toFixed(0)} unw ${c.brakeUnweight} dug ${c.brakeDug} K ${s.twistK} crouch ${c.cmd.crouch.toFixed(2)} yawB ${(Math.atan2(-s.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}).z, s.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}).x)*57.3).toFixed(0)} pivot ${c.cmd.pivotTorque.toFixed(0)} trav ${c.travelSign} twist ${s.riderTwist.toFixed(2)} bl ${s.balanceLoad.toFixed(1)} c ${s.diag.contacts}`); });
