import { RigidBody } from './rigid-body.ts';
import { type V3, clamp, cross, dot, lerp, normalize, qFromAxisAngle, qMul, smoothstep, v3 } from './math3.ts';
import { type BoardSpec, type RiderSpec, type Station, DEFAULT_RIDER, makeStations } from './boards.ts';
import { type SimTerrain, terrainNormal, sampleContact, makeContactSample } from './terrain.ts';
import type { SnowMaterial } from './snow.ts';

export const G = 9.81;
/** Fixed physics step. 960 Hz keeps the stiffest snow contacts (hardpack, ice) inside the explicit-integration stability limit. */
export const SIM_DT = 1 / 960;

/**
 * Physical actuator commands from the rider. These are limited by rider strength and act through
 * contact; they are NOT positions or velocities that are assigned to the board. A separate "intent mapper"
 * (gamepad/keyboard -> these values) belongs in the input layer.
 */
export type RiderCommand = {
    /** Where the leg force is applied on the board relative to the binding centre (m): toe(+z)/heel(-z) and nose(+x)/tail(-x) pressure. */
    copZ: number; copX: number;
    /** Rider centre-of-mass target relative to the leg base in the board frame (m): lateral lean, fore/aft. */
    comZ: number; comX: number;
    /** 0 neutral .. 1 deepest crouch; negative values extend the legs toward full extension (-1), used for pops. */
    crouch: number;
    tuck: boolean;
    /** Pivot torque about the board's up axis (N m): rider twists hips/legs against the snow. The reaction torque on the
     *  upper body is not modelled in this single-point-mass rider, so this is limited by `maxPivotTorque`. */
    pivotTorque: number;
    /** Optional. Hip/shoulder twist torque (N m) between the upper body and the board: + turns the body toward +y yaw and
     *  pushes the board the other way. Internal: it can never change the total angular momentum. Wind-ups use this. */
    upperTorque?: number;
    /** Optional 0..1: how compact the body is (grab, tuck, pulled-in arms). Lowers the body's yaw inertia; momentum is kept. */
    compact?: number;
    /** Target edge angle (rad, + = toe edge down) produced by ankle/knee roll torque. NaN = passive ankles (no roll torque). */
    edge: number;
    /** EXPERIMENTAL, off by default: the rider aligns the leg axis with the ground-reaction direction they feel (filtered
     *  acceleration). This feedback loop is marginally stable and can make the board hop during carves; it needs redesign
     *  (see docs). comX/comZ are deliberate lean added to it. */
    balance: boolean;
};
export const NEUTRAL: RiderCommand = { copZ: 0, copX: 0, comZ: 0, comX: 0, crouch: .3, tuck: false, pivotTorque: 0, edge: NaN, balance: false };

export type StationState = { contact: boolean; depth: number; normalForce: number; slip: number; lateralForce: number; engagement: number };
export type Diagnostics = {
    /** Cumulative work done on the system by snow contact forces (J). Negative = dissipated. */
    snowWork: number;
    /** Cumulative work by aerodynamic drag (J). */
    dragWork: number;
    /** Cumulative work done by rider leg force on the rider-board pair net of stored spring energy is not tracked; see energyOf(). */
    maxPenetration: number;
    maxNormalForce: number;
    contacts: number;
};

const SCRATCH = { n: v3(), vp: v3(), r: v3(), ra: v3(), tl: v3(), tz: v3(), te: v3(), ta: v3(), vt: v3(), pw: v3(), f: v3(), ex: v3(), ey: v3(), ez: v3(), w: v3(), t: v3(), t2: v3() };

/**
 * Snowboard + rider simulation.
 *
 *  - Board: 6-DOF rigid body (quaternion, angular momentum form), origin at the board's centre of mass.
 *    Board frame: +x nose, +y up (deck normal), +z toe side for a regular stance.
 *  - Rider: point mass on a telescoping leg (spring-damper + muscle) attached at the centre of pressure on the board;
 *    the COM is held at a commanded lateral/fore-aft offset by an ankle/hip force limited by rider strength.
 *    Rider rotation (torso, spins) is NOT modelled here yet.
 *  - Snow: contact stations along both edges. Each station has progressive compliant bearing support, rate-dependent
 *    damping (energy lost to compaction), frictional sliding, plowing from displaced snow, and edge grip along the
 *    local edge tangent (sidecut). Edge grip is capped by a friction limit proportional to the station's normal force.
 */
export class SnowboardSim {
    spec: BoardSpec; rider: RiderSpec; terrain: SimTerrain;
    board: RigidBody;
    riderP: V3 = v3(); riderV: V3 = v3();
    stations: Station[]; state: StationState[];
    time = 0;
    diag: Diagnostics = { snowWork: 0, dragWork: 0, maxPenetration: 0, maxNormalForce: 0, contacts: 0 };
    boardMass: number;
    /** Board-frame y of the board's centre of mass above the base plane (bindings sit on top). */
    comY = .03;
    maxPivotTorque = 60;
    /** Height of the force application point (binding top) above the board COM. */
    private legBaseY: number;
    readonly lateralAuthority: number;
    legForce = v3(); legAxial = 0;
    /** Board edge angle relative to the snow surface (rad, + = toe edge down), updated every step. */
    edgeAngle = 0;
    rollTorque = 0;
    /** Lateral support the rider's ankles/hips must supply divided by what they can (>1 = cannot hold this lean). */
    balanceLoad = 0;
    private riderReaction = v3(); private prevContacts = 0;
    /** Exponent of the active-contact count used to share the normal-damper stability budget (1 = split evenly). */
    damperShareExp = 1;
    /** Fraction of the normal velocity one step of damping may remove (stability budget before sharing). */
    damperCap = 2;
    /** Rider yaw about the board normal relative to the board (rad), its yaw rate (rad/s), and the passive twist coupling. */
    riderTwist = 0; riderYawRate = 0;
    twistK = 400; twistC = 26; maxTwistTorque = 200;
    /** Anatomical hip/shoulder twist range relative to the board (rad), enforced by a stiff passive end stop. */
    maxTwist = 1.25;
    /** Strongest hip/shoulder twist the rider can produce (N m). Uncalibrated estimate. */
    maxUpperTorque = 210;
    /** Current yaw inertia of the body (kg m^2), lowered by `compact`. */
    riderYawInertia: number;
    /** Steady wind at the rider (m/s, world). Drag acts on the air-relative velocity. */
    wind: V3 = v3();
    /** Contacts touching a rail / box this step, and the summed normal force of all contacts (N). */
    railContacts = 0; totalNormal = 0;
    private cs = makeContactSample(); private centerN = v3();
    private vSysPrev = v3(); private aFilt = v3(); private haveVPrev = false;
    /** Time constant of the rider's acceleration sense (s): vestibular + proprioceptive delay. */
    senseTau = .05;
    maxRollTorque = 300;
    /** Lateral resistance an engaged edge keeps once it slides, as a fraction of its peak hold, and the slip speed (m/s)
     *  over which the hold falls to it. A sliding edge still scrapes and plows a wall of snow. Uncalibrated estimates. */
    slideRetention = .45; stribeckV = .35;
    /** Extra lateral hold of the trailing edge half running in the leading half's groove (fraction). Uncalibrated. */
    grooveHold = 1;
    /** Leg extension speed at which push-off force reaches zero (m/s), Hill force-velocity curve. Estimate. */
    legVmax = 3.6;
    /** Fastest the rider can sweep the board's edge angle (rad/s): a rider cannot snap onto an edge. */
    maxEdgeRate = 3.5;
    private edgeTargetF = 0; private edgeActive = false;

    constructor(spec: BoardSpec, terrain: SimTerrain, rider: RiderSpec = DEFAULT_RIDER, lateralAuthority = 1) {
        this.spec = spec; this.terrain = terrain; this.rider = rider; this.lateralAuthority = lateralAuthority;
        this.boardMass = spec.mass + rider.gearMass;
        const m = this.boardMass, L = spec.length, W = spec.tipWidth;
        // Effective inertia: plank plus rigidly coupled boots/lower legs (about 0.2 m above the base).
        const roll = m * (W * W / 12) + rider.gearMass * .2 * .2 + .08;
        const pitch = m * L * L / 12 * 1.05, yaw = pitch + roll * .5;
        this.board = new RigidBody(m, [roll, yaw, pitch]);
        this.stations = makeStations(spec);
        this.state = this.stations.map(() => ({ contact: false, depth: 0, normalForce: 0, slip: 0, lateralForce: 0, engagement: 0 }));
        this.legBaseY = rider.footHeight - this.comY;
        this.riderYawInertia = rider.yawInertia;
    }

    /** Place the board flat on the terrain at (x,z) heading `yaw` (rotation about +y; 0 = nose toward +x), rider settled at neutral posture. */
    place(x: number, z: number, yaw: number, speed = 0, pitchToSlope = true) {
        const t = this.terrain, b = this.board;
        const h = t.height(x, z), n = terrainNormal(t, x, z, v3());
        b.p.x = x; b.p.z = z; b.p.y = h + this.comY;
        // Orientation: yaw about world up, then tilt so the deck normal equals the terrain normal.
        const qYaw = qFromAxisAngle(v3(0, 1, 0), yaw);
        const axis = cross(v3(0, 1, 0), n), s = Math.hypot(axis.x, axis.y, axis.z);
        const qTilt = s > 1e-9 ? qFromAxisAngle(axis, Math.asin(Math.min(1, s))) : { x: 0, y: 0, z: 0, w: 1 };
        const q = qMul(qTilt, qYaw);
        b.q.x = q.x; b.q.y = q.y; b.q.z = q.z; b.q.w = q.w;
        b.v.x = b.v.y = b.v.z = 0; b.L.x = b.L.y = b.L.z = 0; b.refresh();
        // Velocity along the board's forward axis, in the terrain plane.
        const fwd = b.dirToWorld(v3(1, 0, 0), v3());
        b.v.x = fwd.x * speed; b.v.y = fwd.y * speed; b.v.z = fwd.z * speed;
        // Rider at the leg base + neutral posture, moving with the board.
        const base = this.legBasePoint(v3(0, 0, 0), v3());
        const up = b.dirToWorld(v3(0, 1, 0), v3());
        this.riderP.x = base.x + up.x * this.rider.heightNeutral; this.riderP.y = base.y + up.y * this.rider.heightNeutral; this.riderP.z = base.z + up.z * this.rider.heightNeutral;
        this.riderV.x = b.v.x; this.riderV.y = b.v.y; this.riderV.z = b.v.z;
        this.riderTwist = 0; this.riderYawRate = 0; this.riderYawInertia = this.rider.yawInertia;
        this.edgeActive = false; this.haveVPrev = false;
        void pitchToSlope;
    }
    legBasePoint(cop: { x?: number; z?: number } | V3, out: V3) {
        const local = SCRATCH.t; local.x = -this.spec.setback + (cop.x ?? 0); local.y = this.legBaseY; local.z = cop.z ?? 0;
        return this.board.toWorld(local, out);
    }
    get speed() { return Math.hypot(this.board.v.x, this.board.v.y, this.board.v.z); }
    /** Rider + board mechanical energy relative to y = 0 (J). */
    energy() {
        const b = this.board, rm = this.rider.mass;
        return b.kineticEnergy() + b.mass * G * b.p.y + .5 * rm * dot(this.riderV, this.riderV) + rm * G * this.riderP.y;
    }
    totalMass() { return this.boardMass + this.rider.mass; }

    step(cmd: RiderCommand, dt = SIM_DT) {
        const b = this.board, rd = this.rider, S = SCRATCH;
        b.clearForces();
        const ex = b.dirToWorld(v3(1, 0, 0), S.ex), ey = b.dirToWorld(v3(0, 1, 0), S.ey), ez = b.dirToWorld(v3(0, 0, 1), S.ez);

        // ---- Rider leg (telescoping spring-damper + muscle) and ankle/hip lateral hold -------------------
        const base = this.legBasePoint({ x: clamp(cmd.copX, -.12, .12), z: clamp(cmd.copZ, -.125, .125) }, S.pw);
        const vBase = b.velocityAt(base, S.vp);
        const crouch = clamp(cmd.crouch, -1, 1);
        const lRef = crouch >= 0 ? lerp(rd.heightNeutral, rd.heightMin, crouch) : lerp(rd.heightNeutral, rd.heightMax * .985, -crouch);
        // Edge angle relative to the snow (from the surface normal at the board centre). Computed once per step.
        terrainNormal(this.terrain, b.p.x, b.p.z, this.centerN);
        S.n.x = this.centerN.x; S.n.y = this.centerN.y; S.n.z = this.centerN.z;
        this.edgeAngle = Math.atan2(-dot(S.n, ez), dot(S.n, ey));
        // Rider's sense of the ground reaction: filtered system acceleration + g.
        const M = b.mass + rd.mass;
        const vsx = (b.mass * b.v.x + rd.mass * this.riderV.x) / M, vsy = (b.mass * b.v.y + rd.mass * this.riderV.y) / M, vsz = (b.mass * b.v.z + rd.mass * this.riderV.z) / M;
        if (this.haveVPrev) {
            const k = dt / (this.senseTau + dt);
            this.aFilt.x += ((vsx - this.vSysPrev.x) / dt - this.aFilt.x) * k; this.aFilt.y += ((vsy - this.vSysPrev.y) / dt - this.aFilt.y) * k; this.aFilt.z += ((vsz - this.vSysPrev.z) / dt - this.aFilt.z) * k;
        }
        this.vSysPrev.x = vsx; this.vSysPrev.y = vsy; this.vSysPrev.z = vsz; this.haveVPrev = true;
        let reflexX = 0, reflexZ = 0;
        if (cmd.balance === true) {
            S.w.x = this.aFilt.x; S.w.y = this.aFilt.y + G; S.w.z = this.aFilt.z;       // ground-reaction direction per unit mass
            const gl = b.dirToLocal(S.w, S.t2);                                            // in the board frame
            if (gl.y > .2 * G) {                                                           // ignore while (nearly) unloaded
                const lim = Math.tan(45 * Math.PI / 180);
                reflexX = clamp(gl.x / gl.y, -lim, lim) * lRef; reflexZ = clamp(gl.z / gl.y, -lim, lim) * lRef;
            }
        }
        // Leg axis: from the leg base toward the COM target (reflex + deliberate lean).
        const tx = clamp(reflexX + cmd.comX, -.6, .6), tz = clamp(reflexZ + cmd.comZ, -.75, .75);
        const axisLocal = S.t2; axisLocal.x = tx; axisLocal.y = lRef; axisLocal.z = tz;
        const refLen = Math.hypot(tx, lRef, tz);
        const a = b.dirToWorld(axisLocal, S.ta); normalize(a);
        const dx = this.riderP.x - base.x, dy = this.riderP.y - base.y, dz = this.riderP.z - base.z;
        // The rider's lean is a stiff commanded constraint: the leg line is held on the target axis `a`. Axial = suspension.
        const lx = a.x, ly = a.y, lz = a.z;
        const len = dx * a.x + dy * a.y + dz * a.z;
        const rvx = this.riderV.x - vBase.x, rvy = this.riderV.y - vBase.y, rvz = this.riderV.z - vBase.z;
        const lenRate = rvx * a.x + rvy * a.y + rvz * a.z;
        // Axial: spring to the reference length, damper, and muscle feed-forward carrying body weight along the axis.
        const ff = rd.mass * G * a.y;
        let fAx = rd.legK * (refLen - len) - rd.legC * lenRate + ff;
        if (crouch < 0 && len < refLen) {
            // Active push-off (pop): muscle force limited by the Hill force-velocity relation instead of the passive
            // damper, so the push weakens as the legs extend faster. Ends at the commanded extension.
            const vMax = this.legVmax;
            fAx = Math.max(fAx, -crouch * rd.maxLegForce * clamp(1 - lenRate / vMax, 0, 1));
        }
        fAx = clamp(fAx, -rd.maxLegPull, rd.maxLegForce);
        // Mechanical end stops (passive).
        const lMin = rd.heightMin * .92, lMax = rd.heightMax;
        if (len < lMin) fAx += 8e4 * (lMin - len) - 2000 * Math.min(0, lenRate);
        if (len > lMax) fAx -= 8e4 * (len - lMax) + 2000 * Math.max(0, lenRate);
        // Transverse: hold the COM on the axis (stiff PD). The hold is NOT capped at realistic ankle strength (that made the rider
        // numerically escape the board); instead `balanceLoad` reports demand / realistic capacity so overload can cause a fall.
        const kT = 7.4e4, cT = 4700;
        const ox = dx - a.x * len, oy = dy - a.y * len, oz = dz - a.z * len;
        const vA = rvx * a.x + rvy * a.y + rvz * a.z;
        let ftx = -kT * ox - cT * (rvx - a.x * vA), fty = -kT * oy - cT * (rvy - a.y * vA), ftz = -kT * oz - cT * (rvz - a.z * vA);
        const fTn = Math.hypot(ftx, fty, ftz), fTcap = rd.maxAnkleTorque * this.lateralAuthority / Math.max(.35, len);
        this.balanceLoad = fTn / fTcap;
        const fTmax = 2500;
        if (fTn > fTmax) { const k = fTmax / fTn; ftx *= k; fty *= k; ftz *= k; }
        const fx = lx * fAx + ftx, fy = ly * fAx + fty, fz = lz * fAx + ftz;
        this.legForce.x = fx; this.legForce.y = fy; this.legForce.z = fz; this.legAxial = fAx;
        // Equal and opposite on the board at the leg base.
        S.f.x = -fx; S.f.y = -fy; S.f.z = -fz;
        b.applyForceAtPoint(S.f, base);

        // Ankle/knee roll actuator: PD toward the commanded edge angle, limited by strength. The torque acts on the board;
        // its reaction is a force couple on the rider COM and leg base (net external torque on rider+board is zero).
        this.rollTorque = 0;
        if (Number.isFinite(cmd.edge)) {
            const wRoll = dot(b.w, ex);
            const tgt = clamp(cmd.edge, -1.15, 1.15), maxStep = this.maxEdgeRate * dt;
            if (!this.edgeActive) { this.edgeTargetF = this.edgeAngle; this.edgeActive = true; }
            this.edgeTargetF += clamp(tgt - this.edgeTargetF, -maxStep, maxStep);
            const tau = clamp(1500 * (this.edgeTargetF - this.edgeAngle) - 60 * wRoll, -this.maxRollTorque, this.maxRollTorque);
            this.rollTorque = tau;
            S.w.x = ex.x * tau; S.w.y = ex.y * tau; S.w.z = ex.z * tau; b.applyTorque(S.w);
            // Reaction: a force couple (F on the rider COM, -F on the board at the leg base) whose moment about the base
            // cancels the roll torque on the board. For l a x F = -tau ex_perp the solution perpendicular to the leg is F = (tau/l)(a x ex).
            const ln = Math.max(.35, len), Fc = tau / ln;
            S.ta.x = lx; S.ta.y = ly; S.ta.z = lz;
            const ax = cross(S.ta, ex, S.t2);
            const kx = Fc * ax.x, ky = Fc * ax.y, kz = Fc * ax.z;
            this.riderReaction.x = kx; this.riderReaction.y = ky; this.riderReaction.z = kz;
            S.f.x = -kx; S.f.y = -ky; S.f.z = -kz; b.applyForceAtPoint(S.f, base);
        } else { this.edgeActive = false; this.riderReaction.x = this.riderReaction.y = this.riderReaction.z = 0; }

        // Posture changes the body's yaw inertia; its angular momentum is kept, so pulling in spins faster.
        const iNew = rd.yawInertia * (1 - .45 * clamp(cmd.compact ?? 0, 0, 1));
        if (iNew !== this.riderYawInertia) { this.riderYawRate *= this.riderYawInertia / iNew; this.riderYawInertia = iNew; }
        // Pivot (legs twisting the board) and upper-body twist are both internal torques between the body and the board:
        // the board gets +tau about its normal and the body gets -tau. Net rotation can only come from the snow resisting
        // the board (on the ground) or from momentum already present (in the air).
        const pt = clamp(cmd.pivotTorque, -this.maxPivotTorque, this.maxPivotTorque)
            - clamp(cmd.upperTorque ?? 0, -this.maxUpperTorque, this.maxUpperTorque);
        if (pt !== 0) { S.w.x = ey.x * pt; S.w.y = ey.y * pt; S.w.z = ey.z * pt; b.applyTorque(S.w); this.riderYawRate -= pt / this.riderYawInertia * dt; }

        // Rider yaw: the body has real yaw inertia and is coupled to the board through boots, legs and hips by a passive
        // torsional spring-damper that saturates at what the rider can hold, plus a stiff anatomical end stop.
        if (this.twistK > 0) {
            const wb = dot(b.w, ey);
            const over = Math.abs(this.riderTwist) > this.maxTwist ? (Math.abs(this.riderTwist) - this.maxTwist) * Math.sign(this.riderTwist) : 0;
            let tw = clamp(-this.twistK * this.riderTwist - this.twistC * (this.riderYawRate - wb), -this.maxTwistTorque, this.maxTwistTorque);
            if (over !== 0) tw += -6000 * over - 120 * (this.riderYawRate - wb);
            S.w.x = -ey.x * tw; S.w.y = -ey.y * tw; S.w.z = -ey.z * tw; b.applyTorque(S.w);
            this.riderYawRate += tw / this.riderYawInertia * dt;
            this.riderTwist += (this.riderYawRate - wb) * dt;
        }

        // ---- Gravity -----------------------------------------------------------------------------------
        b.force.y -= b.mass * G;
        let rax = (fx + this.riderReaction.x) / rd.mass, ray = (fy + this.riderReaction.y) / rd.mass - G, raz = (fz + this.riderReaction.z) / rd.mass;

        // ---- Aerodynamic drag on the rider+board (tucking reduces drag area, it adds no thrust) -------------
        const cda = cmd.tuck ? rd.cdaTuck : rd.cdaUpright;
        const ux = this.riderV.x - this.wind.x, uy = this.riderV.y - this.wind.y, uz = this.riderV.z - this.wind.z;
        const vr = Math.hypot(ux, uy, uz);
        if (vr > 1e-6) {
            const k = .5 * rd.airDensity * cda * vr / rd.mass;
            rax -= k * ux; ray -= k * uy; raz -= k * uz;
            this.diag.dragWork -= k * rd.mass * (ux * this.riderV.x + uy * this.riderV.y + uz * this.riderV.z) * dt;
        }

        // ---- Snow contact ---------------------------------------------------------------------------------
        this.contact(dt, ex, ey, ez, cmd);

        // ---- Integrate ------------------------------------------------------------------------------------
        this.riderP.x += (this.riderV.x + .5 * rax * dt) * dt; this.riderP.y += (this.riderV.y + .5 * ray * dt) * dt; this.riderP.z += (this.riderV.z + .5 * raz * dt) * dt;
        this.riderV.x += rax * dt; this.riderV.y += ray * dt; this.riderV.z += raz * dt;
        b.integrate(dt);
        this.time += dt;
    }

    private contact(dt: number, ex: V3, ey: V3, ez: V3, cmd: RiderCommand) {
        const b = this.board, S = SCRATCH, sp = this.spec, d = this.diag;
        d.contacts = 0; this.railContacts = 0; this.totalNormal = 0;
        // Stability budget: stations act in parallel on one body, so each may only use its share of the stable impulse.
        const share = Math.max(1, this.prevContacts) ** this.damperShareExp;
        // Board edge angle relative to the snow (positive: toe edge down), from the surface normal at the centre.
        const cn = this.centerN;
        const nyB = dot(cn, ey), nzB = dot(cn, ez);
        const alpha = Math.atan2(-nzB, nyB);
        for (let i = 0; i < this.stations.length; i++) {
            const st = this.stations[i], ss = this.state[i];
            ss.contact = false; ss.normalForce = 0; ss.lateralForce = 0; ss.slip = 0; ss.depth = 0; ss.engagement = 0;
            // Station world position on the base plane.
            const loc = S.t; loc.x = st.x; loc.y = st.lift - this.comY; loc.z = st.z;
            const pw = b.toWorld(loc, S.pw);
            const c = sampleContact(this.terrain, pw.x, pw.z, pw.y, this.cs);
            const vert = c.h - pw.y;
            if (vert <= 0) continue;
            const n = S.n; n.x = c.nx; n.y = c.ny; n.z = c.nz;
            const pen = vert * n.y;                       // penetration along the surface normal
            const mat: SnowMaterial = c.mat;
            // Velocity of the station point.
            b.velocityAt(pw, S.vp);
            const vn = dot(S.vp, n);
            // Lever arm and effective mass at this point for stability clamps.
            S.r.x = pw.x - b.p.x; S.r.y = pw.y - b.p.y; S.r.z = pw.z - b.p.z;
            const effInvMass = (dir: V3) => {
                cross(S.r, dir, S.ra); const iw = b.invInertiaMul(S.ra, S.t2);
                return b.invMass + dot(S.ra, iw);
            };
            const mEffN = 1 / effInvMass(n);
            // ---- normal force: progressive elastic support + compaction damping ----
            const prog = 1 + (pen / mat.yieldDepth) ** 2;
            const fEl = st.area * mat.bearing * pen * prog;
            // Compression is damped by the full coefficient; rebound by 20%: compacted snow does not push back as hard (energy loss).
            let fDamp = vn < 0 ? st.area * mat.compDamp * -vn : -st.area * .2 * mat.compDamp * vn;
            const fDampMax = this.damperCap * mEffN * Math.abs(vn) / (dt * share);
            fDamp = clamp(fDamp, -fDampMax, fDampMax);
            const fn = Math.max(0, fEl + fDamp);
            if (fn <= 0) continue;
            ss.contact = true; ss.depth = pen; ss.normalForce = fn; this.totalNormal += fn; if (c.rail) this.railContacts++;
            d.contacts++; d.maxPenetration = Math.max(d.maxPenetration, pen); d.maxNormalForce = Math.max(d.maxNormalForce, fn);

            // ---- contact-plane axes ----
            // Long axis projected into the snow plane.
            const el = dot(ex, n);
            S.tl.x = ex.x - n.x * el; S.tl.y = ex.y - n.y * el; S.tl.z = ex.z - n.z * el; normalize(S.tl);
            const ezn = dot(ez, n);
            S.tz.x = ez.x - n.x * ezn; S.tz.y = ez.y - n.y * ezn; S.tz.z = ez.z - n.z * ezn; normalize(S.tz);
            // Edge engagement from edge angle and bite.
            const edgeAngle = st.edge * alpha;
            const engage = smoothstep(edgeAngle, sp.biteStart, sp.biteFull) * mat.edgeBite;
            ss.engagement = engage;
            // Effective sidecut radius of a tilted board: R * cos(edge angle).
            const rEff = sp.sidecutRadius * Math.max(.25, Math.cos(clamp(Math.abs(alpha), 0, 1.3)));
            const slope = st.edge * (st.x / rEff) * engage;
            S.te.x = S.tl.x + S.tz.x * slope; S.te.y = S.tl.y + S.tz.y * slope; S.te.z = S.tl.z + S.tz.z * slope; normalize(S.te);
            cross(n, S.te, S.ta);                                   // across the edge, in the snow plane
            // Tangential velocity.
            S.vt.x = S.vp.x - n.x * vn; S.vt.y = S.vp.y - n.y * vn; S.vt.z = S.vp.z - n.z * vn;
            const u = dot(S.vt, S.te), s = dot(S.vt, S.ta);
            const speedT = Math.hypot(u, s);
            ss.slip = s;

            // ---- friction forces (total tangential force accumulated here) ----
            // Along the edge: kinetic sliding friction.
            const vReg = .03;
            let fu = -mat.muLong * fn * Math.tanh(u / vReg);
            // Across the edge: grip limited by the friction cone. Static capacity falls toward a lower sliding level with slip speed.
            const muEdge = Math.tan(mat.phiDeg * Math.PI / 180);
            // Groove following: while the board tracks along its length, the trailing half of the edge runs in the groove
            // the leading half has just cut, so its lateral hold is backed by the groove wall. Not when skidding sideways.
            const vAlong = dot(b.v, ex), vAcross = dot(b.v, ez);
            const tracking = Math.abs(vAlong) > 1 ? Math.exp(-((vAcross / (.3 * Math.abs(vAlong))) ** 2)) : 0;
            const trailing = st.x * vAlong < 0 ? Math.min(1, Math.abs(st.x) / (sp.effectiveEdge * .25)) : 0;
            const groove = 1 + this.grooveHold * engage * tracking * trailing;
            const muCap = lerp(mat.muLatFlat, muEdge * groove, engage);
            const muSlide = lerp(mat.muLatFlat, this.slideRetention * muEdge * groove, engage);
            const mu = muSlide + (muCap - muSlide) * Math.exp(-((s / this.stribeckV) ** 2));
            let fs = -mu * fn * Math.tanh(s / vReg);
            // Plowing: displaced snow takes momentum from the board (frontal along the board and side area when sliding).
            // Only depth beyond the support compression displaces snow ahead of/beside the board: the few mm a firm surface
            // compresses under load is not a bow wave. Soft snow, where the board sinks well past this, plows strongly.
            const penPlow = Math.max(0, pen - .004 - .12 * mat.yieldDepth);
            const plow = mat.plowDensity * penPlow * speedT;
            const frontal = st.area / st.dx;                         // local half-width
            const fpu = -plow * frontal * u * (st.x > sp.length / 2 - .3 ? 1 : .15);
            const fps = -plow * st.dx * s;
            fu += fpu; fs += fps;
            // Stability: a friction impulse may not reverse the slip within a step.
            const mEffU = 1 / effInvMass(S.te), mEffS = 1 / effInvMass(S.ta);
            // Friction slip directions differ per station, so each may use its full stable impulse (sharing is needed only for the
            // normal damper, where every station pushes along the same direction).
            fu = clamp(fu, -mEffU * Math.abs(u) / dt, mEffU * Math.abs(u) / dt);
            fs = clamp(fs, -mEffS * Math.abs(s) / dt, mEffS * Math.abs(s) / dt);
            ss.lateralForce = fs;

            S.f.x = n.x * fn + S.te.x * fu + S.ta.x * fs;
            S.f.y = n.y * fn + S.te.y * fu + S.ta.y * fs;
            S.f.z = n.z * fn + S.te.z * fu + S.ta.z * fs;
            b.applyForceAtPoint(S.f, pw);
            d.snowWork += dot(S.f, S.vp) * dt;
        }
        this.prevContacts = d.contacts;
        void cmd;
    }
}
