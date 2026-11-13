// Reality physics: rider controller, freestyle observer, game integration and real-scale rig.
// Run: node --experimental-strip-types tests/reality.mjs
// Thresholds are measured properties of THIS model (see docs/REALITY_AUDIT_AND_PLAN.md), checked against physical
// plausibility ranges. They are not calibration against instrumented snowboarding data.
import assert from 'node:assert/strict';
import * as T from 'three';
import { SnowboardSim, NEUTRAL, SIM_DT } from '../lib/sim/snowboard-sim.ts';
import { BOARDS, DEFAULT_RIDER } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { SNOW } from '../lib/sim/snow.ts';
import { RiderController, IDLE_INTENT, edgeForSteer } from '../lib/sim/rider-controller.ts';
import { FreestyleTracker, GRABS } from '../lib/sim/freestyle.ts';
import { shapeStick } from '../lib/input.ts';
import { SnowGame, COURSES, center, height } from '../lib/snow-game.ts';
import { makeParkRails } from '../lib/park-rails.ts';

const rig = (deg = 3, speed = 8, assist = 'balanced', mat = 'groomed', rider = DEFAULT_RIDER) => {
    const sim = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(deg * Math.PI / 180, SNOW[mat]), rider);
    const ctl = new RiderController(); ctl.assist = assist; sim.place(0, 0, Math.PI / 2, speed);
    const tr = new FreestyleTracker(); tr.assist = assist;
    return { sim, ctl, tr, events: [] };
};
const run = (r, secs, intentFn, probe) => {
    for (let i = 0, n = Math.round(secs / SIM_DT); i < n; i++) {
        const t = i * SIM_DT, intent = intentFn(t);
        r.sim.step(r.ctl.update(r.sim, intent, !r.tr.airborne, SIM_DT));
        r.tr.update(r.sim, r.ctl, intent.grab, r.events);
        probe?.(t, r.sim, r.ctl, r.tr);
    }
};
const yawOf = s => { const e = s.board.dirToWorld({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); return Math.atan2(-e.z, e.x); };

// ---- input shaping ---------------------------------------------------------------------------------------------
{
    assert.deepEqual(shapeStick(.1, 0, { deadzone: .12, curve: 1.5, sensitivity: 1 }), [0, 0], 'inside the radial dead zone');
    const [x, y] = shapeStick(.7, .7, { deadzone: .12, curve: 1.5, sensitivity: 1 });
    assert(Math.abs(x - y) < 1e-12 && Math.hypot(x, y) <= 1, 'radial dead zone keeps the stick direction');
    assert(Math.abs(edgeForSteer(1, 4, 1) - 1) < 1e-9 && Math.abs(edgeForSteer(-.5, 4, 1) + .5) < 1e-9, 'linear edge mapping at low speed');
    const e = edgeForSteer(.1, 14, 1); assert(e <= .081 && edgeForSteer(.5, 14, 1) >= .28, 'at speed small inputs glide flat instead of holding a partial edge');
    console.log('Input: radial dead zone, response curve and speed-aware edge mapping passed.');
}

// ---- 5.1 ollie: preparation matters, no unlimited charge --------------------------------------------------------
function ollie(load, extra = {}) {
    const r = rig(3, 8); let clear = 0, air = 0, maxAir = 0, yaw = 0, last = yawOf(r.sim);
    const popAt = 1 + load;
    run(r, popAt + 2.2, t => ({ ...IDLE_INTENT, crouch: t > 1 && t < popAt ? 1 : 0, wind: t > .6 && t < popAt ? (extra.wind ?? 0) : 0, grab: !!extra.grab && r.tr.airborne }), (t, s) => {
        const y = yawOf(s); let dy = y - last; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI; last = y;
        if (s.diag.contacts === 0 && t > .5) { air += SIM_DT; yaw += dy; clear = Math.max(clear, s.board.p.y - s.comY - s.terrain.height(s.board.p.x, s.board.p.z)); }
        else { maxAir = Math.max(maxAir, air); air = 0; }
    });
    return { clear, air: maxAir, spin: yaw * 180 / Math.PI, r };
}
{
    const full = ollie(.4), tap = ollie(.1), held = ollie(2);
    assert(full.clear > .3 && full.clear < .65, `loaded ollie clears ${full.clear.toFixed(2)} m (plausible 0.3-0.65 m)`);
    assert(full.air > .35 && full.air < .75, `ollie airtime ${full.air.toFixed(2)} s`);
    assert(tap.clear < .1, `an unloaded tap barely leaves the snow (${tap.clear.toFixed(2)} m)`);
    assert(Math.abs(held.clear - full.clear) < .03, 'holding the crouch longer stores no extra energy');
    console.log(`Ollie: loaded ${full.clear.toFixed(2)} m / ${full.air.toFixed(2)} s, tap ${tap.clear.toFixed(2)} m, 2 s hold ${held.clear.toFixed(2)} m passed.`);

    // ---- 6.1 / 6.2 spin preparation and angular momentum ----
    const cw = ollie(.4, { wind: 1 }), ccw = ollie(.4, { wind: -1 }), grab = ollie(.4, { wind: 1, grab: true });
    assert(Math.abs(cw.spin) > 60, `a prepared spin rotates (${cw.spin.toFixed(0)} deg off a flat ollie)`);
    assert(Math.abs(cw.spin + ccw.spin) < .05 * Math.abs(cw.spin), 'clockwise and counter-clockwise preparation mirror');
    assert(Math.abs(grab.spin) >= Math.abs(cw.spin) - 2, 'pulling in for a grab never slows the rotation');
    // Air input without preparation cannot create rotation: wind only twists the body against the board.
    const airOnly = rig(3, 8); let airYaw = 0, last = yawOf(airOnly.sim), airborne = false;
    run(airOnly, 3.6, t => ({ ...IDLE_INTENT, crouch: t > 1 && t < 1.4 ? 1 : 0, wind: t > 1.5 && t < 1.9 ? 1 : 0 }), (t, s) => { const y = yawOf(s); let dy = y - last; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI; last = y; if (s.diag.contacts === 0 && t > 1.4) { airborne = true; airYaw += dy; } });
    // Bound: the board can only counter-rotate by (body inertia share) x (hip/shoulder twist range) = 2.6/5.1 x 1.25 rad ~ 37 deg.
    const share = DEFAULT_RIDER.yawInertia / (DEFAULT_RIDER.yawInertia + airOnly.sim.board.inertia?.[1] || 2.5);
    assert(airborne && Math.abs(airYaw) < airOnly.sim.maxTwist * Math.max(share, .52) + .05, `mid-air shoulder input alone gives only a bounded counter-twist (${(airYaw * 57.3).toFixed(0)} deg)`);
    console.log(`Spins: prepared ${cw.spin.toFixed(0)} deg, mirrored ${ccw.spin.toFixed(0)} deg, with grab ${grab.spin.toFixed(0)} deg, air-only ${(airYaw * 57.3).toFixed(0)} deg passed.`);
}
{
    // Yaw momentum of the whole rider is conserved in flight under internal torques (shoulders, posture).
    const s = new SnowboardSim(BOARDS['all-mountain'], new PlaneTerrain(0), { ...DEFAULT_RIDER, cdaUpright: 0, cdaTuck: 0 });
    s.place(0, 0, 0, 0); s.board.p.y += 5; s.riderP.y += 5; s.board.L.y = 6; s.board.refresh();
    const Ly = () => { const ey = s.board.dirToWorld({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }); return s.board.L.y + ey.y * s.riderYawInertia * s.riderYawRate; };
    const L0 = Ly(); let worst = 0, w0 = 0, w1 = 0;
    for (let i = 0; i < 960; i++) { const t = i * SIM_DT; s.step({ ...NEUTRAL, edge: NaN, upperTorque: 120 * Math.sin(t * 5), compact: t > .5 ? 1 : 0 }); worst = Math.max(worst, Math.abs(Ly() - L0)); if (i === 400) w0 = s.riderYawRate; if (i === 900) w1 = s.riderYawRate; }
    assert(worst / L0 < .03, `airborne yaw momentum drift ${(100 * worst / L0).toFixed(2)} % under internal torques`);
    console.log(`Angular momentum: yaw drift ${(100 * worst / L0).toFixed(2)} % in 1 s of flight with shoulder torque and posture change passed.`);
}

// ---- 4.2 / 4.9 no propulsion on the flat; 4.6 braking ------------------------------------------------------------
{
    const r = rig(0, 8); let prev = r.sim.speed, rises = 0;
    run(r, 8, t => ({ ...IDLE_INTENT, steer: .5 * Math.sin(t * 1.3), wind: Math.sin(t * 2.1), tuck: t > 4, lean: .4 * Math.sin(t * .7) }), (t, s) => { if (t > .2 && s.speed > prev + .02) rises++; prev = s.speed; });
    assert(r.sim.speed < 8 && rises < 5, `steering, shoulders, tuck and pressure never propel the rider on the flat (end ${r.sim.speed.toFixed(2)} m/s)`);
    const free = rig(8, 12), braked = rig(8, 12); let stopped = -1;
    run(free, 6, () => IDLE_INTENT);
    run(braked, 12, t => ({ ...IDLE_INTENT, brake: t > .3 ? 1 : 0 }), (t, s) => { if (stopped < 0 && t > 1 && s.speed < .6) stopped = t; });
    assert(stopped > 0, 'holding the speed check brings the rider to a stop');
    console.log(`Flat ground: no propulsion (end ${r.sim.speed.toFixed(2)} m/s). Braking from 12 m/s on 8 deg stops at ${stopped.toFixed(1)} s (free run reaches ${free.sim.speed.toFixed(1)} m/s at 6 s) passed.`);
}

// ---- carving with the controller: no spin-out inside the stable envelope ----------------------------------------
{
    for (const v of [6, 8, 10, 12, 16]) for (const steer of [0, .3, .6]) {
        const r = rig(12, v, 'authentic'); let worst = 0;
        run(r, 2.5, () => ({ ...IDLE_INTENT, steer }), (t, s, c) => { if (t > .5) worst = Math.max(worst, Math.abs(c.slipAngle(s))); });
        assert(worst < 15 * Math.PI / 180, `v ${v} steer ${steer}: board within ${(worst * 57.3).toFixed(0)} deg of travel`);
    }
    console.log('Controller carving: 6-16 m/s at steer 0-0.6 stays within 15 deg of travel (full lock at 16 m/s may wash out; see KNOWN_ISSUES) passed.');
}

// ---- 7 landings: clean straight landing vs sideways landing ------------------------------------------------------
function drop(yawOffset, h = .8, v = 8) {
    const r = rig(10, v); const s = r.sim;
    s.place(0, 0, Math.PI / 2 + yawOffset, 0);
    // velocity straight down the fall line, board turned by yawOffset; lifted h above the snow
    s.board.v.x = 0; s.board.v.z = -v; s.board.v.y = -v * Math.tan(10 * Math.PI / 180); s.riderV.x = 0; s.riderV.z = -v; s.riderV.y = s.board.v.y;
    s.board.p.y += h; s.riderP.y += h;
    run(r, 2, () => IDLE_INTENT);
    return r.events.filter(e => e.type === 'landed' || e.type === 'crash')[0];
}
{
    const clean = drop(0), sideways = drop(1.2);
    assert(clean?.type === 'landed' && ['STOMPED', 'CLEAN', 'UNSTABLE', 'HEAVY'].includes(clean.landing), `aligned drop lands (${clean?.type} ${clean?.landing ?? clean?.kind})`);
    assert(sideways?.type === 'crash', `a sideways landing at speed does not ride away (${sideways?.type} ${sideways?.kind ?? sideways?.landing})`);
    console.log(`Landings: aligned 0.8 m drop -> ${clean.landing}; 70 deg sideways -> ${sideways.kind} passed.`);
}

// ---- trick naming from measured rotation ---------------------------------------------------------------------------
{
    const t = new FreestyleTracker(); t.stance = 'regular';
    const name = (spin, inversions = 0, roll = 0, sw = false) => { t.spin = spin; t.inversions = inversions; t.roll = roll; t.pitch = 0; t.takeoffSwitch = sw; return t.describe().name; };
    assert.equal(name(Math.PI), 'FS 180'); assert.equal(name(-2 * Math.PI), 'BS 360'); assert.equal(name(-2 * Math.PI, 0, 0, true), 'SWITCH FS 360');
    assert.equal(name(Math.PI * .7), 'STRAIGHT AIR', 'partial rotation is never rounded up');
    assert.equal(name(0, 1, -2 * Math.PI), 'BACKFLIP'); assert.equal(name(0, 1, 2 * Math.PI), 'FRONTFLIP');
    assert.equal(name(6 * Math.PI, 2, -2 * Math.PI), 'FS DOUBLE CORK 1080');
    assert.equal(GRABS.length, 13);
    console.log('Trick names: FS/BS by stance and travel, switch, no rounding up, flips, corks, 13 grabs passed.');
}

// ---- game integration: courses, determinism, replay frames ----------------------------------------------------------
function game(course, settings = {}) {
    const g = Object.create(SnowGame.prototype);
    Object.assign(g, { course, mode: 'freeride', state: 'ride', x: 0, d: 0, y: 0, vy: 0, speed: 0, heading: 0, spin: 0, flip: 0, airTime: 0, grabTime: 0, ground: true,
        settings: { physics: 'reality', assistLevel: 'balanced', quality: 'high', volume: 0, assist: false, motion: false, weather: 'clear', fov: 62, ...settings },
        spinInput: 0, spinVelocity: 0, flipVelocity: 0, load: 0, pop: 0, extension: 0, landingImpact: 0, grabKind: 0, grabLocked: -1, time: 0, bailTimer: 0, flowTimer: 0, toastTimer: 0, score: 0, tricks: 0, bails: 0, combo: 1,
        keys: new Set(), touch: new Set(), repeats: new Map(), railDone: new Set(), railActive: -1, railTime: 0, obstacles: [], gateCount: 0, gateIndex: 0,
        features: Array.from({ length: Math.floor(course.length / 180) - 1 }, () => ({})), recordTimer: 0, frames: [], hudTimer: 0, onHUD: () => {}, onEnd: r => { g.result = r; }, sound: () => {}, onPause: () => {},
        realityEvents: [], intent: { ...IDLE_INTENT }, keySteer: 0, realityGrab: 0, padLatch: new Set(), renderQ: new T.Quaternion(), prevRenderQ: new T.Quaternion(), replayHasQ: false, crashVisual: 0 });
    g.rails = makeParkRails(course, d => center(d, course), (x, d) => height(x, d, course), new T.MeshStandardMaterial());
    g.startReality();
    return g;
}
{
    for (const course of COURSES) {
        const g = game(course); let n = 0;
        while (g.state === 'ride' && n++ < 120 * 40) { g.keys.clear(); const off = center(g.d + 20, course) - g.x; if (off > 2) g.keys.add('KeyD'); if (off < -2) g.keys.add('KeyA'); if (g.speed > 15) g.keys.add('KeyS'); g.update(1 / 120); assert(Number.isFinite(g.x + g.y + g.d + g.speed), 'finite state'); }
        assert(g.d > 60, `${course.name}: the rider descends under gravity alone (${g.d.toFixed(0)} m in 40 s)`);
        assert(g.frames.length > 100 && g.frames.every(f => f.q && f.q.every(Number.isFinite)), 'every recorded frame carries the board orientation');
        const q = g.frames[50].q; assert(Math.abs(Math.hypot(...q) - 1) < 1e-6, 'recorded quaternions are normalised');
    }
    // determinism: identical inputs give identical state, whatever the render rate (the game advances in whole 120 Hz ticks)
    const a = game(COURSES[1]), b = game(COURSES[1]);
    for (let i = 0; i < 600; i++) { for (const g of [a, b]) { g.keys.clear(); if (i % 240 < 120) g.keys.add('KeyD'); if (i > 300 && i < 360) g.keys.add('Space'); g.update(1 / 120); } }
    assert.equal(a.x, b.x); assert.equal(a.d, b.d); assert.deepEqual(a.renderQ.toArray(), b.renderQ.toArray());
    // replay interpolates the recorded orientation
    a.run = { time: a.frames.at(-1).t, frames: a.frames }; a.replayTime = a.frames[200].t + 1 / 120; a.replayPlaying = false; a.updateReplay(0);
    assert(a.replayHasQ && Math.abs(a.renderQ.length() - 1) < 1e-9, 'replay slerps the recorded board orientation');
    console.log('Game: all three mountains ride under Reality physics, frames record orientation, deterministic ticks, replay orientation passed.');
}

// ---- real-scale rig ----------------------------------------------------------------------------------------------------
{
    const gradient = () => ({ addColorStop() {} });
    const context = { createLinearGradient: gradient, createRadialGradient: gradient, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, fillText() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {} };
    globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    const { RiderRig, GRAB_TARGETS } = await import('../lib/rider-rig.ts');
    for (const kind of Object.keys(BOARDS)) {
        const root = new T.Group(), r = new RiderRig(root, new T.MeshStandardMaterial(), new T.MeshStandardMaterial()), spec = BOARDS[kind];
        r.setBoard(spec); r.pose({ dt: 1, time: 0, turn: 0, speed: 0, air: false, grab: false, landing: 0, menu: true }); root.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(root), bb = new T.Box3().setFromObject(r.board.children[0]);
        assert(Math.abs(bb.max.x - bb.min.x - spec.length) < .01, `${kind}: rendered board length equals the spec`);
        assert(box.max.y > 1.6 && box.max.y < 1.85, `${kind}: rider stands ${box.max.y.toFixed(2)} m to the helmet top`);
        const feet = r.boots.map(b => b.getWorldPosition(new T.Vector3()).x);
        assert(Math.abs(feet[1] - feet[0] - spec.stanceWidth) < .005, `${kind}: stance width matches`);
        for (let i = 0; i < 2; i++) { r.legs[i].mesh.updateMatrixWorld(true); const ankle = new T.Vector3((i ? 1 : -1) * r.realBoard.stanceHalf, .305, 0).multiplyScalar(.9); assert(r.legs[i].tip.getWorldPosition(new T.Vector3()).distanceTo(ankle) < 1e-4, 'feet stay in the bindings'); }
    }
    const root = new T.Group(), r = new RiderRig(root, new T.MeshStandardMaterial(), new T.MeshStandardMaterial()); r.setBoard(BOARDS['all-mountain']);
    const grip = h => new T.Vector3(0, -.117, 0).applyQuaternion(h.quaternion).add(h.position);
    for (const lead of [1, -1]) for (let k = 0; k < GRAB_TARGETS.length; k++) {
        for (let i = 0; i < 120; i++) r.pose({ dt: 1 / 120, time: i / 120, turn: 0, speed: 20, air: false, grab: false, landing: 0, menu: false, spin: lead > 0 ? 0 : Math.PI });
        for (let i = 0; i < 240; i++) r.pose({ dt: 1 / 120, time: i / 120, turn: 0, speed: 20, air: true, grab: true, landing: 0, menu: false, grabKind: k, spin: lead > 0 ? 0 : Math.PI, extension: 0, pop: 0 });
        const hands = r.grabHands(k, lead);
        for (const h of [0, 1]) if (hands[h]) {
            const miss = grip(r.hands[h]).distanceTo(r.grabContact(k, lead, h)) * .9;
            const limit = GRABS[k].id === 'crail' || GRABS[k].id === 'seatbelt' ? .13 : .06;
            assert(miss < limit, `${GRABS[k].name} (lead ${lead}) hand reaches the board (${(miss * 100).toFixed(1)} cm)`);
        }
        for (const arm of r.arms) { arm.mesh.updateMatrixWorld(true); const a = arm.upper.getWorldPosition(new T.Vector3()), j = arm.lower.getWorldPosition(new T.Vector3()), e = arm.tip.getWorldPosition(new T.Vector3()); assert(Math.abs(a.distanceTo(j) - arm.upperLength * .9) < 1e-5 && Math.abs(j.distanceTo(e) - arm.lowerLength * .9) < 1e-5, 'arms never stretch to reach'); }
    }
    console.log('Rig: real board length and stance for all six boards, 1.6-1.85 m rider, feet in bindings, 13 grabs reach without stretching (crail/seatbelt within 13 cm) passed.');
}
console.log('Reality validation passed.');
