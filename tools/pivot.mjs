import { SnowboardSim, NEUTRAL, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { SNOW } from '../lib/sim/snow.ts';
for (const speed of [0, 4, 12]) for (const crouch of [.3, -.25]) {
  const s = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(8 * Math.PI / 180, SNOW.groomed)); s.place(0, 0, Math.PI / 2, speed);
  for (let i = 0; i < 300; i++) s.step({ ...NEUTRAL, edge: 0 });
  s.twistK = 130; s.maxPivotTorque = 150;
  const yaw = () => { const e = s.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}); return Math.atan2(-e.z, e.x); };
  const y0 = yaw(); let sumT = 0, n = 0;
  for (let i = 0; i < 480; i++) { s.step({ ...NEUTRAL, edge: 0, pivotTorque: 150, crouch }); }
  console.log(`speed ${speed} crouch ${crouch}: board yaw ${((yaw() - y0) * 57.3).toFixed(1)} deg, twist ${s.riderTwist.toFixed(2)}, contacts ${s.diag.contacts}`);
}
