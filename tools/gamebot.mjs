import { SnowGame, COURSES, center, height } from '../lib/snow-game.ts';
import { makeParkRails } from '../lib/park-rails.ts';
import { MeshStandardMaterial, Quaternion } from 'three';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
export function makeRealityGame(course, mode = 'freeride', settings = {}) {
  const g = Object.create(SnowGame.prototype);
  Object.assign(g, { course, mode, state: 'ride', x: center(0, course), d: 0, y: height(center(0, course), 0, course), vy: 0, speed: 0, heading: 0, spin: 0, flip: 0, airTime: 0, grabTime: 0, ground: true,
    settings: { physics: 'reality', assistLevel: 'balanced', quality: 'high', volume: 0, assist: false, motion: false, weather: 'clear', fov: 62, ...settings },
    spinInput: 0, spinVelocity: 0, flipVelocity: 0, load: 0, pop: 0, extension: 0, landingImpact: 0, grabKind: 0, grabLocked: -1, time: 0, bailTimer: 0, flowTimer: 0, toastTimer: 0, score: 0, tricks: 0, bails: 0, combo: 1,
    keys: new Set(), touch: new Set(), repeats: new Map(), railDone: new Set(), railActive: -1, railTime: 0, obstacles: [], gateCount: 0, gateIndex: 0,
    features: Array.from({ length: Math.floor(course.length / 180) - 1 }, () => ({})), recordTimer: 0, frames: [], hudTimer: 0, onHUD: () => {}, onEnd: r => { g.result = r; }, sound: () => {}, onPause: () => {},
    realityEvents: [], intent: { steer: 0, lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 }, keySteer: 0, realityGrab: 0, padLatch: new Set(), renderQ: new Quaternion(), prevRenderQ: new Quaternion(), replayHasQ: false, crashVisual: 0 });
  g.rails = makeParkRails(course, d => center(d, course), (x, d) => height(x, d, course), new MeshStandardMaterial());
  const log = []; const orig = g.onRealityEvent.bind(g); g.onRealityEvent = e => { log.push(e); orig(e); }; g.log = log;
  g.startReality();
  return g;
}
if (process.argv[1].endsWith('gamebot.mjs')) {
  for (const course of COURSES) {
    const g = makeRealityGame(course, 'slopestyle', { assistLevel: process.argv[2] || 'balanced' });
    let n = 0, maxV = 0;
    while (g.state === 'ride' && n++ < 120 * 600) {
      const look = center(g.d + 18, course) - g.x;
      g.keys.clear(); if (look > 1.5) g.keys.add('KeyD'); if (look < -1.5) g.keys.add('KeyA');
      if (g.speed > 19) g.keys.add('KeyS');
      g.update(1 / 120); maxV = Math.max(maxV, g.speed);
      if (!Number.isFinite(g.x + g.y + g.d)) throw new Error('non-finite');
    }
    const by = t => g.log.filter(e => e.type === t);
    console.log(course.name, { finished: g.state === 'result', time: g.time.toFixed(1), d: g.d.toFixed(0), maxKmh: (maxV * 3.6).toFixed(0), score: g.score, tricks: g.tricks, crashes: by('crash').map(e => e.kind), landed: by('landed').map(e => `${e.name}/${e.landing}/${e.air.toFixed(2)}s`), frames: g.frames.length, q: !!g.frames[5]?.q });
  }
}
import { kickerAt as kickAt } from '../lib/park-jumps.ts';
/** Analog bot: holds the kicker centre line ahead of a kicker, otherwise the piste centre; speed-limited. */
export function botIntent(g, opts = {}) {
  const c = g.course, ride = g.reality, v = ride.sim.board.v;
  const k = kickAt(g.d + 45, c);
  const lip = k.base + k.profile.lip;
  const onKick = k.exists && lip - g.d > -2 && lip - g.d < 70;
  const target = onKick ? center(lip, c) : center(g.d + 20, c);
  const i = { steer: 0, lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 };
  i.steer = Math.max(-1, Math.min(1, (target - g.x) * .12 - v.x * .35));
  const vMax = onKick ? (opts.kickSpeed ?? 13) : (opts.cruise ?? 17);
  if (g.speed > vMax) i.brake = Math.min(1, (g.speed - vMax) * .5);
  if (!ride.ground) { i.grab = !!opts.grab; i.wind = 0; }
  return i;
}

/**
 * Pure-pursuit line follower for tests: aims at the point of the course's centre line 14 m of arclength ahead of the
 * nearest point, and steers on the error between that bearing and the travel direction. Works when the mapped line runs
 * diagonally across the course frame (real runs). Returns a readIntent function.
 */
export function lineFollower(g, course, center, { maxSpeed = 15, ahead = 14 } = {}) {
    return () => {
        const v = g.reality.sim.board.v, x = g.x, d = g.d;
        let best = d, bestE = Infinity;
        for (let s = Math.max(0, d - 30); s <= d + 30; s += 1) { const e = Math.hypot(center(s, course) - x, s - d); if (e < bestE) { bestE = e; best = s; } }
        let td = best, arc = 0;
        while (arc < ahead) { const dx = center(td + 1, course) - center(td, course); arc += Math.hypot(dx, 1); td += 1; }
        const want = Math.atan2(center(td, course) - x, td - d), have = Math.atan2(v.x, -v.z);
        let err = want - have; err = Math.atan2(Math.sin(err), Math.cos(err));
        const speed = Math.hypot(v.x, v.z);
        Object.assign(g.intent, IDLE_INTENT, { steer: speed < 1 ? 0 : Math.max(-1, Math.min(1, err * 1.6)), brake: g.speed > maxSpeed ? Math.min(1, (g.speed - maxSpeed) * .4) : 0 });
        return g.intent;
    };
}
