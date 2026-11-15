/**
 * Geometry of a real lift line on the real terrain, shared by the lift scenery and the lift ride.
 *
 * Input: the mapped line (OpenStreetMap aerialway; its intermediate nodes are the pylons where mapped) in course
 * coordinates, and the ground height. Output: the cable heads (stations and towers), the cable height with sag between
 * them, and both tracks (uphill on the right of travel, downhill on the left).
 *
 * Pylons: where the lift is in the Swiss aviation-obstacle register (BAZL; 25 of the 66 lifts, the taller ones), its real
 * pylons are used, at their registered positions and top elevations (`real: true`), and the OpenStreetMap nodes are ignored.
 * A registered lift is never given extra towers: if a span would come too close to the ground, its rope is tensioned
 * (less sag) instead, as on the real single-span cable cars (Mont-Gelé has no pylon at all).
 *
 * Otherwise dimensions are typical values per lift type, not surveyed. The guide asks for estimated clearances to be
 * labelled, and they are: where the mapped pylons alone would let the cable come too close to the ground, a tower is added
 * (flagged `mapped: false`), as a lift engineer would place one on the crest.
 */
export type LiftKind = 'chair' | 'gondola' | 'mixed' | 'cablecar' | 'surface';
export function liftKind(type: string | null | undefined): LiftKind {
    switch (type) {
        case 'chair_lift': return 'chair';
        case 'gondola': case 'funicular': return 'gondola';
        case 'mixed_lift': return 'mixed';
        case 'cable_car': return 'cablecar';
        case 'platter': case 't-bar': case 'drag_lift': case 'rope_tow': case 'j-bar': return 'surface';
        default: return 'chair';
    }
}
type Spec = {
    /** Tower height (ground to cable), m. */ tower: number;
    /** Cable height above the station platform, m (vehicle floor / seat at boarding height). */ station: number;
    /** Lowest allowed cable height above the ground along a span, m. */ clearance: number;
    /** Distance between the uphill and downhill cables, m. */ gauge: number;
    /** Loaded sag as a fraction of span length. */ sag: number;
    /** Typical speed range, m/s. */ speed: [number, number];
};
export const LIFT_SPEC: Record<LiftKind, Spec> = {
    // Chair: seat 2.4 m below the grip, at 0.45 m when boarding; the footrest hangs 0.55 m below the seat.
    chair: { tower: 11, station: 2.85, clearance: 4.6, gauge: 5.6, sag: .022, speed: [1, 6] },
    // Gondola: cabin floor 3.4 m below the grip (hanger 1.1 m + cabin 2.3 m), level with the platform when boarding.
    gondola: { tower: 15, station: 3.4, clearance: 5.6, gauge: 6.2, sag: .022, speed: [2, 7] },
    mixed: { tower: 14, station: 3.4, clearance: 5.6, gauge: 6.2, sag: .022, speed: [2, 6.5] },
    // Aerial tramway: floor 7 m below the track rope (carriage + 4.2 m hanger + 2.8 m cabin).
    cablecar: { tower: 30, station: 7, clearance: 11, gauge: 9, sag: .032, speed: [3, 12] },
    // Surface lift: hangers with a retracting rope; the rider stays on the snow.
    surface: { tower: 7, station: 6, clearance: 4.8, gauge: 2.4, sag: .015, speed: [1, 5] },
};

export type Head = { s: number; x: number; d: number; y: number; ground: number; mapped: boolean; station: boolean;
    /** Registered pylon (BAZL). */ real?: boolean; /** Sag multiplier of the span that starts here (1 = typical). */ sag?: number };
/** Cable below the top of a pylon (sheave trains under the crossarm), m. */
const SHEAVE: Record<LiftKind, number> = { chair: .8, gondola: 1.0, mixed: 1.0, cablecar: 1.5, surface: .3 };
export type CablePoint = { x: number; d: number; y: number; ground: number; tx: number; td: number; slope: number };

export class LiftProfile {
    readonly kind: LiftKind; readonly spec: Spec;
    /** Plan arclength of the mapped line, m. */
    readonly length: number;
    readonly heads: Head[] = [];
    private readonly px: number[] = []; private readonly pd: number[] = []; private readonly ps: number[] = [];
    private readonly ground: (x: number, d: number) => number;
    /** True when the pylons come from the BAZL register. */
    readonly realPylons: boolean;
    constructor(points: [number, number][], ground: (x: number, d: number) => number, type: string | null | undefined, pylons?: [number, number, number][]) {
        this.ground = ground; this.kind = liftKind(type); this.spec = LIFT_SPEC[this.kind];
        let s = 0;
        points.forEach(([x, d], i) => { if (i) s += Math.hypot(x - this.px[i - 1], d - this.pd[i - 1]); this.px.push(x); this.pd.push(d); this.ps.push(s); });
        this.length = s;
        const head = (si: number, mapped: boolean, station: boolean, height: number): Head => {
            const p = this.plan(si), g = ground(p.x, p.d);
            return { s: si, x: p.x, d: p.d, y: g + height, ground: g, mapped, station };
        };
        this.realPylons = !!pylons;
        this.heads.push(head(0, true, true, this.spec.station));
        if (pylons) for (const [x, d, top] of pylons) {
            const si = this.nearestS(x, d);
            if (si <= 12 || si >= s - 12 || this.heads.some(h => Math.abs(h.s - si) < 6)) continue;
            const h = head(si, true, false, 0);
            h.y = Math.max(h.ground + 3, top - SHEAVE[this.kind]); h.real = true;
            this.heads.push(h);
        }
        else for (let i = 1; i < points.length - 1; i++) if (this.ps[i] > 12 && this.ps[i] < s - 12) this.heads.push(head(this.ps[i], true, false, this.spec.tower));
        this.heads.push(head(s, true, true, this.spec.station));
        this.heads.sort((a, b) => a.s - b.s);
        // Add towers where the loaded cable would come closer to the ground than the clearance allows.
        for (let guard = 0; guard < 160; guard++) {
            let worst = 0, at = -1;
            for (let si = 0; si <= s; si += 4) {
                const p = this.plan(si), need = ground(p.x, p.d) + this.spec.clearance - this.cableY(si);
                const nearStation = si < 25 || si > s - 25;
                if (need > worst && !nearStation) { worst = need; at = si; }
            }
            if (at < 0 || worst < .05) break;
            if (this.realPylons) {
                // registered line: tension the span instead of inventing a tower
                const a = this.span(at);
                if ((a.sag ?? 1) > 0) { a.sag = Math.max(0, (a.sag ?? 1) * .6 - .05); continue; }
                // a taut rope is still too low: fall through and add a (labelled) tower
            }
            const near = this.heads.find(h => !h.station && !h.real && Math.abs(h.s - at) < 10);
            if (near) near.y += worst + .5;
            else { this.heads.push(head(at, false, false, this.spec.tower)); this.heads.sort((a, b) => a.s - b.s); }
        }
    }
    /** Arclength of the point of the mapped line nearest to (x, d). */
    nearestS(x: number, d: number) {
        let best = Infinity, out = 0;
        for (let i = 0; i < this.ps.length - 1; i++) {
            const ax = this.px[i], ad = this.pd[i], dx = this.px[i + 1] - ax, dd = this.pd[i + 1] - ad, L2 = dx * dx + dd * dd || 1e-9;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (d - ad) * dd) / L2)), q = Math.hypot(ax + dx * t - x, ad + dd * t - d);
            if (q < best) { best = q; out = this.ps[i] + t * (this.ps[i + 1] - this.ps[i]); }
        }
        return out;
    }
    /** The head at the start of the span containing s. */
    private span(s: number) { const h = this.heads; let i = 0; while (i < h.length - 2 && h[i + 1].s < s) i++; return h[i]; }
    /** Plan position on the mapped line at arclength s (extrapolated beyond the ends). */
    plan(s: number) {
        const n = this.ps.length - 1;
        let i = 0; while (i < n - 1 && this.ps[i + 1] < s) i++;
        const seg = Math.max(1e-6, this.ps[i + 1] - this.ps[i]), t = (s - this.ps[i]) / seg;
        const tx = (this.px[i + 1] - this.px[i]) / seg, td = (this.pd[i + 1] - this.pd[i]) / seg;
        return { x: this.px[i] + (this.px[i + 1] - this.px[i]) * t, d: this.pd[i] + (this.pd[i + 1] - this.pd[i]) * t, tx, td };
    }
    /** Cable height at plan arclength s: straight between heads with a parabolic sag (loaded rope). */
    cableY(s: number) {
        const h = this.heads;
        if (s <= h[0].s) return h[0].y;
        if (s >= h[h.length - 1].s) return h[h.length - 1].y;
        let i = 0; while (i < h.length - 2 && h[i + 1].s < s) i++;
        const a = h[i], b = h[i + 1], span = b.s - a.s, t = (s - a.s) / span;
        const sag = this.spec.sag * (a.sag ?? 1) * Math.hypot(span, b.y - a.y);
        return a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t);
    }
    /** Cable point on a track: +1 uphill (right of travel), -1 downhill (left), 0 the line itself. */
    at(s: number, track: 1 | -1 | 0 = 1): CablePoint {
        const p = this.plan(s), off = track * this.spec.gauge / 2;
        const x = p.x + p.td * off, d = p.d - p.tx * off, e = .5;
        return { x, d, y: this.cableY(s), ground: this.ground(x, d), tx: p.tx, td: p.td, slope: (this.cableY(s + e) - this.cableY(s - e)) / (2 * e) };
    }
    /** Lowest vehicle-bottom clearance along the line (for tests): cable height above ground minus `below`. */
    minClearance(below: number) {
        let m = Infinity;
        for (let s = 25; s <= this.length - 25; s += 2) { const c = this.at(s, 0); m = Math.min(m, c.y - below - c.ground); }
        return m;
    }
}

/** Point on the closed rope loop: uphill track [0, L), top bullwheel turn, downhill track, bottom turn. */
export function loopPoint(p: LiftProfile, u: number) {
    const L = p.length, r = p.spec.gauge / 2, C = Math.PI * r, loop = 2 * L + 2 * C;
    u = ((u % loop) + loop) % loop;
    if (u < L) { const c = p.at(u, 1); return { x: c.x, d: c.d, y: c.y, dx: c.tx, dd: c.td, up: true }; }
    if (u < L + C || u >= 2 * L + C) {
        const top = u < L + C, phi = (top ? u - L : u - 2 * L - C) / C * Math.PI, c = p.at(top ? L : 0, 0);
        const fx = c.tx, fd = c.td, rx = fd, rd = -fx, k = top ? 1 : -1;
        return { x: c.x + k * (fx * r * Math.sin(phi) + rx * r * Math.cos(phi)), d: c.d + k * (fd * r * Math.sin(phi) + rd * r * Math.cos(phi)), y: c.y,
            dx: k * (fx * Math.cos(phi) - rx * Math.sin(phi)), dd: k * (fd * Math.cos(phi) - rd * Math.sin(phi)), up: false };
    }
    const s = L - (u - L - C), c = p.at(s, -1);
    return { x: c.x, d: c.d, y: c.y, dx: -c.tx, dd: -c.td, up: false };
}
export const loopLength = (p: LiftProfile) => 2 * p.length + Math.PI * p.spec.gauge;
