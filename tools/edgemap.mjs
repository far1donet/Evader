import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const edges = [.08,.15,.2,.3,.4,.5,.6,.7,.8,.9,1.0];
console.log('v   ' + edges.map(e => e.toFixed(2).padStart(5)).join(''));
for (const v of [3,5,7,9,11,13,15,18,22]) {
  let row = '';
  for (const e of edges) {
    const r = rig(12, 'groomed', 'authentic', v); let worst = 0;
    run(r, 1.6, () => ({ ...IDLE_INTENT, steer: e / 1.0 }), (t, s, c) => { if (t > .4) worst = Math.max(worst, Math.abs(c.slipAngle(s))); });
    row += (worst * 57.3).toFixed(0).padStart(5);
  }
  console.log(String(v).padEnd(4) + row);
}
