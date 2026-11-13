import { SnowboardSim, SIM_DT, G } from './sim/snowboard-sim.ts';
import { BOARDS, DEFAULT_RIDER, type BoardCategory } from './sim/boards.ts';
import { CourseTerrain, type CourseFunctions, type SimRail } from './sim/course-terrain.ts';
import { RiderController, type AssistLevel, type RiderIntent, type Stance } from './sim/rider-controller.ts';
import { FreestyleTracker, type FreestyleEvent, type GrabKind } from './sim/freestyle.ts';
import { terrainNormal } from './sim/terrain.ts';
import { v3 } from './sim/math3.ts';

/** Sub-steps of the 960 Hz simulation per 120 Hz game tick. */
export const SUBSTEPS = 8;
export const PHYSICS_VERSION = 'reality-1';

/**
 * One physically simulated ride on an EVADER course. The game loop calls `tick` at 120 Hz; it advances the 960 Hz
 * simulation by eight steps. Everything the renderer needs (position, the board's orientation quaternion, rider posture)
 * is read back from the simulation; nothing here writes position, velocity or orientation except `place`
 * (start of a run, a manual line reset, or standing up after a crash), which the game reports to the player.
 */
export class RealityRide {
    terrain: CourseTerrain;
    sim: SnowboardSim;
    ctl = new RiderController();
    tricks = new FreestyleTracker();
    board: BoardCategory;
    /** After a crash the body slides on the snow (Coulomb friction) until it stops, then the rider stands up. */
    crashed = false; crashTime = 0; crashKind = '';
    private slideP = v3(); private slideV = v3();
    /** Wall-clock milliseconds spent in the last tick, for the diagnostics overlay. */
    lastTickMs = 0;
    private n = v3();

    constructor(fns: CourseFunctions, rails: SimRail[], board: BoardCategory = 'all-mountain') {
        this.terrain = new CourseTerrain(fns);
        this.terrain.rails = rails;
        this.board = board;
        this.sim = new SnowboardSim(BOARDS[board], this.terrain, DEFAULT_RIDER);
    }
    configure(o: { assist: AssistLevel; stance: Stance; freshSnow: number; wind?: { x: number; z: number } }) {
        this.ctl.assist = o.assist; this.tricks.assist = o.assist;
        this.ctl.stance = o.stance; this.tricks.stance = o.stance;
        this.terrain.freshSnow = o.freshSnow;
        this.sim.wind.x = o.wind?.x ?? 0; this.sim.wind.z = o.wind?.z ?? 0;
    }
    /** Put the rider on the snow at course position (x, d), pointing along the fall line, moving at `speed`. */
    place(x: number, d: number, speed: number) {
        const z = -d;
        terrainNormal(this.terrain, x, z, this.n);
        // Steepest descent direction in the horizontal plane is the horizontal part of the surface normal.
        let dx = this.n.x, dz = this.n.z;
        if (Math.hypot(dx, dz) < 1e-3) { dx = 0; dz = -1; }
        this.sim.place(x, z, Math.atan2(-dz, dx), speed);
        this.ctl.reset(); this.tricks.reset();
        this.crashed = false; this.crashTime = 0;
    }

    tick(intent: RiderIntent, grabKind: GrabKind, events: FreestyleEvent[]) {
        const t0 = performance.now();
        this.tricks.grabKind = grabKind;
        for (let i = 0; i < SUBSTEPS; i++) {
            if (this.crashed) { this.slide(); continue; }
            const cmd = this.ctl.update(this.sim, intent, !this.tricks.airborne, SIM_DT);
            this.sim.step(cmd);
            const before = events.length;
            this.tricks.update(this.sim, this.ctl, intent.grab, events);
            for (let k = before; k < events.length; k++) { const e = events[k]; if (e.type === 'crash') this.crash(e.kind); }
        }
        this.lastTickMs = performance.now() - t0;
    }

    /** Begin a fall (from a freestyle crash or a collision the game detects, e.g. a tree). */
    crash(kind: string, keep = 1) {
        if (this.crashed) return;
        const s = this.sim, M = s.boardMass + s.rider.mass;
        this.crashed = true; this.crashTime = 0; this.crashKind = kind;
        this.slideP.x = s.board.p.x; this.slideP.y = s.board.p.y; this.slideP.z = s.board.p.z;
        // The body keeps the system's momentum.
        this.slideV.x = (s.boardMass * s.board.v.x + s.rider.mass * s.riderV.x) / M;
        this.slideV.y = 0;
        this.slideV.z = (s.boardMass * s.board.v.z + s.rider.mass * s.riderV.z) / M;
        // A collision with a fixed object (tree, rock) takes most of the momentum.
        this.slideV.x *= keep; this.slideV.z *= keep;
    }
    /** Sliding body: gravity along the surface and Coulomb friction (mu = 0.45, body and clothing on snow, estimate). */
    private slide() {
        const dt = SIM_DT, p = this.slideP, v = this.slideV;
        this.crashTime += dt;
        terrainNormal(this.terrain, p.x, p.z, this.n);
        const n = this.n;
        // Gravity component along the surface (horizontal projection used for the in-plane motion).
        const gx = G * n.x * n.y, gz = G * n.z * n.y;
        const sp = Math.hypot(v.x, v.z);
        const fr = .45 * G * n.y;
        v.x += gx * dt; v.z += gz * dt;
        if (sp > 1e-3) { const k = Math.min(sp, fr * dt) / sp; v.x -= v.x * k; v.z -= v.z * k; }
        p.x += v.x * dt; p.z += v.z * dt; p.y = this.terrain.height(p.x, p.z) + .05;
        if ((this.crashTime > 1.1 && Math.hypot(v.x, v.z) < 1.2) || this.crashTime > 3.5) this.standUp();
    }
    private standUp() { this.place(this.slideP.x, -this.slideP.z, 0); }

    // ---- read-outs for the renderer, HUD and replays -------------------------------------------------------------------
    get x() { return this.crashed ? this.slideP.x : this.sim.board.p.x; }
    get d() { return -(this.crashed ? this.slideP.z : this.sim.board.p.z); }
    /** Height of the board's base centre (the rig's root). */
    get y() { return this.crashed ? this.slideP.y : this.sim.board.p.y - this.sim.comY; }
    get speed() { const v = this.crashed ? this.slideV : this.sim.board.v; return Math.hypot(v.x, v.y, v.z); }
    get vy() { return this.crashed ? 0 : this.sim.board.v.y; }
    /** Direction of travel as the game's heading (0 = straight down the course, + toward +x). */
    get heading() { const v = this.crashed ? this.slideV : this.sim.board.v; return Math.hypot(v.x, v.z) > .3 ? Math.atan2(v.x, -v.z) : this.boardHeading; }
    /** Heading of the board's long axis toward its leading end. */
    get boardHeading() { const e = this.sim.board.dirToWorld({ x: 1, y: 0, z: 0 }, v3()); const s = this.ctl.travelSign; return Math.atan2(e.x * s, -e.z * s); }
    get ground() { return !this.crashed && !this.tricks.airborne; }
    /** 0 at neutral stance .. 1 at the deepest crouch (negative = extended). */
    get compression() { const r = this.sim.rider; return (r.heightNeutral - this.ctl.legLength(this.sim)) / (r.heightNeutral - r.heightMin); }
}
