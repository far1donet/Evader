import { DEM_BASE64, DEM_META } from './dem-data.ts';
import { ANCHORS, ROUTES } from './routes-data.ts';

/**
 * Real terrain for the Verbier courses.
 *
 * Elevation: SRTM 1-arc-second DEM (about 21 x 31 m cells here), sampled with Catmull-Rom bicubic interpolation so the
 * surface and its normals are smooth. Rendering and physics use this same function, so what you see is what you ride.
 *
 * Course frame: the game describes a run by lateral offset x (metres, + = right of travel) and distance d along the run.
 * Close to the run line (|x| < 150 m) a point maps to `line(d) + x * right(d)`; farther out the frame blends into a straight
 * frame along the start-to-end direction, so distant mountains keep their real shape instead of folding around bends.
 * Consequence (documented): the run is drawn straightened; elevations, gradients and cross-slopes are real, plan-view
 * curvature is not shown.
 *
 * Added on top of the DEM (game design, not measured): irregular moguls where the guide reports them, small snow relief,
 * and park features on the La Chaux course.
 */
const M = DEM_META;
let dem: Int16Array | null = null;
function grid() {
    if (dem) return dem;
    const bin = typeof atob === 'function' ? atob(DEM_BASE64) : '';
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    dem = new Int16Array(M.width * M.height);
    for (let i = 0; i < dem.length; i++) dem[i] = view.getInt16(i * 2, true);
    return dem;
}
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
/** DEM elevation (m) at local metres e (east) and n (north) from the crop's south-west corner. */
export function demHeight(e: number, n: number) {
    const g = grid(), W = M.width, H = M.height;
    const fx = Math.min(Math.max(e / M.dx, 0), W - 1.0001), fy = Math.min(Math.max((H - 1) - n / M.dy, 0), H - 1.0001);
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    const at = (cx: number, cy: number) => g[Math.min(Math.max(cy, 0), H - 1) * W + Math.min(Math.max(cx, 0), W - 1)];
    const row = (cy: number) => cr(at(x - 1, cy), at(x, cy), at(x + 1, cy), at(x + 2, cy), tx);
    return cr(row(y - 1), row(y), row(y + 1), row(y + 2), ty);
}
export function latLonToLocal(lat: number, lon: number) { return { e: (lon - M.originLon) * M.metresPerDegEast, n: (lat - M.originLat) * M.metresPerDegNorth }; }

export type RunClass = 'blue' | 'red' | 'black' | 'itinerary' | 'park';
export type RouteId = typeof ROUTES[number]['id'];
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export class VerbierRun {
    id: string; name: string; klass: RunClass; length: number;
    private e: Float64Array; private n: Float64Array; private re: Float64Array; private rn: Float64Array;
    private sE: number; private sN: number; private tE: number; private tN: number; private scale: number;
    readonly startElevation: number; readonly endElevation: number;
    /** Half-width of the groomed piste (m); 0 for an ungroomed itinerary. Typical widths, not measured. */
    pisteHalfWidth: number;
    constructor(route: typeof ROUTES[number]) {
        this.id = route.id; this.name = route.name; this.klass = route.klass as RunClass;
        const p = route.path, k = p.length;
        this.e = new Float64Array(k); this.n = new Float64Array(k); this.re = new Float64Array(k); this.rn = new Float64Array(k);
        for (let i = 0; i < k; i++) { this.e[i] = p[i][0]; this.n[i] = p[i][1]; }
        // Right-hand normal of the travel direction, smoothed over +-40 m so the corridor does not kink.
        for (let i = 0; i < k; i++) {
            const a = Math.max(0, i - 8), b = Math.min(k - 1, i + 8);
            const te = this.e[b] - this.e[a], tn = this.n[b] - this.n[a], l = Math.hypot(te, tn) || 1;
            this.re[i] = tn / l; this.rn[i] = -te / l;
        }
        this.length = 5 * (k - 1);
        this.sE = this.e[0]; this.sN = this.n[0];
        const de = this.e[k - 1] - this.sE, dn = this.n[k - 1] - this.sN, dl = Math.hypot(de, dn) || 1;
        this.tE = de / dl; this.tN = dn / dl; this.scale = dl / this.length;
        this.startElevation = route.startElevation; this.endElevation = route.endElevation;
        this.pisteHalfWidth = { blue: 22, red: 18, black: 14, itinerary: 0, park: 28 }[this.klass];
    }
    /** Local DEM metres for course coordinates (x lateral, d along the run). */
    toLocal(x: number, d: number, out = { e: 0, n: 0 }) {
        const f = Math.min(Math.max(d / 5, 0), this.e.length - 1.0001), i = Math.floor(f), t = f - i;
        const pe = this.e[i] + (this.e[i + 1] - this.e[i]) * t, pn = this.n[i] + (this.n[i + 1] - this.n[i]) * t;
        const re = this.re[i] + (this.re[i + 1] - this.re[i]) * t, rn = this.rn[i] + (this.rn[i + 1] - this.rn[i]) * t;
        const rl = Math.hypot(re, rn) || 1;
        const extra = Math.max(0, d - this.length) + Math.min(0, d);   // beyond the ends: continue straight
        let ne = pe + this.tE * extra + x * re / rl, nn = pn + this.tN * extra + x * rn / rl;
        const ax = Math.abs(x);
        if (ax > 150) {
            // far field: straight frame along the start->end direction
            const w = ax >= 600 ? 1 : (t => t * t * (3 - 2 * t))((ax - 150) / 450);
            const fe = this.sE + this.tE * d * this.scale + x * this.tN, fn = this.sN + this.tN * d * this.scale - x * this.tE;
            ne += (fe - ne) * w; nn += (fn - nn) * w;
        }
        out.e = ne; out.n = nn; return out;
    }
    private tmp = { e: 0, n: 0 };
    /** Mogul amplitude (m) at (x, d): where the guide reports moguls. */
    mogulAmplitude(x: number, d: number) {
        const off = Math.abs(x);
        if (this.id === 'mont-fort') return d < 260 ? .55 * (1 - smooth(d, 200, 260)) : off > this.pisteHalfWidth ? .25 : 0;
        if (this.klass === 'itinerary') return .5;
        if (this.klass === 'black') return off > this.pisteHalfWidth ? .3 : 0;
        return 0;
    }
    /** Ground height (m above sea level) at course coordinates. */
    height(x: number, d: number) {
        const p = this.toLocal(x, d, this.tmp);
        let h = demHeight(p.e, p.n);
        const amp = Math.abs(x) < 400 ? this.mogulAmplitude(x, d) : 0;
        if (amp > 0) h += amp * moguls(p.e, p.n);
        if (Math.abs(x) > this.pisteHalfWidth && Math.abs(x) < 400) h += .12 * Math.sin(p.e * .21 + Math.sin(p.n * .13) * 2) * Math.cos(p.n * .17); // wind relief off-piste
        return h;
    }
    /** Surface slope (deg) and aspect (unit downhill direction, local e/n) of the DEM at course coordinates. */
    slopeAt(x: number, d: number) {
        const p = this.toLocal(x, d, this.tmp), s = 12;
        const ge = (demHeight(p.e + s, p.n) - demHeight(p.e - s, p.n)) / (2 * s), gn = (demHeight(p.e, p.n + s) - demHeight(p.e, p.n - s)) / (2 * s);
        const g = Math.hypot(ge, gn);
        return { deg: Math.atan(g) * 180 / Math.PI, downE: g ? -ge / g : 0, downN: g ? -gn / g : 0, elevation: demHeight(p.e, p.n) };
    }
}
/** Irregular moguls: three crossing wave trains (5.4-7.3 m) with an uneven envelope, fixed to the ground. Range about -1..1. */
export function moguls(e: number, n: number) {
    const a = Math.sin(e * .86 + n * .52 + 1.3) , b = Math.sin(e * -.41 + n * .97 + 4.1), c = Math.sin(e * .63 - n * .74 + 2.2);
    const env = .55 + .45 * Math.sin(e * .071 + n * .053) * Math.cos(n * .061 - e * .029);
    return (a * b * .9 + c * .45) * env;
}
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const runs = new Map<string, VerbierRun>();
export function verbierRun(id: string): VerbierRun {
    let r = runs.get(id);
    if (!r) { const route = ROUTES.find(x => x.id === id); if (!route) throw new Error(`Unknown Verbier run ${id}`); r = new VerbierRun(route); runs.set(id, r); }
    return r;
}
export const VERBIER_ROUTES = ROUTES;
export const VERBIER_ANCHORS = ANCHORS;
export { hash as verbierHash };

/** Air temperature from an altitude lapse rate of 6.5 degC per km, relative to a reference at Verbier village (1,500 m). */
export function lapseTemperature(elevation: number, villageTemp: number) { return villageTemp - 6.5 * (elevation - 1500) / 1000; }
/** Approximate treeline in the Val de Bagnes (larch / arolla pine), with local variation. Game estimate. */
export function treeline(e: number, n: number) { return 2150 + 90 * Math.sin(e * .004 + 1.1) * Math.cos(n * .0035); }
