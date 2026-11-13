import { rig, run } from './bench.mjs';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
function trial({ load = .4, windPre = 0, windRel = 0, lean = 0, grab = false, speed = 8, deg = 3 }) {
  const r = rig(deg, 'groomed', 'balanced', speed);
  let air = 0, maxAir = 0, clear = 0, yaw0 = null, yawAir = 0, lastYaw = 0, airborne = false, noseUp = 0, popAt = 1 + load, landed = false;
  const yawOf = s => { const ex = s.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}); return Math.atan2(-ex.z, ex.x); };
  run(r, popAt + 2.5, t => ({ ...IDLE_INTENT, crouch: t > 1 && t < popAt ? 1 : 0, wind: t > .6 && t < popAt ? windPre : t >= popAt + .1 && t < popAt + .7 ? windRel : 0, lean: t > 1 && t < popAt ? lean : 0, grab: grab && air > .15 }), (t, s, c) => {
    const y = yawOf(s); let dy = y - lastYaw; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI; lastYaw = y;
    if (s.diag.contacts === 0 && t > .5) { air += 1/960; if (air > .03) { airborne = true; yawAir += dy; } const g = s.board.p.y - .03 - s.terrain.height(s.board.p.x, s.board.p.z); clear = Math.max(clear, g); const ex = s.board.dirToWorld({x:1,y:0,z:0},{x:0,y:0,z:0}); noseUp = Math.max(noseUp, Math.asin(ex.y) + Math.sin(deg*Math.PI/180)); }
    else { if (airborne) maxAir = Math.max(maxAir, air); airborne = false; air = 0; }
  });
  return { air: maxAir.toFixed(2), clearance: clear.toFixed(2), noseUpDeg: (noseUp*57.3).toFixed(0), spinDeg: (yawAir*57.3).toFixed(0), endV: r.sim.speed.toFixed(1), popLoad: r.ctl.popLoad.toFixed(2) };
}
console.log('ollie quick (0.1s load)', trial({ load: .1 }));
console.log('ollie full (0.4s load) ', trial({ load: .4 }));
console.log('ollie long hold (2s)   ', trial({ load: 2 }));
console.log('nollie                 ', trial({ load: .4, lean: 1 }));
console.log('air wind only (no prep) ', trial({ load: .4, windRel: 1 }));
console.log('spin prep cw            ', trial({ load: .4, windPre: 1 }));
console.log('spin prep ccw           ', trial({ load: .4, windPre: -1 }));
console.log('spin prep cw + grab     ', trial({ load: .4, windPre: 1, grab: true }));
console.log('spin prep cw, 0.1s load ', trial({ load: .12, windPre: 1 }));
console.log('spin prep cw, 6 m/s 0deg', trial({ load: .4, windPre: 1, speed: 6, deg: 0 }));
