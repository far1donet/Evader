import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const edges = [.08,.15,.2,.3,.4,.5,.6,.7,.8,.9,1.0];
const [rate, gain, cg] = [+process.argv[2], +process.argv[3], +process.argv[5]];
let fails = 0;
for (const v of [3,5,7,9,11,13,15,18,22]) {
  let row = '';
  for (const e of edges) {
    const r = rig(12, 'groomed', 'authentic', v); r.sim.maxEdgeRate = rate; r.ctl.copGain = cg; let worst = 0;
    const orig = r.ctl.update.bind(r.ctl);
    r.ctl.update = (s, i, g, dt) => { const c = orig(s, i, g, dt); c.pivotTorque *= gain; return c; };
    r.sim.maxPivotTorque = 60 * gain;
    run(r, 1.6, () => ({ ...IDLE_INTENT, steer: e }), (t, s, c) => { s.maxPivotTorque = 60 * gain; if (t > .4) worst = Math.max(worst, Math.abs(c.slipAngle(s))); });
    if (worst > .35) fails++;
    row += (worst * 57.3).toFixed(0).padStart(5);
  }
  if (process.argv[4]) console.log(String(v).padEnd(4) + row);
}
console.log("rate", rate, "gain", gain, "copGain", cg, "fails", fails);
