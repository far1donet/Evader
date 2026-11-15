import type { Resort, ResortLift, Station, RouteSummary } from './terrain.ts';
import { overviewGrid } from './terrain.ts';

/**
 * Piste-map rendering for the resort map: a hillshade computed from the real 10 m snow surface (swissALTI3D), with the
 * mapped pistes, lifts and stations drawn on top. The same drawing is the 2D map and the texture draped on the 3D map.
 * Colours follow the Swiss piste convention (blue / red / black, yellow itineraries); no resort artwork is reproduced.
 */
export const PISTE_COLOUR: Record<string, string> = { blue: '#2369d6', red: '#d8322a', black: '#15181b', itinerary: '#e6b400', park: '#f07a1e', skicross: '#f07a1e' };
export type View = { e: number; n: number; scale: number; w: number; h: number };

/** Shaded relief of the whole box, one pixel per 10 m overview cell. */
export function reliefImage(resort: Resort) {
    const g = overviewGrid(), m = g.meta, nx = m.nx, ny = m.ny;
    const c = document.createElement('canvas'); c.width = nx; c.height = ny;
    const ctx = c.getContext('2d')!, img = ctx.createImageData(nx, ny), px = img.data;
    const h = (x: number, y: number) => g.height(Math.min(ny - 1, Math.max(0, y)) * nx + Math.min(nx - 1, Math.max(0, x)));
    const az = 315 * Math.PI / 180, alt = 40 * Math.PI / 180;                    // light from the north-west
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const z = h(x, y), dzdx = (h(x + 1, y) - h(x - 1, y)) / (2 * m.cell), dzdy = (h(x, y - 1) - h(x, y + 1)) / (2 * m.cell);
        const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
        let shade = Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
        shade = Math.max(0, shade);
        // ground colour: valley meadows and forest belt below ~2,000 m, snow above, bare rock on very steep faces
        let r: number, gr: number, b: number;
        const snow = Math.min(1, Math.max(0, (z - 1550) / 450)), rock = Math.min(1, Math.max(0, (slope * 180 / Math.PI - 38) / 10));
        r = 196 + (246 - 196) * snow; gr = 210 + (249 - 210) * snow; b = 196 + (252 - 196) * snow;
        r = r + (150 - r) * rock; gr = gr + (156 - gr) * rock; b = b + (162 - b) * rock;
        const k = .5 + .62 * shade, i = (y * nx + x) * 4;
        px[i] = Math.min(255, r * k); px[i + 1] = Math.min(255, gr * k); px[i + 2] = Math.min(255, b * k * 1.04); px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

export type DrawOptions = {
    station?: string | null; selectedLift?: string | null; selectedRoute?: string | null; highlightRoutes?: Set<string>;
    rider?: { e: number; n: number } | null; labels?: boolean; pixelRatio?: number;
};
const project = (v: View, e: number, n: number) => [(e - v.e) * v.scale + v.w / 2, (v.n - n) * v.scale + v.h / 2] as const;

/** Draw relief + pistes + lifts + stations for a view. */
export function drawMap(ctx: CanvasRenderingContext2D, resort: Resort, relief: HTMLCanvasElement | ImageBitmap, v: View, o: DrawOptions = {}) {
    const pr = o.pixelRatio ?? 1;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.fillStyle = '#c9d6df'; ctx.fillRect(0, 0, v.w, v.h);
    const m = resort.overview;
    const [ox, oy] = project(v, m.e0 - m.cell / 2, m.n1 + m.cell / 2);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(relief, ox, oy, m.nx * m.cell * v.scale, m.ny * m.cell * v.scale);
    const lw = Math.max(1.4, Math.min(4.5, v.scale * 9));
    // park footprint
    if (resort.park) { ctx.beginPath(); resort.park.world.forEach(([e, n], i) => { const [x, y] = project(v, e, n); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.fillStyle = '#f07a1e55'; ctx.fill(); }
    // pistes
    for (const p of resort.pistes) {
        ctx.beginPath(); p.line.forEach(([e, n], i) => { const [x, y] = project(v, e, n); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = PISTE_COLOUR[p.klass] ?? '#2369d6'; ctx.lineWidth = lw; ctx.lineJoin = ctx.lineCap = 'round';
        ctx.setLineDash(p.klass === 'itinerary' ? [lw * 2.2, lw * 1.6] : []); ctx.stroke();
    }
    ctx.setLineDash([]);
    // highlighted routes (from the current station) and the selected one
    const routeLine = (r: RouteSummary, width: number, colour: string) => {
        ctx.beginPath(); r.line.forEach(([e, n], i) => { const [x, y] = project(v, e, n); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke();
    };
    for (const r of resort.routes) if (o.highlightRoutes?.has(r.id) && r.id !== o.selectedRoute) { routeLine(r, lw * 3, '#ffffffcc'); routeLine(r, lw * 1.3, PISTE_COLOUR[r.klass]); }
    const sel = o.selectedRoute ? resort.routes.find(r => r.id === o.selectedRoute) : undefined;
    if (sel) { routeLine(sel, lw * 4.2, '#d7fa65'); routeLine(sel, lw * 1.6, PISTE_COLOUR[sel.klass]); }
    // lifts
    for (const l of resort.lifts) {
        const selected = l.id === o.selectedLift, fromHere = !!o.station && l.from === o.station;
        ctx.beginPath(); l.points.forEach(([e, n], i) => { const [x, y] = project(v, e, n); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (selected || fromHere) { ctx.strokeStyle = selected ? '#d7fa65' : '#ffffff'; ctx.lineWidth = lw * (selected ? 3.4 : 2.6); ctx.stroke(); }
        ctx.strokeStyle = '#20262b'; ctx.lineWidth = Math.max(1.2, lw * .7); ctx.stroke();
        if (v.scale > .12) for (const [e, n] of l.points.slice(1, -1)) { const [x, y] = project(v, e, n); ctx.fillStyle = '#20262b'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    }
    // stations
    const placed: [number, number, number, number][] = [];
    const order = [...resort.stations].sort((a, b) => importance(b, o.station) - importance(a, o.station));
    for (const s of order) {
        const [x, y] = project(v, s.e, s.n);
        if (x < -40 || y < -40 || x > v.w + 40 || y > v.h + 40) continue;
        const here = s.id === o.station, r = here ? 7 : 4.2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = here ? '#d7fa65' : '#ffffff'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#15202a'; ctx.stroke();
        if (o.labels === false) continue;
        const big = importance(s, o.station) >= 3;
        if (!big && v.scale < .09 && !here) continue;
        ctx.font = `${here ? 700 : 600} ${here ? 14 : big ? 12.5 : 11}px Arial, Helvetica, sans-serif`;
        const tw = ctx.measureText(s.name).width, bx = x + 8, by = y - 8;
        const rect: [number, number, number, number] = [bx - 2, by - 12, tw + 4, 16];
        if (!here && placed.some(p => rect[0] < p[0] + p[2] && rect[0] + rect[2] > p[0] && rect[1] < p[1] + p[3] && rect[1] + rect[3] > p[1])) continue;
        placed.push(rect);
        ctx.lineWidth = 3.4; ctx.strokeStyle = '#ffffffe6'; ctx.strokeText(s.name, bx, by); ctx.fillStyle = '#15202a'; ctx.fillText(s.name, bx, by);
    }
    if (o.rider) {
        const [x, y] = project(v, o.rider.e, o.rider.n);
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = '#d7fa65'; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = '#15202a'; ctx.stroke();
    }
}
function importance(s: Station, here?: string | null) { return (s.id === here ? 100 : 0) + s.liftsUp.length * 2 + s.liftsArrive.length + (s.nameSource.startsWith('common') ? 3 : 0); }

/** Full-box texture for the 3D map (relief + pistes + lifts, no labels). */
export function mapTexture(resort: Resort, relief: HTMLCanvasElement, size = 4096) {
    const b = resort.box, c = document.createElement('canvas'); c.width = c.height = size;
    const v: View = { e: (b.e0 + b.e1) / 2, n: (b.n0 + b.n1) / 2, scale: size / (b.e1 - b.e0), w: size, h: size };
    drawMap(c.getContext('2d')!, resort, relief, v, { labels: false });
    return c;
}

// ---- hit testing ---------------------------------------------------------------------------------------------------------------
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** What is under a world point (e, n) within tol metres: station, then lift, then route. */
export function pick(resort: Resort, e: number, n: number, tol: number, routes?: Set<string>):
    { kind: 'station'; item: Station } | { kind: 'lift'; item: ResortLift } | { kind: 'route'; item: RouteSummary } | null {
    let best: { d: number; r: ReturnType<typeof pick> } | null = null;
    for (const s of resort.stations) { const d = Math.hypot(s.e - e, s.n - n); if (d < tol * 1.3 && (!best || d < best.d)) best = { d, r: { kind: 'station', item: s } }; }
    if (best) return best.r;
    for (const l of resort.lifts) for (let i = 0; i < l.points.length - 1; i++) {
        const d = segDist(e, n, l.points[i][0], l.points[i][1], l.points[i + 1][0], l.points[i + 1][1]);
        if (d < tol && (!best || d < best.d)) best = { d, r: { kind: 'lift', item: l } };
    }
    if (best) return best.r;
    for (const r of resort.routes) {
        if (routes && !routes.has(r.id)) continue;
        for (let i = 0; i < r.line.length - 1; i++) {
            const d = segDist(e, n, r.line[i][0], r.line[i][1], r.line[i + 1][0], r.line[i + 1][1]);
            if (d < tol && (!best || d < best.d)) best = { d, r: { kind: 'route', item: r } };
        }
    }
    return best?.r ?? null;
}
/** Position along a polyline at fraction t (by length). */
export function along(points: [number, number, number][], t: number) {
    const seg: number[] = []; let total = 0;
    for (let i = 0; i < points.length - 1; i++) { const l = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]); seg.push(l); total += l; }
    let s = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < seg.length; i++) {
        if (s <= seg[i] || i === seg.length - 1) {
            const k = seg[i] ? Math.min(1, s / seg[i]) : 0, a = points[i], b = points[i + 1];
            return { e: a[0] + (b[0] - a[0]) * k, n: a[1] + (b[1] - a[1]) * k, z: a[2] + (b[2] - a[2]) * k, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
        }
        s -= seg[i];
    }
    const p = points[points.length - 1]; return { e: p[0], n: p[1], z: p[2], heading: 0 };
}
