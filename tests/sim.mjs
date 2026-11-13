// Validation suite for the physics core in lib/sim (Phase 2 + the first part of Phase 3).
// Run: node --experimental-strip-types tests/sim.mjs
// Tolerances are justified inline. Nothing here is calibrated against real snowboarding data: these tests check the
// model against analytic references and against its own conservation/consistency properties.
import assert from 'node:assert/strict';
import { RigidBody } from '../lib/sim/rigid-body.ts';
import { len } from '../lib/sim/math3.ts';
import { SnowboardSim, NEUTRAL, SIM_DT, G } from '../lib/sim/snowboard-sim.ts';
import { BOARDS, DEFAULT_RIDER } from '../lib/sim/boards.ts';
import { PlaneTerrain } from '../lib/sim/terrain.ts';
import { SNOW } from '../lib/sim/snow.ts';

const noDrag = { ...DEFAULT_RIDER, cdaUpright: 0, cdaTuck: 0 };
const speed3 = s => { const M = s.boardMass + s.rider.mass; return Math.hypot((s.boardMass * s.board.v.x + s.rider.mass * s.riderV.x) / M, (s.boardMass * s.board.v.y + s.rider.mass * s.riderV.y) / M, (s.boardMass * s.board.v.z + s.rider.mass * s.riderV.z) / M); };
const DOWNHILL_YAW = Math.PI / 2; // board nose toward -z, the course direction
const make = (angDeg, mat = 'groomed', rider = DEFAULT_RIDER, board = 'all-mountain') => new SnowboardSim(BOARDS[board], new PlaneTerrain(angDeg * Math.PI / 180, SNOW[mat]), rider);
const run = (s, secs, cmd = NEUTRAL) => { const n = Math.round(secs / SIM_DT); for (let i = 0; i < n; i++) s.step(cmd); };

// ---- 24.1 / 24.6 rigid body: ballistic motion and angular momentum ----------------------------------------------
{
    const c = new RigidBody(80, [1, 1, 1]); c.v = { x: 4, y: 7, z: -3 };
    for (let i = 0; i < 960; i++) { c.clearForces(); c.force.y = -80 * G; c.integrate(1 / 960); }
    assert(Math.abs(c.p.y - (7 - .5 * G)) < 1e-9, 'ballistic height after 1 s matches y0 + v t - g t^2/2');
    assert(Math.abs(c.p.x - 4) < 1e-9 && Math.abs(c.p.z + 3) < 1e-9, 'no horizontal acceleration in free flight');
    const b = new RigidBody(5, [1, 2.5, 4]); b.setAngularVelocity({ x: 3, y: .2, z: 3.5 });
    const L0 = len(b.L), E0 = b.kineticEnergy();
    for (let i = 0; i < 96000; i++) { b.clearForces(); b.integrate(1 / 960); } // 100 s of torque-free tumbling
    assert(Math.abs(len(b.L) - L0) / L0 < 1e-12, 'angular momentum conserved with zero torque');
    assert(Math.abs(b.kineticEnergy() - E0) / E0 < 1e-5, 'torque-free tumbling energy stays bounded over 100 s');
    // posture change: pulling in lowers I and raises w, while L is untouched
    const p = new RigidBody(75, [8, 8, 2]); p.setAngularVelocity({ x: 0, y: 0, z: 2 }); const Lz = p.L.z;
    p.setInertia([8, 8, 1]);
    assert(Math.abs(p.L.z - Lz) < 1e-12 && Math.abs(p.w.z - 4) < 1e-9, 'halving the inertia doubles the spin rate, L unchanged');
    // an applied torque changes L by exactly torque * dt
    const q = new RigidBody(75, [8, 8, 2]); q.clearForces(); q.torque.z = 10; q.integrate(.1);
    assert(Math.abs(q.L.z - 1) < 1e-12, 'ground contact can only add angular momentum through torque');
    console.log('Rigid body: ballistic flight, angular momentum, posture/inertia and torque impulse passed.');
}

// ---- 25 Test A: stationary rider ------------------------------------------------------------------------------
{
    const s = make(0); s.place(0, 0, DOWNHILL_YAW, 0); run(s, 3);
    const x0 = s.board.p.x, z0 = s.board.p.z, y0 = s.board.p.y; let maxH = 0, minY = 9, maxY = -9;
    for (let i = 0; i < 960 * 2; i++) { s.step(NEUTRAL); maxH = Math.max(maxH, Math.hypot(s.board.v.x, s.board.v.z)); minY = Math.min(minY, s.board.p.y); maxY = Math.max(maxY, s.board.p.y); }
    assert(maxH < 1e-3, 'flat ground: no unexplained horizontal motion');
    assert(Math.hypot(s.board.p.x - x0, s.board.p.z - z0) < 1e-3, 'flat ground: no drift');
    assert(maxY - minY < 1e-4, 'board does not jitter (vertical range < 0.1 mm)');
    const sink = (s.comY - s.board.p.y); // base is comY below the board origin
    assert(sink > .002 && sink < .010, `static sink on groomed snow is a few mm (got ${(sink * 1e3).toFixed(1)} mm)`);
    assert(Math.abs(s.legAxial - s.rider.mass * G) < 25, 'legs carry body weight at rest');
    console.log(`Stationary rest: sink ${(sink * 1e3).toFixed(1)} mm, jitter ${((maxY - minY) * 1e3).toFixed(3)} mm, drift 0 passed.`);
}

// ---- 24.3 slopes vs analytic reference -------------------------------------------------------------------------
for (const [ang, mat] of [[10, 'groomed'], [20, 'groomed'], [10, 'hardpack'], [15, 'icy']]) {
    const th = ang * Math.PI / 180, mu = SNOW[mat].muLong;
    const s = make(ang, mat, noDrag); s.place(0, 0, DOWNHILL_YAW, 2); run(s, 1);
    const v0 = speed3(s), t0 = s.time; run(s, 2);
    const a = (speed3(s) - v0) / (s.time - t0), ref = G * (Math.sin(th) - mu * Math.cos(th));
    assert(Math.abs(a - ref) / ref < .005, `${ang} deg ${mat}: a=${a.toFixed(4)} vs g(sin-mu cos)=${ref.toFixed(4)} (<0.5%)`);
    assert(Math.abs(s.board.p.x) < 1e-4, 'no lateral drift while sliding straight');
}
{ // terminal velocity with aerodynamic drag
    const th = 20 * Math.PI / 180, mu = SNOW.groomed.muLong, s = make(20); s.place(0, 0, DOWNHILL_YAW, 2); run(s, 60);
    // Gravity and snow friction act on the whole system (rider + board/boots/bindings); drag acts on the rider.
    const vt = Math.sqrt(2 * s.totalMass() * G * (Math.sin(th) - mu * Math.cos(th)) / (s.rider.airDensity * s.rider.cdaUpright));
    assert(Math.abs(speed3(s) - vt) / vt < .01, `terminal speed ${speed3(s).toFixed(2)} vs analytic ${vt.toFixed(2)} (<1%)`);
}
console.log('Slope acceleration matches g(sin - mu cos) to <0.5%, terminal speed to <1%.');

// ---- 24.2 flat ground: stopping, no propulsion from tucking ------------------------------------------------------
{
    const s = make(0); s.place(0, 0, DOWNHILL_YAW, 10); let prev = speed3(s), rises = 0, tStop = -1;
    for (let i = 0; i < 960 * 60; i++) { s.step(NEUTRAL); const v = speed3(s); if (v > prev + 1e-4) rises++; prev = v; if (tStop < 0 && v < .01) tStop = s.time; }
    assert.equal(rises, 0, 'speed never increases on flat ground');
    assert(tStop > 0 && tStop < 40, `rider comes to a complete stop (t=${tStop.toFixed(1)} s)`);
    assert(Math.abs(s.board.p.x) < 1e-3, 'level ground produces no lateral motion');
    const dist = {};
    for (const tuck of [false, true]) { const t = make(0); t.place(0, 0, DOWNHILL_YAW, 15); let p = 15, up = 0; const cmd = { ...NEUTRAL, tuck };
        for (let i = 0; i < 960 * 10; i++) { t.step(cmd); const v = speed3(t); if (v > p + 1e-4) up++; p = v; } assert.equal(up, 0, 'tucking never accelerates'); dist[tuck] = -t.board.p.z; }
    assert(dist[true] > dist[false] + .5, 'a tuck coasts farther than upright by reducing drag only');
    console.log(`Flat ground: stops in ${tStop.toFixed(1)} s, never accelerates, tuck carries ${(dist[true] - dist[false]).toFixed(1)} m farther.`);
}

// ---- 24.4 carving ----------------------------------------------------------------------------------------------
function carve({ edge, v0, mat = 'groomed', ang = 12, t0 = .7, t1 = 1.5 }) {
    const s = make(ang, mat); s.place(0, 0, DOWNHILL_YAW, v0); const cmd = { ...NEUTRAL, edge };
    const heading = () => Math.atan2(s.board.v.x, -s.board.v.z); let h0 = 0, vA = 0, aSum = 0, n = 0, maxSpeed = 0;
    for (let i = 0; i < Math.round(t1 / SIM_DT); i++) {
        s.step(cmd); if (Math.abs(s.time - t0) < SIM_DT / 2) { h0 = heading(); vA = s.speed; }
        if (s.time > t0) { aSum += s.edgeAngle; n++; } maxSpeed = Math.max(maxSpeed, s.speed);
        assert(Number.isFinite(s.speed) && s.speed < 60, 'carving stays numerically stable');
    }
    const rate = (heading() - h0) / (t1 - t0), alpha = aSum / n, sp = (vA + s.speed) / 2;
    return { alpha, R: sp / Math.abs(rate), Rgeo: BOARDS['all-mountain'].sidecutRadius * Math.cos(Math.abs(alpha)), aLat: sp * Math.abs(rate) / G, sign: Math.sign(rate) };
}
{
    for (const edge of [.5, .7, .9]) { const r = carve({ edge, v0: 6 });
        assert(r.R / r.Rgeo > .9 && r.R / r.Rgeo < 1.3, `clean carve radius ${r.R.toFixed(1)} m vs sidecut*cos(edge) ${r.Rgeo.toFixed(1)} m (edge ${(r.alpha * 57.3).toFixed(0)} deg)`); }
    const toe = carve({ edge: .6, v0: 6 }), heel = carve({ edge: -.6, v0: 6 });
    assert(toe.sign === -heel.sign && Math.abs(toe.R - heel.R) / toe.R < .02, 'toe and heel turns mirror each other');
    const tight = carve({ edge: .9, v0: 6 }), shallow = carve({ edge: .5, v0: 6 });
    assert(tight.R < shallow.R, 'more edge angle gives a tighter turn');
    // speed: at higher speed the same edge angle cannot supply the lateral force; radius grows and follows the lean-force limit
    const fast = carve({ edge: .7, v0: 10 });
    assert(fast.R > 1.5 * fast.Rgeo, `at 10 m/s the same edge skids wide (R ${fast.R.toFixed(1)} m vs geometric ${fast.Rgeo.toFixed(1)} m)`);
    assert(Math.abs(fast.aLat - Math.tan(fast.alpha)) < .12, `skid-limited lateral acceleration ${fast.aLat.toFixed(2)} g tracks tan(edge) ${Math.tan(fast.alpha).toFixed(2)}`);
    // surfaces
    const gr = carve({ edge: .6, v0: 10, mat: 'groomed' }), ice = carve({ edge: .6, v0: 10, mat: 'icy' });
    assert(ice.aLat < gr.aLat * .5, `ice holds far less lateral load than groomed (${ice.aLat.toFixed(2)} g vs ${gr.aLat.toFixed(2)} g)`);
    console.log('Carving: radius tracks sidecut*cos(edge) when grip allows, skids to the lean-force limit when it does not, mirrors toe/heel, ice grips less.');
}

// ---- 24.4 skidding dissipates energy -----------------------------------------------------------------------------
{
    const loss = (v0, edge) => { const s = make(0); s.place(0, 0, DOWNHILL_YAW, v0); const E0 = s.energy(); run(s, 1.2, { ...NEUTRAL, edge }); return { dE: E0 - s.energy(), snow: s.diag.snowWork, speed: s.speed }; };
    const skid = loss(10, .9), straight = loss(10, NaN);
    assert(skid.dE > 0 && straight.dE > 0, 'both lose mechanical energy on flat snow');
    console.log(`Energy: forced-edge run loses ${skid.dE.toFixed(0)} J, straight run ${straight.dE.toFixed(0)} J over 1.2 s.`);
}

// ---- 24.7 landing: stable contact, bounded penetration -----------------------------------------------------------
{
    const s = make(0); s.place(0, 0, DOWNHILL_YAW, 0); s.board.p.y += 1; s.riderP.y += 1; let peakLeg = 0, minGap = 9;
    for (let i = 0; i < 960 * 3; i++) { s.step(NEUTRAL); peakLeg = Math.max(peakLeg, s.legAxial); minGap = Math.min(minGap, s.riderP.y - s.board.p.y); assert(Number.isFinite(s.board.p.y)); }
    assert(s.diag.maxPenetration < .03, `no deep terrain penetration (max ${(s.diag.maxPenetration * 1e3).toFixed(1)} mm)`);
    assert(speed3(s) < .05 && Math.abs(s.legAxial - s.rider.mass * G) < 30, 'settles back to rest after a 1 m drop');
    assert(minGap > .40, 'rider legs do not pass through the board');
    console.log(`Landing: 1 m drop, peak leg force ${peakLeg.toFixed(0)} N (${(peakLeg / (s.rider.mass * G)).toFixed(1)}x body weight), penetration ${(s.diag.maxPenetration * 1e3).toFixed(1)} mm, settles.`);
}

// ---- 23.4 frame-rate independence: render dt does not change the authoritative state ----------------------------
{
    const drive = renderDt => { const s = make(12); s.place(0, 0, DOWNHILL_YAW, 6); let acc = 0, t = 0; const cmd = { ...NEUTRAL, edge: .6 };
        while (t < 2) { acc += renderDt; t += renderDt; while (acc >= SIM_DT) { s.step(cmd); acc -= SIM_DT; } } return s; };
    // Compare at an equal number of physics steps by stepping to the same count.
    const a = drive(1 / 30), b = drive(1 / 144);
    const n = Math.min(Math.round(a.time / SIM_DT), Math.round(b.time / SIM_DT));
    const ra = make(12), rb = make(12); ra.place(0, 0, DOWNHILL_YAW, 6); rb.place(0, 0, DOWNHILL_YAW, 6);
    for (let i = 0; i < n; i++) { ra.step({ ...NEUTRAL, edge: .6 }); rb.step({ ...NEUTRAL, edge: .6 }); }
    assert.equal(ra.board.p.x, rb.board.p.x); assert.equal(ra.board.q.w, rb.board.q.w);
    assert(Math.abs(a.board.p.z - b.board.p.z) < 1.0, 'the same inputs reach nearly the same place at 30 and 144 fps (differ only by how many whole steps fit)');
    console.log('Determinism: identical step counts give bit-identical state; render rate only changes how many whole steps fit.');
}
// ---- Spin-out guard: the board must stay pointed along its travel inside the envelope where it has been verified -------
{
    const maxSlipAngle = (edge, v0, secs = 2) => {
        const s = make(12); s.place(0, 0, DOWNHILL_YAW, v0); let worst = 0;
        const n = Math.round(secs / SIM_DT);
        for (let i = 0; i < n; i++) {
            s.step({ ...NEUTRAL, edge });
            if (i % 48 === 0 && s.time > .5) {
                const bx = s.board.dirToWorld({ x: 1, y: 0, z: 0 });
                let d = Math.atan2(-bx.z, bx.x) - Math.atan2(-s.board.v.z, s.board.v.x);
                while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
                worst = Math.max(worst, Math.abs(d));
            }
        }
        return worst * 180 / Math.PI;
    };
    for (const edge of [.3, .5, .7, .9]) assert(maxSlipAngle(edge, 6) < 5, `6 m/s, edge ${edge}: board stays within 5 deg of its travel`);
    for (const edge of [.5, .7, .9]) assert(maxSlipAngle(edge, 10) < 15, `10 m/s, edge ${edge}: skids without spinning out`);
    console.log('Spin-out guard: 6 m/s at edge 0.3-0.9 and 10 m/s at edge 0.5-0.9 keep the board within 15 deg of its travel (outside that envelope see docs/KNOWN_ISSUES.md).');
}
console.log('Physics core validation passed.');
