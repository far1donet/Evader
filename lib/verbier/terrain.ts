import { RUNS_META } from './runs-meta.ts';

/**
 * The Verbier 4 Vallées resort, built by tools/verbier/build_resort.py from real data:
 *  - swissALTI3D 2 m (2024) © swisstopo, smoothed for snow cover (groomed pistes more than off-piste), shared by every
 *    run as 1 km tiles, plus a 10 m overview of the whole domain and an SRTM horizon around it;
 *  - piste and lift lines from OpenSkiData / OpenStreetMap contributors (ODbL); stations named from the Swiss public-
 *    transport stop register (BAV) and swissNAMES3D;
 *  - tree positions detected in SWISSIMAGE © swisstopo.
 *
 * A rideable route runs from one lift station to another along mapped pistes. Course frame: x = metres right of travel,
 * d = metres down the course.
 *  - 'rotated' routes: the map is only rotated, every real bend is drawn as it is (centreX(d) follows it).
 *  - 'curvilinear' routes (hairpins): d is the distance along the real line and x the offset across it.
 * Rendering and physics sample the same function.
 */
export type RunClass = 'blue' | 'red' | 'black' | 'itinerary' | 'park' | 'skicross';
export type Zone = { d0: number; d1: number; name: string | null; grooming: 'groomed' | 'moguls' | 'ungroomed'; difficulty: string | null; osm: string[] };
export type Lift = { id?: string; name: string | null; type: string | null; osm: string[]; points: [number, number, number][];
    occupancy?: number | null; capacity?: number | null; rideS?: number; length?: number };
type Grid = { e0: number; n1: number; cell: number; nx: number; ny: number; base: number; scale: number };

export type Station = { id: string; name: string; nameSource: string; e: number; n: number; z: number; liftsUp: string[]; liftsArrive: string[]; routesFrom: string[]; routesTo: string[] };
export type ResortLift = {
    id: string; name: string; type: string; typeLabel: string; guide: { id: string; name: string; type: string; sector: string } | null;
    capacity: number | null; occupancy: number | null; detachable: boolean | null; bubble: boolean | null; heating: boolean | null;
    durationS: number | null; durationSource: string; rideS: number; length: number; vertical: number; bottomZ: number; topZ: number;
    points: [number, number, number][]; osm: string[]; from: string; to: string; note: string | null;
};
export type MapPiste = { i: number; name: string | null; ref: string | null; klass: RunClass; grooming: string; line: [number, number][] };
export type RouteSummary = {
    id: string; name: string; description: string; klass: RunClass; length: number; drop: number; startElevation: number; endElevation: number;
    fromStation: string | null; toStation: string | null; featured: boolean; pistes: number[]; climb: number; line: [number, number][];
};
export type Resort = {
    version: number; built: string; crs: string; box: { e0: number; n0: number; e1: number; n1: number }; tileSize: number; tileCell: number;
    tiles: [number, number, number, number][]; overview: Grid; horizon: Grid; stations: Station[]; lifts: ResortLift[]; pistes: MapPiste[];
    routes: RouteSummary[]; park: { world: [number, number][] } | null; sources: string[];
};
type RouteDoc = {
    id: string; name: string; description: string; klass: RunClass; length: number; halfWidth: number; startElevation: number; endElevation: number; backtrack: number;
    frame: { mode: 'rotated' | 'curvilinear'; e0: number; n0: number; ue: number; un: number };
    path: { step: number; e: number[]; n: number[]; te: number[]; tn: number[]; s: number[] } | null;
    centre: number[]; zones: Zone[]; park: { world: [number, number][] } | null; fromStation: string | null; toStation: string | null; featured: boolean; sources: string[];
    /** Set on a lift course (the corridor along a lift line, used for the lift ride): the lift's id. */
    lift?: string;
};
export type RunHeader = Omit<RouteDoc, 'centre' | 'path' | 'park'> & { trees: number; lifts: Lift[]; park: { polygon: [number, number][] } | null };

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TILE_CELLS = 500, CELL = 2;
/** Beyond this distance from the route line the 10 m overview is used (tiles are loaded to 650 m). */
const NEAR_FULL = 450, NEAR_END = 600;

// ---- data store ----------------------------------------------------------------------------------------------------------
type Tile = { h: Int16Array; base: number; trees: Int16Array };
const store = {
    resort: undefined as Resort | undefined,
    overview: undefined as Int16Array | undefined,
    horizon: undefined as Int16Array | undefined,
    tiles: new Map<number, Tile>(),
    shipped: new Map<number, [number, number, number, number]>(),
};
const tileKey = (te: number, tn: number) => te * 10000 + tn;

function decodeDeltaRows(bytes: Uint8Array, nx: number, ny: number, byteOffset = 0) {
    const raw = new Int16Array(bytes.buffer.slice(bytes.byteOffset + byteOffset, bytes.byteOffset + byteOffset + nx * ny * 2));
    for (let r = 0; r < ny; r++) { let acc = 0; const o = r * nx; for (let c = 0; c < nx; c++) { acc += raw[o + c]; raw[o + c] = acc; } }
    return raw;
}
function setResort(r: Resort) { store.resort = r; store.shipped.clear(); for (const t of r.tiles) store.shipped.set(tileKey(t[0], t[1]), t); }
function setTile(te: number, tn: number, bytes: Uint8Array) {
    const meta = store.shipped.get(tileKey(te, tn))!;
    const h = decodeDeltaRows(bytes, TILE_CELLS, TILE_CELLS);
    const n = new DataView(bytes.buffer, bytes.byteOffset + TILE_CELLS * TILE_CELLS * 2, 4).getUint32(0, true);
    const trees = new Int16Array(bytes.buffer.slice(bytes.byteOffset + TILE_CELLS * TILE_CELLS * 2 + 4, bytes.byteOffset + TILE_CELLS * TILE_CELLS * 2 + 4 + n * 6));
    store.tiles.set(tileKey(te, tn), { h, base: meta[2], trees });
}

// ---- world height sampling -------------------------------------------------------------------------------------------------
function gridBilinear(g: Grid, data: Int16Array, e: number, n: number) {
    const fx = Math.min(Math.max((e - g.e0) / g.cell, 0), g.nx - 1.0001), fy = Math.min(Math.max((g.n1 - n) / g.cell, 0), g.ny - 1.0001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, o = iy * g.nx + ix;
    const v = (data[o] * (1 - tx) + data[o + 1] * tx) * (1 - ty) + (data[o + g.nx] * (1 - tx) + data[o + g.nx + 1] * tx) * ty;
    return g.base + v / g.scale;
}
/** 10 m overview inside the survey box, blended into the 40 m SRTM horizon over its last 400 m. Needs overview + horizon. */
export function overviewHeight(e: number, n: number) {
    const r = store.resort!, b = r.box;
    const edge = Math.min(e - b.e0, b.e1 - e, n - b.n0, b.n1 - n);
    const hz = store.horizon ? gridBilinear(r.horizon, store.horizon, e, n) : NaN;
    if (edge <= 0 || !store.overview) return hz;
    const ov = gridBilinear(r.overview, store.overview, e, n);
    if (edge >= 400 || !store.horizon) return ov;
    return hz + (ov - hz) * smooth(edge, 0, 400);
}
/** One 2 m cell of the snow surface (global cell indices; origin at the box's north-west corner), or NaN if not loaded. */
function cellAt(c: number, r: number) {
    const b = store.resort!.box;
    const tc = Math.floor(c / TILE_CELLS), trr = Math.floor(r / TILE_CELLS);
    const t = store.tiles.get(tileKey(b.e0 / 1000 + tc, b.n1 / 1000 - 1 - trr));
    if (!t) return NaN;
    return t.base + t.h[(r - trr * TILE_CELLS) * TILE_CELLS + (c - tc * TILE_CELLS)] / 10;
}
/** Snow-surface height at LV95 (e, n): bicubic on the 2 m tiles where loaded, otherwise the overview. */
export function worldHeight(e: number, n: number) {
    const b = store.resort!.box;
    const fx = (e - b.e0) / CELL, fy = (b.n1 - n) / CELL;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const W = (b.e1 - b.e0) / CELL, H = (b.n1 - b.n0) / CELL;
    if (ix < 1 || iy < 1 || ix > W - 3 || iy > H - 3) return overviewHeight(e, n);
    const tx = fx - ix, ty = fy - iy;
    let ok = true;
    const row = (r: number) => {
        const a = cellAt(ix - 1, r), b2 = cellAt(ix, r), c = cellAt(ix + 1, r), d = cellAt(ix + 2, r);
        if (Number.isNaN(a + b2 + c + d)) ok = false;
        return cr(a, b2, c, d, tx);
    };
    const v = cr(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), ty);
    return ok ? v : overviewHeight(e, n);
}

// ---- runs ---------------------------------------------------------------------------------------------------------------------
type Level = { e: Float32Array; n: Float32Array; te: Float32Array; tn: Float32Array };
/** Smoothing of a curvilinear route's line by lateral distance: window (m of arclength) used beyond `from` metres. */
const LEVELS = [{ window: 0, from: 0 }, { window: 120, from: 30 }, { window: 320, from: 80 }, { window: 800, from: 200 }, { window: 2000, from: 500 }, { window: 4000, from: 1100 }];
/** Moving average with point-reflected ends (a[-k] = 2 a[0] - a[k]), which keeps the line's end direction. */
function boxSmooth(a: Float32Array, half: number) {
    if (half < 1) return a;
    const n = a.length, at = (i: number) => i < 0 ? 2 * a[0] - a[Math.min(n - 1, -i)] : i >= n ? 2 * a[n - 1] - a[Math.max(0, 2 * (n - 1) - i)] : a[i];
    const out = new Float32Array(n); let sum = 0;
    for (let i = -half; i <= half; i++) sum += at(i);
    for (let i = 0; i < n; i++) { out[i] = sum / (2 * half + 1); sum += at(i + half + 1) - at(i - half); }
    return out;
}
function smoothLevel(e: Float32Array, n: Float32Array, te: Float32Array, tn: Float32Array, window: number, _from: number): Level {
    if (!window) return { e, n, te, tn };
    const half = Math.round(window / 2 / 2);                                    // samples are 2 m apart
    let se = e, sn = n; for (let k = 0; k < 2; k++) { se = boxSmooth(se, half); sn = boxSmooth(sn, half); }
    const ste = new Float32Array(e.length), stn = new Float32Array(e.length);
    for (let i = 0; i < e.length; i++) {
        const st = Math.max(1, Math.round(half / 2)), a = Math.max(0, i - st), b = Math.min(e.length - 1, i + st);   // wide stencil: stable through hairpins
        let de = se[b] - se[a], dn = sn[b] - sn[a], l = Math.hypot(de, dn);
        if (l < 1e-6) { de = te[i]; dn = tn[i]; l = Math.hypot(de, dn); }
        ste[i] = de / l; stn[i] = dn / l;
    }
    return { e: se, n: sn, te: ste, tn: stn };
}
export class VerbierRun {
    readonly h: RunHeader; readonly id: string; readonly name: string; readonly klass: RunClass; readonly length: number;
    readonly pisteHalfWidth: number; readonly startElevation: number; readonly endElevation: number;
    readonly centre: Float32Array;
    readonly frame: RouteDoc['frame'];
    /** Trees from the aerial imagery near the route: x, d, estimated height (m), repeated. */
    readonly trees: Float32Array;
    private path?: { e: Float32Array; n: Float32Array; te: Float32Array; tn: Float32Array; s: Float32Array; hash: Map<number, number[]>; levels: Level[] };
    constructor(doc: RouteDoc, scan = true) {
        this.frame = doc.frame; this.id = doc.id; this.name = doc.name; this.klass = doc.klass; this.length = doc.length;
        this.pisteHalfWidth = doc.halfWidth; this.startElevation = doc.startElevation; this.endElevation = doc.endElevation;
        this.centre = Float32Array.from(doc.centre);
        if (doc.path) {
            const p = doc.path, f = doc.frame, hash = new Map<number, number[]>();
            const e = Float32Array.from(p.e, v => v + f.e0), n = Float32Array.from(p.n, v => v + f.n0);
            for (let i = 0; i < e.length; i++) { const k = Math.floor(e[i] / 100) * 100000 + Math.floor(n[i] / 100); (hash.get(k) ?? hash.set(k, []).get(k)!).push(i); }
            const te = Float32Array.from(p.te), tn = Float32Array.from(p.tn);
            this.path = { e, n, te, tn, s: Float32Array.from(p.s), hash, levels: LEVELS.map(l => smoothLevel(e, n, te, tn, l.window, l.from)) };
        }
        const { centre: _c, path: _p, park, ...rest } = doc;
        // nearby lifts (all mapped points within reach of the course frame) and trees, in course coordinates
        const lifts: Lift[] = [];
        if (scan) for (const l of store.resort!.lifts) {
            const pts = l.points.map(([e, n, z]) => { const c = this.toCourse(e, n); return c ? [c.x, c.d, z] as [number, number, number] : null; });
            if (pts.some(p => !p)) continue;
            if (!pts.some(p => Math.abs(p![0] - this.centreX(p![1])) < 2000 && p![1] > -1200 && p![1] < this.length + 1200)) continue;
            lifts.push({ id: l.id, name: l.name, type: l.type, osm: l.osm, points: pts as [number, number, number][], occupancy: l.occupancy, capacity: l.capacity, rideS: l.rideS, length: l.length });
        }
        const trees: number[] = [];
        if (scan) for (const [k, t] of store.tiles) {
            const te = Math.floor(k / 10000), tn = k % 10000;
            for (let i = 0; i < t.trees.length; i += 3) {
                const c = this.toCourse(te * 1000 + t.trees[i] / 2, tn * 1000 + t.trees[i + 1] / 2);
                if (!c || c.d < -100 || c.d > this.length + 100 || Math.abs(c.x - this.centreX(c.d)) > NEAR_FULL) continue;
                trees.push(c.x, c.d, t.trees[i + 2] / 10);
            }
        }
        this.trees = Float32Array.from(trees);
        const polygon = park ? park.world.map(([e, n]) => { const c = this.toCourse(e, n)!; return [c.x, c.d] as [number, number]; }) : null;
        this.h = { ...rest, trees: this.trees.length / 3, lifts, park: polygon ? { polygon } : null };
    }
    /** Lateral position (x) of the real run line at distance d. */
    centreX(d: number) {
        const c = this.centre, f = Math.min(Math.max(d, 0), c.length - 1.0001), i = Math.floor(f);
        return c[i] + (c[i + 1] - c[i]) * (f - i);
    }
    /** LV95 position of course point (x, d). Exact for rotated routes; along the real line for curvilinear ones. */
    world(x: number, d: number) {
        const f = this.frame;
        if (!this.path) return { e: f.e0 + d * f.ue + x * f.un, n: f.n0 + d * f.un - x * f.ue };
        const p = this.path, last = p.s.length - 1;
        const s = Math.min(Math.max(d, 0), p.s[last]);
        let lo = 0, hi = last;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.s[m] <= s) lo = m; else hi = m; }
        const t = p.s[hi] > p.s[lo] ? (s - p.s[lo]) / (p.s[hi] - p.s[lo]) : 0, beyond = d - s;
        // Within 30 m of the line: the exact mapped line. Further out, an ever smoother copy of it, so that offsets on the
        // inside of a bend never cross (no folded terrain); heights there are still real, their positions approximate.
        const ax = Math.abs(x);
        let k = 0; while (k < LEVELS.length - 1 && ax > LEVELS[k + 1].from) k++;
        const a = p.levels[k], b = p.levels[Math.min(k + 1, LEVELS.length - 1)];
        const w = k + 1 < LEVELS.length ? smooth(ax, LEVELS[k].from, LEVELS[k + 1].from) : 0;
        const at = (l: Level) => {
            const lerp = (arr: Float32Array) => arr[lo] + (arr[hi] - arr[lo]) * t;
            const te = lerp(l.te), tn = lerp(l.tn);
            return { e: lerp(l.e) + beyond * te + x * tn, n: lerp(l.n) + beyond * tn - x * te };
        };
        const pa = at(a); if (w <= 0) return pa;
        const pb = at(b); return { e: pa.e + (pb.e - pa.e) * w, n: pa.n + (pb.n - pa.n) * w };
    }
    /** Course coordinates of an LV95 point (null if a curvilinear route has no line point within 400 m). */
    toCourse(e: number, n: number): { x: number; d: number } | null {
        if (!this.path) { const f = this.frame, de = e - f.e0, dn = n - f.n0; return { x: de * f.un - dn * f.ue, d: de * f.ue + dn * f.un }; }
        const p = this.path; let best = -1, bd = 400 * 400;
        const ce = Math.floor(e / 100), cn = Math.floor(n / 100);
        for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
            const list = p.hash.get((ce + a) * 100000 + cn + b); if (!list) continue;
            for (const i of list) { const dd = (p.e[i] - e) ** 2 + (p.n[i] - n) ** 2; if (dd < bd) { bd = dd; best = i; } }
        }
        if (best < 0) return null;
        let x = (e - p.e[best]) * p.tn[best] - (n - p.n[best]) * p.te[best], d = p.s[best] + (e - p.e[best]) * p.te[best] + (n - p.n[best]) * p.tn[best];
        // world() smooths the frame away from the line: refine so that world(x, d) lands on (e, n) (Gauss-Newton)
        for (let it = 0; it < 6; it++) {
            const w = this.world(x, d), re = e - w.e, rn = n - w.n;
            if (re * re + rn * rn < .01) break;
            const wx = this.world(x + 1, d), wd = this.world(x, d + 1);
            const a = wx.e - w.e, b = wd.e - w.e, c = wx.n - w.n, dd = wd.n - w.n, det = a * dd - b * c;
            if (Math.abs(det) < 1e-6) break;
            x += (dd * re - b * rn) / det; d += (a * rn - c * re) / det;
        }
        return { x, d };
    }
    /** Snow-surface height (m above sea level). 2 m swissALTI3D near the route, the 10 m overview beyond. */
    terrain(x: number, d: number) {
        const w = this.world(x, d), off = Math.abs(x - this.centreX(d));
        if (off <= NEAR_FULL) return worldHeight(w.e, w.n);
        const far = overviewHeight(w.e, w.n);
        if (off >= NEAR_END) return far;
        return far + (worldHeight(w.e, w.n) - far) * (1 - smooth(off, NEAR_FULL, NEAR_END));
    }
    /** Grooming of the mapped segment at distance d (OpenStreetMap: classic / mogul / backcountry). */
    zoneAt(d: number): Zone | undefined { return this.h.zones.find(z => d >= z.d0 - 2 && d <= z.d1 + 2) ?? this.h.zones[this.h.zones.length - 1]; }
    /** Mogul amplitude (m): mapped mogul sections, ungroomed itineraries and off-piste. Groomed pistes: none. */
    mogulAmplitude(x: number, d: number) {
        const z = this.zoneAt(d), off = Math.abs(x - this.centreX(d));
        if (this.klass === 'park' || this.klass === 'skicross') return 0;
        if (z?.grooming === 'moguls') return off < this.pisteHalfWidth + 6 ? .55 : .3;
        if (z?.grooming === 'ungroomed' || this.klass === 'itinerary') return .42;
        return off > this.pisteHalfWidth + 8 ? .22 : 0;
    }
    /** Snow on the ground: metres outside the groomed corridor (negative = on it), and whether an ungroomed itinerary is here. */
    snowAt(x: number, d: number) { return { off: Math.abs(x - this.centreX(d)) - this.pisteHalfWidth, itinerary: this.pisteHalfWidth === 0 }; }
    /** Ground height used by the game: real terrain plus irregular moguls where they belong. */
    height(x: number, d: number) {
        let h = this.terrain(x, d);
        const amp = Math.abs(x - this.centreX(d)) < 300 ? this.mogulAmplitude(x, d) : 0;
        if (amp > 0) { const w = this.world(x, d); h += amp * moguls(w.e, w.n); }
        return h;
    }
    /** Slope (deg), how much it faces north (+1) or south (-1), and elevation at (x, d). */
    slopeAt(x: number, d: number) {
        const w = this.world(x, d), s = 2;
        const ge = (worldHeight(w.e + s, w.n) - worldHeight(w.e - s, w.n)) / (2 * s), gn = (worldHeight(w.e, w.n + s) - worldHeight(w.e, w.n - s)) / (2 * s), g = Math.hypot(ge, gn);
        return { deg: Math.atan(g) * 180 / Math.PI, downN: g ? -gn / g : 0, elevation: this.terrain(x, d) };
    }
}
/** Irregular moguls: three crossing wave trains (5.4-7.3 m) with an uneven envelope, fixed to the ground. About -1..1. */
export function moguls(e: number, n: number) {
    const a = Math.sin(e * .86 + n * .52 + 1.3), b = Math.sin(e * -.41 + n * .97 + 4.1), c = Math.sin(e * .63 - n * .74 + 2.2);
    const env = .55 + .45 * Math.sin(e * .071 + n * .053) * Math.cos(n * .061 - e * .029);
    return (a * b * .9 + c * .45) * env;
}

// ---- loading ------------------------------------------------------------------------------------------------------------------
/** Runtime location of the resort files, relative to the page (works under any base path such as /Evader/). */
export const resortUrl = (path: string) => `resort/${path}`;
type NodeFs = { readFileSync(p: string): Uint8Array; existsSync(p: string): boolean };
type NodeZlib = { inflateSync(b: Uint8Array): Uint8Array };
function node() {
    const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown; cwd: () => string } }).process;
    const fs = proc?.getBuiltinModule?.('fs') as NodeFs | undefined, zlib = proc?.getBuiltinModule?.('zlib') as NodeZlib | undefined;
    return fs && zlib && proc ? { fs, zlib, root: `${proc.cwd()}/public/` } : undefined;
}
const isBrowser = typeof window !== 'undefined' && typeof fetch === 'function';
async function fetchBytes(path: string, inflate: boolean) {
    const r = await fetch(resortUrl(path)); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    if (!inflate) return new Uint8Array(await r.arrayBuffer());
    const stream = (await r.blob()).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
function readBytes(path: string, inflate: boolean) {
    const nd = node(); if (!nd) throw new Error('no file system');
    const b = nd.fs.readFileSync(`${nd.root}resort/${path}`);
    return inflate ? nd.zlib.inflateSync(b) : b;
}
const pending = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
    let p = pending.get(key) as Promise<T> | undefined;
    if (!p) { p = make(); p.catch(() => pending.delete(key)); pending.set(key, p); }
    return p;
}
/** Resort index (stations, lifts, pistes, routes) plus the 10 m overview and the horizon. */
export function loadResort(): Promise<Resort> {
    if (store.resort && store.overview && store.horizon) return Promise.resolve(store.resort);
    if (!isBrowser) return Promise.resolve(resortSync());
    return once('resort', async () => {
        const r = await (await fetch(resortUrl('resort.json'))).json() as Resort; setResort(r);
        const [ov, hz] = await Promise.all([fetchBytes('overview.bin', true), fetchBytes('horizon.bin', true)]);
        store.overview = decodeDeltaRows(ov, r.overview.nx, r.overview.ny); store.horizon = decodeDeltaRows(hz, r.horizon.nx, r.horizon.ny);
        return r;
    });
}
/** Synchronous resort load (Node: tests and tools). */
export function resortSync(): Resort {
    if (store.resort && store.overview && store.horizon) return store.resort;
    const r = JSON.parse(new TextDecoder().decode(readBytes('resort.json', false))) as Resort; setResort(r);
    store.overview = decodeDeltaRows(readBytes('overview.bin', true), r.overview.nx, r.overview.ny);
    store.horizon = decodeDeltaRows(readBytes('horizon.bin', true), r.horizon.nx, r.horizon.ny);
    return r;
}
export function resortLoaded() { return store.resort && store.overview ? store.resort : undefined; }
/** Tiles within 650 m of a route's line. */
function corridorTiles(doc: RouteDoc) {
    const f = doc.frame, keys = new Set<number>(), pts: [number, number][] = [];
    if (doc.path) for (let i = 0; i < doc.path.e.length; i += 10) pts.push([f.e0 + doc.path.e[i], f.n0 + doc.path.n[i]]);
    else for (let d = 0; d < doc.centre.length; d += 20) { const x = doc.centre[d]; pts.push([f.e0 + d * f.ue + x * f.un, f.n0 + d * f.un - x * f.ue]); }
    for (const [e, n] of pts) for (let a = -650; a <= 650; a += 325) for (let b = -650; b <= 650; b += 325) {
        const k = tileKey(Math.floor((e + a) / 1000), Math.floor((n + b) / 1000)); if (store.shipped.has(k)) keys.add(k);
    }
    return [...keys];
}
const runs = new Map<string, VerbierRun>();
const makeRun = (doc: RouteDoc) => new VerbierRun(doc);
export function isRunLoaded(id: string) { return runs.has(id); }
/** Load a route (any station-to-station route or a featured run) with the terrain it needs. */
export function loadRun(id: string): Promise<VerbierRun> {
    const have = runs.get(id); if (have) return Promise.resolve(have);
    if (!isBrowser) return Promise.resolve(verbierRun(id));
    return once(`run:${id}`, async () => {
        await loadResort();
        const doc = await (await fetch(resortUrl(`routes/${id}.json`))).json() as RouteDoc;
        await Promise.all(corridorTiles(doc).filter(k => !store.tiles.has(k)).map(async k => {
            const te = Math.floor(k / 10000), tn = k % 10000; setTile(te, tn, await fetchBytes(`tiles/${te}_${tn}.bin`, true));
        }));
        const run = makeRun(doc); runs.set(id, run); return run;
    });
}
/** A loaded run. In Node (tests, tools) it is read synchronously from public/resort on first use. */
export function verbierRun(id: string): VerbierRun {
    const have = runs.get(id); if (have) return have;
    if (!node()) throw new Error(`Verbier run ${id} is not loaded yet (call loadRun first)`);
    const r = resortSync();
    const lift = id.startsWith('lift-') ? r.lifts.find(l => `lift-${l.id}` === id) : undefined;
    const doc = lift ? liftRouteDoc(lift) : JSON.parse(new TextDecoder().decode(readBytes(`routes/${id}.json`, false))) as RouteDoc;
    for (const k of corridorTiles(doc)) if (!store.tiles.has(k)) { const te = Math.floor(k / 10000), tn = k % 10000; setTile(te, tn, readBytes(`tiles/${te}_${tn}.bin`, true)); }
    const run = makeRun(doc); runs.set(id, run); return run;
}
// ---- free ride: the whole domain ----------------------------------------------------------------------------------------------
/** Shipped 1 km tiles within `radius` metres of (e, n) that are not in memory yet. */
export function missingTiles(e: number, n: number, radius: number) {
    const out: number[] = [];
    for (let te = Math.floor((e - radius) / 1000); te <= Math.floor((e + radius) / 1000); te++)
        for (let tn = Math.floor((n - radius) / 1000); tn <= Math.floor((n + radius) / 1000); tn++) {
            const k = tileKey(te, tn); if (store.shipped.has(k) && !store.tiles.has(k)) out.push(k);
        }
    return out;
}
/** Load the 2 m tiles within `radius` of (e, n). Resolves with the number of tiles loaded. */
export async function loadTilesAround(e: number, n: number, radius: number): Promise<number> {
    const keys = missingTiles(e, n, radius);
    if (!isBrowser) { for (const k of keys) { const te = Math.floor(k / 10000), tn = k % 10000; setTile(te, tn, readBytes(`tiles/${te}_${tn}.bin`, true)); } return keys.length; }
    await Promise.all(keys.map(k => once(`tile:${k}`, async () => { const te = Math.floor(k / 10000), tn = k % 10000; if (!store.tiles.has(k)) setTile(te, tn, await fetchBytes(`tiles/${te}_${tn}.bin`, true)); })));
    return keys.length;
}
/** Trees of the loaded tiles within `radius` of (e, n), as world points with heights (m). */
export function treesAround(e: number, n: number, radius: number) {
    const out: { e: number; n: number; h: number }[] = [];
    for (const [k, t] of store.tiles) {
        const te = Math.floor(k / 10000), tn = k % 10000;
        if (te * 1000 > e + radius || (te + 1) * 1000 < e - radius || tn * 1000 > n + radius || (tn + 1) * 1000 < n - radius) continue;
        for (let i = 0; i < t.trees.length; i += 3) {
            const te2 = te * 1000 + t.trees[i] / 2, tn2 = tn * 1000 + t.trees[i + 1] / 2;
            if (Math.abs(te2 - e) <= radius && Math.abs(tn2 - n) <= radius) out.push({ e: te2, n: tn2, h: t.trees[i + 2] / 10 });
        }
    }
    return out;
}
export type SnowInfo = { off: number; itinerary: boolean; moguls?: boolean };
/**
 * The free-ride terrain: the whole survey box in a north-up frame centred on the starting point
 * (x = metres east, d = metres north of it; the game's z = -d points north). Same snow surface, moguls and materials as the
 * runs, but the piste corridors come from every mapped piste (see free-world.ts SurfaceMap) instead of one run line.
 */
export class FreeTerrain extends VerbierRun {
    /** Where the rider is (course x), so `centreX` has something sensible to return to code that asks for "the line". */
    focusX = 0;
    private readonly snowFn: (e: number, n: number) => SnowInfo;
    constructor(e0: number, n0: number, snowFn: (e: number, n: number) => SnowInfo) {
        super({ id: 'free', name: 'FREE RIDE', description: 'The whole 4 Vallées', klass: 'red', length: 1e6, halfWidth: 18, startElevation: 0, endElevation: 0, backtrack: 0,
            frame: { mode: 'rotated', e0, n0, ue: 0, un: 1 }, path: null, centre: [0, 0], zones: [{ d0: -1e6, d1: 1e6, name: null, grooming: 'groomed', difficulty: null, osm: [] }],
            park: null, fromStation: null, toStation: null, featured: false, sources: [] }, false);
        this.snowFn = snowFn;
    }
    centreX() { return this.focusX; }
    terrain(x: number, d: number) { return worldHeight(this.frame.e0 + x, this.frame.n0 + d); }
    snowAt(x: number, d: number): SnowInfo { return this.snowFn(this.frame.e0 + x, this.frame.n0 + d); }
    mogulAmplitude(x: number, d: number) {
        const s = this.snowAt(x, d);
        if (s.moguls) return s.off < 6 ? .55 : .3;
        if (s.itinerary) return .42;
        return s.off > 8 ? .22 : 0;
    }
    height(x: number, d: number) {
        let h = this.terrain(x, d);
        const amp = this.mogulAmplitude(x, d);
        if (amp > 0) h += amp * moguls(this.frame.e0 + x, this.frame.n0 + d);
        return h;
    }
}
/** Register the free-ride terrain as run 'free' (one session at a time). */
export function setFreeTerrain(t: FreeTerrain) { runs.set('free', t); }

/** Margin of terrain before the bottom and after the top station on a lift course, m. */
export const LIFT_MARGIN = 160;
/** A course along a lift line (rotated frame, d uphill from 160 m below the bottom station): the lift ride's scene. */
export function liftRouteDoc(l: ResortLift): RouteDoc {
    const a = l.points[0], b = l.points[l.points.length - 1];
    let ue = b[0] - a[0], un = b[1] - a[1]; const L = Math.hypot(ue, un); ue /= L; un /= L;
    const e0 = a[0] - ue * LIFT_MARGIN, n0 = a[1] - un * LIFT_MARGIN, length = Math.ceil(L + 2 * LIFT_MARGIN);
    const proj = l.points.map(([e, n]) => ({ d: (e - e0) * ue + (n - n0) * un, x: (e - e0) * un - (n - n0) * ue }));
    const centre = Array.from({ length: length + 1 }, (_, d) => {
        if (d <= proj[0].d) return proj[0].x;
        for (let i = 0; i < proj.length - 1; i++) if (d <= proj[i + 1].d) return proj[i].x + (proj[i + 1].x - proj[i].x) * (d - proj[i].d) / Math.max(1e-6, proj[i + 1].d - proj[i].d);
        return proj[proj.length - 1].x;
    });
    const surface = liftKindOf(l.type) === 'surface';
    return {
        id: `lift-${l.id}`, name: l.name.toUpperCase(), description: `${l.typeLabel}`, klass: surface ? 'blue' : 'red', length, halfWidth: surface ? 5 : 6,
        startElevation: l.bottomZ, endElevation: l.topZ, backtrack: 0, frame: { mode: 'rotated', e0, n0, ue, un }, path: null, centre,
        zones: [{ d0: 0, d1: length, name: l.name, grooming: 'groomed', difficulty: null, osm: l.osm }], park: null,
        fromStation: l.from, toStation: l.to, featured: false, lift: l.id,
        sources: ['swissALTI3D 2 m 2024 (c) swisstopo', 'OpenSkiData / OpenStreetMap contributors, ODbL (lift line)'],
    };
}
const liftKindOf = (t: string | null) => t === 'platter' || t === 't-bar' || t === 'drag_lift' || t === 'rope_tow' || t === 'j-bar' ? 'surface' : 'aerial';
/** Load the terrain for a lift ride (corridor along the lift line). Run id: `lift-<lift id>`. */
export function loadLift(liftId: string): Promise<VerbierRun> {
    const id = `lift-${liftId}`, have = runs.get(id); if (have) return Promise.resolve(have);
    if (!isBrowser) return Promise.resolve(verbierRun(id));
    return once(`run:${id}`, async () => {
        const r = await loadResort(), lift = r.lifts.find(l => l.id === liftId);
        if (!lift) throw new Error(`unknown lift ${liftId}`);
        const doc = liftRouteDoc(lift);
        await Promise.all(corridorTiles(doc).filter(k => !store.tiles.has(k)).map(async k => {
            const te = Math.floor(k / 10000), tn = k % 10000; setTile(te, tn, await fetchBytes(`tiles/${te}_${tn}.bin`, true));
        }));
        const run = makeRun(doc); runs.set(id, run); return run;
    });
}
/** True if the 2 m tile containing (e, n) is in memory. */
export function tileLoaded(e: number, n: number) { return store.tiles.has(tileKey(Math.floor(e / 1000), Math.floor(n / 1000))); }
/** Featured runs for the menu. */
export const RUNS = RUNS_META;
/** Air temperature from an altitude lapse rate of 6.5 degC per km, relative to a reference at Verbier village (1,500 m). */
export function lapseTemperature(elevation: number, villageTemp: number) { return villageTemp - 6.5 * (elevation - 1500) / 1000; }
/** Overview grid for maps (heights at the cell centres), once loadResort has resolved. */
export function overviewGrid() { const r = store.resort!; return { meta: r.overview, data: store.overview!, height: (i: number) => r.overview.base + store.overview![i] / r.overview.scale }; }
