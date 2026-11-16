import * as T from 'three';
import { resortSync, loadTilesAround, FreeTerrain, setFreeTerrain } from '../../lib/verbier/terrain.ts';
import { SurfaceMap, FreeView } from '../../lib/verbier/free-world.ts';
import { SnowGame, height, snowDepth, FREE_COURSE } from '../../lib/snow-game.ts';
import { IDLE_INTENT } from '../../lib/sim/rider-controller.ts';
const r = resortSync(), sm = new SurfaceMap(r);
const names = (process.argv[2] ?? 'Les Attelas,Verbier – Médran,Savoleyres,Tracouet,Siviez,Col des Gentianes,Les Ruinettes,La Chaux,Thyon,Mayens de Bruson (Moay)').split(',');
const SECS = +(process.argv[3] ?? 120);
for (const name of names) {
  const st = r.stations.find(s => s.name === name); if (!st) { console.log('no station', name); continue; }
  await loadTilesAround(st.e, st.n, 1600);
  const run = new FreeTerrain(Math.round(st.e), Math.round(st.n), (e, n) => sm.at(e, n)); setFreeTerrain(run);
  const view = new FreeView(run, sm, r, 'low', (x, d) => height(x, d, FREE_COURSE), (x, d) => snowDepth(x, d, FREE_COURSE));
  view.prime(0, 0);
  const g = Object.create(SnowGame.prototype);
  Object.assign(g, { course: FREE_COURSE, mode: 'freeride', state: 'ride', x: 0, d: 0, y: 0, vy: 0, speed: 0, heading: 0, spin: 0, flip: 0, airTime: 0, grabTime: 0, ground: true,
    settings: { physics: 'reality', assistLevel: 'balanced', quality: 'low', volume: 0, assist: false, motion: false, weather: 'clear', fov: 62 },
    spinInput: 0, spinVelocity: 0, flipVelocity: 0, load: 0, pop: 0, extension: 0, landingImpact: 0, grabKind: 0, grabLocked: -1, time: 0, bailTimer: 0, flowTimer: 0, toastTimer: 0, score: 0, tricks: 0, bails: 0, combo: 1,
    keys: new Set(), touch: new Set(), repeats: new Map(), railDone: new Set(), railActive: -1, railTime: 0, obstacles: [], gateCount: 0, gateIndex: 0,
    features: [], recordTimer: 0, frames: [], hudTimer: 0, onHUD: () => {}, onEnd: () => {}, sound: () => {}, onPause: () => {}, rails: [],
    realityEvents: [], intent: { ...IDLE_INTENT }, keySteer: 0, realityGrab: 0, padLatch: new Set(), renderQ: new T.Quaternion(), prevRenderQ: new T.Quaternion(), replayHasQ: false, crashVisual: 0,
    stick: { x: 0, y: 0 }, gesture: { enabled: false }, walking: false, walkHeading: 0, walkSpeed: 0, walkHeld: 0, stoppedFor: 0 });
  g.freeStart = { x: 0, d: 0, yaw: 0 }; g.freeStart.yaw = g.fallLineYaw(0, 0);
  g.startReality();
  const log = []; const R = g.reality, P = R.push.bind(R), W = R.walkTo.bind(R);
  R.push = (...a) => { log.push(`t${g.time.toFixed(2)} push ${a.map(v => v.toFixed(2))} v${R.speed.toFixed(1)}`); P(...a); };
  R.walkTo = (...a) => { if (!g._w) log.push(`t${g.time.toFixed(2)} walk start`); g._w = 1; W(...a); };
  const phase = Math.random() * 6;
  g.readIntent = () => { const t = g.time; Object.assign(g.intent, IDLE_INTENT, { steer: Math.sin(t * .7 + phase) * .8, brake: g.speed > 17 ? .7 : 0, tuck: g.speed < 2.5 }); return g.intent; };
  const crashes = []; let under = 0, worstUnder = 0, fast = 0, stuck = 0, stuckT = 0, nan = false, maxSpeed = 0, prevCrashed = false, flights = 0, maxAir = 0, air = 0;
  const startY = g.y; let walkT = 0;
  for (let i = 0; i < 120 * SECS; i++) {
    if (i % 4 === 0) { view.update(g.x, g.d, 4 / 120); g.obstacles = view.obstacles; }
    g.update(1 / 120); if (g.walking) walkT += 1 / 120;
    const rd = g.reality;
    if (!g.walking) g._w = 0;
    if (g.speed > 40 && !g._dumped) { g._dumped = 1; console.log(name, 'BLOWUP at', g.time.toFixed(2), 'walking', g.walking, 'last:', log.slice(-6).join(' | ')); }
    if (!Number.isFinite(g.x + g.y + g.d)) { nan = true; break; }
    const gr = height(g.x, g.d, FREE_COURSE);
    if (!rd.crashed && g.y - gr < -.25) { under++; worstUnder = Math.min(worstUnder, g.y - gr); }
    maxSpeed = Math.max(maxSpeed, g.speed); if (g.speed > 30) fast++;
    if (!g.ground) { air += 1 / 120; } else { maxAir = Math.max(maxAir, air); if (air > 1.5) flights++; air = 0; }
    if (rd.crashed && !prevCrashed) {
      const near = view.obstacles.filter(o => Math.hypot(o.x - g.x, o.d - g.d) < 4).map(o => o.kind ?? (o.r > 2 ? 'rock' : 'tree')).slice(0, 3);
      crashes.push(`${rd.crashKind}@${Math.round(g.x)},${Math.round(g.d)} v${rd.speed.toFixed(0)} near[${near}]`);
    }
    prevCrashed = rd.crashed;
    if (!rd.crashed && g.speed < .3 && g.intent.brake === 0) { stuckT += 1 / 120; if (stuckT > 8) { stuck++; stuckT = 0; } } else stuckT = 0;
  }
  const w = run.world(g.x, g.d);
  console.log(`${name.padEnd(28)} moved ${Math.round(Math.hypot(g.x, g.d))} m, drop ${Math.round(startY - g.y)} m, vmax ${maxSpeed.toFixed(0)}, under ${under} (worst ${worstUnder.toFixed(2)}), >30m/s ${fast}, stuck ${stuck}, long airs ${flights} (max ${maxAir.toFixed(1)} s), nan ${nan}, walked ${walkT.toFixed(0)} s, crashes ${crashes.length}: ${crashes.slice(0, 6).join(' | ')}`);
  view.dispose();
}
