import { NEUTRAL, type RiderCommand, type SnowboardSim } from './snowboard-sim.ts';
import { clamp, dot, v3 } from './math3.ts';

/**
 * Rider intent -> physical rider commands.
 *
 * The player expresses INTENT (lean into a turn, press the tail, wind the shoulders, compress and extend). This module
 * turns intent into the actuator commands of `SnowboardSim` (edge angle target, centre of pressure, leg length, internal
 * twist torques). It never sets a position, velocity, heading or orientation: every result comes from the simulation.
 *
 * It also contains the rider's own reflexes (keeping the board pointed along the travel direction with hip/leg twist,
 * picking the trailing edge when sliding sideways). Their strength depends on the selected assist level, which is an
 * explicit, user-visible setting. Nothing here switches physics off.
 */
export type RiderIntent = {
    /** -1..1, + = turn to the rider's right of travel (screen right in the chase camera). */
    steer: number;
    /** -1..1 fore/aft pressure relative to travel: + toward the leading end (nose when riding forward). */
    lean: number;
    /** -1..1 shoulder/hip wind: + = rotate clockwise seen from above. */
    wind: number;
    /** 0..1 leg compression. Releasing after compressing extends the legs (pop). */
    crouch: number;
    /** 0..1 speed check / stop. */
    brake: number;
    tuck: boolean;
    /** Grab requested (pulls the knees up and the body in). */
    grab: boolean;
    /** -1..1 throw for inversions: + = backward (toward the heels / tail), - = forward. */
    flip: number;
};
export const IDLE_INTENT: RiderIntent = { steer: 0, lean: 0, wind: 0, crouch: 0, brake: 0, tuck: false, grab: false, flip: 0 };
export type AssistLevel = 'authentic' | 'balanced' | 'beginner';
export type Stance = 'regular' | 'goofy';

const ASSIST = {
    // yaw reflex gains (N m/rad, N m s/rad), max leg/hip pivot torque (N m), max commanded edge (rad), and whether the
    // rider is prevented from tipping onto the leading edge while sliding.
    // `level`: gain (N m/rad) of the landing-preparation assist that pitches the board toward the snow below while
    // airborne. Authentic leaves board pitch entirely to the player's lean input.
    authentic: { kp: 150, kd: 14, pivot: 60, edge: 1.0, guardLeading: false, landingPivot: 60, level: 0 },
    balanced: { kp: 230, kd: 20, pivot: 90, edge: .95, guardLeading: false, landingPivot: 150, level: 500 },
    beginner: { kp: 320, kd: 26, pivot: 120, edge: .8, guardLeading: true, landingPivot: 220, level: 900 },
};

const smooth = (x: number, a: number, b: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/**
 * Edge angle a rider commits to for a steering intent. At speed, a partly engaged edge (about 0.1-0.28 rad) is a
 * transitional state the model cannot hold without spinning out (see docs/KNOWN_ISSUES.md), and real riders at speed
 * either glide flat or commit to the edge, so the mapping passes through that band. Above ~16 m/s the full edge is
 * reduced slightly because the sidecut would demand more lateral force than any lean can supply.
 */
export function edgeForSteer(steer: number, speed: number, maxEdge: number) {
    const m = clamp(Math.abs(steer), 0, 1), sign = Math.sign(steer);
    const top = maxEdge * (1 - .12 * smooth(speed, 15, 19));
    const linear = m * top;
    const banded = m < .12 ? m / .12 * .08 : .28 + (m - .12) / .88 * (top - .28);
    const w = smooth(speed, 8, 11);
    return sign * (linear * (1 - w) + banded * w);
}
export type PopPhase = 'none' | 'load' | 'extend';
export class RiderController {
    assist: AssistLevel = 'balanced';
    stance: Stance = 'regular';
    /** +1 nose-first, -1 tail-first (switch). Hysteresis keeps it stable at low speed. */
    travelSign: 1 | -1 = 1;
    pop: PopPhase = 'none';
    popTimer = 0;
    /** Leg compression achieved when the pop was released (0..1); for feedback and replays. */
    popLoad = 0;
    /** Pop variant decided by where the pressure was when loading: tail (ollie) or nose (nollie). */
    popEnd: 'tail' | 'nose' = 'tail';
    braking = 0; brakeTime = 0; brakeUnweight = false; brakeDug = false;
    /** Spin direction prepared during the load (-1..1) and time since the unwind started (s). */
    windPrep = 0; unwindTimer = 9;
    /** Gain of the fore/aft pressure reflex (m of centre-of-pressure shift per rad of slip error). */
    copGain = 0;
    private prevSlip = 0; private havePrev = false; private brakeSign = 1;
    readonly cmd: RiderCommand = { ...NEUTRAL, edge: 0 };
    /** Softness of the snow under the board, 0 (firm) .. 1 (fresh powder). Read by the renderer too. */
    soft = 0;
    /** Seconds since the last touchdown (set by the caller); a short window where landing reflexes are strongest. */
    sinceLanding = 9;
    private ex = v3(); private ey = v3(); private ez = v3();

    reset() { this.pop = 'none'; this.popTimer = 0; this.braking = 0; this.havePrev = false; this.travelSign = 1; this.sinceLanding = 9; Object.assign(this.cmd, NEUTRAL, { edge: 0 }); }

    /** Slip angle between the board's long axis and the velocity, in the snow plane (rad, + = velocity toward +z). */
    slipAngle(sim: SnowboardSim) {
        const b = sim.board;
        b.dirToWorld({ x: 1, y: 0, z: 0 }, this.ex); b.dirToWorld({ x: 0, y: 0, z: 1 }, this.ez);
        const vx = dot(b.v, this.ex), vz = dot(b.v, this.ez);
        return Math.atan2(vz, Math.abs(vx) + 1e-6);
    }

    update(sim: SnowboardSim, intent: RiderIntent, grounded: boolean, dt: number): RiderCommand {
        const a = ASSIST[this.assist], c = this.cmd, b = sim.board;
        b.dirToWorld({ x: 1, y: 0, z: 0 }, this.ex); b.dirToWorld({ x: 0, y: 1, z: 0 }, this.ey); b.dirToWorld({ x: 0, y: 0, z: 1 }, this.ez);
        const vx = dot(b.v, this.ex), vz = dot(b.v, this.ez), planar = Math.hypot(vx, vz);
        if (grounded && planar > .6 && this.braking <= .05) { if (vx > .25 * planar) this.travelSign = 1; else if (vx < -.25 * planar) this.travelSign = -1; }
        const fwd = this.travelSign;
        this.sinceLanding += dt;

        // ---- pop: load (compress, pressure toward one end), then extend hard ----------------------------------------
        if (intent.crouch > .2 && this.pop === 'none' && grounded) { this.pop = 'load'; this.popEnd = intent.lean > .4 ? 'nose' : 'tail'; }
        if (this.pop === 'load' && intent.crouch <= .2) {
            if (grounded) { this.pop = 'extend'; this.popTimer = 0; this.unwindTimer = 0; this.popLoad = clamp((sim.rider.heightNeutral - this.legLength(sim)) / (sim.rider.heightNeutral - sim.rider.heightMin), 0, 1); }
            else this.pop = 'none';
        }
        if (this.pop === 'extend') { this.popTimer += dt; if (this.popTimer > .2) this.pop = 'none'; }
        this.unwindTimer += dt;
        if (this.pop === 'load') this.windPrep = Math.abs(intent.wind) > .25 ? intent.wind : 0;
        // Upper body: during the load a held spin direction counter-winds the shoulders; the pop unwinds them hard toward
        // that direction. Otherwise the stick twists the body directly. Always an internal, strength-limited torque.
        const unwinding = this.unwindTimer < .42 && this.windPrep !== 0;
        // The unwind starts a few hundredths into the extension and, while the board is still on the snow, the muscles
        // stop driving near the far end of the hip/shoulder range instead of slamming into it (which would hand the
        // rotation to the board while the snow can still stop it).
        const nearStop = grounded && this.windPrep !== 0 && -sim.riderTwist * Math.sign(this.windPrep) > sim.maxTwist * .7;
        const unwindDrive = this.unwindTimer < .05 ? 0 : nearStop ? 0 : 1;
        // Wind-up: drive toward the end of the range, then only hold against the hips' passive spring there.
        const wound = this.windPrep !== 0 && sim.riderTwist * Math.sign(this.windPrep) > sim.maxTwist * .8;
        const windTorque = wound ? Math.min(sim.maxTwistTorque, sim.twistK * Math.abs(sim.riderTwist)) * Math.sign(this.windPrep) : this.windPrep * sim.maxUpperTorque * .55;
        const upper = this.pop === 'load' && this.windPrep !== 0 ? windTorque
            : unwinding ? -this.windPrep * sim.maxUpperTorque * unwindDrive : -intent.wind * sim.maxUpperTorque;
        if (!unwinding && this.pop !== 'load' && this.unwindTimer >= .42) this.windPrep = 0;

        const popX = (this.popEnd === 'tail' ? -1 : 1) * fwd;
        c.tuck = intent.tuck && grounded;
        // At walking pace "tuck" means skate: push with the free back foot (full to 3 m/s, gone by 5 m/s, never at speed).
        c.skate = intent.tuck && grounded && intent.brake < .05 ? fwd * Math.min(1, Math.max(0, (5 - planar) / 2)) : 0;
        c.balance = false;
        c.comZ = 0;
        if (grounded) {
            // Crouch: legs follow the compression intent. Extension (negative crouch) only during the pop stroke.
            // Snow under the board: soft (powder) 1 .. firm (groomed) 0, from its bearing stiffness.
            const mat = sim.terrain.material(b.p.x, b.p.z);
            this.soft = 1 - Math.min(1, Math.max(0, (Math.log10(mat.bearing) - 4.9) / .9));
            // Carving at speed: the legs flex further as the edge angle rises (lower centre of mass, hips toward the
            // snow), as riders do in high-edge carves. In soft snow the rider rides deeper in the legs as well.
            const carveFlex = Math.min(1, Math.abs(sim.edgeAngle) / .7) * Math.min(1, planar / 9);
            c.crouch = this.pop === 'extend' ? -1 : this.pop === 'load' ? .35 + .65 * intent.crouch
                : intent.tuck ? .55 : Math.min(.85, .3 + .25 * Math.abs(intent.steer) + .22 * carveFlex + .12 * this.soft);
            // Ollie / nollie: pressure stays on the loaded end through the first part of the snap, so the leg force
            // pivots the board about that end and the other end rises.
            let press = this.pop === 'load' || (this.pop === 'extend' && this.popTimer < .1) ? popX * .12 : clamp(intent.lean, -1, 1) * fwd * .11;
            // Powder technique: with no deliberate press, weight drifts to the tail in soft snow so the nose planes up.
            if (this.pop === 'none' && Math.abs(intent.lean) < .3) press -= fwd * .055 * this.soft;

            // ---- edging and braking ----
            const speed = planar;
            // Signed against the travel direction, so a board swung past 90 degrees reads > 90 instead of wrapping.
            const slip = Math.atan2(vz, fwd * vx + 1e-6);
            if (intent.brake <= .05) { this.brakeTime = 0; this.brakeDug = false; }
            this.brakeUnweight = false;
            if (intent.brake > .05 && this.braking <= .05) this.brakeSign = (intent.lean > .3 ? -1 : 1) * (this.stance === 'regular' ? 1 : -1); // heelside: slide toward the toes
            this.braking = intent.brake;
            let edge = edgeForSteer(intent.steer, speed, a.edge) * fwd;
            const slipTarget = 0;
            let brakeFront = 0, brakePivot = NaN, relaxed = false;
            if (this.braking > .05 && speed > .4) {
                // Speed check / stop: turn the board across the FALL LINE (heelside: toes downhill; toeside: toes uphill)
                // and sideslip on the uphill edge. Phases: (1) set an edge briefly, because the carve is the only way to
                // give the whole rider a yaw rate (the snow is the only external torque); (2) unweight and flatten so the
                // board keeps rotating; (3) dig the trailing edge to scrub speed.
                const n = sim.centerNormal, fh = Math.hypot(n.x, n.z);
                const fx = fh > 1e-3 ? n.x / fh : 0, fz = fh > 1e-3 ? n.z / fh : -1;      // downhill, horizontal
                const toe = this.stance === 'regular' ? 1 : -1;
                const tx = this.ez.x * toe, tz = this.ez.z * toe, th = Math.hypot(tx, tz) || 1;
                const side = this.brakeSign * toe;                                     // +1 toes downhill (heelside)
                const dx = fx * side, dz = fz * side;
                const yawErr = Math.atan2((tz * dx - tx * dz) / th, (tx * dx + tz * dz) / th);
                this.brakeTime += dt;
                const sideV = vz;                                                      // sideways velocity in board z
                const uphillEdge = -Math.sign(this.ez.x * fx + this.ez.z * fz) || -1;
                const trail = Math.abs(sideV) > .3 ? -Math.sign(sideV) : uphillEdge;
                const r = Math.sign(yawErr) || 1;
                const big = Math.abs(yawErr);
                // Pivot the board under the hips with the base nearly flat and the legs relaxed (lower twist stiffness),
                // then dig the trailing edge and stay dug (latched) until the brake is released.
                if (!this.brakeDug && (big < .75 || this.brakeTime > .7)) this.brakeDug = true;
                const dig = this.brakeDug ? 1 : 0;
                edge = !this.brakeDug ? trail * .04 : trail * (.1 + .5 * this.braking) + edge * .15;
                this.brakeUnweight = !this.brakeDug && speed > 2;
                brakeFront = (1 - dig) * .06 * fwd;
                relaxed = true;
                const wy = dot(b.w, this.ey);
                brakePivot = 260 * yawErr - 30 * wy;
            }
            // Recovering a big sideways slide: only the snow can give the rider the yaw needed to straighten out, so the
            // trailing edge is set and the path carves back under the board. Small slips are left to the hip reflex.
            if (this.braking <= .05 && this.pop === 'none' && speed > 3 && Math.abs(slip) > .45 && Math.abs(slip) < 1.4) {
                edge = -Math.sign(slip) * Math.min(.45, .2 + (Math.abs(slip) - .45) * .6) + edge * .2;
            }
            if (a.guardLeading && Math.abs(slip) > .2 && Math.sign(edge) === Math.sign(slip)) edge = 0;
            // Spin set-up: the takeoff is made from an engaged edge so the snow can take the reaction of the shoulders'
            // unwind (frontside spins off the heel edge, backside off the toe edge, as commonly taught).
            const spinSetup = this.windPrep !== 0 && (this.pop === 'load' || this.pop === 'extend');
            if (spinSetup) {
                const toe = this.stance === 'regular' ? 1 : -1;
                const frontside = -Math.sign(this.windPrep) * toe * fwd > 0;
                edge = (frontside ? -toe : toe) * .32 + edge * .3;
            }
            c.edge = edge;

            // ---- yaw reflex: hips/legs keep the board's long axis on the commanded slip angle ----
            const dSlip = this.havePrev ? (slip - this.prevSlip) / dt : 0;
            this.prevSlip = slip; this.havePrev = true;
            let pivot = 0;
            if (!Number.isNaN(brakePivot)) {
                pivot = brakePivot;
            } else if (unwinding || this.pop === 'extend' || (this.pop === 'load' && this.windPrep !== 0)) {
                pivot = 0; // the legs do not fight the wind-up or unwind; the engaged edge and the snow hold the board
            } else if (speed > 1.2) {
                // Rotating the board about +y swings its x axis toward -z, which RAISES the slip angle when riding +x
                // (and lowers it when riding -x), so the restoring torque is -k * slip * travelSign.
                pivot = -(a.kp * (slip - slipTarget) + a.kd * dSlip) * fwd;
            } else {
                // Almost stopped: the rider twists the board toward the steer direction (skating-style pivot).
                pivot = -intent.steer * 45 * fwd;
            }
            // Fore/aft pressure reflex: when the board is skidding, the friction yaw moment is mu * N * (centre-of-pressure
            // offset), so moving pressure toward one end is how a rider stops the tail (or nose) washing out.
            if (speed > 1.2 && this.pop === 'none' && this.copGain) press += clamp(this.copGain * ((slip - slipTarget) * 1.0 + .08 * dSlip), -.1, .1);
            press += brakeFront;
            // Unweighting: a quick extension lightens the board so it pivots against less friction.
            if (this.brakeUnweight) c.crouch = Math.min(c.crouch, -.25);
            c.copX = clamp(press, -.12, .12); c.comX = c.copX * .9; c.copZ = 0;
            // Leg/hip coupling stiffness is set by the rider (co-contraction): relaxed while pivoting into a stop.
            sim.twistK = relaxed ? 130 : 400; sim.twistC = relaxed ? 8 : 26;
            const max = relaxed ? Math.max(a.pivot, 150) : this.sinceLanding < .4 ? a.landingPivot : a.pivot;
            sim.maxPivotTorque = max;
            c.pivotTorque = clamp(pivot, -max, max);
            c.upperTorque = upper;
            c.compact = 0;
            c.boardPitchTorque = 0;
        } else {
            this.havePrev = false;
            // Airborne: no external torque is available. Wind input only twists the body against the board.
            c.pivotTorque = 0;
            c.upperTorque = upper;
            c.compact = intent.grab ? 1 : intent.tuck ? .6 : Math.abs(intent.wind) > .3 ? .5 : .15;
            const fall = -b.v.y;
            const gap = this.gapBelow(sim);
            const tti = fall > .5 ? gap / fall : 9;
            // Landing preparation: legs extend toward neutral before impact so there is stroke left to absorb it.
            const prepare = tti < .3 || intent.grab === false && tti < .55;
            c.crouch = prepare ? .15 : intent.grab ? 1 : .45;
            c.copX = 0; c.copZ = 0;
            c.comX = clamp(-intent.flip, -1, 1) * fwd * .22;
            c.comZ = 0;
            c.edge = 0; // ankles hold the base parallel to the snow below
            // Board pitch in the air: hips and knees rotate the board against the body's own inertia. The player's lean
            // tips the leading end down (+) or up (-); the assist (if enabled) aims the base at the snow below.
            const n = sim.centerNormal;
            const err = Math.asin(clamp(this.ex.x * n.x + this.ex.y * n.y + this.ex.z * n.z, -1, 1)); // + = +x end above the surface plane
            const wp = dot(b.w, this.ez);
            const want = -clamp(intent.lean, -1, 1) * fwd * .45;
            const player = -clamp(intent.lean, -1, 1) * fwd * sim.maxPitchTorque * .7;
            c.boardPitchTorque = a.level > 0 ? -a.level * (err - want) - .12 * a.level * wp : player;
        }
        return c;
    }
    legLength(sim: SnowboardSim) {
        const b = sim.board, r = sim.riderP;
        b.dirToWorld({ x: 0, y: 1, z: 0 }, this.ey);
        return (r.x - b.p.x) * this.ey.x + (r.y - b.p.y) * this.ey.y + (r.z - b.p.z) * this.ey.z - sim.rider.footHeight;
    }
    /** Vertical gap between the board and the terrain below it. */
    gapBelow(sim: SnowboardSim) { return sim.board.p.y - sim.terrain.height(sim.board.p.x, sim.board.p.z); }
}
