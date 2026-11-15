import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapPiste } from './terrain.ts';

/**
 * Other people on the slopes in free ride: skiers and snowboarders riding down the mapped pistes near you, in linked
 * turns across the piste at 25-50 km/h, respawning upstream when they finish or fall far behind. Their routes are the
 * real piste lines; who is where is invented (there is no live data), so the numbers are a plausible quiet day, not a
 * count. Two instanced meshes (jackets coloured per person, and everything else), so the whole crowd costs two draw calls.
 */
const HALF: Record<string, number> = { blue: 22, red: 18, black: 15, park: 20, skicross: 8, itinerary: 6 };
const JACKETS = [0xd6452e, 0x1e5fa8, 0xf2c230, 0x2f8f5b, 0xe8e4da, 0x7a2f8f, 0x222831, 0xea7b2c, 0x3fb7c9, 0xb8324f];

type Person = { piste: MapPiste; seg: number; t: number; speed: number; phase: number; freq: number; width: number; board: boolean; sign: number; s: number };
type Line = { piste: MapPiste; pts: [number, number][]; len: number[] };

function figure(board: boolean) {
    // metres; +y up, the person faces -z (downhill), skis/board along z
    const parts: { g: T.BufferGeometry; c: number; jacket: boolean }[] = [];
    const put = (g: T.BufferGeometry, c: number, jacket: boolean, x: number, y: number, z: number, rx = 0, rz = 0) => {
        g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); parts.push({ g, c, jacket });
    };
    put(new T.CapsuleGeometry(.17, .42, 3, 8), 0, true, 0, 1.12, 0, -.35);                  // torso, leaning forward
    put(new T.CapsuleGeometry(.065, .42, 2, 6), 0, true, -.25, 1.05, -.08, -.6, .5);         // arms
    put(new T.CapsuleGeometry(.065, .42, 2, 6), 0, true, .25, 1.05, -.08, -.6, -.5);
    put(new T.SphereGeometry(.12, 10, 8), 0xe7e9ec, false, 0, 1.56, -.12);                   // helmet
    put(new T.BoxGeometry(.2, .07, .06), 0x1c2a33, false, 0, 1.53, -.22);                     // goggles
    if (board) {
        // the board lies across the facing direction (placed turned 90 deg, so it runs along the travel)
        put(new T.CapsuleGeometry(.08, .55, 2, 6), 0x2b2f36, false, -.22, .52, 0, 0, -.3);    // legs, feet on the board
        put(new T.CapsuleGeometry(.08, .55, 2, 6), 0x2b2f36, false, .22, .52, 0, 0, .3);
        put(new T.BoxGeometry(1.5, .03, .28), 0x30343c, false, 0, .03, 0);                   // board
    } else {
        put(new T.CapsuleGeometry(.08, .55, 2, 6), 0x2b2f36, false, -.12, .5, .05, .3);      // legs (flexed)
        put(new T.CapsuleGeometry(.08, .55, 2, 6), 0x2b2f36, false, .12, .5, .05, .3);
        put(new T.BoxGeometry(.08, .025, 1.7), 0xc23a2b, false, -.13, .03, 0);                // skis
        put(new T.BoxGeometry(.08, .025, 1.7), 0xc23a2b, false, .13, .03, 0);
        put(new T.CylinderGeometry(.01, .01, 1.1, 4), 0x8a9096, false, -.34, .7, -.15, .4);   // poles
        put(new T.CylinderGeometry(.01, .01, 1.1, 4), 0x8a9096, false, .34, .7, -.15, .4);
    }
    const merge = (jacket: boolean) => {
        const gs = parts.filter(p => p.jacket === jacket).map(p => {
            const g = p.g.index ? p.g.toNonIndexed() : p.g; g.deleteAttribute('uv');
            const c = new T.Color(jacket ? 0xffffff : p.c), n = g.attributes.position.count, col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
            g.setAttribute('color', new T.BufferAttribute(col, 3));
            return g;
        });
        return mergeGeometries(gs)!;
    };
    return { jacket: merge(true), rest: merge(false) };
}

export class Crowd {
    readonly group = new T.Group();
    private people: Person[] = [];
    private lines = new Map<MapPiste, Line>();
    private meshes: { jacket: T.InstancedMesh; rest: T.InstancedMesh; board: boolean }[] = [];
    private readonly count: number;
    private readonly pistes: MapPiste[];
    private readonly e0: number; private readonly n0: number;
    private readonly height: (x: number, d: number) => number;
    private rand: () => number;
    constructor(pistes: MapPiste[], e0: number, n0: number, height: (x: number, d: number) => number, quality: string, seed = 7) {
        this.pistes = pistes.filter(p => p.klass !== 'itinerary' && p.line.length > 1); this.e0 = e0; this.n0 = n0; this.height = height;
        this.count = quality === 'low' ? 10 : quality === 'balanced' ? 22 : 36;
        let s = seed; this.rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
        const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
        for (const board of [false, true]) {
            const f = figure(board), n = Math.ceil(this.count / 2);
            const jacket = new T.InstancedMesh(f.jacket, mat, n), rest = new T.InstancedMesh(f.rest, mat, n);
            for (const m of [jacket, rest]) { m.castShadow = quality !== 'low'; m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(T.DynamicDrawUsage); }
            for (let i = 0; i < n; i++) jacket.setColorAt(i, new T.Color(JACKETS[Math.floor(this.rand() * JACKETS.length)]));
            this.meshes.push({ jacket, rest, board }); this.group.add(jacket, rest);
        }
        this.group.name = 'crowd';
    }
    /** Pistes oriented downhill with cumulative lengths (cached). */
    private line(p: MapPiste): Line {
        let l = this.lines.get(p);
        if (!l) {
            let pts = p.line.map(([e, n]) => [e - this.e0, n - this.n0] as [number, number]);
            if (this.height(...pts[0]) < this.height(...pts[pts.length - 1])) pts = pts.reverse();
            const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
            l = { piste: p, pts, len }; this.lines.set(p, l);
        }
        return l;
    }
    private spawn(x: number, d: number, upstream: boolean): Person | null {
        const near = this.pistes.filter(p => p.line.some(([e, n]) => Math.hypot(e - this.e0 - x, n - this.n0 - d) < 600));
        if (!near.length) return null;
        const piste = near[Math.floor(this.rand() * near.length)], l = this.line(piste), total = l.len[l.len.length - 1];
        if (total < 120) return null;
        // start upstream of the rider when possible, otherwise anywhere along the visible part
        let s = this.rand() * total;
        if (upstream) {
            let best = 0, bd = Infinity;
            for (let i = 0; i < l.pts.length; i++) { const q = Math.hypot(l.pts[i][0] - x, l.pts[i][1] - d); if (q < bd) { bd = q; best = l.len[i]; } }
            s = Math.max(0, best - 150 - this.rand() * 350);
        }
        const board = this.rand() < .45;
        return { piste, seg: 0, t: 0, s, speed: 7 + this.rand() * 7, phase: this.rand() * 6.28, freq: .35 + this.rand() * .3,
            width: (piste.half ?? HALF[piste.klass] ?? 18) * (.35 + this.rand() * .4), board, sign: this.rand() < .5 ? 1 : -1 };
    }
    private at(l: Line, s: number) {
        let i = 1; while (i < l.len.length - 1 && l.len[i] < s) i++;
        const a = l.pts[i - 1], b = l.pts[i], seg = l.len[i] - l.len[i - 1] || 1, t = Math.min(1, Math.max(0, (s - l.len[i - 1]) / seg));
        return { x: a[0] + (b[0] - a[0]) * t, d: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / seg, td: (b[1] - a[1]) / seg };
    }
    private m = new T.Object3D();
    update(dt: number, x: number, d: number, time: number) {
        // keep the crowd near the rider
        this.people = this.people.filter(p => { const l = this.line(p.piste), q = this.at(l, p.s); return p.s < l.len[l.len.length - 1] - 5 && Math.hypot(q.x - x, q.d - d) < 900; });
        for (let tries = 0; this.people.length < this.count && tries < 4; tries++) { const p = this.spawn(x, d, this.people.length > this.count / 2); if (p) this.people.push(p); }
        const used = [0, 0];
        for (const p of this.people) {
            const l = this.line(p.piste);
            // linked turns: the lateral offset swings across the piste; speed along the line drops a little mid-turn
            const w = p.phase + time * p.freq * 2 * Math.PI, off = Math.sin(w) * p.width * p.sign, dOff = Math.cos(w) * p.width * p.sign * p.freq * 2 * Math.PI;
            p.s += p.speed * (1 - .15 * Math.abs(Math.cos(w))) * dt;
            const q = this.at(l, p.s), nx = q.td, nd = -q.tx;            // right of travel
            const px = q.x + nx * off, pd = q.d + nd * off;
            const vx = q.tx * p.speed + nx * dOff, vd = q.td * p.speed + nd * dOff;
            const yaw = Math.atan2(-vx, vd) + (p.board ? Math.PI / 2 : 0);   // local -z along the travel (world z = -d)
            const lean = Math.max(-.5, Math.min(.5, -Math.sin(w) * .45 * p.sign));
            const k = p.board ? 1 : 0, mesh = this.meshes[k], i = used[k]++;
            if (i >= mesh.jacket.instanceMatrix.count) continue;
            this.m.position.set(px, this.height(px, pd), -pd);
            this.m.rotation.set(p.board ? lean : 0, yaw, p.board ? 0 : lean, 'YXZ');
            this.m.updateMatrix();
            mesh.jacket.setMatrixAt(i, this.m.matrix); mesh.rest.setMatrixAt(i, this.m.matrix);
        }
        this.meshes.forEach((m, k) => { m.jacket.count = m.rest.count = used[k]; m.jacket.instanceMatrix.needsUpdate = m.rest.instanceMatrix.needsUpdate = true; });
    }
    /** Positions (local x, d) of everyone, for tests. */
    positions() { return this.people.map(p => { const q = this.at(this.line(p.piste), p.s); return { x: q.x, d: q.d, piste: p.piste }; }); }
    dispose() { for (const m of this.meshes) { m.jacket.geometry.dispose(); m.rest.geometry.dispose(); m.jacket.dispose(); m.rest.dispose(); } }
}
