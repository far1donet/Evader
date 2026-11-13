import { SnowboardSim, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { SNOW } from '../lib/sim/snow.ts';
import { RiderController, IDLE_INTENT } from '../lib/sim/rider-controller.ts';
export function rig(deg = 12, mat = 'groomed', assist = 'balanced', speed = 8) {
  const sim = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(deg * Math.PI / 180, SNOW[mat]));
  const ctl = new RiderController(); ctl.assist = assist; sim.place(0, 0, Math.PI / 2, speed);
  return { sim, ctl };
}
export function run({ sim, ctl }, secs, intentFn, probe) {
  const n = Math.round(secs / SIM_DT); let air = 0;
  for (let i = 0; i < n; i++) { const t = i * SIM_DT; const g = sim.diag.contacts > 0 || air < .04; sim.step(ctl.update(sim, intentFn(t), g, SIM_DT)); air = sim.diag.contacts ? 0 : air + SIM_DT; probe?.(t, sim, ctl); }
}
if (process.argv[1].endsWith('bench.mjs')) {
  for (const speed of [6, 8, 10, 12, 16]) for (const steer of [0, .3, .6, 1]) for (const assist of ['authentic', 'balanced']) {
    const r = rig(12, 'groomed', assist, speed); let worst = 0, minUp = 1, maxBL = 0;
    run(r, 2.5, () => ({ ...IDLE_INTENT, steer }), (t, s, c) => { if (t > .5) { worst = Math.max(worst, Math.abs(c.slipAngle(s))); maxBL = Math.max(maxBL, s.balanceLoad); minUp = Math.min(minUp, s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0}).y); } });
    console.log(`v${speed} steer${steer} ${assist.padEnd(9)} worstSlip ${(worst*57.3).toFixed(0).padStart(3)}deg  minUp ${minUp.toFixed(2)} maxBL ${maxBL.toFixed(2)} endV ${r.sim.speed.toFixed(1)}`);
  }
}
