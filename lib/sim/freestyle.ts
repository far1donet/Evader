import type { SnowboardSim } from './snowboard-sim.ts';
import type { AssistLevel, RiderController, Stance } from './rider-controller.ts';
import { clamp, cross, dot, normalize, v3, type V3 } from './math3.ts';
import { SIM_DT } from './snowboard-sim.ts';

/**
 * Freestyle observer: watches the simulation and names what actually happened.
 *
 * It never changes the simulation. Rotation is the integral of the board's real angular velocity; a grab counts only
 * while the knees are pulled up far enough for the hand to reach the board; landing quality comes from the contact state
 * at touchdown and the leg/balance loads that follow; crashes are declared from mechanical criteria (sideways contact at
 * speed, bottomed-out legs, inverted contact, balance overload). Thresholds depend on the assist level, which the player
 * selects explicitly.
 */
export type GrabKind = 'indy' | 'mute' | 'melon' | 'stalefish' | 'nose' | 'tail' | 'method' | 'japan' | 'crail' | 'roastbeef' | 'chickensalad' | 'seatbelt' | 'truckdriver';
export const GRABS: { id: GrabKind; name: string; reach: number; twoHands?: boolean }[] = [
    // `reach`: leg length above the deepest crouch (m) at which the hand reaches that part of the board. Nose and tail
    // grabs and the cross-body grabs need the knees pulled up further. Estimates for an average adult.
    { id: 'indy', name: 'INDY', reach: .14 },
    { id: 'mute', name: 'MUTE', reach: .14 },
    { id: 'melon', name: 'MELON', reach: .12 },
    { id: 'stalefish', name: 'STALEFISH', reach: .1 },
    { id: 'nose', name: 'NOSE GRAB', reach: .07 },
    { id: 'tail', name: 'TAIL GRAB', reach: .08 },
    { id: 'method', name: 'METHOD', reach: .1 },
    { id: 'japan', name: 'JAPAN', reach: .1 },
    { id: 'crail', name: 'CRAIL', reach: .07 },
    { id: 'roastbeef', name: 'ROAST BEEF', reach: .08 },
    { id: 'chickensalad', name: 'CHICKEN SALAD', reach: .08 },
    { id: 'seatbelt', name: 'SEATBELT', reach: .06 },
    { id: 'truckdriver', name: 'TRUCK DRIVER', reach: .08, twoHands: true },
];
export type LandingClass = 'STOMPED' | 'CLEAN' | 'UNSTABLE' | 'HEAVY' | 'SCRAPED' | 'HAND DRAG' | 'BUTT CHECK' | 'UNDER-ROTATED' | 'OVER-ROTATED';
export type CrashKind = 'EDGE CATCH' | 'HARD LANDING' | 'INVERTED LANDING' | 'NOSE DIVE' | 'LOST BALANCE' | 'SPUN OUT' | 'RAIL SLIP' | 'TREE STRIKE' | 'ROCK STRIKE';
export type FreestyleEvent =
    | { type: 'takeoff'; kind: 'ollie' | 'nollie' | 'kicker' | 'drop' }
    | { type: 'landed'; name: string; landing: LandingClass; score: number; air: number; spinDeg: number; inversions: number; grab?: string; grabTime: number }
    | { type: 'crash'; kind: CrashKind }
    | { type: 'rail'; name: string; time: number; score: number }
    | { type: 'press'; name: string; time: number; score: number };

const LIMITS: Record<AssistLevel, { balance: number; balanceTime: number; slip: number; bottom: number }> = {
    // balanceLoad is lateral support demand / ankle-hip capacity (see SnowboardSim). Values above ~2 occur briefly in
    // hard carves; sustained overload means the rider cannot stay on the board.
    authentic: { balance: 5, balanceTime: .22, slip: 55 * Math.PI / 180, bottom: .1 },
    balanced: { balance: 7, balanceTime: .3, slip: 65 * Math.PI / 180, bottom: .14 },
    beginner: { balance: 10, balanceTime: .4, slip: 75 * Math.PI / 180, bottom: .2 },
};

export class FreestyleTracker {
    assist: AssistLevel = 'balanced';
    stance: Stance = 'regular';
    airborne = false;
    airTime = 0;
    /** Rotation accumulated since takeoff about world up (spin), the takeoff travel axis (roll) and the lateral axis (pitch). */
    spin = 0; roll = 0; pitch = 0;
    inversions = 0; private inverted = false;
    grabKind: GrabKind = 'indy';
    grabbing = false; grabTime = 0; private grabCredit = 0; private grabUsed: GrabKind | undefined;
    takeoffSwitch = false; private takeoffDir = v3(1, 0, 0); private contactLost = 0; private contactTime = 0;
    /** Seconds since the last touchdown and the classification window after it. */
    sinceLanding = 9; private pending?: { slip: number; tilt: number; vImpact: number; peakLeg: number; minLeg: number; maxBalance: number; overload: number; spinDir: number };
    private overload = 0; private slideTime = 0; private repeats = new Map<string, number>();
    lastLanding?: LandingClass;
    railTime = 0; private railMin = 9; private railMax = 0;
    pressTime = 0; private pressEnd = 0; private pressYaw = 0;
    private up = v3(); private ex = v3(); private ez = v3(); private tmp = v3();

    reset() { this.airborne = false; this.airTime = 0; this.spin = this.roll = this.pitch = 0; this.inversions = 0; this.inverted = false; this.grabbing = false; this.grabTime = 0; this.pending = undefined; this.overload = 0; this.sinceLanding = 9; this.railTime = 0; this.pressTime = 0; this.contactLost = 0; }
    clearRepeats() { this.repeats.clear(); }

    /** Call once per simulation step, after `sim.step`. */
    update(sim: SnowboardSim, ctl: RiderController, grabHeld: boolean, events: FreestyleEvent[], dt = SIM_DT) {
        const b = sim.board, contacts = sim.diag.contacts, L = LIMITS[this.assist];
        b.dirToWorld({ x: 0, y: 1, z: 0 }, this.up); b.dirToWorld({ x: 1, y: 0, z: 0 }, this.ex); b.dirToWorld({ x: 0, y: 0, z: 1 }, this.ez);
        if (contacts > 0) { this.contactLost = 0; this.contactTime += dt; } else { this.contactLost += dt; this.contactTime = 0; }

        // ---- takeoff: the board has been off the snow for 60 ms (short chatter is not flight) ----
        if (!this.airborne && this.contactLost > .06) {
            this.airborne = true; this.airTime = this.contactLost; this.spin = this.roll = this.pitch = 0; this.inversions = 0; this.inverted = false;
            this.grabTime = 0; this.grabCredit = 0; this.grabUsed = undefined; this.pending = undefined;
            const hx = b.v.x, hz = b.v.z, h = Math.hypot(hx, hz) || 1;
            this.takeoffDir.x = hx / h; this.takeoffDir.y = 0; this.takeoffDir.z = hz / h;
            this.takeoffSwitch = ctl.travelSign < 0;
            const kind = ctl.popTimer < .35 && ctl.pop !== 'load' && ctl.popLoad > .2 ? (ctl.popEnd === 'nose' ? 'nollie' : 'ollie') : b.v.y > 2 ? 'kicker' : 'drop';
            events.push({ type: 'takeoff', kind });
        }
        if (this.airborne) {
            this.airTime += dt;
            // Rotation about fixed takeoff axes (world up, horizontal travel, lateral).
            const w = b.w, T = this.takeoffDir, S = cross({ x: 0, y: 1, z: 0 }, T, this.tmp);
            this.spin += w.y * dt; this.roll += dot(w, T) * dt; this.pitch += dot(w, S) * dt;
            const upDot = this.up.y;
            if (!this.inverted && upDot < -.25) { this.inverted = true; this.inversions++; }
            if (this.inverted && upDot > .25) this.inverted = false;
            // A grab needs the hand on the board: knees pulled up so the board is within arm's reach.
            const g = GRABS.find(x => x.id === this.grabKind)!;
            const legRoom = ctl.legLength(sim) - sim.rider.heightMin;
            this.grabbing = grabHeld && this.airTime > .12 && legRoom <= g.reach;
            if (this.grabbing) { this.grabCredit += dt; if (this.grabCredit > .2) { this.grabTime += dt; this.grabUsed = this.grabKind; } } else this.grabCredit = 0;
            if (contacts > 0 && this.contactTime > .012) this.touchdown(sim, ctl, events);
            return;
        }

        // ---- after touchdown: watch the legs and balance for a short window, then classify ----
        this.sinceLanding += dt;
        const legLen = ctl.legLength(sim);
        const p = this.pending;
        if (p) {
            p.peakLeg = Math.max(p.peakLeg, sim.legAxial); p.minLeg = Math.min(p.minLeg, legLen); p.maxBalance = Math.max(p.maxBalance, sim.balanceLoad);
            if (sim.balanceLoad > L.balance * .5) p.overload += dt;
            const bottomed = p.minLeg < sim.rider.heightMin * .97;
            if (bottomed && this.sinceLanding > .05 && sim.legAxial >= sim.rider.maxLegForce * .99 && p.vImpact > 6.5 + 4 * L.bottom) { this.pending = undefined; events.push({ type: 'crash', kind: 'HARD LANDING' }); return; }
            if (this.sinceLanding > .45) { this.pending = undefined; this.classify(sim, p, events); }
        }

        // ---- riding crashes ----
        const speed = Math.hypot(b.v.x, b.v.z);
        // Lying over beyond ~75 degrees from the snow surface while touching it: the rider is down.
        if (contacts > 0 && dot(this.up, sim.centerNormal) < .26) { this.reset(); events.push({ type: 'crash', kind: Math.abs(ctl.slipAngle(sim)) > .6 ? 'EDGE CATCH' : 'LOST BALANCE' }); return; }
        this.overload = sim.balanceLoad > L.balance ? this.overload + dt : Math.max(0, this.overload - dt * 2);
        if (this.overload > L.balanceTime) { this.overload = 0; const slip = Math.abs(ctl.slipAngle(sim)); events.push({ type: 'crash', kind: slip > .6 && speed > 5 ? 'EDGE CATCH' : sim.railContacts ? 'RAIL SLIP' : 'LOST BALANCE' }); return; }
        // Spun out: far past sideways at speed, or a big uncontrolled slide that lasts.
        const slipNow = Math.abs(ctl.slipAngle(sim));
        this.slideTime = speed > 6 && slipNow > L.slip && ctl.braking < .05 ? this.slideTime + dt : 0;
        if ((speed > 7 && slipNow > L.slip + .35 && ctl.braking < .05 && this.sinceLanding > .6) || this.slideTime > .9) { this.slideTime = 0; events.push({ type: 'crash', kind: 'SPUN OUT' }); return; }

        // ---- rails and boxes ----
        if (sim.railContacts > 0) { this.railTime += dt; const along = Math.abs(dot(this.ex, this.takeoffDir)); this.railMin = Math.min(this.railMin, along); this.railMax = Math.max(this.railMax, along); }
        else if (this.railTime > 0) {
            if (this.railTime > .25) {
                const across = this.railMax < .7;
                const name = across ? 'BOARDSLIDE' : '50-50';
                const score = Math.round((across ? 240 : 170) + this.railTime * 160);
                events.push({ type: 'rail', name, time: this.railTime, score });
            }
            this.railTime = 0; this.railMin = 9; this.railMax = 0;
        }
        if (sim.railContacts === 0) { this.takeoffDir.x = b.v.x; this.takeoffDir.y = 0; this.takeoffDir.z = b.v.z; normalize(this.takeoffDir); }

        // ---- presses and butters: only one end of the board on the snow ----
        let front = 0, back = 0;
        for (let i = 0; i < sim.stations.length; i++) if (sim.state[i].contact) { if (sim.stations[i].x > .15) front++; else if (sim.stations[i].x < -.15) back++; }
        const end = front > 0 && back === 0 ? 1 : back > 0 && front === 0 ? -1 : 0;
        if (end !== 0 && speed > 1.5 && sim.railContacts === 0) {
            if (this.pressEnd !== end) { this.pressEnd = end; this.pressTime = 0; this.pressYaw = 0; }
            this.pressTime += dt; this.pressYaw += b.w.y * dt;
        } else if (this.pressTime > 0) {
            if (this.pressTime > .4) {
                const nose = this.pressEnd * ctl.travelSign > 0;
                const turned = Math.abs(this.pressYaw) * 180 / Math.PI;
                const name = turned > 300 ? `${nose ? 'NOSE' : 'TAIL'} BUTTER 360` : turned > 150 ? `${nose ? 'NOSE' : 'TAIL'} BUTTER 180` : `${nose ? 'NOSE' : 'TAIL'} PRESS`;
                events.push({ type: 'press', name, time: this.pressTime, score: Math.round(80 + this.pressTime * 90 + turned * .6) });
            }
            this.pressTime = 0; this.pressEnd = 0;
        }
    }

    private touchdown(sim: SnowboardSim, ctl: RiderController, events: FreestyleEvent[]) {
        const b = sim.board, L = LIMITS[this.assist];
        this.airborne = false; this.sinceLanding = 0; ctl.sinceLanding = 0;
        // Contact geometry at touchdown.
        const nx = sim.centerNormal;
        const tilt = Math.acos(clamp(dot(this.up, nx), -1, 1));
        const vn = dot(b.v, nx);
        const slip = ctl.slipAngle(sim);
        const along = dot(b.v, this.ex);
        const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
        // Nose-first into the snow: the leading end points steeply into the slope.
        const lead = along >= 0 ? 1 : -1;
        const dive = lead * dot(this.ex, nx);
        const flight = this.airTime;
        if (tilt > 1.25 || this.up.y < .15) { events.push({ type: 'crash', kind: 'INVERTED LANDING' }); return; }
        if (flight > .25 && Math.abs(slip) > L.slip && speed > 5) { events.push({ type: 'crash', kind: 'EDGE CATCH' }); return; }
        if (flight > .25 && dive < -.6 && speed > 6) { events.push({ type: 'crash', kind: 'NOSE DIVE' }); return; }
        this.pending = { slip, tilt, vImpact: Math.max(0, -vn), peakLeg: 0, minLeg: 9, maxBalance: 0, overload: 0, spinDir: Math.sign(this.spin) };
        if (flight < .25) this.pending = undefined; // a bump or a chatter hop, not a trick
    }

    private classify(sim: SnowboardSim, p: NonNullable<FreestyleTracker['pending']>, events: FreestyleEvent[]) {
        const s = Math.abs(p.slip) * 180 / Math.PI;
        const heavy = p.peakLeg >= sim.rider.maxLegForce * .98;
        let landing: LandingClass;
        // Residual rotation sign: slip in the direction of the spin means the board had not finished turning.
        const residual = p.slip * -p.spinDir;
        if (s > 25) landing = residual > 0 ? 'UNDER-ROTATED' : 'OVER-ROTATED';
        else if (p.minLeg < sim.rider.heightMin * .99 && p.vImpact > 5) landing = 'BUTT CHECK';
        else if (p.maxBalance > LIMITS[this.assist].balance * .7) landing = 'HAND DRAG';
        else if (heavy) landing = 'HEAVY';
        else if (s > 15) landing = 'SCRAPED';
        else if (s > 8 || p.tilt > .25) landing = 'UNSTABLE';
        else if (p.vImpact < 4.5 && s < 5) landing = 'STOMPED';
        else landing = 'CLEAN';
        this.lastLanding = landing;
        const r = this.describe();
        const factor = { STOMPED: 1.15, CLEAN: 1, UNSTABLE: .8, HEAVY: .7, SCRAPED: .65, 'HAND DRAG': .5, 'BUTT CHECK': .35, 'UNDER-ROTATED': .45, 'OVER-ROTATED': .45 }[landing];
        const key = `${r.name}`;
        const rep = this.repeats.get(key) ?? 0; this.repeats.set(key, rep + 1);
        const base = 60 + r.spinDeg * 1.1 + r.inversions * 420 + (this.grabUsed ? 120 + Math.min(this.grabTime, 1.5) * 110 : 0);
        const score = Math.round(base * factor * (1 + Math.min(this.airTime, 3) * .12) * Math.max(.3, 1 - rep * .2));
        events.push({ type: 'landed', name: r.name, landing, score, air: this.airTime, spinDeg: r.spinDeg, inversions: r.inversions, grab: r.grab, grabTime: this.grabTime });
    }

    /** Trick name from the measured rotation. Spin credit is in completed 180s; partial rotation is never rounded up. */
    describe() {
        const deg = Math.abs(this.spin) * 180 / Math.PI;
        const spinDeg = Math.floor((deg + 25) / 180) * 180;
        const toe = this.stance === 'regular' ? 1 : -1;
        // Frontside: the chest turns toward the direction of travel first (derived in docs/REALITY_AUDIT_AND_PLAN.md).
        const travel = this.takeoffSwitch ? -1 : 1;
        const frontside = this.spin * toe * travel > 0;
        const inv = this.inversions;
        const rollDom = Math.abs(this.roll) >= Math.abs(this.pitch);
        let name = '';
        const sw = this.takeoffSwitch ? 'SWITCH ' : '';
        if (inv === 0) name = spinDeg ? `${sw}${frontside ? 'FS' : 'BS'} ${spinDeg}` : this.takeoffSwitch ? 'SWITCH AIR' : 'STRAIGHT AIR';
        else if (spinDeg < 180) {
            // Roll about the travel axis: + tips the head to the right of travel. Pitch about up x travel: - tips it backward.
            const back = rollDom ? this.roll * -toe * travel > 0 : this.pitch < 0;
            const base = rollDom ? (back ? 'BACKFLIP' : 'FRONTFLIP') : (back ? 'WILDCAT' : 'TAMEDOG');
            name = `${sw}${inv > 1 ? (inv === 2 ? 'DOUBLE ' : 'TRIPLE ') : ''}${base}`;
        } else {
            const cork = inv === 1 ? 'CORK' : inv === 2 ? 'DOUBLE CORK' : 'TRIPLE CORK';
            name = `${sw}${frontside ? 'FS' : 'BS'} ${cork} ${spinDeg}`;
        }
        const grab = this.grabUsed ? GRABS.find(g => g.id === this.grabUsed)!.name : undefined;
        if (grab && this.grabTime > .15) name += ` ${grab}`;
        return { name, spinDeg, inversions: inv, grab };
    }
}
export function grabIndex(kind: GrabKind) { return GRABS.findIndex(g => g.id === kind); }
export function velocityHeading(v: V3) { return Math.atan2(v.x, -v.z); }
