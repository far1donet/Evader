import * as T from 'three';
import type { VerbierRun, Lift } from './terrain.ts';

/**
 * Scenery placed from real data: lift lines (mapped pylon nodes and stations from OpenStreetMap), piste poles along the
 * real run line, and the ski-cross start gate and netting. Sizes (tower heights, station boxes, pole spacing) are
 * typical values, not surveyed: the guide asks that estimated clearances be labelled as such, and they are here.
 */
const TOWER: Record<string, number> = { gondola: 16, cable_car: 26, chair_lift: 12, mixed_lift: 14, 't-bar': 7, platter: 7, rope_tow: 3, magic_carpet: 0 };
const VEHICLE_GAP: Record<string, number> = { gondola: 45, chair_lift: 22, mixed_lift: 28, cable_car: 0, 't-bar': 18, platter: 18 };

export function liftGroup(run: VerbierRun, height: (x: number, d: number) => number) {
    const g = new T.Group(); g.name = 'lifts';
    const steel = new T.MeshStandardMaterial({ color: 0x8a949c, metalness: .7, roughness: .4 });
    const station = new T.MeshStandardMaterial({ color: 0x6b6f72, roughness: .8 });
    const roof = new T.MeshStandardMaterial({ color: 0x2c3438, roughness: .7 });
    const cabin = new T.MeshStandardMaterial({ color: 0xd8dde0, metalness: .2, roughness: .5 });
    const cableMat = new T.LineBasicMaterial({ color: 0x1d2328 });
    const towerGeo = new T.CylinderGeometry(.35, .5, 1, 8);
    for (const lift of run.h.lifts) addLift(g, lift);
    return g;

    function addLift(group: T.Group, lift: Lift) {
        const type = lift.type ?? 'chair_lift';
        if (type === 'magic_carpet') return;
        const pts = lift.points.map(([x, d]) => new T.Vector3(x, height(x, d), -d));
        const top = TOWER[type] ?? 10;
        // stations at both ends (box sized by lift type)
        for (const i of [0, pts.length - 1]) {
            const big = type === 'gondola' || type === 'cable_car' || type === 'mixed_lift';
            const s = big ? [16, 9, 12] : type === 'chair_lift' ? [10, 6, 8] : [4, 3, 4];
            const b = new T.Mesh(new T.BoxGeometry(s[0], s[1], s[2]), station); b.position.copy(pts[i]).add(new T.Vector3(0, s[1] / 2 - .5, 0));
            const r = new T.Mesh(new T.BoxGeometry(s[0] + 1, .6, s[2] + 1), roof); r.position.copy(b.position).add(new T.Vector3(0, s[1] / 2 + .3, 0));
            b.castShadow = r.castShadow = true; b.receiveShadow = true; group.add(b, r);
        }
        if (top === 0) return;
        // pylons at intermediate mapped nodes (OpenStreetMap aerialway nodes are mostly pylons)
        const heads: T.Vector3[] = [pts[0].clone().add(new T.Vector3(0, 7, 0))];
        for (let i = 1; i < pts.length - 1; i++) {
            const t = new T.Mesh(towerGeo, steel); t.scale.y = top; t.position.copy(pts[i]).add(new T.Vector3(0, top / 2, 0)); t.castShadow = true; group.add(t);
            const arm = new T.Mesh(new T.BoxGeometry(6, .4, .4), steel); arm.position.copy(pts[i]).add(new T.Vector3(0, top, 0)); group.add(arm);
            heads.push(pts[i].clone().add(new T.Vector3(0, top, 0)));
        }
        heads.push(pts[pts.length - 1].clone().add(new T.Vector3(0, 7, 0)));
        // cable: two lines (up/down track) with a parabolic sag of ~2.5 % of each span (estimate)
        const cable: T.Vector3[] = [];
        for (const side of [-2.5, 2.5]) {
            for (let i = 0; i < heads.length - 1; i++) {
                const a = heads[i], b = heads[i + 1], span = a.distanceTo(b), sag = span * .025;
                const dir = new T.Vector3().subVectors(b, a); const right = new T.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(side);
                for (let k = 0; k < 8; k++) {
                    const t0 = k / 8, t1 = (k + 1) / 8;
                    const p0 = a.clone().lerp(b, t0).add(right).add(new T.Vector3(0, -4 * sag * t0 * (1 - t0), 0));
                    const p1 = a.clone().lerp(b, t1).add(right).add(new T.Vector3(0, -4 * sag * t1 * (1 - t1), 0));
                    cable.push(p0, p1);
                }
            }
        }
        group.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(cable), cableMat));
        // static vehicles along the cable
        const gap = VEHICLE_GAP[type] ?? 0;
        if (!gap) return;
        const vehicle = type === 'gondola' || type === 'mixed_lift' ? new T.BoxGeometry(2, 2.2, 2) : new T.BoxGeometry(2.6, .5, .8);
        let acc = gap / 2;
        for (let i = 0; i < heads.length - 1; i++) {
            const a = heads[i], b = heads[i + 1], span = a.distanceTo(b);
            while (acc < span) {
                const t = acc / span, side = (Math.floor(acc / gap) % 2 ? 2.5 : -2.5);
                const dir = new T.Vector3().subVectors(b, a); const right = new T.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(side);
                const m = new T.Mesh(vehicle, cabin); m.position.copy(a.clone().lerp(b, t)).add(right).add(new T.Vector3(0, -4 * span * .025 * t * (1 - t) - 2.2, 0));
                m.lookAt(m.position.clone().add(new T.Vector3(dir.x, 0, dir.z))); group.add(m);
                acc += gap;
            }
            acc -= span;
        }
    }
}

const POLE: Record<string, number> = { blue: 0x2f6fd6, red: 0xd8342c, black: 0x111316, itinerary: 0xf2c418, park: 0xf07a1e, skicross: 0xf07a1e };
/** Piste poles along the real run line, alternating sides every 40 m (Swiss marking colours by class). */
export function poleGroup(run: VerbierRun, height: (x: number, d: number) => number, centre: (d: number) => number) {
    const g = new T.Group(); g.name = 'piste-poles';
    const mat = new T.MeshStandardMaterial({ color: POLE[run.klass] ?? 0xd8342c, roughness: .6 });
    const geo = new T.CylinderGeometry(.05, .05, 1.6, 6);
    const off = Math.max(6, run.pisteHalfWidth + 1.5);
    const count = Math.floor(run.length / 40);
    const poles = new T.InstancedMesh(geo, mat, count + 1);
    const o = new T.Object3D();
    for (let i = 0; i <= count; i++) {
        const d = i * 40, x = centre(d) + (i % 2 ? off : -off);
        o.position.set(x, height(x, d) + .8, -d); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
    }
    poles.castShadow = true; g.add(poles);
    return g;
}

// ---- Ski cross: shape added to the real terrain along the mapped line -----------------------------------------------------
/** Curvature of the run's centre line (1/m, + = turning toward +x). */
export function curvature(run: VerbierRun, d: number) { const s = 6; return (run.centreX(d + s) - 2 * run.centreX(d) + run.centreX(d - s)) / (s * s); }
const JUMPS = [{ d: 175, len: 16, rise: 1.6 }, { d: 395, len: 18, rise: 1.9 }];
/** Ski-cross relief (m) at (x, d): berms on the real bends (banked to ~12 m/s), whoops on straights, two table jumps.
 *  The guide lists start gate, banked turns, whoops, jumps and netting; their sizes here are a design. */
export function skicrossShape(run: VerbierRun, x: number, d: number) {
    const o = x - run.centreX(d);
    // start ramp: the mapped start area is nearly flat (0-5 deg for 45 m), so the course starts from a built ramp
    // (6 m over 60 m: built snow, as ski-cross tracks are; a design value). Its sides blend out over 20 m, a snow pad.
    const ramp = d < 60 && Math.abs(o) < 30 ? 6 * ((60 - d) / 60) ** 1.3 * smoothFall(Math.abs(o), 10, 30) : 0;
    if (Math.abs(o) > 9 || d > run.length - 15) return ramp;
    if (d < 20) return ramp;
    let h = ramp;
    const k = curvature(run, d);
    const bank = Math.min(Math.atan(Math.abs(k) * 144 / 9.81), .6);          // tan(bank) = v^2 k / g at 12 m/s, max ~34 deg
    if (bank > .05) h += Math.max(0, -Math.sign(k) * o) * Math.tan(bank) * (1 - Math.max(0, Math.abs(o) - 6) / 3);
    else {
        const roller = .45 * (1 - Math.cos(2 * Math.PI * d / 7)) / 2;       // whoops: 7 m rollers, 45 cm
        h += roller * (1 - Math.max(0, Math.abs(o) - 5) / 4);
    }
    for (const j of JUMPS) {
        const t = d - j.d; if (t < 0 || t > j.len + 14) continue;
        h += t < 6 ? j.rise * (t / 6) ** 2 : t < 6 + j.len ? j.rise : j.rise * (1 - (t - 6 - j.len) / 8);
    }
    return h;
}
const smoothFall = (v: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return 1 - t * t * (3 - 2 * t); };
/** Ski-cross start gate and side netting. */
export function skicrossGroup(run: VerbierRun, height: (x: number, d: number) => number) {
    const g = new T.Group(); g.name = 'skicross';
    const orange = new T.MeshStandardMaterial({ color: 0xf07a1e, roughness: .7, transparent: true, opacity: .38, depthWrite: false, side: T.DoubleSide });
    const post = new T.MeshStandardMaterial({ color: 0x30363a });
    const gateY = height(run.centreX(10), 10);
    const hut = new T.Mesh(new T.BoxGeometry(14, 3, 3), new T.MeshStandardMaterial({ color: 0x2b3a44 })); hut.position.set(run.centreX(10), gateY + 1.5, -6); g.add(hut);
    for (const side of [-1, 1]) {
        const pos: number[] = [];
        for (let d = 12; d < run.length - 15; d += 4) {
            const a = run.centreX(d) + side * 8.5, b = run.centreX(d + 4) + side * 8.5;
            const ya = height(a, d), yb = height(b, d + 4);
            pos.push(a, ya, -d, b, yb, -(d + 4), b, yb + 1.1, -(d + 4), a, ya, -d, b, yb + 1.1, -(d + 4), a, ya + 1.1, -d);
            if (d % 12 === 0) { const p = new T.Mesh(new T.CylinderGeometry(.04, .04, 1.3, 5), post); p.position.set(a, ya + .65, -d); g.add(p); }
        }
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        g.add(new T.Mesh(geo, orange));
    }
    return g;
}
