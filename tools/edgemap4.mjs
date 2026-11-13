import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const edges = [.08,.15,.2,.3,.4,.5,.6,.7,.8,.9,1.0];
const [tau, show] = [+process.argv[2], process.argv[3]];
let fails = 0, hops = 0;
for (const v of [3,5,7,9,11,13,15,18,22]) {
  let row = '';
  for (const e of edges) {
    const r = rig(12, 'groomed', 'authentic', v); r.sim.senseTau = tau; r.ctl.copGain = 0; let worst = 0, air = 0, maxAir = 0;
    const orig = r.ctl.update.bind(r.ctl); r.ctl.update = (s, i, g, dt) => { const c = orig(s, i, g, dt); c.balance = tau > 0; return c; };
    run(r, 1.6, () => ({ ...IDLE_INTENT, steer: e }), (t, s, c) => { if (t > .4) worst = Math.max(worst, Math.abs(c.slipAngle(s))); air = s.diag.contacts ? 0 : air + 1/960; maxAir = Math.max(maxAir, air); });
    if (worst > .35) fails++; if (maxAir > .03) hops++;
    row += ((worst * 57.3).toFixed(0) + (maxAir > .03 ? 'h' : ' ')).padStart(5);
  }
  if (show) console.log(String(v).padEnd(4) + row);
}
console.log('balance tau', tau, 'fails', fails, 'hops', hops);
