import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const r = rig(3, 'groomed', 'balanced', 8); let k = 0;
run(r, 2.2, t => ({ ...IDLE_INTENT, crouch: t > 1 && t < 1.4 ? 1 : 0, wind: t > .6 && t < 1.4 ? 1 : 0 }), (t, s, c) => {
  if (t < 1.25 || k++ % 24) return;
  const ey = s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0});
  const wb = s.board.w.x*ey.x + s.board.w.y*ey.y + s.board.w.z*ey.z;
  const Lb = s.board.L.x*ey.x + s.board.L.y*ey.y + s.board.L.z*ey.z, Lr = s.riderYawInertia * s.riderYawRate;
  console.log(`t${t.toFixed(3)} c${s.diag.contacts} pop:${c.pop} unw ${c.unwindTimer.toFixed(2)} upper ${c.cmd.upperTorque.toFixed(0)} pivot ${c.cmd.pivotTorque.toFixed(0)} twist ${s.riderTwist.toFixed(2)} wb ${wb.toFixed(2)} wr ${s.riderYawRate.toFixed(2)} Lb ${Lb.toFixed(1)} Lr ${Lr.toFixed(1)} Ltot ${(Lb+Lr).toFixed(1)}`);
});
