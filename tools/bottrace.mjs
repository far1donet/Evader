import { COURSES, center } from '../lib/snow-game.ts';
import { makeRealityGame, botIntent } from './gamebot.mjs';
const course = COURSES[+process.argv[2] || 0];
const g = makeRealityGame(course, 'slopestyle', { assistLevel: 'balanced' });
let last; g.readIntent = () => { last = botIntent(g, { kickSpeed: 13 }); Object.assign(g.intent, last); return g.intent; };
let n = 0, prevLog = 0;
while (g.state === 'ride' && n++ < 120 * (+process.argv[3] || 120)) {
  g.update(1 / 120);
  const s = g.reality.sim;
  if (n % 60 === 0 || g.log.length > prevLog) {
    const ev = g.log.slice(prevLog).map(e => e.type + ':' + (e.kind ?? e.name)).join(','); prevLog = g.log.length;
    console.log(`t ${g.time.toFixed(1)} d ${g.d.toFixed(0)} off ${(g.x - center(g.d, course)).toFixed(1)} v ${g.speed.toFixed(1)} slip ${(g.reality.ctl.slipAngle(s)*57.3).toFixed(0)} steer ${last.steer.toFixed(2)} brake ${last.brake.toFixed(2)} edge ${(s.edgeAngle*57.3).toFixed(0)} up ${s.board.dirToWorld({x:0,y:1,z:0},{x:0,y:0,z:0}).y.toFixed(2)} bl ${s.balanceLoad.toFixed(1)} c ${s.diag.contacts} trav ${g.reality.ctl.travelSign} ${g.reality.crashed ? 'CRASHED' : ''} ${ev}`);
  }
}
