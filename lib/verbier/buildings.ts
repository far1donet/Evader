import * as T from 'three';
import type { Building } from './terrain.ts';

/**
 * Buildings of the 4 Vallées, from swisstopo VECTOR25 footprints and the GWR register (floors and use), drawn as Valais
 * chalets and blocks: masonry ground floor, larch timber above (houses), plaster blocks with a timber top floor
 * (apartments, hotels), concrete for large and transport buildings, dark timber for huts and barns, white churches. Gable
 * roofs along the long side, overhanging, with half a metre of snow on them. Footprints are the generalised 1:25,000 ones
 * (rectangles of the right size and orientation, not surveyed outlines); heights are floors x 2.8 m.
 *
 * Everything is merged into one mesh with vertex colours (one draw call for a village).
 */
export type Local = (e: number, n: number) => [number, number] | null;
export type Solid = { x: number; d: number; r: number; rd: number; h: number; ux: number; ud: number; hl: number; hw: number; kind: 'WALL STRIKE' | 'TOWER STRIKE' };

const C = (hex: number) => new T.Color(hex);
const STONE = [C(0xb9b2a5), C(0xa9a397), C(0xc7c1b6)], LARCH = [C(0x5e3b22), C(0x6e4628), C(0x4d301c), C(0x7a512e)];
const PLASTER = [C(0xd9d0c0), C(0xe2dccf), C(0xcfc4b0), C(0xd6cdbd)], CONCRETE = [C(0xa8a7a2), C(0xb6b4ad)];
const SNOW = C(0xf2f5f9), SOFFIT = C(0x2e241c), FASCIA = C(0x3b2a1d), WINDOW = C(0x1d2328), CHIMNEY = C(0x8b857c);
const hash = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

class Builder {
    pos: number[] = []; col: number[] = [];
    tri(a: T.Vector3, b: T.Vector3, c: T.Vector3, k: T.Color) {
        this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let i = 0; i < 3; i++) this.col.push(k.r, k.g, k.b);
    }
    quad(a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3, k: T.Color) { this.tri(a, b, c, k); this.tri(a, c, d, k); }
    geometry() {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
        g.computeVertexNormals(); g.computeBoundingSphere();
        return g;
    }
}
const v = (x: number, y: number, d: number) => new T.Vector3(x, y, -d);

/** One building into the builder; returns its solid box (local frame) or null when it is off the local frame. */
function addBuilding(B: Builder, b: Building, local: Local, ground: (x: number, d: number) => number): Solid | null {
    const ue = Math.cos(b.angle), un = Math.sin(b.angle), L = b.length / 2, W = b.width / 2;
    const cornersW: [number, number][] = [[-L, -W], [L, -W], [L, W], [-L, W]].map(([a, c]) => [b.e + ue * a - un * c, b.n + un * a + ue * c]);
    const c4 = cornersW.map(([e, n]) => local(e, n)); if (c4.some(c => !c)) return null;
    const cs = c4 as [number, number][], cen = local(b.e, b.n)!;
    const gs = cs.map(([x, d]) => ground(x, d)), g0 = Math.min(...gs) - .8, g1 = Math.max(...gs);
    const r = hash(b.e, b.n), r2 = hash(b.n, b.e);
    const storey = b.kind === 3 ? 2.6 : b.kind === 2 || b.kind === 5 ? 3.4 : 2.8;
    const eave = g1 + b.floors * storey + (b.kind === 4 ? 4 : 0);
    // wall colours: lower and upper part
    let low: T.Color, up: T.Color, split: number;
    switch (b.kind) {
        case 0: low = STONE[Math.floor(r * 3)]; up = LARCH[Math.floor(r2 * 4)]; split = g1 + Math.min(storey, (eave - g1) * .45); break;
        case 1: low = PLASTER[Math.floor(r * 4)]; up = LARCH[Math.floor(r2 * 4)]; split = eave - storey; break;
        case 3: low = up = LARCH[Math.floor(r2 * 4)].clone().multiplyScalar(.8); split = eave; break;
        case 4: low = up = PLASTER[1]; split = eave; break;
        case 5: low = up = CONCRETE[Math.floor(r * 2)]; split = eave; break;
        default: low = up = (r < .5 ? PLASTER : CONCRETE)[Math.floor(r2 * 2)]; split = eave; break;
    }
    const P = (i: number, y: number) => v(cs[i][0], y, cs[i][1]);
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if (split > g0 + .1) B.quad(P(i, g0), P(j, g0), P(j, split), P(i, split), low);
        if (eave > split + .05) B.quad(P(i, split), P(j, split), P(j, eave), P(i, eave), up);
        // a row of windows per floor on the long sides (dark recessed band), for scale
        if ((i === 0 || i === 2) && b.kind !== 3 && b.length > 5) for (let f = 0; f < b.floors; f++) {
            const y0 = g1 + f * storey + 1.0, y1 = y0 + 1.2; if (y1 > eave - .3) break;
            const ax = cs[i][0], ad = cs[i][1], bx = cs[j][0], bd = cs[j][1], nx = (bd - ad), nd = -(bx - ax), nl = Math.hypot(nx, nd) || 1, o = .03;
            const ox = nx / nl * o, od = nd / nl * o, t0 = .14, t1 = .86;
            const pa = [ax + (bx - ax) * t0 + ox, ad + (bd - ad) * t0 + od], pb = [ax + (bx - ax) * t1 + ox, ad + (bd - ad) * t1 + od];
            B.quad(v(pa[0], y0, pa[1]), v(pb[0], y0, pb[1]), v(pb[0], y1, pb[1]), v(pa[0], y1, pa[1]), WINDOW);
        }
    }
    // gable roof along the long axis (corners 0-1 and 3-2 are the long sides), overhanging
    const pitch = b.kind === 2 || b.kind === 5 ? .2 : b.kind === 4 ? .75 : .47, o = b.kind === 3 ? .5 : .8;
    const ex = (cs[1][0] - cs[0][0]) / (2 * L), ed = (cs[1][1] - cs[0][1]) / (2 * L), wx = (cs[3][0] - cs[0][0]) / (2 * W), wd = (cs[3][1] - cs[0][1]) / (2 * W);
    const at = (a: number, c: number, y: number) => v(cen[0] + ex * a + wx * c, y, cen[1] + ed * a + wd * c);
    const ridge = eave + (W + o) * Math.tan(pitch), snow = .45, eo = eave - o * Math.tan(pitch);
    const A = L + o, Wo = W + o;
    // snow on both slopes (top), the timber underside, the snow edge (fascia) and the gable ends
    for (const s of [-1, 1]) {
        B.quad(at(-A, s * Wo, eo + snow), at(A, s * Wo, eo + snow), at(A, 0, ridge + snow), at(-A, 0, ridge + snow), SNOW);
        B.quad(at(A, s * Wo, eo), at(-A, s * Wo, eo), at(-A, 0, ridge), at(A, 0, ridge), SOFFIT);
        B.quad(at(-A, s * Wo, eo), at(A, s * Wo, eo), at(A, s * Wo, eo + snow), at(-A, s * Wo, eo + snow), SNOW);
    }
    for (const s of [-1, 1]) {
        B.tri(at(s * L, -W, eave), at(s * L, W, eave), at(s * L, 0, ridge - .1), up);
        B.quad(at(s * A, -Wo, eo), at(s * A, Wo, eo), at(s * A, Wo, eo + snow), at(s * A, -Wo, eo + snow), FASCIA);
        B.tri(at(s * A, -Wo, eo + snow), at(s * A, Wo, eo + snow), at(s * A, 0, ridge + snow), SNOW);
        B.tri(at(s * A, -Wo, eo), at(s * A, Wo, eo), at(s * A, 0, ridge), FASCIA);
    }
    // chimney on houses and blocks
    if ((b.kind === 0 || b.kind === 1) && b.length > 6) {
        const a = (r - .5) * L, c = W * .4, cw = .35, y0 = eave, y1 = ridge + snow + .9;
        const q = [[a - cw, c - cw], [a + cw, c - cw], [a + cw, c + cw], [a - cw, c + cw]];
        for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; B.quad(at(p[0], p[1], y0), at(n[0], n[1], y0), at(n[0], n[1], y1), at(p[0], p[1], y1), CHIMNEY); }
        B.quad(at(q[0][0], q[0][1], y1), at(q[1][0], q[1][1], y1), at(q[2][0], q[2][1], y1), at(q[3][0], q[3][1], y1), SNOW);
    }
    const hl = Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]) / 2, hw = Math.hypot(cs[3][0] - cs[0][0], cs[3][1] - cs[0][1]) / 2;
    return { x: cen[0], d: cen[1], r: Math.hypot(hl, hw) + 1, rd: Math.hypot(hl, hw) + 1, h: ridge - g1 + 1, ux: ex, ud: ed, hl, hw, kind: 'WALL STRIKE' };
}

/** Merged mesh of the given buildings in a local frame, plus their solid boxes. */
export function buildingMesh(list: Building[], local: Local, ground: (x: number, d: number) => number, opts: { shadows?: boolean; keep?: (x: number, d: number, b: Building) => boolean } = {}) {
    const B = new Builder(), solids: Solid[] = [];
    for (const b of list) {
        const c = local(b.e, b.n); if (!c || (opts.keep && !opts.keep(c[0], c[1], b))) continue;
        const s = addBuilding(B, b, local, ground); if (s) solids.push(s);
    }
    const mesh = new T.Mesh(B.geometry(), MATERIAL);
    mesh.name = 'buildings'; mesh.castShadow = !!opts.shadows; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    return { mesh, solids };
}
const MATERIAL = new T.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, side: T.DoubleSide });

/** Is (x, d) inside the solid box, below its top? */
export function insideSolid(o: Solid, x: number, d: number, above: number, pad = .35) {
    const dx = x - o.x, dd = d - o.d, a = dx * o.ux + dd * o.ud, c = -dx * o.ud + dd * o.ux;
    return Math.abs(a) < o.hl + pad && Math.abs(c) < o.hw + pad && above < o.h;
}
