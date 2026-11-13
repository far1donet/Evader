import { COURSES, center, height } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const course = COURSES[1], line = center(123, course);
const g = makeRealityGame(course, 'slopestyle', {}); const ride = g.reality, sim = ride.sim;
ride.place(line, 75, +(process.argv[2] || 18)); g.syncReality(1/120);
g.readIntent = () => { Object.assign(g.intent, { steer: Math.max(-1, Math.min(1, (line - g.x) * .08 - sim.board.v.x * .22)), lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 }); return g.intent; };
for (let n = 0; n < 120 * 3.5 && g.log.filter(e => e.type === 'crash').length === 0; n++) { g.update(1/120); if (n % 6 === 0 && g.d > 100) console.log(`d ${g.d.toFixed(1)} v ${g.speed.toFixed(1)} c ${sim.diag.contacts} slip ${(ride.ctl.slipAngle(sim)*57.3).toFixed(1)} edge ${(sim.edgeAngle*57.3).toFixed(1)} cmdE ${(ride.ctl.cmd.edge*57.3).toFixed(1)} pivot ${ride.ctl.cmd.pivotTorque.toFixed(0)} wy ${sim.board.w.y.toFixed(2)} leg ${sim.legAxial.toFixed(0)} bl ${sim.balanceLoad.toFixed(1)} steer ${g.intent.steer.toFixed(2)} xl ${(g.x-line).toFixed(2)} bp ${sim.bodyPitch.toFixed(2)}`); }
console.log(g.log.map(e => e.type + ':' + (e.kind ?? e.name)).join(' '));
