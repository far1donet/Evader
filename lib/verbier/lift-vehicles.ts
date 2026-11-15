import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Lift vehicles, built in metres with the grip on the cable at the origin, travel toward -z, up +y.
 * Generic designs with typical dimensions (no manufacturer's model or branding):
 *  - detachable chair, 2-8 seats, seat 2.4 m below the grip, safety bar with footrest;
 *  - gondola cabin (4-10 seats), floor 3.4 m below the grip, benches front and back;
 *  - aerial tramway cabin, floor 7 m below the track rope;
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

export const MAT = {
    steel: new T.MeshStandardMaterial({ color: 0x8a939a, metalness: .65, roughness: .38 }),
    darkSteel: new T.MeshStandardMaterial({ color: 0x353c42, metalness: .5, roughness: .5 }),
    seat: new T.MeshStandardMaterial({ color: 0x24384c, roughness: .75 }),
    cabin: new T.MeshStandardMaterial({ color: 0xe6e9eb, metalness: .25, roughness: .35 }),
    stripe: new T.MeshStandardMaterial({ color: 0xb3302c, roughness: .5 }),
    glass: new T.MeshStandardMaterial({ color: 0x2c4152, metalness: .4, roughness: .08, transparent: true, opacity: .55 }),
    rubber: new T.MeshStandardMaterial({ color: 0x1b1f22, roughness: .9 }),
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const g = new T.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g;
};
/** Tube between two points. */
const tube = (a: T.Vector3, b: T.Vector3, r: number) => {
    const g = new T.CylinderGeometry(r, r, a.distanceTo(b), 6);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q); const m = a.clone().add(b).multiplyScalar(.5); g.translate(m.x, m.y, m.z); return g;
};
const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
const merge = (gs: T.BufferGeometry[]) => { const g = mergeGeometries(gs.map(x => x.index ? x.toNonIndexed() : x), false)!; g.computeVertexNormals(); return g; };

export function chairModel(seats: number): VehicleModel {
    const W = seats * .5 + .3, half = W / 2;
    const steel = [
        box(.26, .3, .62, 0, -.05, 0),                                      // grip on the cable
        tube(V(0, -.18, 0), V(0, -1.6, .34), .05),                          // hanger
        tube(V(-half, -1.6, .34), V(half, -1.6, .34), .04),                 // yoke over the backrest
        ...[-1, 1].map(s => tube(V(s * half, -1.6, .34), V(s * half, -2.42, .24), .035)),   // side posts
        box(W, .05, .46, 0, -2.5, .02),                                      // seat frame
        ...Array.from({ length: seats - 1 }, (_, i) => box(.04, .22, .4, -half + .15 + (i + 1) * .5, -2.3, .02)), // armrests
    ];
    const cushions = [box(W - .06, .09, .48, 0, -2.42, .02), box(W - .06, .6, .07, 0, -2.07, .29, -.2)];
    const pivot = V(0, -1.6, .34);
    const barSteel = [
        ...[-1, 1].map(s => tube(V(s * (half - .05), -1.6, .34), V(s * (half - .05), -2.02, -.46), .03)),
        tube(V(-half + .05, -2.02, -.46), V(half - .05, -2.02, -.46), .03),   // front bar at chest height
        ...[-1, 1].map(s => tube(V(s * W / 4, -2.02, -.46), V(s * W / 4, -2.86, -.56), .025)),
        tube(V(-W * .4, -2.86, -.56), V(W * .4, -2.86, -.56), .03),           // footrest
    ].map(g => g.translate(-pivot.x, -pivot.y, -pivot.z));
    const seatsAt = Array.from({ length: seats }, (_, i) => V(-half + .15 + .25 + i * .5, -2.37, .02));
    return {
        parts: [{ geometry: merge(steel), material: MAT.steel }, { geometry: merge(cushions), material: MAT.seat }],
        seats: seatsAt, rider: seatsAt[Math.floor((seats - 1) / 2)], riderPose: 'seat',
        bar: { parts: [{ geometry: merge(barSteel), material: MAT.steel }], pivot },
    };
}

export function gondolaModel(): VehicleModel {
    const W = 1.9, D = 2.0, H = 2.25, roof = -1.1, floor = roof - H;
    const steel = [box(.26, .3, .62, 0, -.05, 0), tube(V(0, -.18, 0), V(0, roof + .05, 0), .06), box(.9, .12, .5, 0, roof + .06, 0)];
    const body = [box(W, H - .82, D, 0, floor + (H - .82) / 2, 0), box(W, .12, D, 0, roof - .06, 0)];
    const stripe = [box(W + .01, .14, D + .01, 0, floor + .22, 0)];
    const glass = [box(W + .02, .74, D + .02, 0, roof - .12 - .37, 0)];
    const benches = [box(W - .2, .06, .38, 0, floor + .45, .74), box(W - .2, .06, .38, 0, floor + .45, -.74)];
    const seats = [-.45, 0, .45].flatMap(x => [V(x, floor + .48, .74), V(x, floor + .48, -.74)]);
    return {
        parts: [{ geometry: merge(steel), material: MAT.steel }, { geometry: merge(body), material: MAT.cabin }, { geometry: merge(stripe), material: MAT.stripe },
            { geometry: merge(glass), material: MAT.glass }, { geometry: merge(benches), material: MAT.darkSteel }],
        seats, rider: V(.3, floor + .58, .74), riderPose: 'seat',
    };
}

export function cableCarModel(): VehicleModel {
    const W = 3.4, D = 7.2, H = 2.75, roof = -4.2, floor = roof - H;
    const steel = [box(1.1, .55, 4.2, 0, -.05, 0), ...[-1, 1].map(z => tube(V(0, -.3, z * 1.6), V(0, roof + .1, z * 1.2), .09)), box(1.4, .2, 3.2, 0, roof + .1, 0)];
    const body = [box(W, H - .95, D, 0, floor + (H - .95) / 2, 0), box(W, .15, D, 0, roof - .07, 0)];
    const stripe = [box(W + .01, .18, D + .01, 0, floor + .3, 0)];
    const glass = [box(W + .02, .8, D + .02, 0, roof - .15 - .4, 0)];
    return {
        parts: [{ geometry: merge(steel), material: MAT.darkSteel }, { geometry: merge(body), material: MAT.cabin }, { geometry: merge(stripe), material: MAT.stripe }, { geometry: merge(glass), material: MAT.glass }],
        seats: [], rider: V(0, floor + .02, 1.8), riderPose: 'stand',
    };
}

/** Retracted hanger of a surface lift (spring box + short rope), as seen when empty. */
export function hangerModel(platter: boolean): VehicleModel {
    const steel = [box(.34, .44, .3, 0, -.25, 0), tube(V(0, -.45, 0), V(0, -1.8, 0), .02)];
    const end = platter ? new T.CylinderGeometry(.17, .17, .05, 16).translate(0, -1.85, 0) : tube(V(-.5, -1.82, 0), V(.5, -1.82, 0), .035);
    return { parts: [{ geometry: merge(steel), material: MAT.darkSteel }, { geometry: merge([end]), material: MAT.rubber }], seats: [], rider: V(0, 0, 0), riderPose: 'stand' };
}

/** Distant vehicles on other lifts: a few boxes each (they are seen from hundreds of metres away). */
export function lowModel(kind: 'chair' | 'gondola' | 'mixed' | 'cablecar' | 'surface', seats: number): Part[] {
    if (kind === 'cablecar') return [{ geometry: merge([box(.5, 4.2, .5, 0, -2.1, 0), box(3.4, 2.75, 7.2, 0, -5.6, 0)]), material: MAT.cabin }];
    if (kind === 'gondola' || kind === 'mixed') return [{ geometry: merge([box(.12, 1.1, .12, 0, -.55, 0), box(1.9, 2.25, 2.0, 0, -2.22, 0)]), material: MAT.cabin }];
    if (kind === 'surface') return [{ geometry: merge([box(.3, .4, .3, 0, -.2, 0), box(.04, 1.4, .04, 0, -1.1, 0)]), material: MAT.darkSteel }];
    const W = seats * .5 + .3;
    return [{ geometry: merge([box(.08, 2.2, .08, 0, -1.2, .3), box(W, .1, .5, 0, -2.42, .02), box(W, .55, .08, 0, -2.1, .3)]), material: MAT.seat }];
}
/** A seated passenger (other riders on the chairs), origin at the seat surface, facing -z. */
export function passengerGeometry() {
    const g = [
        new T.CapsuleGeometry(.17, .38, 2, 6).translate(0, .42, .1),        // torso, leaning on the backrest
        new T.SphereGeometry(.12, 8, 6).translate(0, .86, .08),            // helmet
        box(.34, .15, .44, 0, .07, -.18),                                    // thighs
        box(.3, .46, .14, 0, -.2, -.44),                                     // shins
        new T.BoxGeometry(.24, .02, 1.45).rotateY(1.25).translate(0, -.46, -.5), // board resting across the footrest
    ];
    return merge(g);
}
