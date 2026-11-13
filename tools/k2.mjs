import { COURSES, center, height } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const course = COURSES[1], line = center(123, course);
const g = makeRealityGame(course, 'slopestyle', {}); const ride = g.reality, sim = ride.sim;
ride.place(line, 75, 12); g.syncReality(1/120);
g.readIntent = () => { Object.assign(g.intent, { steer: Math.max(-1, Math.min(1, (line - g.x) * .15 - sim.board.v.x * .4)), lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 }); return g.intent; };
for (let n = 0; n < 120 * 1.6; n++) { g.update(1/120); if (n % 6 === 0) { const ex = sim.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}); console.log(`t ${(n/120).toFixed(2)} d ${g.d.toFixed(1)} c ${sim.diag.contacts} gap ${(sim.board.p.y - .03 - height(sim.board.p.x, -sim.board.p.z, course)).toFixed(3)} vy ${sim.board.v.y.toFixed(2)} ex.y ${ex.y.toFixed(3)} pitchRate ${sim.board.w.x.toFixed(2)} ${sim.board.w.z.toFixed(2)} leg ${sim.legAxial.toFixed(0)} air ${ride.tricks.airborne} steer ${g.intent.steer.toFixed(2)} x-line ${(g.x-line).toFixed(2)}`); } }
