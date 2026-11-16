import * as T from 'three';
import { activateTiles, forestCover, worldHeight, FreeTerrain, loadTilesAround, missingTiles, overviewHeight, treesAround, loadBuildings, buildingsAround, buildingsLoaded, type Resort, type ResortLift, type MapPiste, type Station, type SnowInfo, type Lift } from './terrain.ts';
import { buildingMesh, type Solid } from './buildings.ts';
/**
 * Where to put the rider for a free-ride start near (e, n): not inside a lift terminal (24 m around each lift end) or a
 * building, on ground no steeper than 35 deg; the nearest such spot, preferring the lowest one at that distance so the
 * rider can ride away. Returns (e, n) unchanged if it is already clear.
 */
export function clearSpot(resort: Resort, e: number, n: number): [number, number] {
    const ends = resort.lifts.flatMap(l => [l.points[0], l.points[l.points.length - 1]]).filter(([le, ln]) => Math.hypot(le - e, ln - n) < 140);
    const houses = buildingsLoaded() ? buildingsAround(e, n, 140) : [];
    const clear = (pe: number, pn: number) => {
        if (ends.some(([le, ln]) => Math.hypot(le - pe, ln - pn) < 24)) return false;
        for (const b of houses) {
            const dx = pe - b.e, dn = pn - b.n, a = dx * Math.cos(b.angle) + dn * Math.sin(b.angle), c = -dx * Math.sin(b.angle) + dn * Math.cos(b.angle);
            if (Math.abs(a) < b.length / 2 + 3 && Math.abs(c) < b.width / 2 + 3) return false;
        }
        const g = Math.hypot(worldHeight(pe + 2, pn) - worldHeight(pe - 2, pn), worldHeight(pe, pn + 2) - worldHeight(pe, pn - 2)) / 4;
        return g < .7;
    };
    if (clear(e, n)) return [e, n];
    for (let r = 6; r <= 90; r += 4) {
        let best: [number, number, number] | null = null;
        for (let k = 0; k < 32; k++) {
            const a = k / 32 * Math.PI * 2, pe = e + Math.cos(a) * r, pn = n + Math.sin(a) * r;
            if (!clear(pe, pn)) continue;
            const h = worldHeight(pe, pn); if (!best || h < best[2]) best = [pe, pn, h];
        }
        if (best) return [best[0], best[1]];
    }
    return [e, n];
}
/** Free geometry (and instance buffers) of a removed group whose materials are shared (lifts, buildings). */
function dropGeometry(g: T.Object3D) {
    const geos = new Set<T.BufferGeometry>();
    g.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); if (o instanceof T.Mesh || o instanceof T.LineSegments) geos.add(o.geometry); });
    geos.forEach(x => x.dispose());
}
/** Free a rebuilt group's GPU buffers: instance data, geometries and its own materials (each rebuild makes new ones). */
function release(g: T.Object3D) {
    const geos = new Set<T.BufferGeometry>(), mats = new Set<T.Material>();
    g.traverse(o => {
        if (o instanceof T.InstancedMesh) o.dispose();
        if (o instanceof T.Mesh || o instanceof T.LineSegments) { geos.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); }
    });
    geos.forEach(x => x.dispose()); mats.forEach(m => m.dispose());
}
const SNOW_FAR = new T.Color(0xe8eff8), STONE_FAR = new T.Color(0x596479), FOREST_FAR = new T.Color(0x4a5a50);
import { Crowd } from './crowd.ts';
import { snowMaterial, preset } from '../alpine.ts';
import { makeAlpineForest } from '../alpine-forest.ts';
import { makeCloudSea } from './cloud-sea.ts';
import { liftScenery } from './lift-ride.ts';

/**
 * Free ride over the whole Verbier 4 Vallées domain.
 *
 * SurfaceMap: where the groomed pistes, mogul sections and ungroomed itineraries are, from every mapped piste
 * (OpenStreetMap), so snow, moguls and materials are right anywhere, not only along one run.
 * FreeView: the world drawn around the rider, streamed as they move: 2 m (or 4 m) terrain chunks near the rider, a coarser
 * mesh to the horizon, trees from the aerial imagery, the lifts, piste marker poles, the valley cloud sea.
 */
const HALF: Record<string, number> = { blue: 22, red: 18, black: 15, park: 30, skicross: 9 };
const CELL = 4, CELLS = 250, NONE = 60;
type SurfTile = { off: Float32Array; flags: Uint8Array };
const key = (te: number, tn: number) => te * 10000 + tn;

export class SurfaceMap {
    private readonly tiles = new Map<number, SurfTile>();
    private readonly byTile = new Map<number, MapPiste[]>();
    readonly resort: Resort;
    constructor(resort: Resort) {
        this.resort = resort;
        for (const p of resort.pistes) {
            const seen = new Set<number>();
            for (const [e, n] of p.line) for (const de of [-80, 80]) for (const dn of [-80, 80]) {
                const k = key(Math.floor((e + de) / 1000), Math.floor((n + dn) / 1000));
                if (!seen.has(k)) { seen.add(k); (this.byTile.get(k) ?? this.byTile.set(k, []).get(k)!).push(p); }
            }
        }
    }
    private tile(te: number, tn: number): SurfTile {
        const k = key(te, tn); let t = this.tiles.get(k); if (t) return t;
        t = { off: new Float32Array(CELLS * CELLS).fill(NONE), flags: new Uint8Array(CELLS * CELLS) };
        const e0 = te * 1000, n0 = tn * 1000;
        for (const p of this.byTile.get(k) ?? []) {
            const groomed = p.klass !== 'itinerary' && p.grooming !== 'ungroomed', half = p.half ?? HALF[p.klass] ?? 18, reach = groomed ? half + 40 : 18;
            for (let i = 0; i < p.line.length - 1; i++) {
                const [ax, ay] = p.line[i], [bx, by] = p.line[i + 1];
                const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - e0) / CELL)), c1 = Math.min(CELLS - 1, Math.ceil((Math.max(ax, bx) + reach - e0) / CELL));
                const r0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - n0) / CELL)), r1 = Math.min(CELLS - 1, Math.ceil((Math.max(ay, by) + reach - n0) / CELL));
                if (c0 > c1 || r0 > r1) continue;
                const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
                for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
                    const px = e0 + (c + .5) * CELL, py = n0 + (r + .5) * CELL;
                    const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
                    const dist = Math.hypot(px - ax - tt * dx, py - ay - tt * dy), idx = r * CELLS + c;
                    if (groomed) {
                        if (dist - half < t.off[idx]) t.off[idx] = dist - half;
                        if (p.grooming === 'moguls' && dist < half + 6) t.flags[idx] |= 2;
                    } else if (dist < 14) t.flags[idx] |= 1;
                }
            }
        }
        this.tiles.set(k, t); return t;
    }
    private cell(gc: number, gr: number) {
        const te = Math.floor(gc / CELLS), tn = Math.floor(gr / CELLS), t = this.tile(te, tn), i = (gr - tn * CELLS) * CELLS + (gc - te * CELLS);
        return { off: t.off[i], flags: t.flags[i] };
    }
    /** Snow at a world point (bilinear distance to the groomed corridor; flags from the nearest cell). */
    at(e: number, n: number): SnowInfo {
        const fx = e / CELL - .5, fy = n / CELL - .5, c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r;
        const a = this.cell(c, r), b = this.cell(c + 1, r), cc = this.cell(c, r + 1), d = this.cell(c + 1, r + 1);
        const off = (a.off * (1 - tx) + b.off * tx) * (1 - ty) + (cc.off * (1 - tx) + d.off * tx) * ty;
        const nearest = (tx < .5 ? (ty < .5 ? a : cc) : (ty < .5 ? b : d)).flags;
        return { off, itinerary: !!(nearest & 1) && off > 0, moguls: !!(nearest & 2) };
    }
    /** Closest mapped piste to a world point (for the HUD). */
    nearest(e: number, n: number) {
        let best: { piste: MapPiste; dist: number } | null = null;
        for (const p of this.byTile.get(key(Math.floor(e / 1000), Math.floor(n / 1000))) ?? []) {
            for (let i = 0; i < p.line.length - 1; i++) {
                const [ax, ay] = p.line[i], [bx, by] = p.line[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
                const tt = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2)), dist = Math.hypot(e - ax - tt * dx, n - ay - tt * dy);
                if (!best || dist < best.dist) best = { piste: p, dist };
            }
        }
        return best;
    }
}

const POLE_COLOUR: Record<string, number> = { blue: 0x2f6fd6, red: 0xd8342c, black: 0x111316, itinerary: 0xf2c418, park: 0xf07a1e, skicross: 0xf07a1e };
type Chunk = { mesh: T.Mesh; ci: number; cj: number };
export type FreeInfo = { where: string; onPiste: boolean; nearLifts: ResortLift[]; station?: Station };

export class FreeView {
    readonly group = new T.Group();
    obstacles: ({ x: number; d: number; r: number } | Solid)[] = [];
    private readonly chunkSize = 64; private readonly step: number; private readonly radius: number;
    private readonly chunks = new Map<string, Chunk>();
    private readonly queue: [number, number][] = [];
    private readonly material: T.Material;
    private far?: T.Mesh; private farCentre = new T.Vector2(1e9, 1e9); private readonly farMat: T.MeshStandardMaterial; private readonly nearBox = new T.Vector4();
    private horizon?: T.Mesh;
    private forest?: T.Object3D; private treeCentre = new T.Vector2(1e9, 1e9);
    private lifts = new Map<string, T.Group>(); private poles?: T.Group; private sceneryCentre = new T.Vector2(1e9, 1e9);
    private readonly sea: T.Mesh;
    private loading = false; private lastStream = new T.Vector2(1e9, 1e9);
    private readonly e0: number; private readonly n0: number;
    readonly run: FreeTerrain; readonly surface: SurfaceMap; readonly resort: Resort; private readonly quality: string;
    private readonly heightFn: (x: number, d: number) => number; private readonly depthFn: (x: number, d: number) => number;
    constructor(run: FreeTerrain, surface: SurfaceMap, resort: Resort, quality: string, heightFn: (x: number, d: number) => number, depthFn: (x: number, d: number) => number) {
        this.run = run; this.surface = surface; this.resort = resort; this.quality = quality; this.heightFn = heightFn; this.depthFn = depthFn;
        this.e0 = run.frame.e0; this.n0 = run.frame.n0;
        const q = quality;
        this.step = q === 'low' || q === 'balanced' ? 4 : 2;
        this.radius = q === 'low' ? 3 : q === 'balanced' ? 4 : q === 'high' ? 4 : 5;
        this.material = snowMaterial(1e6, 1e9, false, this.step <= 2);
        this.farMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .94, envMapIntensity: .48 });
        const nearBox = this.nearBox;
        this.farMat.onBeforeCompile = sh => {
            sh.uniforms.nearBox = { value: nearBox };
            sh.vertexShader = 'uniform vec4 nearBox;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                // tuck the coarse mesh under the detailed window around the rider
                if (position.x > nearBox.x && position.x < nearBox.z && position.z > nearBox.y && position.z < nearBox.w) transformed.y -= 14.0;`);
        };
        this.sea = makeCloudSea(new T.Vector3(0, 0, 0), 1250, 26000); this.group.add(this.sea);
        this.crowd = new Crowd(resort.pistes, this.e0, this.n0, heightFn, quality); this.group.add(this.crowd.group);
        this.buildHorizon();
    }
    private world(x: number, d: number) { return { e: this.e0 + x, n: this.n0 + d }; }

    /** Build everything around the starting point at once (call before the first frame). */
    prime(x: number, d: number) { this.update(x, d, 0, true); }

    /** Stream tiles and rebuild what moved out of range. Cheap when nothing changes. */
    /** Other skiers and riders on the pistes around (see crowd.ts). */
    crowd: Crowd;
    private clock = 0;
    update(x: number, d: number, dt: number, all = false) {
        this.run.focusX = x;
        this.clock += dt; this.crowd.update(Math.min(dt, .1), x, d, this.clock);
        const w = this.world(x, d);
        // tiles: start loading 1.6 km ahead, every 200 m moved
        if (!this.loading && Math.hypot(x - this.lastStream.x, d - this.lastStream.y) > 200) {
            this.lastStream.set(x, d);
            if (missingTiles(w.e, w.n, 1600).length) {
                this.loading = true;
                // fetched tiles wait until the rider is clear of them (activateTiles below): the ground never shifts underfoot
                loadTilesAround(w.e, w.n, 1600, true).then(() => { this.loading = false; }).catch(() => { this.loading = false; });
            }
        }
        const applied = activateTiles(w.e, w.n, 120);
        if (applied.length) this.tilesApplied(applied, x, d);
        // near chunks
        const ci0 = Math.floor(x / this.chunkSize), cj0 = Math.floor(d / this.chunkSize), R = this.radius;
        for (const [k, c] of this.chunks) if (Math.abs(c.ci - ci0) > R + 1 || Math.abs(c.cj - cj0) > R + 1) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); this.chunks.delete(k); }
        const want: [number, number, number][] = [];
        for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (!this.chunks.has(`${ci0 + i},${cj0 + j}`)) want.push([ci0 + i, cj0 + j, i * i + j * j]);
        want.sort((a, b) => a[2] - b[2]);
        // Work within a time budget per frame (about 4 ms) so streaming never stalls a frame; at least one chunk per frame.
        const t0 = performance.now(), left = () => all || performance.now() - t0 < this.budgetMs;
        let built = 0;
        for (const [ci, cj] of want) { if (built > 0 && !left()) break; this.buildChunk(ci, cj); built++; }
        while (left() && this.queue.length) { const [ci, cj] = this.queue.shift()!; if (this.chunks.has(`${ci},${cj}`)) this.buildChunk(ci, cj); }
        this.nearBox.set((ci0 - R) * this.chunkSize + 24, -((cj0 + R + 1) * this.chunkSize) + 24, (ci0 + R + 1) * this.chunkSize - 24, -((cj0 - R) * this.chunkSize) - 24);
        // far mesh, trees, lifts and poles
        if (Math.hypot(x - this.farCentre.x, d - this.farCentre.y) > 2000) this.buildFar(x, d);
        if (Math.hypot(x - this.treeCentre.x, d - this.treeCentre.y) > 120 && !this.busy.has('trees')) this.job('trees', this.treesJob(x, d));
        if (Math.hypot(x - this.sceneryCentre.x, d - this.sceneryCentre.y) > 220 && !this.busy.has('scenery')) this.job('scenery', this.sceneryJob(x, d));
        // background jobs (trees, lifts, poles) continue in small steps with whatever budget is left
        // (at least one step per frame, so they progress even on a slow device whose budget is used up by chunks)
        let steps = 0;
        while (this.jobs.length && (steps++ === 0 || left())) { const j = this.jobs[0]; if (j.gen.next().done) { this.jobs.shift(); this.busy.delete(j.name); } }
        this.sea.position.set(x, 1250, -d);
    }
    /** Milliseconds per frame the streaming may use (lowered automatically on slow devices by the game). */
    budgetMs = 4;
    private jobs: { name: string; gen: Generator<void, void, unknown> }[] = [];
    private busy = new Set<string>();
    private job(name: string, gen: Generator<void, void, unknown>) { this.busy.add(name); this.jobs.push({ name, gen }); }
    /** After 2 m tiles are applied: rebuild the ground, trees, and the lifts and buildings standing on them. */
    private tilesApplied(tiles: [number, number][], x: number, d: number) {
        this.dirtyNear(x, d); this.treeCentre.set(1e9, 1e9); this.sceneryCentre.set(1e9, 1e9);
        const touches = (e: number, n: number) => tiles.some(([te, tn]) => e > te * 1000 - 200 && e < (te + 1) * 1000 + 200 && n > tn * 1000 - 200 && n < (tn + 1) * 1000 + 200);
        for (const l of this.resort.lifts) {
            const g = this.lifts.get(l.id);
            if (g && l.points.some(([e, n]) => touches(e, n))) { this.group.remove(g); dropGeometry(g); this.lifts.delete(l.id); this.towers.delete(l.id); }
        }
    }
    /** After a 2 m tile arrives: rebuild the chunks it covers, nearest first. */
    private dirtyNear(x: number, d: number) {
        const list = [...this.chunks.values()].sort((a, b) => Math.hypot(a.ci * this.chunkSize - x, a.cj * this.chunkSize - d) - Math.hypot(b.ci * this.chunkSize - x, b.cj * this.chunkSize - d));
        for (const c of list) this.queue.push([c.ci, c.cj]);
    }

    private buildChunk(ci: number, cj: number) {
        const S = this.chunkSize, st = this.step, n = S / st, x0 = ci * S, d0 = cj * S, h = this.heightFn;
        const verts = (n + 1) * (n + 1), skirt = 4 * (n + 1);
        const pos = new Float32Array((verts + skirt) * 3), nor = new Float32Array((verts + skirt) * 3), col = new Float32Array((verts + skirt) * 3);
        const centers = new Float32Array((verts + skirt) * 2), paint = new Float32Array((verts + skirt) * 3).fill(0), depth = new Float32Array(verts + skirt);
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const k = j * (n + 1) + i, x = x0 + i * st, d = d0 + j * st, y = h(x, d);
            pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = -d;
            const dx = (h(x - .5, d) - h(x + .5, d)), dz = (h(x, d + .5) - h(x, d - .5)), sc = 1 / Math.hypot(dx, 1, dz);
            nor[k * 3] = dx * sc; nor[k * 3 + 1] = sc; nor[k * 3 + 2] = dz * sc;
            const dep = this.depthFn(x, d), powder = T.MathUtils.smoothstep(dep, .07, .44), wind = Math.sin(x * .16 + d * .085) * Math.cos(x * .072 - d * .12);
            const snow = .86 + .07 * wind * powder, rock = 1 - T.MathUtils.smoothstep(sc, .74, .84);
            col[k * 3] = T.MathUtils.lerp(snow * (.93 - .035 * powder), .36, rock); col[k * 3 + 1] = T.MathUtils.lerp(snow * (.97 - .02 * powder), .38, rock); col[k * 3 + 2] = T.MathUtils.lerp(snow, .42, rock);
            depth[k] = dep;
            const s = this.run.snowAt(x, d);
            centers[k * 2] = x - Math.max(0, Math.min(40, s.off + 17)); centers[k * 2 + 1] = 1e6;
            paint[k * 3] = -100;
        }
        const idx: number[] = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
        // skirts: each edge copied 5 m down, so no gap shows against the coarser mesh or a neighbour being rebuilt
        const edges = [Array.from({ length: n + 1 }, (_, i) => i), Array.from({ length: n + 1 }, (_, i) => n * (n + 1) + i),
            Array.from({ length: n + 1 }, (_, j) => j * (n + 1)), Array.from({ length: n + 1 }, (_, j) => j * (n + 1) + n)];
        let s = verts;
        for (const edge of edges) {
            const first = s;
            for (const k of edge) { pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - 5; pos[s * 3 + 2] = pos[k * 3 + 2];
                for (let c = 0; c < 3; c++) { nor[s * 3 + c] = nor[k * 3 + c]; col[s * 3 + c] = col[k * 3 + c]; paint[s * 3 + c] = paint[k * 3 + c]; }
                centers[s * 2] = centers[k * 2]; centers[s * 2 + 1] = centers[k * 2 + 1]; depth[s] = depth[k]; s++; }
            for (let i = 0; i < n; i++) { const a = edge[i], b = edge[i + 1], c = first + i, dd = first + i + 1; idx.push(a, c, b, b, c, dd, a, b, c, b, dd, c); }
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
        g.setAttribute('pisteCenters', new T.BufferAttribute(centers, 2)); g.setAttribute('kickerPaint', new T.BufferAttribute(paint, 3)); g.setAttribute('snowDepth', new T.BufferAttribute(depth, 1));
        g.setIndex(idx); g.computeBoundingSphere();
        const k2 = `${ci},${cj}`, old = this.chunks.get(k2);
        if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); }
        const mesh = new T.Mesh(g, this.material); mesh.receiveShadow = true; this.group.add(mesh);
        this.chunks.set(k2, { mesh, ci, cj });
    }

    /**
     * Far-terrain colour: snow, rock on steep faces, and forest where the aerial imagery found canopy (cover from
     * forest.bin; outside the tiles with tree data, an estimate from elevation: dense below 1,750 m, none above 2,150 m).
     * Seen from a distance, snowy conifer forest reads dark green-grey. A little noise breaks up the snow.
     */
    private colourFor(h: number, slopeCos: number, out: T.Color, e = 0, n = 0) {
        const rock = (1 - T.MathUtils.smoothstep(slopeCos, .72, .86)) * (.75 + .25 * T.MathUtils.smoothstep(h, 2600, 3000));
        let cover = forestCover(e, n);
        if (cover < 0) cover = (1 - T.MathUtils.smoothstep(h, 1750, 2150)) * .55 * T.MathUtils.smoothstep(slopeCos, .6, .8);
        const noise = Math.sin(e * .013 + n * .021) * Math.sin(e * .031 - n * .017) * .025;
        out.copy(SNOW_FAR).multiplyScalar(1 + noise).lerp(FOREST_FAR, Math.min(1, cover) * .82).lerp(STONE_FAR, rock * .9);
        return out;
    }
    /** Coarse terrain to about 6 km around the rider, from the 10 m overview. */
    private buildFar(x: number, d: number) {
        this.farCentre.set(x, d);
        const step = this.quality === 'low' ? 64 : 48, half = 6000, n = Math.round(2 * half / step);
        const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3), c = new T.Color();
        const cx = Math.round(x / step) * step, cd = Math.round(d / step) * step;
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const k = j * (n + 1) + i, xx = cx - half + i * step, dd = cd - half + j * step, w = this.world(xx, dd);
            pos[k * 3] = xx; pos[k * 3 + 1] = overviewHeight(w.e, w.n); pos[k * 3 + 2] = -dd;
        }
        const idx: number[] = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const nn = g.attributes.normal;
        for (let k = 0; k < (n + 1) * (n + 1); k++) { const w = this.world(pos[k * 3], -pos[k * 3 + 2]); this.colourFor(pos[k * 3 + 1], nn.getY(k), c, w.e, w.n).toArray(col, k * 3); }
        g.setAttribute('color', new T.BufferAttribute(col, 3));
        if (this.far) { this.group.remove(this.far); this.far.geometry.dispose(); }
        this.far = new T.Mesh(g, this.farMat); this.far.receiveShadow = true; this.group.add(this.far);
    }
    /** Distant mountains (SRTM beyond the survey box, the overview inside it), 160 m mesh, built once. */
    private buildHorizon() {
        const step = 160, half = 24000, n = Math.round(2 * half / step);
        const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3), c = new T.Color();
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const k = j * (n + 1) + i, xx = -half + i * step, dd = -half + j * step, w = this.world(xx, dd), r = Math.hypot(xx, dd);
            pos[k * 3] = xx; pos[k * 3 + 1] = overviewHeight(w.e, w.n) - (r < 6500 ? 30 : 0); pos[k * 3 + 2] = -dd;
        }
        const idx: number[] = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const nn = g.attributes.normal;
        for (let k = 0; k < (n + 1) * (n + 1); k++) { const w = this.world(pos[k * 3], -pos[k * 3 + 2]); this.colourFor(pos[k * 3 + 1], nn.getY(k), c, w.e, w.n).toArray(col, k * 3); }
        g.setAttribute('color', new T.BufferAttribute(col, 3));
        this.horizon = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: .95 })); this.group.add(this.horizon);
    }
    /** The nearest trees from the aerial imagery (budget by quality); trees within 150 m are solid. */
    private *treesJob(x: number, d: number): Generator<void, void, unknown> {
        this.treeCentre.set(x, d);
        const w = this.world(x, d), budget = preset(this.quality).trees * 2;
        const cand = treesAround(w.e, w.n, 700).map(t => ({ ...t, x: t.e - this.e0, d: t.n - this.n0, r: Math.hypot(t.e - w.e, t.n - w.n) }));
        yield;
        cand.sort((a, b) => a.r - b.r);
        const keep = cand.slice(0, budget);
        yield;
        const placed = keep.map((t, index) => ({ x: t.x, y: this.heightFn(t.x, t.d), d: t.d, height: t.h, index }));
        yield;
        const forest = makeAlpineForest(placed);
        if (this.forest) { this.group.remove(this.forest); release(this.forest); }
        this.forest = forest; this.group.add(forest);
        this.treeObstacles = keep.filter(t => t.r < 150).map(t => ({ x: t.x, d: t.d, r: 1.1 }));
        this.obstacles = [...this.treeObstacles, ...this.solidObstacles];
    }
    private treeObstacles: { x: number; d: number; r: number }[] = [];
    private solidObstacles: Solid[] = [];
    private buildings: T.Object3D[] = [];
    private courseLift(l: ResortLift): Lift {
        return { id: l.id, name: l.name, type: l.type, osm: l.osm, points: l.points.map(([e, n, z]) => [e - this.e0, n - this.n0, z] as [number, number, number]), occupancy: l.occupancy, capacity: l.capacity, rideS: l.rideS, length: l.length,
            pylons: l.pylons?.map(([e, n, top]) => [e - this.e0, n - this.n0, top] as [number, number, number]), bubble: l.bubble };
    }
    private towers = new Map<string, Solid[]>();
    private liftBuiltAt = new Map<string, [number, number]>();
    private buildingsReady?: Promise<unknown>;
    /** Buildings available now? If not, start loading them once and redo the scenery when they arrive (never waits). */
    private haveBuildings() {
        if (!buildingsLoaded()) this.buildingsReady ??= loadBuildings().then(() => { this.sceneryCentre.set(1e9, 1e9); }, () => undefined);
        return buildingsLoaded();
    }
    /** Lifts within 2.2 km, buildings within 0.9-2.5 km, and piste marker poles (Swiss colours) within 700 m. */
    private *sceneryJob(x: number, d: number): Generator<void, void, unknown> {
        this.sceneryCentre.set(x, d);
        const w = this.world(x, d), near = new Set<string>();
        for (const l of this.resort.lifts) {
            if (l.type === 'magic_carpet' || !l.points.some(([e, n]) => Math.hypot(e - w.e, n - w.n) < 2200)) continue;
            near.add(l.id);
            // rebuild a lift once the rider has moved well away from where it was built (tower detail follows the rider)
            const at = this.liftBuiltAt.get(l.id);
            if (at && Math.hypot(at[0] - x, at[1] - d) > 450) { const old = this.lifts.get(l.id)!; this.group.remove(old); dropGeometry(old); this.lifts.delete(l.id); }
            if (!this.lifts.has(l.id)) {
                const near = this.quality === 'low' ? 0 : this.quality === 'balanced' ? 260 : 420;
                const vNear = this.quality === 'low' ? 0 : this.quality === 'balanced' ? 90 : 150;
                const { group: g, profile } = liftScenery(this.courseLift(l), this.heightFn, { vehicles: this.quality !== 'low', detail: (tx, td) => Math.hypot(tx - x, td - d) < near ? 'high' : 'low', vehicleDetail: (vx, vd) => Math.hypot(vx - x, vd - d) < vNear });
                this.liftBuiltAt.set(l.id, [x, d]);
                this.lifts.set(l.id, g); this.group.add(g);
                const tr = profile.kind === 'cablecar' ? 1.6 : profile.kind === 'surface' ? .25 : .55;
                this.towers.set(l.id, profile.heads.filter(h => !h.station).map(h => ({ x: h.x, d: h.d, r: tr + 1, rd: tr + 1, h: h.y - h.ground, ux: 1, ud: 0, hl: tr, hw: tr, kind: 'TOWER STRIKE' })));
                yield;
            }
        }
        for (const [id, g] of this.lifts) if (!near.has(id)) { this.group.remove(g); dropGeometry(g); this.lifts.delete(id); this.towers.delete(id); this.liftBuiltAt.delete(id); }
        // buildings (VECTOR25 + GWR) around the rider, nearest first in slices; solid within 700 m like the lift towers
        const all = this.haveBuildings();
        const R = this.quality === 'low' ? 900 : this.quality === 'balanced' ? 1500 : 2000;
        const list = all ? buildingsAround(w.e, w.n, R).sort((a, b) => Math.hypot(a.e - w.e, a.n - w.n) - Math.hypot(b.e - w.e, b.n - w.n)) : [];
        const local = (e: number, n: number): [number, number] => [e - this.e0, n - this.n0];
        const keep = (_x: number, _d: number, b: { e: number; n: number; width: number }) => this.surface.at(b.e, b.n).off > b.width / 2 - 3;
        const meshes: T.Object3D[] = [], solids: Solid[] = [];
        const [l2, l1] = this.quality === 'balanced' ? [130, 600] : this.quality === 'low' ? [0, 450] : [210, 800];
        const lod = (bx: number, bd: number) => { const q = Math.hypot(bx - x, bd - d); return q < l2 ? 2 : q < l1 ? 1 : 0; };
        for (let i = 0; i < list.length; i += 350) {
            const m = buildingMesh(list.slice(i, i + 350), local, this.heightFn, { shadows: this.quality !== 'low' && i < 700, keep, lod: this.quality === 'low' ? (bx, bd) => Math.min(1, lod(bx, bd)) : lod });
            meshes.push(m.mesh);
            for (const o of m.solids) if (Math.hypot(o.x - x, o.d - d) < 700) solids.push(o);
            yield;
        }
        for (const m of this.buildings) { this.group.remove(m); dropGeometry(m); }
        this.buildings = meshes; for (const m of meshes) this.group.add(m);
        this.solidObstacles = [...solids, ...[...this.towers.values()].flat().filter(o => Math.hypot(o.x - x, o.d - d) < 700)];
        this.obstacles = [...this.treeObstacles, ...this.solidObstacles];
        if (this.poles) { this.group.remove(this.poles); release(this.poles); }
        this.poles = new T.Group();
        const byColour = new Map<number, T.Matrix4[]>(), m = new T.Object3D();
        for (const p of this.resort.pistes) {
            if (!p.line.some(([e, n]) => Math.hypot(e - w.e, n - w.n) < 700)) continue;
            const off = p.klass === 'itinerary' ? 0 : (p.half ?? HALF[p.klass] ?? 18) + 1.5;
            let acc = 0;
            for (let i = 0; i < p.line.length - 1; i++) {
                const [ax, ay] = p.line[i], [bx, by] = p.line[i + 1], seg = Math.hypot(bx - ax, by - ay); if (!seg) continue;
                for (; acc < seg; acc += 30) {
                    const t = acc / seg, pe = ax + (bx - ax) * t + (by - ay) / seg * off, pn = ay + (by - ay) * t - (bx - ax) / seg * off;
                    if (Math.hypot(pe - w.e, pn - w.n) > 700) continue;
                    const px = pe - this.e0, pd = pn - this.n0;
                    m.position.set(px, this.heightFn(px, pd) + .8, -pd); m.updateMatrix();
                    const colour = POLE_COLOUR[p.klass] ?? 0xd8342c; (byColour.get(colour) ?? byColour.set(colour, []).get(colour)!).push(m.matrix.clone());
                }
                acc -= seg;
            }
        }
        const geo = new T.CylinderGeometry(.05, .05, 1.6, 6);
        for (const [colour, ms] of byColour) {
            const inst = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ color: colour, roughness: .6 }), ms.length);
            ms.forEach((mm, i) => inst.setMatrixAt(i, mm)); this.poles.add(inst);
        }
        this.group.add(this.poles);
    }

    /** Where the rider is, for the HUD: piste or off-piste, the lift they can take, the station they are at. */
    info(x: number, d: number, speed: number): FreeInfo {
        const w = this.world(x, d), near = this.surface.nearest(w.e, w.n);
        const CLASS: Record<string, string> = { blue: 'Blue', red: 'Red', black: 'Black', itinerary: 'Itinerary', park: 'Park', skicross: 'Ski cross' };
        let where = 'Off-piste', onPiste = false;
        if (near) {
            const half = near.piste.klass === 'itinerary' ? 14 : (near.piste.half ?? HALF[near.piste.klass] ?? 18) + 3, name = near.piste.name ?? 'unnamed piste';
            if (near.dist < half) { where = `${CLASS[near.piste.klass] ?? 'Piste'} · ${name}`; onPiste = true; }
            else where = `Off-piste · ${name} ${Math.round(near.dist)} m away`;
        }
        // lifts you can get on: their loading area is within 35 m and you have stopped (or nearly) to queue
        const nearLifts = speed > 4 ? [] : this.resort.lifts.map(l => ({ l, dist: Math.hypot(l.points[0][0] - w.e, l.points[0][1] - w.n) }))
            .filter(x => x.dist < 35 && x.l.type !== 'magic_carpet').sort((a, b) => a.dist - b.dist).slice(0, 3).map(x => x.l);
        let station: Station | undefined;
        for (const s of this.resort.stations) if (Math.hypot(s.e - w.e, s.n - w.n) < 70) station = s;
        return { where, onPiste, nearLifts, station };
    }
    dispose() {
        this.group.removeFromParent();
        this.group.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); else if (o instanceof T.Mesh || o instanceof T.LineSegments) o.geometry.dispose(); });
    }
}
