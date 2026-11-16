import * as T from 'three';
import { Builder, M, V, bend, box, loft, rbox, roundedRect, smoothNormals, tube, wheel } from './craft.ts';

/**
 * Lift vehicles, built in metres with the grip on the cable at the origin, travel toward -z, up +y.
 * Generic designs with typical dimensions (no manufacturer's model, livery or branding):
 *  - detachable chair, 1-8 seats: bent-tube hanger and frame, padded seats and backrests, safety bar with footrest,
 *    optional weather bubble; seat 2.4 m below the grip;
 *  - gondola cabin (8 seats): rounded shell with a continuous glass band, corner pillars, sliding-door seams, benches
 *    inside; floor 3.4 m below the grip;
 *  - aerial tramway cabin: large glazed cabin under a carriage that runs on the track ropes, roof railing;
 *    floor 7 m below the rope;
 *  - surface-lift hanger (platter / T-bar) on a retracting rope.
 */
export type Part = { geometry: T.BufferGeometry; material: T.Material };
export type VehicleModel = {
    parts: Part[];
    /** Seat surface centres (chairs, gondola benches), vehicle frame. */
    seats: T.Vector3[];
    /** Where the player sits (seat) or stands (cable car floor). */
    rider: T.Vector3;
    riderPose: 'seat' | 'stand';
    /** Safety bar (chairs): parts and pivot; rotate about x through the pivot, 0 = down, BAR_UP = raised. */
    bar?: { parts: Part[]; pivot: T.Vector3 };
};
export const BAR_UP = 1.75;
/** Kept for older imports: the materials now live in craft.ts. */
export const MAT = { steel: M.galv, darkSteel: M.paint, seat: M.fabric, cabin: M.cabin, stripe: M.trim, glass: M.glass, rubber: M.rubber };

/** Detachable grip with its running gear (rollers on the station rails), on the rope at the origin. */
function grip(b: Builder, long = .74) {
    b.add(rbox(.26, .2, long, .05, 0, -.02, 0), M.paint);
    b.add(rbox(.12, .26, long * .7, .03, 0, -.2, 0), M.galv);                                  // jaw housing
    for (const z of [-long * .36, long * .36]) for (const x of [-.15, .15]) b.add(wheel(.065, .045, x, .1, z, 12), M.rubber);
    b.add(rbox(.42, .04, .2, .015, 0, .1, 0), M.galv);                                        // roller axle plate
}

export function chairModel(seats: number, opts: { bubble?: boolean } = {}): VehicleModel {
    const n = Math.max(1, Math.min(8, seats)), W = n * .5 + .2, half = W / 2;
    const b = new Builder(); grip(b);
    // hanger: down from the grip, bending back over the backrest
    b.add(bend([V(0, -.12, 0), V(0, -.6, .02), V(0, -1.1, .14), V(0, -1.45, .34), V(0, -1.6, .42)], .048, 10), M.galv);
    // top yoke and side frames (one bent tube each side down to under the seat)
    b.add(tube(V(-half - .02, -1.62, .42), V(half + .02, -1.62, .42), .04, 10), M.paint);
    for (const s of [-1, 1]) b.add(bend([V(s * (half + .02), -1.62, .42), V(s * (half + .03), -1.78, .45), V(s * (half + .03), -2.25, .4), V(s * (half + .03), -2.47, .22), V(s * (half + .03), -2.52, -.24)], .034, 8), M.paint);
    // seat tray and backrest shell
    b.add(rbox(W, .06, .54, .025, 0, -2.5, -.01), M.paint);
    const back = new T.Matrix4().makeRotationX(-.2).setPosition(0, -2.06, .33);
    b.add(rbox(W - .04, .66, .045, .02), M.paint, back);
    const seatsAt: T.Vector3[] = [];
    for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * .5;
        b.add(rbox(.46, .1, .5, .045, x, -2.42, -.01, 1), M.fabric);                                 // cushion
        b.add(rbox(.44, .56, .09, .04, 0, 0, -.05, 1), M.fabric, new T.Matrix4().makeRotationX(-.2).setPosition(x, -2.05, .31));
        if (i < n - 1) b.add(rbox(.045, .16, .38, .02, x + .25, -2.32, -.05), M.rubber);           // divider / armrest
        seatsAt.push(V(x, -2.37, .02));
    }
    for (const s of [-1, 1]) b.add(rbox(.06, .2, .42, .025, s * (half - .01), -2.33, -.04), M.rubber);   // end armrests
    // safety bar (pivots at the yoke ends) with a footrest; parts are relative to the pivot
    const pivot = V(0, -1.62, .42), bar = new Builder(), P = (x: number, y: number, z: number) => V(x - pivot.x, y - pivot.y, z - pivot.z);
    for (const s of [-1, 1]) bar.add(bend([P(s * (half - .04), -1.62, .42), P(s * (half - .05), -1.78, .2), P(s * (half - .07), -1.97, -.22), P(s * (half - .1), -2.03, -.44)], .03, 8), M.paint);
    bar.add(tube(P(-half + .1, -2.03, -.44), P(half - .1, -2.03, -.44), .03, 8), M.paint);
    for (const s of [-1, 1]) bar.add(bend([P(s * W * .22, -2.03, -.44), P(s * W * .22, -2.45, -.5), P(s * W * .22, -2.86, -.58)], .025, 8), M.paint);
    bar.add(rbox(W * .62, .07, .16, .03, ...P(0, -2.88, -.6).toArray() as [number, number, number]), M.rubber);
    bar.add(rbox(W * .5, .05, .06, .02, ...P(0, -2.03, -.44).toArray() as [number, number, number]), M.rubber);   // padded grab rail
    if (opts.bubble) {
        // weather bubble: a tinted shell over the front of the chair, lowered with the bar
        const g = new T.SphereGeometry(1, 32, 14, Math.PI * .5, Math.PI, .08 * Math.PI, .42 * Math.PI);
        g.rotateY(Math.PI); g.scale(half + .14, 1.05, .95); g.translate(0, -.06, .02);
        bar.add(g, M.bubble);
    }
    return { parts: b.build(), seats: seatsAt, rider: seatsAt[Math.floor((n - 1) / 2)], riderPose: 'seat', bar: { parts: bar.build(), pivot } };
}

/** Cabin shell: lower body, trim band, glass band with pillars, roof rim and dome. Heights relative to the grip. */
function cabinShell(b: Builder, w: number, d: number, r: number, floor: number, sill: number, top: number, roof: number, dome: number, opts: { pillars?: (mid: [number, number]) => boolean; flatRoof?: boolean; seg?: number } = {}) {
    const o = roundedRect(w, d, r, opts.seg ?? 48);
    const body = loft(o, [{ y: floor, sx: .9, sz: .92 }, { y: floor + .07, sx: .97, sz: .975 }, { y: floor + .2, sx: 1, sz: 1 }, { y: sill, sx: 1, sz: 1 }], { capBottom: true });
    b.add(smoothNormals(body.main), M.cabin);
    b.add(smoothNormals(loft(o, [{ y: floor + .2, sx: 1.004, sz: 1.004 }, { y: floor + .36, sx: 1.004, sz: 1.004 }]).main), M.trim);   // trim band
    const pillar = opts.pillars ?? (([x, z]) => Math.abs(x) > w / 2 - r * .75 && Math.abs(z) > d / 2 - r * .75);
    const band = loft(o, [{ y: sill, sx: 1, sz: 1 }, { y: top, sx: .965, sz: .965 }], { pick: (_i, mid) => pillar(mid) });
    b.add(band.main, M.glass); if (band.alt) b.add(band.alt, M.trim);
    b.add(loft(o, [{ y: sill - .03, sx: 1.012, sz: 1.012 }, { y: sill + .03, sx: 1.012, sz: 1.012 }], { capTop: true }).main, M.trim);   // sill rail
    const roofRings = opts.flatRoof
        ? [{ y: top, sx: .965, sz: .965 }, { y: roof, sx: .955, sz: .955 }]
        : [{ y: top, sx: .965, sz: .965 }, { y: roof, sx: .95, sz: .95 }, { y: roof + dome * .45, sx: .86, sz: .87 }, { y: roof + dome * .8, sx: .62, sz: .64 }, { y: roof + dome, sx: .25, sz: .27 }];
    b.add(smoothNormals(loft(o, roofRings, { capTop: true }).main), M.cabin);
    return o;
}

export function gondolaModel(): VehicleModel {
    const W = 1.95, D = 2.0, R = .44, floor = -3.4, sill = -2.42, top = -1.4, roof = -1.3;
    const b = new Builder(); grip(b, .8);
    // hanger arm down to the roof fairing
    b.add(bend([V(0, -.14, 0), V(0, -.42, .06), V(0, -.8, .16), V(0, -1.02, .02)], .06, 10), M.paint);
    b.add(rbox(.66, .14, .52, .06, 0, -1.08, 0, 3), M.trim);                                          // roof fairing
    cabinShell(b, W, D, R, floor, sill, top, roof, .16);
    // sliding doors on the platform side (+x): seams, frames and handles
    for (const z of [-.6, 0, .6]) b.add(box(.012, top - floor - .3, .02, W / 2 + .004, (floor + top) / 2 + .1, z), M.trim);
    for (const z of [-.08, .08]) b.add(rbox(.03, .22, .025, .01, W / 2 + .018, floor + .8, z), M.chrome);
    // interior: floor, benches front and back, seat backs (seen through the glass)
    b.add(box(W * .78, .03, D * .78, 0, floor + .14, 0), M.rubber);
    for (const s of [-1, 1]) { b.add(rbox(W - .3, .09, .4, .03, 0, floor + .45, s * .68), M.fabric); b.add(rbox(W - .3, .4, .06, .03, 0, floor + .7, s * .87), M.fabric); }
    const seats = [-.48, 0, .48].flatMap(x => [V(x, floor + .5, .68), V(x, floor + .5, -.68)]);
    return { parts: b.build(), seats, rider: V(.3, floor + .5, .68), riderPose: 'seat' };
}

export function cableCarModel(): VehicleModel {
    const W = 3.5, D = 7.4, R = .95, floor = -7.0, sill = -6.0, top = -4.65, roof = -4.45;
    const b = new Builder();
    // carriage on the track ropes: body, wheels in two rows, hanger arms down to the roof
    b.add(rbox(1.3, .5, 4.6, .12, 0, -.32, 0, 3), M.paint);
    for (let k = 0; k < 8; k++) for (const x of [-.32, .32]) b.add(wheel(.19, .09, x, .02, -1.95 + k * .56, 14), M.rubber);
    b.add(rbox(1.5, .1, 4.4, .03, 0, -.08, 0), M.galv);
    for (const s of [-1, 1]) b.add(tube(V(0, -.5, s * 1.9), V(0, roof + .05, s * 1.25), .15, 12, .12), M.paint);
    b.add(rbox(1.2, .25, 3.2, .08, 0, roof + .14, 0), M.trim);
    // pillars: corners plus every 1.5 m along the long sides
    cabinShell(b, W, D, R, floor, sill, top, roof, 0, { flatRoof: true, seg: 64,
        pillars: ([x, z]) => (Math.abs(x) > W / 2 - R * .75 && Math.abs(z) > D / 2 - R * .75) || (Math.abs(x) > W / 2 - .05 && [-1.5, 0, 1.5].some(p => Math.abs(z - p) < .08)) });
    b.add(rbox(W * .94, .06, D * .94, .03, 0, roof + .03, 0), M.cabin);                                   // roof deck
    // roof railing (maintenance deck)
    const rail = roundedRect(W * .86, D * .86, R * .7, 32).map(([x, z]) => V(x, roof + .72, z)); rail.push(rail[0].clone());
    b.add(bend(rail, .03, 6, 0), M.galv);
    for (const [x, z] of roundedRect(W * .86, D * .86, R * .7, 16)) b.add(tube(V(x, roof + .05, z), V(x, roof + .72, z), .022, 6), M.galv);
    // doors (+x side): seams and handles
    for (const z of [-1.1, 0, 1.1]) b.add(box(.015, top - floor - .3, .025, W / 2 + .005, (floor + top) / 2 + .1, z), M.trim);
    b.add(box(W * .84, .03, D * .84, 0, floor + .14, 0), M.rubber);
    return { parts: b.build(), seats: [], rider: V(0, floor + .02, 2.0), riderPose: 'stand' };
}

/** Retracted hanger of a surface lift (spring box + short rope), as seen when empty. */
export function hangerModel(platter: boolean): VehicleModel {
    const b = new Builder();
    b.add(rbox(.32, .42, .28, .05, 0, -.26, 0), M.paint); b.add(wheel(.08, .05, 0, .02, 0, 12), M.rubber);
    b.add(tube(V(0, -.47, 0), V(0, -1.8, 0), .018, 6), M.galv);
    if (platter) { const g = new T.CylinderGeometry(.17, .15, .05, 20); g.translate(0, -1.86, 0); b.add(g, M.rubber); }
    else { b.add(tube(V(0, -1.8, 0), V(0, -1.86, 0), .03, 6), M.galv); b.add(rbox(1.0, .07, .07, .03, 0, -1.88, 0), M.rubber); }
    return { parts: b.build(), seats: [], rider: V(0, 0, 0), riderPose: 'stand' };
}

/** Distant vehicles on other lifts: the same silhouettes with a fraction of the triangles (seen from hundreds of metres). */
export function lowModel(kind: 'chair' | 'gondola' | 'mixed' | 'cablecar' | 'surface', seats: number): Part[] {
    const b = new Builder();
    if (kind === 'cablecar') {
        b.add(rbox(1.3, .5, 4.4, .1, 0, -.3, 0, 1), M.paint);
        for (const s of [-1, 1]) b.add(tube(V(0, -.5, s * 1.9), V(0, -4.4, s * 1.25), .14, 6), M.paint);
        const o = roundedRect(3.5, 7.4, .95, 16);
        b.add(loft(o, [{ y: -7, sx: .95, sz: .96 }, { y: -6, sx: 1, sz: 1 }], { capBottom: true }).main, M.cabin);
        b.add(loft(o, [{ y: -6, sx: 1, sz: 1 }, { y: -4.65, sx: .965, sz: .965 }]).main, M.glass);
        b.add(loft(o, [{ y: -4.65, sx: .965, sz: .965 }, { y: -4.45, sx: .955, sz: .955 }], { capTop: true }).main, M.cabin);
    } else if (kind === 'gondola' || kind === 'mixed') {
        b.add(tube(V(0, -.1, 0), V(0, -1.1, 0), .06, 5), M.paint);
        const o = roundedRect(1.95, 2.0, .44, 12);
        b.add(loft(o, [{ y: -3.4, sx: .92, sz: .93 }, { y: -2.42, sx: 1, sz: 1 }], { capBottom: true }).main, M.cabin);
        b.add(loft(o, [{ y: -2.42, sx: 1, sz: 1 }, { y: -1.4, sx: .965, sz: .965 }]).main, M.glass);
        b.add(loft(o, [{ y: -1.4, sx: .965, sz: .965 }, { y: -1.3, sx: .95, sz: .95 }, { y: -1.15, sx: .5, sz: .5 }], { capTop: true }).main, M.cabin);
    } else if (kind === 'surface') {
        b.add(box(.3, .4, .28, 0, -.24, 0), M.paint); b.add(box(.03, 1.4, .03, 0, -1.1, 0), M.galv);
    } else {
        const W = seats * .5 + .2;
        b.add(tube(V(0, -.1, 0), V(0, -1.6, .4), .05, 5), M.galv);
        b.add(box(W, .1, .5, 0, -2.42, 0), M.fabric); b.add(box(W, .6, .1, 0, -2.06, .32), M.fabric);
        b.add(box(W + .08, .05, .05, 0, -1.62, .42), M.paint);
    }
    return b.build();
}
/** A seated passenger (other riders on the chairs), origin at the seat surface, facing -z. */
export function passengerGeometry() {
    const b = new Builder();
    b.add(new T.CapsuleGeometry(.17, .38, 3, 8).translate(0, .42, .1), M.paint);          // torso, leaning on the backrest
    b.add(new T.SphereGeometry(.12, 10, 8).translate(0, .86, .08), M.paint);              // helmet
    b.add(rbox(.34, .15, .44, .05, 0, .07, -.18), M.paint);                                  // thighs
    b.add(rbox(.3, .46, .14, .05, 0, -.2, -.44), M.paint);                                   // shins
    b.add(new T.BoxGeometry(.24, .02, 1.45).rotateY(1.25).translate(0, -.46, -.5), M.paint);    // board resting across the footrest
    return b.build()[0].geometry;
}
