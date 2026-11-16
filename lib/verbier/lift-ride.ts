import * as T from 'three';
import { LiftProfile, loopPoint, loopLength, type LiftKind } from './lift-profile.ts';
import { chairModel, gondolaModel, cableCarModel, hangerModel, passengerGeometry, lowModel, MAT, BAR_UP, type VehicleModel } from './lift-vehicles.ts';
import { towerParts, stationParts } from './lift-structures.ts';
import { Builder, M } from './craft.ts';
const ROPE_LINE = new T.LineBasicMaterial({ color: 0x2a3034, transparent: true, opacity: .7 });
import type { Lift } from './terrain.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Lifts in the game world: the static scenery of every lift near a course (towers, ropes, stations, vehicles on the loop)
 * and the ride on one lift (the player's vehicle moving on the real line at the real speed, with boarding and unloading).
 *
 * Speed comes from the mapped ride duration (OpenStreetMap) over the line length; vehicle spacing from the mapped
 * capacity and seats (spacing = speed x 3600 x seats / capacity). Missing values use typical ones per lift type.
 */
const DEFAULT_SEATS: Record<LiftKind, number> = { chair: 4, gondola: 8, mixed: 6, cablecar: 60, surface: 1 };
const DEFAULT_CAPACITY: Record<LiftKind, number> = { chair: 2000, gondola: 2000, mixed: 2400, cablecar: 600, surface: 900 };
export function liftDynamics(lift: Lift, profile: LiftProfile) {
    const kind = profile.kind, spec = profile.spec;
    const ride = lift.rideS ?? profile.length / spec.speed[1];
    const v = Math.min(spec.speed[1], Math.max(spec.speed[0], profile.length / Math.max(30, ride)));
    const seats = lift.occupancy ?? DEFAULT_SEATS[kind], capacity = lift.capacity ?? DEFAULT_CAPACITY[kind];
    const minGap = kind === 'chair' ? 9 : kind === 'surface' ? 8 : 20;
    const gap = kind === 'cablecar' ? Infinity : Math.min(220, Math.max(minGap, v * 3600 * seats / capacity));
    // Boarding speed: detachable chairs and gondolas slow down in the station; fixed-grip chairs load moving; trams stop.
    const board = kind === 'cablecar' ? 0 : kind === 'surface' ? v : kind === 'gondola' ? .35 : kind === 'chair' && seats < 4 ? Math.min(v, 2.2) : 1.0;
    return { v, gap, seats, board, ride: profile.length / v };
}
function modelsFor(kind: LiftKind, seats: number, type: string | null, bubble = false) {
    if (kind === 'gondola') return [gondolaModel()];
    if (kind === 'cablecar') return [cableCarModel()];
    if (kind === 'surface') return [hangerModel(type === 'platter')];
    if (kind === 'mixed') return [chairModel(Math.min(8, Math.max(4, seats)), { bubble }), gondolaModel()];
    return [chairModel(Math.min(8, Math.max(1, seats)), { bubble })];
}
/** Vehicle k uses model index: Télémixte = one cabin every fourth vehicle; everything else one model. */
const modelIndex = (kind: LiftKind, k: number) => kind === 'mixed' && k % 4 === 2 ? 1 : 0;

const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpQ2 = new T.Quaternion(), tmpP = new T.Vector3(), ONE = new T.Vector3(1, 1, 1), X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0);
function vehicleMatrix(out: T.Matrix4, x: number, y: number, d: number, dx: number, dd: number, swing: number) {
    tmpQ.setFromAxisAngle(Y, Math.atan2(-dx, dd)).multiply(tmpQ2.setFromAxisAngle(X, swing));
    return out.compose(tmpP.set(x, y, -d), tmpQ, ONE);
}
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const JACKETS = [0x1e2a36, 0xb3532c, 0x2f6b4f, 0xe0dcd2, 0x6b2f3f, 0x2a4f86, 0xd6a23a, 0x3a3a3a];

// ---- static scenery ------------------------------------------------------------------------------------------------------
/** Towers, ropes, stations and (unless it is the lift being ridden) vehicles spread on the loop. */
export function liftScenery(lift: Lift, height: (x: number, d: number) => number, opts: { active?: boolean; vehicles?: boolean; detail?: 'high' | 'low' | ((x: number, d: number) => 'high' | 'low'); /** full vehicle models here (default: nowhere) */ vehicleDetail?: (x: number, d: number) => boolean } = {}) {
    const g = new T.Group(); g.name = `lift-${lift.id ?? lift.name}`;
    const profile = new LiftProfile(lift.points.map(p => [p[0], p[1]]), height, lift.type, lift.pylons);
    const spec = profile.spec, kind = profile.kind, half = spec.gauge / 2;
    // Towers and stations (lift-structures.ts), merged into one mesh per material: a lift has dozens of towers.
    const b = new Builder(), detailAt = (x: number, d: number) => typeof opts.detail === 'function' ? opts.detail(x, d) : opts.detail ?? 'high', detail = detailAt(profile.heads[0].x, profile.heads[0].d) === 'high' || profile.heads.some(h => detailAt(h.x, h.d) === 'high') ? 'high' : 'low';
    const frame = (x: number, y: number, d: number, yaw: number) => new T.Matrix4().compose(new T.Vector3(x, y, -d), new T.Quaternion().setFromAxisAngle(Y, yaw), ONE);
    for (const h of profile.heads) {
        if (h.station) continue;
        const c = profile.at(h.s, 0);
        towerParts(b, kind, h.y - h.ground, spec.gauge, detailAt(h.x, h.d), frame(h.x, h.y, h.d, Math.atan2(-c.tx, c.td)));
    }
    for (const end of [0, profile.length]) {
        const c = profile.at(end, 0), yaw = Math.atan2(-c.tx, c.td) + (end === 0 ? Math.PI : 0);   // the line leaves along local +z
        stationParts(b, kind, spec.gauge, c.ground - c.y, frame(c.x, c.y, c.d, yaw));
    }
    const built = b.group(); g.add(...built.children);
    // ropes: steel tubes (near) plus a thin line so they stay visible from far away
    const rope: T.Vector3[] = [], tubes: T.BufferGeometry[] = [];
    for (const track of (kind === 'cablecar' ? [1, -1] : [1, -1]) as (1 | -1)[]) {
        const pts: T.Vector3[] = [];
        for (let s = 0; s <= profile.length + 1e-6; s += 6) { const a = profile.at(Math.min(s, profile.length), track); pts.push(new T.Vector3(a.x, a.y, -a.d)); }
        const last = profile.at(profile.length, track); if (pts[pts.length - 1].distanceTo(new T.Vector3(last.x, last.y, -last.d)) > .5) pts.push(new T.Vector3(last.x, last.y, -last.d));
        for (let i = 0; i < pts.length - 1; i++) rope.push(pts[i], pts[i + 1]);
        if (detail === 'high') tubes.push(new T.TubeGeometry(new T.CatmullRomCurve3(pts), pts.length * 2, kind === 'cablecar' ? .03 : .026, 6, false));
    }
    if (tubes.length) { const m = new T.Mesh(mergeGeometries(tubes, false)!, M.rope); m.castShadow = true; g.add(m); tubes.forEach(t => t.dispose()); }
    g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(rope), ROPE_LINE));
    if (opts.active || opts.vehicles === false) return { group: g, profile };
    // vehicles on the loop (moving ones belong to the ride): full models near the player, silhouettes further away
    const dyn = liftDynamics(lift, profile), loop = loopLength(profile);
    type Spot = { x: number; y: number; d: number; dx: number; dd: number; model: number };
    const spots: Spot[] = [];
    if (kind === 'cablecar') for (const [sv, track] of [[profile.length * .35, 1], [profile.length * .65, -1]] as const) { const c = profile.at(sv, track); spots.push({ x: c.x, y: c.y, d: c.d, dx: c.tx * track, dd: c.td * track, model: 0 }); }
    else { const n = Math.max(2, Math.floor(loop / dyn.gap)); for (let k = 0; k < n; k++) { const q = loopPoint(profile, k * loop / n); spots.push({ x: q.x, y: q.y, d: q.d, dx: q.dx, dd: q.dd, model: modelIndex(kind, k) }); } }
    const place = (parts: { geometry: T.BufferGeometry; material: T.Material }[], at: Spot[], shadows: boolean) => {
        if (!at.length) return;
        for (const part of parts) {
            const inst = new T.InstancedMesh(part.geometry, part.material, at.length);
            at.forEach((p, i) => inst.setMatrixAt(i, vehicleMatrix(tmpM, p.x, p.y, p.d, p.dx, p.dd, 0)));
            inst.castShadow = shadows && !(part.material as T.MeshStandardMaterial).transparent; g.add(inst);
        }
    };
    const isNear = (p: Spot) => !!opts.vehicleDetail?.(p.x, p.d);
    const models = spots.some(isNear) ? modelsFor(kind, dyn.seats, lift.type, !!lift.bubble) : [];
    for (let m = 0; m < Math.max(1, models.length); m++) {
        const mine = spots.filter(p => p.model === m || models.length === 0);
        const lowKind = kind === 'mixed' && m === 1 ? 'gondola' : kind;
        place(lowModel(lowKind, dyn.seats), mine.filter(p => !isNear(p)), false);
        const full = models[m];
        if (full) place([...full.parts, ...(full.bar ? full.bar.parts.map(bp => ({ geometry: bp.geometry.translate(full.bar!.pivot.x, full.bar!.pivot.y, full.bar!.pivot.z), material: bp.material })) : [])], mine.filter(isNear), true);
    }
    return { group: g, profile };
}

// ---- the ride -------------------------------------------------------------------------------------------------------------
export type RidePhase = 'wait' | 'board' | 'depart' | 'ride' | 'arrive' | 'alight' | 'done';
export type RideFrame = {
    phase: RidePhase; kind: LiftKind;
    /** Rider rig root (board origin) and facing; the rig's -z points along `dir`. */
    root: T.Vector3; dir: T.Vector3; swing: number;
    pose: 'seat' | 'stand' | 'tow'; sit: number; bar: number;
    /** Grip of the rider's vehicle (camera target), and for surface lifts the rope attachment above the rider. */
    grip: T.Vector3; cable: T.Vector3;
    progress: number; elevation: number; remainingReal: number; speed: number;
};
export class LiftRide {
    readonly group = new T.Group();
    readonly profile: LiftProfile; readonly kind: LiftKind; readonly dyn: ReturnType<typeof liftDynamics>;
    /** Playback speed of the ride itself (boarding and unloading always play at 1x). */
    multiplier = 4;
    private readonly height: (x: number, d: number) => number;
    private readonly models: VehicleModel[];
    private readonly loop: number; private readonly n: number;
    private U: number; private lineV: number; private phase: RidePhase = 'wait'; private phaseT = 0;
    private sit = 0; private bar = 0; private swing = 0; private swingV = 0; private lastS = 0;
    private readonly localRoot: T.Vector3; private readonly sLoad: number; private readonly sUnload: number;
    private readonly riderVehicle = new T.Group(); private barGroup?: T.Group;
    private readonly instanced: { mesh: T.InstancedMesh; model: number }[] = [];
    private passengers?: T.InstancedMesh;
    private otherCabin?: T.Group;
    private readonly frame: RideFrame;
    private alightFrom = new T.Vector3(); private boardFrom = new T.Vector3();

    constructor(lift: Lift, height: (x: number, d: number) => number, quality = 'high') {
        this.height = height;
        this.profile = new LiftProfile(lift.points.map(p => [p[0], p[1]]), height, lift.type, lift.pylons);
        this.kind = this.profile.kind; this.dyn = liftDynamics(lift, this.profile);
        this.models = modelsFor(this.kind, this.dyn.seats, lift.type, !!lift.bubble);
        this.loop = loopLength(this.profile);
        this.n = this.kind === 'cablecar' ? 1 : Math.max(2, Math.floor(this.loop / this.dyn.gap));
        const model = this.models[0];
        this.localRoot = model.riderPose === 'seat' ? model.rider.clone().add(new T.Vector3(0, -.58, -.38)) : model.rider.clone();
        // scenery without vehicles + the moving ones
        this.group.add(liftScenery(lift, height, { active: true }).group);
        for (const p of model.parts) this.riderVehicle.add(new T.Mesh(p.geometry, p.material));
        if (model.bar) { this.barGroup = new T.Group(); this.barGroup.position.copy(model.bar.pivot); for (const p of model.bar.parts) this.barGroup.add(new T.Mesh(p.geometry, p.material)); this.riderVehicle.add(this.barGroup); }
        this.riderVehicle.traverse(o => { o.castShadow = true; });
        if (this.kind !== 'surface') this.group.add(this.riderVehicle);
        if (this.kind === 'cablecar') {
            this.otherCabin = new T.Group(); for (const p of model.parts) this.otherCabin.add(new T.Mesh(p.geometry, p.material)); this.group.add(this.otherCabin);
        } else {
            this.models.forEach((m, mi) => {
                const count = Array.from({ length: this.n }, (_, k) => k).filter(k => k > 0 && modelIndex(this.kind, k) === mi).length;
                for (const p of m.parts) { const mesh = new T.InstancedMesh(p.geometry, p.material, Math.max(1, count)); mesh.castShadow = true; mesh.frustumCulled = false; this.group.add(mesh); this.instanced.push({ mesh, model: mi }); }
                if (m.bar) for (const p of m.bar.parts) { const mesh = new T.InstancedMesh(p.geometry, p.material, Math.max(1, count)); mesh.frustumCulled = false; this.group.add(mesh); this.instanced.push({ mesh, model: -1 - mi }); }
            });
            if (model.seats.length && this.kind !== 'gondola' && quality !== 'low') {
                this.passengers = new T.InstancedMesh(passengerGeometry(), new T.MeshStandardMaterial({ roughness: .85 }), this.n * model.seats.length);
                this.passengers.frustumCulled = false; this.passengers.castShadow = true;
                const col = new T.Color();
                for (let i = 0; i < this.n * model.seats.length; i++) this.passengers.setColorAt(i, col.setHex(JACKETS[Math.floor(hash(i, 3) * JACKETS.length)]));
                this.group.add(this.passengers);
            }
        }
        // where the rider boards and leaves: on the uphill track in the stations
        this.sLoad = this.kind === 'cablecar' ? 3 : 6; this.sUnload = this.profile.length - (this.kind === 'cablecar' ? 3 : 6);
        const contact = this.sLoad + this.localRoot.z;                 // grip position when the seat reaches the rider
        this.U = this.kind === 'cablecar' ? contact : contact - Math.max(this.dyn.board * 2.6, this.kind === 'gondola' ? 4 : 0);
        this.lineV = this.dyn.board;
        this.frame = { phase: 'wait', kind: this.kind, root: new T.Vector3(), dir: new T.Vector3(), swing: 0, pose: this.kind === 'surface' ? 'tow' : 'stand', sit: 0, bar: 0,
            grip: new T.Vector3(), cable: new T.Vector3(), progress: 0, elevation: 0, remainingReal: this.dyn.ride, speed: 0 };
        this.update(0);
    }
    get rideSeconds() { return this.dyn.ride; }
    /** Jump to the approach to the top station. */
    skip() {
        if (this.phase === 'arrive' || this.phase === 'alight' || this.phase === 'done') return;
        // from any earlier phase: already aboard, a little before the top station
        if (this.phase === 'wait' || this.phase === 'board') { this.sit = 1; this.bar = 1; }
        this.U = Math.max(this.U, this.sUnload + this.localRoot.z - this.brakeDistance() - 25); this.lineV = this.dyn.v; this.phase = 'ride'; this.phaseT = 0;
    }
    private brakeDistance() { const a = this.kind === 'cablecar' ? .35 : .6; return (this.dyn.v ** 2 - this.dyn.board ** 2) / (2 * a) + 4; }
    private groundPoint(s: number, track: 1 | 0, out: T.Vector3) { const c = this.profile.at(s, track); return out.set(c.x, this.height(c.x, c.d), -c.d); }

    update(dtReal: number): RideFrame {
        const f = this.frame, k = this.dyn, a = this.kind === 'cablecar' ? .35 : .6;
        // The journey along the line plays at the chosen speed; walking on, sitting down and getting off play at 1x.
        const dt = this.phase === 'ride' || this.phase === 'depart' || this.phase === 'arrive' ? dtReal * this.multiplier : dtReal;
        this.phaseT += dt;
        const sRoot = () => this.U - this.localRoot.z;
        const prevV = this.lineV;
        switch (this.phase) {
            case 'wait':
                if (this.kind === 'cablecar') { if (this.phaseT > 1.2) this.next('board'); }
                else { this.lineV = this.kind === 'gondola' ? Math.max(k.board, Math.min(1.4, this.sLoad - sRoot() + .35)) : k.board; if (sRoot() >= this.sLoad) this.next('board'); }
                break;
            case 'board':
                this.lineV = k.board;
                if (this.kind === 'surface') { if (this.phaseT > .25) this.next('depart'); }
                else { this.sit = Math.min(1, this.phaseT / (this.kind === 'cablecar' ? 1.8 : .8)); if (this.sit >= 1) this.next('depart'); }
                break;
            case 'depart':
                this.lineV = Math.min(k.v, this.lineV + a * dt);
                this.bar = Math.min(1, this.bar + dtReal / 1.6);
                if (this.lineV >= k.v && this.bar >= 1) this.next('ride');
                break;
            case 'ride':
                this.lineV = k.v;
                if (sRoot() >= this.sUnload - this.brakeDistance()) this.next('arrive');
                break;
            case 'arrive': {
                const left = this.sUnload - sRoot();
                this.lineV = this.kind === 'cablecar' ? Math.max(0, Math.min(this.lineV, Math.sqrt(Math.max(0, 2 * a * left)))) : Math.max(k.board, Math.min(this.lineV, Math.sqrt(k.board ** 2 + 2 * a * Math.max(0, left))));
                if (left < 18) this.bar = Math.max(0, this.bar - dtReal / 1.6);
                if (left <= .05 || (this.kind === 'cablecar' && this.lineV < .02)) { this.alightFrom.copy(f.root); this.next('alight'); }
                break;
            }
            case 'alight':
                this.lineV = this.kind === 'cablecar' ? 0 : k.board;
                this.sit = Math.max(0, 1 - this.phaseT / .8); this.bar = 0;
                if (this.phaseT > 2.8) this.next('done');
                break;
        }
        this.U += this.lineV * dt;
        // swing of the rider's vehicle: a pendulum (about 2.8 s period) pushed by the line's acceleration and by tower passes
        const accel = dt > 0 ? (this.lineV - prevV) / dt : 0, w = 2 * Math.PI / 2.8;
        if (this.kind !== 'surface') {
            for (const h of this.profile.heads) if (!h.station && this.lastS < h.s && this.U >= h.s) this.swingV += .05 * Math.min(1.5, k.v / 5) * (this.kind === 'cablecar' ? .5 : 1);
            this.lastS = this.U;
            this.swingV += (-w * w * this.swing - .35 * this.swingV - accel / 9.81 * w * w) * Math.min(dt, .05);
            this.swing += this.swingV * Math.min(dt, .05);
        }
        // place the rider's vehicle and the others
        const q = this.kind === 'cablecar' ? (() => { const c = this.profile.at(Math.min(this.profile.length, Math.max(0, this.U)), 1); return { x: c.x, d: c.d, y: c.y, dx: c.tx, dd: c.td }; })() : loopPoint(this.profile, this.U);
        const vm = vehicleMatrix(new T.Matrix4(), q.x, q.y, q.d, q.dx, q.dd, this.swing);
        vm.decompose(this.riderVehicle.position, this.riderVehicle.quaternion, this.riderVehicle.scale);
        if (this.barGroup) this.barGroup.rotation.x = (1 - this.bar) * BAR_UP;
        f.grip.set(q.x, q.y, -q.d);
        if (this.otherCabin) {
            const c = this.profile.at(Math.min(this.profile.length, Math.max(0, this.profile.length - this.U)), -1);
            vehicleMatrix(tmpM, c.x, c.y, c.d, -c.tx, -c.td, -this.swing * .6).decompose(this.otherCabin.position, this.otherCabin.quaternion, this.otherCabin.scale);
        }
        this.placeOthers();
        // rider
        f.dir.set(q.dx, 0, -q.dd).normalize();
        const seatWorld = this.localRoot.clone().applyMatrix4(vm);
        f.swing = this.swing;
        if (this.kind === 'surface') {
            const s = this.phase === 'wait' || this.phase === 'board' ? this.sLoad : this.phase === 'alight' || this.phase === 'done' ? this.sUnload + Math.min(6, this.phaseT * 2.5) : sRoot();
            const c = this.profile.at(Math.min(this.profile.length + 8, s), 1);
            f.root.set(c.x, this.height(c.x, c.d), -c.d); f.dir.set(c.tx, 0, -c.td).normalize();
            f.cable.set(c.x, this.profile.cableY(Math.min(this.profile.length, s)), -c.d);
            f.pose = 'tow'; f.sit = 0; f.bar = this.phase === 'alight' || this.phase === 'done' || this.phase === 'wait' ? 0 : 1;
        } else if (this.phase === 'wait') {
            // chairs: wait on the loading line, the chair comes from behind; cabins: wait on the platform beside the door
            const s0 = this.kind === 'cablecar' ? this.sLoad - 6 + Math.min(1, this.phaseT / 1.2) * 1.5 : this.sLoad;
            this.groundPoint(s0, 1, f.root);
            if (this.kind === 'gondola' || this.kind === 'cablecar') {
                const c = this.profile.at(s0, 1), side = this.kind === 'cablecar' ? 2.6 : 1.9;
                f.root.x += c.td * side; f.root.z += c.tx * side; f.root.y = this.height(f.root.x, -f.root.z);
            }
            this.boardFrom.copy(f.root); f.pose = 'stand'; f.sit = 0;
        } else if (this.phase === 'board') {
            const e = this.sit * this.sit * (3 - 2 * this.sit);
            f.root.lerpVectors(this.boardFrom, seatWorld, e); f.pose = this.models[0].riderPose === 'seat' ? 'seat' : 'stand'; f.sit = this.models[0].riderPose === 'seat' ? this.sit : 0;
        } else if (this.phase === 'alight' || this.phase === 'done') {
            // stand up onto the unloading ramp, then glide off it
            const t = Math.min(this.phaseT, 2.8), standUp = Math.min(1, t / .8);
            const out = this.groundPoint(Math.min(this.profile.length + 12, this.sUnload + (this.kind === 'cablecar' ? 5 : 0) + Math.max(0, t - .5) * 2.6), 1, new T.Vector3());
            f.root.lerpVectors(this.alightFrom, out, Math.min(1, t / (this.kind === 'cablecar' ? 2.8 : 1.4)));
            f.pose = this.models[0].riderPose === 'seat' && standUp < 1 ? 'seat' : 'stand'; f.sit = this.sit;
        } else { f.root.copy(seatWorld); f.pose = this.models[0].riderPose === 'seat' ? 'seat' : 'stand'; f.sit = this.models[0].riderPose === 'seat' ? 1 : 0; }
        if (this.kind !== 'surface') f.bar = this.bar;
        f.phase = this.phase;
        const along = Math.min(1, Math.max(0, (sRoot() - this.sLoad) / (this.sUnload - this.sLoad)));
        f.progress = this.phase === 'alight' || this.phase === 'done' ? 1 : along;
        f.elevation = f.root.y; f.speed = this.lineV;
        f.remainingReal = Math.max(0, (this.sUnload - sRoot()) / k.v);
        return f;
    }
    private next(p: RidePhase) { this.phase = p; this.phaseT = 0; }
    private placeOthers() {
        if (this.kind === 'cablecar') return;
        const counts = new Map<number, number>(), model0 = this.models[0];
        let pi = 0;
        for (let k = 1; k < this.n; k++) {
            const u = this.U + k * this.loop / this.n, q = loopPoint(this.profile, u), mi = modelIndex(this.kind, k);
            if (Math.hypot(q.x - this.frame.grip.x, q.d + this.frame.grip.z) > 900) continue;   // too far to see detail
            const sway = Math.sin(k * 1.7 + this.U * .07) * .03;
            vehicleMatrix(tmpM, q.x, q.y, q.d, q.dx, q.dd, sway);
            const i = counts.get(mi) ?? 0; counts.set(mi, i + 1);
            for (const it of this.instanced) {
                if (it.model === mi) it.mesh.setMatrixAt(i, tmpM);
                else if (it.model === -1 - mi) {
                    // others' safety bars: down while riding up with someone aboard, raised otherwise
                    const bar = this.models[mi].bar!, up = q.up && hash(k, 0) < .55 ? 0 : BAR_UP;
                    it.mesh.setMatrixAt(i, tmpM.clone().multiply(new T.Matrix4().makeTranslation(bar.pivot.x, bar.pivot.y, bar.pivot.z)).multiply(new T.Matrix4().makeRotationX(up)));
                }
            }
            if (this.passengers && mi === 0 && q.up && hash(k, 0) < .55) for (let j = 0; j < model0.seats.length; j++) {
                if (hash(k, j + 1) > .55) continue;
                const st = model0.seats[j];
                this.passengers.setMatrixAt(pi++, tmpM.clone().multiply(new T.Matrix4().makeTranslation(st.x, st.y, st.z)));
            }
        }
        for (const it of this.instanced) { it.mesh.count = counts.get(it.model >= 0 ? it.model : -1 - it.model) ?? 0; it.mesh.instanceMatrix.needsUpdate = true; }
        if (this.passengers) { this.passengers.count = pi; this.passengers.instanceMatrix.needsUpdate = true; }
    }
    dispose() { this.group.removeFromParent(); this.group.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); }); }
}
