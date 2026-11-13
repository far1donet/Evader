import { COURSES, center, height } from '../lib/snow-game.ts';
import { makeRealityGame } from './gamebot.mjs';
const course = COURSES[1];
const g = makeRealityGame(course, 'slopestyle', {});
const ride = g.reality, sim = ride.sim; let n = 0;
while (g.state === 'ride' && n++ < 120 * 40 && g.d < 135) {
  const look = center(g.d + 18, course) - g.x;
  g.keys.clear(); if (look > 1.5) g.keys.add('KeyD'); if (look < -1.5) g.keys.add('KeyA');
  g.update(1 / 120);
  if (g.d > 98 && n % 6 === 0) {
    const ex = sim.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}), ey = sim.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0});
    console.log(`d ${g.d.toFixed(1)} off ${(g.x - center(123, course)).toFixed(1)} gap ${(sim.board.p.y - .03 - height(g.x, g.d, course)).toFixed(2)} c ${sim.diag.contacts} v ${g.speed.toFixed(1)} vy ${sim.board.v.y.toFixed(1)} exy ${ex.y.toFixed(2)} eyy ${ey.y.toFixed(2)} slip ${(ride.ctl.slipAngle(sim)*57.3).toFixed(0)} leg ${sim.legAxial.toFixed(0)} bl ${sim.balanceLoad.toFixed(1)} crashed ${ride.crashed}`);
  }
}
