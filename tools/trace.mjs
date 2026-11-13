import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const [v, e] = [+process.argv[2], +process.argv[3]];
const r = rig(12, 'groomed', 'authentic', v); let k = 0;
run(r, 1.6, () => ({ ...IDLE_INTENT, steer: e }), (t, s, c) => {
  if (k++ % 48) return;
  const ey = s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0});
  const front = s.state.filter((q, i) => q.contact && s.stations[i].x > 0).length, back = s.state.filter((q, i) => q.contact && s.stations[i].x < 0).length;
  const latF = s.state.filter((q, i) => s.stations[i].x > 0).reduce((a, q) => a + q.lateralForce, 0), latB = s.state.filter((q, i) => s.stations[i].x < 0).reduce((a, q) => a + q.lateralForce, 0);
  console.log(`t${t.toFixed(2)} slip ${(c.slipAngle(s)*57.3).toFixed(1).padStart(6)} edge ${s.edgeAngle.toFixed(2)} wy ${(s.board.w.x*ey.x+s.board.w.y*ey.y+s.board.w.z*ey.z).toFixed(2).padStart(6)} pivot ${c.cmd.pivotTorque.toFixed(0).padStart(4)} twist ${s.riderTwist.toFixed(2)} cF${front} cB${back} latF ${latF.toFixed(0).padStart(6)} latB ${latB.toFixed(0).padStart(6)} leg ${s.legAxial.toFixed(0)} v ${s.speed.toFixed(1)}`);
});
