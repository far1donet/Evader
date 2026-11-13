import { COURSES, center, height, snowDepth } from '../lib/snow-game.ts';
import { kickerAt } from '../lib/park-jumps.ts';
import { CourseTerrain } from '../lib/sim/course-terrain.ts';
import { SnowboardSim, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS } from '../lib/sim/boards.ts';
import { RiderController, IDLE_INTENT } from '../lib/sim/rider-controller.ts';
const course = COURSES[+process.argv[2] || 0], assist = process.argv[3] || 'balanced';
const fns = { height: (x, d) => height(x, d, course), snowDepth: (x, d) => snowDepth(x, d, course), center: d => center(d, course),
  parkZone: (x, d) => { const k = kickerAt(d, course); if (!k.exists) return 0; const off = Math.abs(x - center(k.base + k.profile.lip, course)); if (off > k.profile.shoulder) return 0; const t = d - k.base; return t >= 0 && t <= k.profile.lip ? 1 : t > k.profile.lip && t <= k.profile.runout ? 2 : 0; } };
const terrain = new CourseTerrain(fns);
const sim = new SnowboardSim(BOARDS['all-mountain'], terrain);
const ctl = new RiderController(); ctl.assist = assist;
const x0 = center(5, course); sim.place(x0, -5, Math.PI / 2, 8);
let t = 0, air = 0, airMax = 0, flights = [], bl = [], maxBL = 0, t0 = performance.now(), steps = 0, lastLog = 0, airStart = 0, wasAir = false, takeoffD = 0;
const intent = { ...IDLE_INTENT };
while (t < 200) {
  const d = -sim.board.p.z, x = sim.board.p.x;
  const grounded = sim.diag.contacts > 0 || air < .05;
  const target = center(d + 15, course);
  intent.steer = Math.max(-1, Math.min(1, (target - x) * .12 - sim.board.v.x * .25));
  sim.step(ctl.update(sim, intent, grounded, SIM_DT)); steps++; t += SIM_DT;
  if (sim.diag.contacts === 0) { air += SIM_DT; if (!wasAir && air > .1) { wasAir = true; airStart = t - air; takeoffD = d; } }
  else { if (wasAir) { flights.push({ d: takeoffD.toFixed(0), air: air.toFixed(2), land: d.toFixed(0), v: sim.speed.toFixed(1), leg: sim.legAxial.toFixed(0) }); ctl.sinceLanding = 0; } wasAir = false; air = 0; }
  if (sim.diag.contacts > 0) { bl.push(sim.balanceLoad); maxBL = Math.max(maxBL, sim.balanceLoad); }
  if (t - lastLog > 10) { lastLog = t; console.log(`t=${t.toFixed(0)} d=${d.toFixed(0)} off=${(x - center(d, course)).toFixed(1)} v=${sim.speed.toFixed(1)} slip=${(ctl.slipAngle(sim)*57.3).toFixed(0)} up=${sim.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0}).y.toFixed(2)}`); }
  if (d > course.length - 12) break;
  if (!Number.isFinite(sim.board.p.y)) { console.log('NaN'); break; }
}
const ms = performance.now() - t0; bl.sort((a, b) => a - b);
console.log({ simSeconds: t.toFixed(1), msPerSimSecond: (ms / t).toFixed(1), usPerStep: (ms * 1000 / steps).toFixed(1), evalsPerStep: (terrain.evaluations / steps).toFixed(1), blP50: bl[bl.length >> 1]?.toFixed(2), blP99: bl[Math.floor(bl.length * .99)]?.toFixed(2), maxBL: maxBL.toFixed(2) });
console.log(flights);
