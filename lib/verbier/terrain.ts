import { RUNS_META } from './runs-meta.ts';

/**
 * Real terrain for the Verbier courses, built by tools/verbier/build_runs.py from:
 *  - swissALTI3D 2 m (2024) © swisstopo, smoothed for snow cover (groomed pistes more than off-piste);
 *  - run and lift lines from OpenSkiData / OpenStreetMap contributors (ODbL);
 *  - tree positions detected in SWISSIMAGE © swisstopo.
 *
 * Course frame: x = metres right of travel, d = metres down the course.
 *  - 'rotated' runs: the map is only rotated, so every bend of the real run is drawn as it is (centreX(d) follows it).
 *  - 'curvilinear' runs (real hairpins): d is the distance along the real line and x the offset across it; heights along
 *    and beside the line are real, the bends are drawn unrolled.
 * Rendering and physics sample the same function.
 */
export type RunClass = 'blue' | 'red' | 'black' | 'itinerary' | 'park' | 'skicross';
type Grid = { x0: number; d0: number; nx: number; nd: number; cell: number; base: number; scale: number };
export type Zone = { d0: number; d1: number; name: string | null; grooming: 'groomed' | 'moguls' | 'ungroomed'; difficulty: string | null; osm: string[] };
export type Lift = { name: string | null; type: string | null; osm: string[]; points: [number, number, number][] };
export type RunHeader = {
    id: string; name: string; description: string; klass: RunClass; length: number; halfWidth: number;
    startElevation: number; endElevation: number; backtrack: number;
    frame: { mode: 'rotated' | 'curvilinear'; e0: number; n0: number; ue: number; un: number };
    zones: Zone[]; centre: { count: number; step: number }; near: Grid; far: Grid; trees: number; lifts: Lift[];
    park: { polygon: [number, number][] } | null; sources: string[];
};

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class VerbierRun {
    readonly h: RunHeader; readonly id: string; readonly name: string; readonly klass: RunClass; readonly length: number;
    readonly pisteHalfWidth: number; readonly startElevation: number; readonly endElevation: number;
    readonly centre: Float32Array; readonly near: Int16Array; readonly far: Int16Array;
    /** Trees from the aerial imagery: x, d, estimated height (m), repeated. */
    readonly trees: Float32Array;
    constructor(buf: ArrayBuffer) {
        const view = new DataView(buf), hl = view.getUint32(0, true);
        this.h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
        let o = 4 + hl;
        this.centre = new Float32Array(buf.slice(o, o + this.h.centre.count * 4)); o += this.h.centre.count * 4;
        const nn = this.h.near.nx * this.h.near.nd; this.near = new Int16Array(buf.slice(o, o + nn * 2)); o += nn * 2; o += (4 - (nn * 2) % 4) % 4;
        const fn = this.h.far.nx * this.h.far.nd; this.far = new Int16Array(buf.slice(o, o + fn * 2)); o += fn * 2; o += (4 - (fn * 2) % 4) % 4;
        this.trees = new Float32Array(buf.slice(o, o + this.h.trees * 12));
        this.id = this.h.id; this.name = this.h.name; this.klass = this.h.klass; this.length = this.h.length;
        this.pisteHalfWidth = this.h.halfWidth; this.startElevation = this.h.startElevation; this.endElevation = this.h.endElevation;
    }
    /** Lateral position (x) of the real run line at distance d. */
    centreX(d: number) {
        const c = this.centre, f = Math.min(Math.max(d, 0), c.length - 1.0001), i = Math.floor(f);
        return c[i] + (c[i + 1] - c[i]) * (f - i);
    }
    private gridHeight(g: Grid, data: Int16Array, x: number, d: number, cubic: boolean) {
        const fx = Math.min(Math.max((x - g.x0) / g.cell, 0), g.nx - 1.0001), fd = Math.min(Math.max((d - g.d0) / g.cell, 0), g.nd - 1.0001);
        const ix = Math.floor(fx), id = Math.floor(fd), tx = fx - ix, td = fd - id;
        const at = (cx: number, cd: number) => data[Math.min(Math.max(cd, 0), g.nd - 1) * g.nx + Math.min(Math.max(cx, 0), g.nx - 1)];
        let v: number;
        if (cubic) {
            const row = (cd: number) => cr(at(ix - 1, cd), at(ix, cd), at(ix + 1, cd), at(ix + 2, cd), tx);
            v = cr(row(id - 1), row(id), row(id + 1), row(id + 2), td);
        } else {
            v = (at(ix, id) * (1 - tx) + at(ix + 1, id) * tx) * (1 - td) + (at(ix, id + 1) * (1 - tx) + at(ix + 1, id + 1) * tx) * td;
        }
        return g.base + v / g.scale;
    }
    /** Snow-surface height (m above sea level) from the swissALTI3D grids. 2 m near the run, 16 m beyond. */
    terrain(x: number, d: number) {
        const n = this.h.near;
        const ex = Math.min(x - n.x0, n.x0 + (n.nx - 1) * n.cell - x), ed = Math.min(d - n.d0, n.d0 + (n.nd - 1) * n.cell - d);
        const edge = Math.min(ex, ed);
        if (edge >= 40) return this.gridHeight(n, this.near, x, d, true);
        const farH = this.gridHeight(this.h.far, this.far, x, d, false);
        if (edge <= 0) return farH;
        const w = smooth(edge, 0, 40);
        return farH + (this.gridHeight(n, this.near, x, d, true) - farH) * w;
    }
    /** Grooming of the mapped segment at distance d (from OpenStreetMap: classic / mogul / backcountry). */
    zoneAt(d: number): Zone | undefined { return this.h.zones.find(z => d >= z.d0 - 2 && d <= z.d1 + 2) ?? this.h.zones[this.h.zones.length - 1]; }
    /** Mogul amplitude (m): mapped mogul sections, and ungroomed itineraries. Groomed pistes: none. */
    mogulAmplitude(x: number, d: number) {
        const z = this.zoneAt(d), off = Math.abs(x - this.centreX(d));
        if (this.klass === 'park' || this.klass === 'skicross') return 0;
        if (z?.grooming === 'moguls') return off < this.pisteHalfWidth + 6 ? .55 : .3;
        if (z?.grooming === 'ungroomed' || this.klass === 'itinerary') return .42;
        return off > this.pisteHalfWidth + 8 ? .22 : 0;   // off-piste bumps beside groomed runs
    }
    /** Ground height used by the game: real terrain plus irregular moguls where they belong. */
    height(x: number, d: number) {
        let h = this.terrain(x, d);
        const amp = Math.abs(x - this.centreX(d)) < 300 ? this.mogulAmplitude(x, d) : 0;
        if (amp > 0) { const w = this.world(x, d); h += amp * moguls(w.e, w.n); }
        return h;
    }
    /** Approximate world LV95 position (for fixed-to-the-ground noise and aspect). Exact for rotated runs. */
    world(x: number, d: number) {
        const f = this.h.frame, re = f.un, rn = -f.ue;
        return { e: f.e0 + d * f.ue + x * re, n: f.n0 + d * f.un + x * rn };
    }
    /** Slope (deg), how much it faces north (+1) or south (-1), and elevation at (x, d). */
    slopeAt(x: number, d: number) {
        const s = 2, gx = (this.terrain(x + s, d) - this.terrain(x - s, d)) / (2 * s), gd = (this.terrain(x, d + s) - this.terrain(x, d - s)) / (2 * s);
        const f = this.h.frame, re = f.un, rn = -f.ue;
        // gradient in world east/north; downhill = -gradient
        const ge = gx * re + gd * f.ue, gn = gx * rn + gd * f.un, g = Math.hypot(ge, gn);
        return { deg: Math.atan(g) * 180 / Math.PI, downN: g ? -gn / g : 0, elevation: this.terrain(x, d) };
    }
}
/** Irregular moguls: three crossing wave trains (5.4-7.3 m) with an uneven envelope, fixed to the ground. About -1..1. */
export function moguls(e: number, n: number) {
    const a = Math.sin(e * .86 + n * .52 + 1.3), b = Math.sin(e * -.41 + n * .97 + 4.1), c = Math.sin(e * .63 - n * .74 + 2.2);
    const env = .55 + .45 * Math.sin(e * .071 + n * .053) * Math.cos(n * .061 - e * .029);
    return (a * b * .9 + c * .45) * env;
}

const loaded = new Map<string, VerbierRun>();
const pending = new Map<string, Promise<VerbierRun>>();
/** Runtime file location of a run (relative to the page, so it works under any base path such as /Evader/). */
export const runUrl = (id: string) => `terrain/${id}.bin`;
export function isRunLoaded(id: string) { return loaded.has(id); }
/** Load a run's terrain file (browser: fetch; Node: read from public/). */
export function loadRun(id: string): Promise<VerbierRun> {
    const have = loaded.get(id); if (have) return Promise.resolve(have);
    let p = pending.get(id);
    if (!p) {
        p = fetch(runUrl(id)).then(r => { if (!r.ok) throw new Error(`terrain ${id}: HTTP ${r.status}`); return r.arrayBuffer(); })
            .then(buf => { const run = new VerbierRun(buf); loaded.set(id, run); return run; });
        p.catch(() => pending.delete(id));
        pending.set(id, p);
    }
    return p;
}
/** A loaded run. In Node (tests, tools) it is read synchronously from public/terrain on first use. */
export function verbierRun(id: string): VerbierRun {
    const have = loaded.get(id); if (have) return have;
    const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown; cwd: () => string } }).process;
    const fs = proc?.getBuiltinModule?.('fs') as { readFileSync(p: string): Uint8Array } | undefined;
    if (fs && proc) {
        const b = fs.readFileSync(`${proc.cwd()}/public/terrain/${id}.bin`);
        const run = new VerbierRun(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        loaded.set(id, run); return run;
    }
    throw new Error(`Verbier run ${id} is not loaded yet (call loadRun first)`);
}
export const RUNS = RUNS_META;
/** Air temperature from an altitude lapse rate of 6.5 degC per km, relative to a reference at Verbier village (1,500 m). */
export function lapseTemperature(elevation: number, villageTemp: number) { return villageTemp - 6.5 * (elevation - 1500) / 1000; }
