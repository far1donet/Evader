import * as T from 'three';
import type { Building } from './terrain.ts';
import { Builder, M, V, box, rbox, stoneTexture, plasterTexture, tiled, woodTexture } from './craft.ts';

/**
 * Buildings of the 4 Vallées, from swisstopo VECTOR25 footprints and the GWR register (floors and use), drawn as
 * Valais chalets and blocks:
 *  - chalets: rubble-stone ground floor, weathered larch planks above, small-paned windows with wooden (sometimes
 *    painted) shutters, a balcony on each upper floor of the valley-side gable, a deep gable roof under half a metre of
 *    snow with the purlin ends showing, a chimney;
 *  - apartment blocks and hotels: plaster floors, a timber top floor, larger windows, balconies along the long side;
 *  - barns and huts (raccards, mazots): dark old timber on a stone base;
 *  - large non-residential buildings and transport buildings: plaster or concrete with window bands, low roofs;
 *  - churches: white plaster, steep roof and a bell tower with a spire.
 * Footprints are the generalised 1:25,000 ones (rectangles of the right size and orientation, not surveyed outlines);
 * heights are floors x 2.8 m; openings, balconies and colours are typical, not surveyed.
 *
 * Level of detail per building (0 far, 1 middle, 2 near): walls and roof; + windows, balconies, chimney; + frames,
 * sills, shutters, balcony posts, purlin ends and doors. Everything merges into one mesh per material.
 */
export type Local = (e: number, n: number) => [number, number] | null;
export type Solid = { x: number; d: number; r: number; rd: number; h: number; ux: number; ud: number; hl: number; hw: number; kind: 'WALL STRIKE' | 'TOWER STRIKE' };

const std = (o: T.MeshStandardMaterialParameters) => new T.MeshStandardMaterial(o);
const MAT = {
    larch: tiled(std({ color: 0xffffff, map: woodTexture('#7a5232', 3), roughness: .86 }), 2),
    larchDark: tiled(std({ color: 0xffffff, map: woodTexture('#4d3220', 9), roughness: .88 }), 2),
    larchLight: tiled(std({ color: 0xffffff, map: woodTexture('#8f6a45', 27), roughness: .84 }), 2),
    stone: tiled(std({ color: 0xffffff, map: stoneTexture(), roughness: .92 }), 2.5),
    plaster: tiled(std({ color: 0xffffff, map: plasterTexture(), roughness: .93 }), 4),
    plasterWarm: tiled(std({ color: 0xf1e2c8, map: plasterTexture(), roughness: .93 }), 4),
    window: std({ color: 0x1a2530, metalness: .35, roughness: .07, envMapIntensity: 1.5 }),
    frameWhite: std({ color: 0xf0eee8, roughness: .6 }),
    shutterGreen: tiled(std({ color: 0x5f8a5c, map: woodTexture('#9a9a9a', 33), roughness: .7 }), 2),
    shutterRed: tiled(std({ color: 0xb04a3a, map: woodTexture('#a0a0a0', 35), roughness: .7 }), 2),
    roofMetal: std({ color: 0x4a4f53, metalness: .5, roughness: .5 }),
};
const hash = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

/** One building into the builder, in its own frame: a along the length (gable axis), b across, y up (absolute). */
function addBuilding(B: Builder, b: Building, local: Local, ground: (x: number, d: number) => number, lod: number): Solid | null {
    const ue = Math.cos(b.angle), un = Math.sin(b.angle), L = b.length / 2, W = b.width / 2;
    const cw = (a: number, c: number) => local(b.e + ue * a - un * c, b.n + un * a + ue * c);
    const c4 = [cw(-L, -W), cw(L, -W), cw(L, W), cw(-L, W)], cen = local(b.e, b.n);
    if (!cen || c4.some(c => !c)) return null;
    const cs = c4 as [number, number][];
    const gs = cs.map(([x, d]) => ground(x, d)), g0 = Math.min(...gs) - .9, g1 = Math.max(...gs);
    // frame: building space (a, y, b) to the scene (x, y, z = -d); keep it right-handed even if the local frame mirrors
    const ex = [(cs[1][0] - cs[0][0]) / (2 * L), (cs[1][1] - cs[0][1]) / (2 * L)], wx0 = [(cs[3][0] - cs[0][0]) / (2 * W), (cs[3][1] - cs[0][1]) / (2 * W)];
    const ax = V(ex[0], 0, -ex[1]), bz0 = V(wx0[0], 0, -wx0[1]), handed = ax.clone().cross(V(0, 1, 0)).dot(bz0) < 0 ? -1 : 1;   // det(a, y, b) > 0
    const bz = bz0.multiplyScalar(handed);
    const frame = new T.Matrix4().makeBasis(ax, V(0, 1, 0), bz).setPosition(cen[0], 0, -cen[1]);
    const put = (g: T.BufferGeometry, m: T.Material) => B.add(g, m, frame);
    // valley side: the gable end (±a) and long side (±b) with the lower ground
    const gA = (gs[1] + gs[2]) / 2 - (gs[0] + gs[3]) / 2, valleyA = gA < 0 ? 1 : -1;
    const gB = (gs[2] + gs[3]) / 2 - (gs[0] + gs[1]) / 2, valleyB = (gB < 0 ? 1 : -1) * handed;
    const r = hash(b.e, b.n), r2 = hash(b.n, b.e);
    const kind = b.kind, storey = kind === 3 ? 2.6 : kind === 2 || kind === 5 ? 3.4 : 2.8;
    const eave = g1 + b.floors * storey + (kind === 4 ? 5 : 0) + .3;
    // walls: lower and upper materials
    let low: T.Material, up: T.Material, split: number;
    switch (kind) {
        case 0: low = MAT.stone; up = r < .5 ? MAT.larch : MAT.larchLight; split = g1 + Math.min(storey, (eave - g1) * .45); break;
        case 1: low = r < .5 ? MAT.plaster : MAT.plasterWarm; up = MAT.larch; split = eave - storey; break;
        case 3: low = MAT.stone; up = MAT.larchDark; split = g1 + .9; break;
        case 4: low = up = MAT.plaster; split = eave; break;
        case 5: low = up = M.concrete; split = eave; break;
        default: low = up = r < .5 ? MAT.plaster : M.concrete; split = eave; break;
    }
    if (lod === 0) put(box(2 * L, eave - g0, 2 * W, 0, (eave + g0) / 2, 0), up === MAT.larch || up === MAT.larchLight || up === MAT.larchDark ? up : low);   // far: one block
    else {
        if (split > g0 + .05) put(box(2 * L, split - g0, 2 * W, 0, (split + g0) / 2, 0), low);
        if (eave > split + .05) put(box(2 * L + .04, eave - split, 2 * W + .04, 0, (eave + split) / 2, 0), up);
    }
    // roof: gable along a, deep overhangs, timber slab with snow on top
    const pitch = kind === 2 || kind === 5 ? .2 : kind === 4 ? .75 : kind === 3 ? .55 : .46;
    const oe = kind === 2 || kind === 5 ? .5 : 1.0, og = kind === 2 || kind === 5 ? .4 : 1.2, t = .24, snow = .42;
    const run = W + oe, slope = run / Math.cos(pitch), rise = Math.tan(pitch) * W, ridge = eave + rise;
    for (const s of [-1, 1]) {
        // slab centre: halfway down the slope from the ridge line
        const cy = ridge - Math.sin(pitch) * slope / 2 + t / 2, cz = s * Math.cos(pitch) * slope / 2;
        const m = new T.Matrix4().makeRotationX(s * pitch).setPosition(0, cy, cz);
        if (lod > 0) { const slab = box(2 * (L + og), t, slope); slab.applyMatrix4(m); put(slab, MAT.larchDark); }
        const sn = lod >= 2 ? rbox(2 * (L + og) + .12, snow, slope + .08, .16, 0, 0, 0, 1) : box(2 * (L + og) + .12, snow, slope + .08);
        sn.applyMatrix4(new T.Matrix4().makeRotationX(s * pitch).setPosition(0, cy + (t + snow) / 2 * Math.cos(pitch) - .02, cz + s * (t + snow) / 2 * Math.sin(pitch))); put(sn, M.snow);
    }
    // gable triangles at both ends
    for (const s of [-1, 1]) {
        const tri = new T.BufferGeometry(), a = s * (L + .02);
        const pts = s > 0 ? [a, eave, W + .02, a, eave, -W - .02, a, ridge + .05, 0] : [a, eave, -W - .02, a, eave, W + .02, a, ridge + .05, 0];
        tri.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); tri.computeVertexNormals(); put(tri, up);
    }
    // church tower
    if (kind === 4) {
        const ta = -L + 1.6, th = eave + 9;
        put(box(3.2, th - g0, 3.2, ta, (th + g0) / 2, 0), MAT.plaster);
        const spire = new T.ConeGeometry(2.6, 7, 4, 1); spire.rotateY(Math.PI / 4); spire.translate(ta, th + 3.5, 0); put(spire, MAT.roofMetal);
        if (lod >= 1) for (const s of [-1, 1]) put(box(.05, 1.6, .7, ta + s * 1.62, th - 2.2, 0), MAT.window);
    }
    if (lod >= 1) {
        // windows, per floor, on all four walls (none on the stone ground floor of barns)
        const big = kind === 1 || kind === 2 || kind === 5, ww = big ? 1.25 : kind === 4 ? 1.0 : .85, wh = kind === 4 ? 2.8 : big ? 1.35 : 1.05;
        const shutter = kind === 0 && r2 < .85 ? (r2 < .12 ? MAT.shutterGreen : r2 < .2 ? MAT.shutterRed : MAT.larchDark) : null;
        const frameM = kind === 0 || kind === 3 ? MAT.larchDark : MAT.frameWhite;
        const floors = kind === 4 ? 1 : Math.max(1, b.floors);
        const opening = (along: 'a' | 'b', side: number, pos: number, y: number) => {
            const n = along === 'b' ? V(0, 0, side) : V(side, 0, 0), wall = along === 'b' ? W : L;
            const at = (u: number, yy: number, out: number) => along === 'b' ? V(pos + 0 * u, yy, side * (wall + out)) : V(side * (wall + out), yy, pos);
            const pane = new T.PlaneGeometry(ww, wh); pane.lookAt(n); const p = at(0, y, .04); pane.translate(p.x, p.y, p.z); put(pane, MAT.window);
            if (lod < 2) return;
            // frame: one box just larger than the pane, set slightly proud of the wall (the pane sits in front of it)
            const fb = along === 'b' ? box(ww + .16, wh + .16, .06) : box(.06, wh + .16, ww + .16), fp = at(0, y, .005); fb.translate(fp.x, fp.y, fp.z); put(fb, frameM);
            if (!big) { const mu = along === 'b' ? box(.05, wh, .04) : box(.04, wh, .05), mp = at(0, y, .05); mu.translate(mp.x, mp.y, mp.z); put(mu, frameM); }   // mullion
            const sill = along === 'b' ? box(ww + .3, .07, .22) : box(.22, .07, ww + .3); const sp = at(0, y - wh / 2 - .08, .1); sill.translate(sp.x, sp.y, sp.z); put(sill, frameM);
            if (shutter) for (const k of [-1, 1]) {
                const g = along === 'b' ? box(ww * .52, wh + .05, .05) : box(.05, wh + .05, ww * .52), sp2 = at(0, y, .06);
                g.translate(sp2.x + (along === 'b' ? k * (ww * .78) : 0), sp2.y, sp2.z + (along === 'a' ? k * (ww * .78) : 0)); put(g, shutter);
            }
        };
        for (let f = 0; f < floors; f++) {
            const y = g1 + f * storey + (kind === 4 ? 4 : 1.45);
            if (kind === 3 && f === 0 && floors > 0) { opening('a', valleyA, 0, g1 + 1.8); continue; }
            if (y + wh / 2 > eave - .15) break;
            const nLong = Math.max(1, Math.floor((2 * L - 1.6) / (big ? 2.3 : 2.7))), nGable = Math.max(1, Math.min(3, Math.floor((2 * W - 1.2) / 2.4)));
            for (const s of [-1, 1]) {
                for (let k = 0; k < nLong; k++) opening('b', s, -L + .8 + (k + .5) * (2 * L - 1.6) / nLong, y);
                for (let k = 0; k < nGable; k++) opening('a', s, -W + .6 + (k + .5) * (2 * W - 1.2) / nGable, y);
            }
        }
        // windows in the gable (attic) of chalets
        if (kind === 0 && rise > 1.8) for (const s of [-1, 1]) opening('a', s, 0, eave + rise * .38);
        // balconies: chalets on each upper floor of the valley-side gable; blocks along the valley-side long side
        const balcony = (along: 'a' | 'b', side: number, y: number, span: number) => {
            const dep = kind === 1 ? 1.5 : 1.3, wall = along === 'a' ? L : W;
            const slab = along === 'a' ? box(dep, .16, span) : box(span, .16, dep); const o = side * (wall + dep / 2);
            slab.translate(along === 'a' ? o : 0, y, along === 'a' ? 0 : o); put(slab, MAT.larchDark);
            const rail = along === 'a' ? box(.07, .95, span) : box(span, .95, .07), ro = side * (wall + dep - .04);
            rail.translate(along === 'a' ? ro : 0, y + .55, along === 'a' ? 0 : ro); put(rail, kind === 1 && r < .5 ? MAT.frameWhite : MAT.larch);
            for (const k of [-1, 1]) { const end = along === 'a' ? box(dep, .95, .07) : box(.07, .95, dep); end.translate(along === 'a' ? side * (wall + dep / 2) : k * (span / 2), y + .55, along === 'a' ? k * (span / 2) : side * (wall + dep / 2)); put(end, MAT.larch); }
            if (lod < 2) return;
            const posts = Math.max(2, Math.round(span / 1.6));
            for (let k = 0; k <= posts; k++) {
                const u = -span / 2 + k * span / posts, pst = box(.12, .95 + .3, .12); pst.translate(along === 'a' ? ro : u, y + .55, along === 'a' ? u : ro); put(pst, MAT.larchDark);
                const brk = along === 'a' ? box(dep * .9, .14, .1) : box(.1, .14, dep * .9); brk.translate(along === 'a' ? side * (wall + dep * .45) : u, y - .2, along === 'a' ? u : side * (wall + dep * .45)); put(brk, MAT.larchDark);
            }
            const cap = along === 'a' ? box(.14, .07, span + .1) : box(span + .1, .07, .14); cap.translate(along === 'a' ? ro : 0, y + 1.05, along === 'a' ? 0 : ro); put(cap, MAT.larchDark);
        };
        if (kind === 0) for (let f = 1; f < b.floors; f++) balcony('a', valleyA, g1 + f * storey + .05, 2 * W + .6);
        if (kind === 1) for (let f = 1; f < b.floors; f++) balcony('b', valleyB, g1 + f * storey + .05, 2 * L - 1.2);
        // chimney
        if ((kind === 0 || kind === 1) && b.length > 7) {
            const ca = (r - .5) * L, cb = W * .35, top = ridge + .9, base = eave + Math.tan(pitch) * (W - cb) - .4;
            put(box(.62, top - base, .62, ca, (top + base) / 2, cb), MAT.plaster);
            put(box(.85, .1, .85, ca, top + .05, cb), MAT.roofMetal); put(lod >= 2 ? rbox(.8, .22, .8, .1, ca, top + .2, cb, 1) : box(.8, .22, .8, ca, top + .2, cb), M.snow);
        }
    }
    if (lod >= 2) {
        // purlin ends under the gable overhangs, a door on the uphill gable
        for (const s of [-1, 1]) for (const bb of [-W * .55, 0, W * .55]) {
            const y = eave + Math.tan(pitch) * (W - Math.abs(bb)) - .05, g = box(og + .1, .22, .18); g.translate(s * (L + og / 2), y, bb); put(g, MAT.larchDark);
        }
        if (kind !== 2) { const door = box(.1, 2.1, 1.0); door.translate(-valleyA * (L + .04), g1 + 1.05, W * .4); put(door, MAT.larchDark); }
    }
    const hl = Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]) / 2, hw = Math.hypot(cs[3][0] - cs[0][0], cs[3][1] - cs[0][1]) / 2;
    return { x: cen[0], d: cen[1], r: Math.hypot(hl, hw) + 1, rd: Math.hypot(hl, hw) + 1, h: ridge - g1 + 1, ux: ex[0], ud: ex[1], hl, hw, kind: 'WALL STRIKE' };
}

/**
 * Merged meshes of the given buildings in a local frame, plus their solid boxes. `lod(x, d)` picks the level of detail
 * per building from its local position (default: 1).
 */
export function buildingMesh(list: Building[], local: Local, ground: (x: number, d: number) => number,
    opts: { shadows?: boolean; keep?: (x: number, d: number, b: Building) => boolean; lod?: (x: number, d: number) => number } = {}) {
    const B = new Builder(), solids: Solid[] = [];
    for (const b of list) {
        const c = local(b.e, b.n); if (!c || (opts.keep && !opts.keep(c[0], c[1], b))) continue;
        const s = addBuilding(B, b, local, ground, opts.lod?.(c[0], c[1]) ?? 1); if (s) solids.push(s);
    }
    const mesh = B.group(!!opts.shadows); mesh.name = 'buildings';
    return { mesh, solids };
}

/** Is (x, d) inside the solid box, below its top? */
export function insideSolid(o: Solid, x: number, d: number, above: number, pad = .35) {
    const dx = x - o.x, dd = d - o.d, a = dx * o.ux + dd * o.ud, c = -dx * o.ud + dd * o.ux;
    return Math.abs(a) < o.hl + pad && Math.abs(c) < o.hw + pad && above < o.h;
}
