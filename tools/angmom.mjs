import { SnowboardSim, NEUTRAL, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { cross, dot } from '../lib/sim/math3.ts';
export function totalL(s) {
  const b = s.board, mb = b.mass, mr = s.rider.mass, M = mb + mr;
  const c = { x: (mb * b.p.x + mr * s.riderP.x) / M, y: (mb * b.p.y + mr * s.riderP.y) / M, z: (mb * b.p.z + mr * s.riderP.z) / M };
  const rb = { x: b.p.x - c.x, y: b.p.y - c.y, z: b.p.z - c.z }, rr = { x: s.riderP.x - c.x, y: s.riderP.y - c.y, z: s.riderP.z - c.z };
  const lb = cross(rb, { x: mb * b.v.x, y: mb * b.v.y, z: mb * b.v.z }), lr = cross(rr, { x: mr * s.riderV.x, y: mr * s.riderV.y, z: mr * s.riderV.z });
  const ey = b.dirToWorld({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }), ez = b.dirToWorld({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 });
  const fy = s.riderYawInertia * s.riderYawRate, fp = s.bodyPitchInertia * s.bodyPitchRate;
  return { x: b.L.x + lb.x + lr.x + ey.x * fy + ez.x * fp, y: b.L.y + lb.y + lr.y + ey.y * fy + ez.y * fp, z: b.L.z + lb.z + lr.z + ey.z * fy + ez.z * fp };
}
if (process.argv[1].endsWith('angmom.mjs')) for (const react of [false, true]) {
  const s = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(0)); s.legMomentReaction = react;
  s.place(0, 0, 0, 0); s.board.p.y += 5; s.riderP.y += 5; s.board.v.y = 3; s.riderV.y = 3; s.board.L.y = 8; s.board.L.z = 3; s.board.refresh();
  const L0 = totalL(s); let maxErr = 0;
  for (let i = 0; i < 960; i++) { const t = i * SIM_DT; s.step({ ...NEUTRAL, edge: 0, crouch: .3 + .4 * Math.sin(t * 9), comX: .15 * Math.sin(t * 7), upperTorque: 80 * Math.sin(t * 5), boardPitchTorque: 120 * Math.sin(t * 4), compact: .5 + .5 * Math.sin(t * 3) }); const L = totalL(s); maxErr = Math.max(maxErr, Math.hypot(L.x - L0.x, L.y - L0.y, L.z - L0.z)); }
  console.log(`legMomentReaction ${react}: |L0| ${Math.hypot(L0.x, L0.y, L0.z).toFixed(2)} N m s, max drift over 1 s of flight ${maxErr.toFixed(4)} N m s`);
}
