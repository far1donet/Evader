import { COURSES, center } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const course = COURSES[1], line = center(123, course);
const g = makeRealityGame(course, 'slopestyle', {}); const ride = g.reality, sim = ride.sim;
ride.place(line, 75, 16); g.syncReality(1/120);
g.readIntent = () => { Object.assign(g.intent, { steer: Math.max(-1, Math.min(1, (line - g.x) * .08 - sim.board.v.x * .22)), lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 }); return g.intent; };
// wrap applyForceAtPoint to accumulate yaw torque about board up from contact forces only
const b = sim.board; const orig = b.applyForceAtPoint.bind(b); let inContact = false, tq = 0;
const contactOrig = sim.contact ?? null;
const proto = Object.getPrototypeOf(sim);
const c0 = proto.contact;
sim.contact = function (...a) { inContact = true; tq = 0; const r = c0.apply(this, a); inContact = false; return r; };
b.applyForceAtPoint = (f, p) => { if (inContact) { const up = b.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0}); const rx = p.x - b.p.x, ry = p.y - b.p.y, rz = p.z - b.p.z; const t = { x: ry*f.z - rz*f.y, y: rz*f.x - rx*f.z, z: rx*f.y - ry*f.x }; tq += t.x*up.x + t.y*up.y + t.z*up.z; } return orig(f, p); };
for (let n = 0; n < 120 * 2.5; n++) { g.update(1/120); if (n % 6 === 0 && g.d > 90 && g.d < 106) console.log(`d ${g.d.toFixed(1)} slip ${(ride.ctl.slipAngle(sim)*57.3).toFixed(1)} wy ${sim.board.w.y.toFixed(2)} snowYawTorque ${tq.toFixed(0)} pivot ${ride.ctl.cmd.pivotTorque.toFixed(0)} twist ${sim.riderTwist.toFixed(2)} edge ${(sim.edgeAngle*57.3).toFixed(0)} cmdE ${(ride.ctl.cmd.edge*57.3).toFixed(0)} front ${sim.state.filter((q,i)=>q.contact&&sim.stations[i].x>0).length} back ${sim.state.filter((q,i)=>q.contact&&sim.stations[i].x<0).length} toe ${sim.state.filter((q,i)=>q.contact&&sim.stations[i].edge>0).length} heel ${sim.state.filter((q,i)=>q.contact&&sim.stations[i].edge<0).length}`); }
