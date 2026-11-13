import { SnowboardSim, NEUTRAL, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS, DEFAULT_RIDER } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { totalL } from './angmom.mjs';
const variants = { none: {}, crouch: { crouch: 1 }, comX: { comX: 1 }, upper: { upper: 1 }, pitch: { pitch: 1 }, compact: { compact: 1 }, edge: { edge: 1 } };
for (const [name, v] of Object.entries(variants)) {
  const s = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(0), { ...DEFAULT_RIDER, cdaUpright: 0, cdaTuck: 0 });
  s.place(0, 0, 0, 0); s.board.p.y += 5; s.riderP.y += 5; s.board.v.y = 3; s.riderV.y = 3; s.board.L.y = 8; s.board.L.z = 3; s.board.refresh();
  const L0 = totalL(s); let maxErr = 0;
  for (let i = 0; i < 960; i++) { const t = i * SIM_DT; s.step({ ...NEUTRAL, edge: v.edge ? .3 * Math.sin(t * 6) : NaN, crouch: v.crouch ? .3 + .4 * Math.sin(t * 9) : .3, comX: v.comX ? .15 * Math.sin(t * 7) : 0, upperTorque: v.upper ? 80 * Math.sin(t * 5) : 0, boardPitchTorque: v.pitch ? 120 * Math.sin(t * 4) : 0, compact: v.compact ? .5 + .5 * Math.sin(t * 3) : 0 }); const L = totalL(s); maxErr = Math.max(maxErr, Math.hypot(L.x - L0.x, L.y - L0.y, L.z - L0.z)); }
  console.log(`${name.padEnd(8)} drift ${maxErr.toFixed(4)}`);
}
