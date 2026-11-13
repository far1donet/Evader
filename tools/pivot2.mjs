import { SnowboardSim, NEUTRAL } from '../lib/sim/snowboard-sim.ts';
import { BOARDS } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { SNOW } from '../lib/sim/snow.ts';
const s = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(0, SNOW.groomed)); s.place(0, 0, Math.PI / 2, 0);
for (let i = 0; i < 300; i++) s.step({ ...NEUTRAL, edge: 0 });
s.twistK = 130; s.maxPivotTorque = 150;
const ey = () => s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0});
for (let i = 0; i < 200; i++) {
  s.step({ ...NEUTRAL, edge: 0, pivotTorque: 150 });
  if (i % 20 === 0) {
    let tq = 0; s.state.forEach((st, k) => { tq += -s.stations[k].x * st.lateralForce; });
    const u = ey(); const wb = s.board.w.x*u.x + s.board.w.y*u.y + s.board.w.z*u.z;
    console.log(`step ${i} wb ${wb.toFixed(3)} wr ${s.riderYawRate.toFixed(2)} twist ${s.riderTwist.toFixed(3)} snowYawTorque~ ${tq.toFixed(1)} maxLatF ${Math.max(...s.state.map(q => Math.abs(q.lateralForce))).toFixed(1)} fnAvg ${(s.state.reduce((a,q)=>a+q.normalForce,0)/s.diag.contacts).toFixed(0)} slipMax ${Math.max(...s.state.map(q=>Math.abs(q.slip))).toFixed(3)}`);
  }
}
