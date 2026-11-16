import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Shared toolkit for the hand-built models (lifts, stations, buildings): geometry helpers that give shaped, rounded,
 * bevelled parts instead of raw boxes; procedural textures (larch planks, stone, plaster, fabric, galvanised steel)
 * drawn once on a canvas; and the PBR materials that use them. Textures exist only in a browser; in Node (tests) the
 * materials have none, which changes nothing but the look.
 */
export const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

// ---- geometry ---------------------------------------------------------------------------------------------------------------
/** Every part gets position + normal + uv, non-indexed, so parts of one material merge into one draw call. */
export function clean(g: T.BufferGeometry) {
    let x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
    if (!x.attributes.normal) x.computeVertexNormals();
    if (!x.attributes.uv) x.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    if (x !== g) g.dispose();
    x.morphAttributes = {};
    x.clearGroups();
    return x;
}
/** Box-projected texture coordinates at a world scale: `tile` metres per texture repeat (walls, concrete, planks). */
export function worldUV(g: T.BufferGeometry, tile: number) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv as T.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (ay >= ax && ay >= az) uv.setXY(i, x / tile, z / tile); else if (ax >= az) uv.setXY(i, z / tile, y / tile); else uv.setXY(i, x / tile, y / tile);
    }
    uv.needsUpdate = true; return g;
}
/** Materials whose texture should be laid at a world scale (metres per repeat). */
const WORLD_TILE = new WeakMap<T.Material, number>();
export const tiled = <M extends T.Material>(m: M, metres: number) => { WORLD_TILE.set(m, metres); return m; };
/** Collects geometry per material; `build` merges each material's parts into one geometry. */
export class Builder {
    private bins = new Map<T.Material, T.BufferGeometry[]>();
    add(g: T.BufferGeometry, m: T.Material, matrix?: T.Matrix4) {
        const c = clean(g);
        const tile = WORLD_TILE.get(m); if (tile) worldUV(c, tile);      // in the part's own frame, before placing it
        if (matrix) c.applyMatrix4(matrix);
        (this.bins.get(m) ?? this.bins.set(m, []).get(m)!).push(c);
        return this;
    }
    has(m: T.Material) { return this.bins.has(m); }
    build(): { geometry: T.BufferGeometry; material: T.Material }[] {
        const out: { geometry: T.BufferGeometry; material: T.Material }[] = [];
        for (const [material, gs] of this.bins) {
            const geometry = gs.length === 1 ? gs[0] : mergeGeometries(gs, false)!;
            if (gs.length > 1) gs.forEach(g => g.dispose());
            geometry.computeBoundingSphere(); out.push({ geometry, material });
        }
        this.bins.clear();
        return out;
    }
    /** Merged meshes in a group (shadows on). */
    group(shadows = true) {
        const g = new T.Group();
        for (const p of this.build()) { const m = new T.Mesh(p.geometry, p.material); m.castShadow = shadows && !(p.material as T.MeshStandardMaterial).transparent; m.receiveShadow = true; g.add(m); }
        return g;
    }
}
const UP = new T.Vector3(0, 1, 0);
/** Round tube between two points. */
export function tube(a: T.Vector3, b: T.Vector3, r: number, seg = 10, r2 = r) {
    const g = new T.CylinderGeometry(r2, r, a.distanceTo(b), seg, 1, false);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    const m = a.clone().add(b).multiplyScalar(.5); g.translate(m.x, m.y, m.z); return g;
}
/** Tube bent smoothly through the given points (hangers, bars, handrails). */
export function bend(points: T.Vector3[], r: number, radial = 8, tension = .35) {
    const curve = new T.CatmullRomCurve3(points, false, 'centripetal', tension);
    const len = curve.getLength();
    return new T.TubeGeometry(curve, Math.max(6, Math.ceil(len / .11)), r, radial, false);
}
/** Box with rounded edges, centred at (x, y, z). */
export function rbox(w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0, seg = 1) {
    const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)); g.translate(x, y, z); return g;
}
export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
/** Wheel (sheave, roller) with its axle along x. */
export function wheel(r: number, w: number, x: number, y: number, z: number, seg = 14) {
    const g = new T.CylinderGeometry(r, r, w, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g;
}

/** Rounded-rectangle outline (x across, z along), counter-clockwise from above, `n` points. */
export function roundedRect(w: number, d: number, r: number, n = 40): [number, number][] {
    const pts: [number, number][] = [], q = Math.max(2, Math.round(n / 4));
    const corners: [number, number, number][] = [[w / 2 - r, d / 2 - r, 0], [-(w / 2 - r), d / 2 - r, Math.PI / 2], [-(w / 2 - r), -(d / 2 - r), Math.PI], [w / 2 - r, -(d / 2 - r), Math.PI * 1.5]];
    for (const [cx, cz, a0] of corners) for (let i = 0; i <= q; i++) { const a = a0 + i / q * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return pts;
}
export type Ring = { y: number; sx: number; sz: number; dx?: number; dz?: number };
/**
 * Surface through rings of the same outline at several heights and scales (cabin shells, station hoods, domes).
 * `pick(i)` can send each outline segment to `alt` instead (window pillars between glass panes). Optional caps.
 */
export function loft(outline: [number, number][], rings: Ring[], opts: { pick?: (seg: number, mid: [number, number]) => boolean; capBottom?: boolean; capTop?: boolean } = {}) {
    const main: number[] = [], alt: number[] = [], uvMain: number[] = [], uvAlt: number[] = [];
    const n = outline.length, P = (ring: Ring, i: number) => { const [x, z] = outline[i % n]; return V(x * ring.sx + (ring.dx ?? 0), ring.y, z * ring.sz + (ring.dz ?? 0)); };
    const per: number[] = [0]; for (let i = 1; i <= n; i++) per.push(per[i - 1] + Math.hypot(outline[i % n][0] - outline[i - 1][0], outline[i % n][1] - outline[i - 1][1]));
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
        const a = P(rings[r], i), b = P(rings[r], i + 1), c = P(rings[r + 1], i + 1), d = P(rings[r + 1], i);
        const mid: [number, number] = [(outline[i][0] + outline[(i + 1) % n][0]) / 2, (outline[i][1] + outline[(i + 1) % n][1]) / 2];
        const toAlt = opts.pick?.(i, mid) ?? false, pos = toAlt ? alt : main, uv = toAlt ? uvAlt : uvMain;
        // wind each quad so its face points away from the ring's axis
        const nrm = d.clone().sub(a).cross(c.clone().sub(a)), cx = (rings[r].dx ?? 0), cz = (rings[r].dz ?? 0);
        const out = (a.x + b.x + c.x + d.x) / 4 - cx, oz = (a.z + b.z + c.z + d.z) / 4 - cz, flip = nrm.x * out + nrm.z * oz < 0;
        const u0 = per[i], u1 = per[i + 1], v0 = rings[r].y, v1 = rings[r + 1].y;
        if (!flip) { for (const p of [a, d, c, a, c, b]) pos.push(p.x, p.y, p.z); uv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0); }
        else { for (const p of [a, c, d, a, b, c]) pos.push(p.x, p.y, p.z); uv.push(u0, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1); }
    }
    const cap = (ring: Ring, up: boolean) => {
        const c = V(ring.dx ?? 0, ring.y, ring.dz ?? 0);
        for (let i = 0; i < n; i++) {
            const a = P(ring, i), b = P(ring, i + 1), ny = a.clone().sub(c).cross(b.clone().sub(c)).y;
            for (const p of (ny > 0) === up ? [c, a, b] : [c, b, a]) main.push(p.x, p.y, p.z); uvMain.push(0, 0, 1, 0, 0, 1);
        }
    };
    if (opts.capBottom) cap(rings[0], false);
    if (opts.capTop) cap(rings[rings.length - 1], true);
    const geo = (p: number[], uv: number[]) => { if (!p.length) return null; const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; };
    return { main: geo(main, uvMain)!, alt: geo(alt, uvAlt) };
}
/** Smooth the normals of a lofted shell (shared positions get averaged normals) so curved panels shade softly. */
export function smoothNormals(g: T.BufferGeometry) {
    const p = g.attributes.position, n = g.attributes.normal, key = (i: number) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    const acc = new Map<string, T.Vector3>();
    for (let i = 0; i < p.count; i++) { const k = key(i); (acc.get(k) ?? acc.set(k, new T.Vector3()).get(k)!).add(V(n.getX(i), n.getY(i), n.getZ(i))); }
    for (let i = 0; i < p.count; i++) { const v = acc.get(key(i))!.clone().normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    n.needsUpdate = true; return g;
}

// ---- procedural textures (browser only) -----------------------------------------------------------------------------------------
const hasDom = typeof document !== 'undefined';
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number, r: () => number) => void, seed: number, repeat = true) {
    if (!hasDom) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const ctx = cv.getContext('2d'); if (!ctx) return null;
    draw(ctx, size, rng(seed));
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
}
const cache = new Map<string, T.Texture | null>();
const once = (k: string, f: () => T.Texture | null) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k)!; };
const shade = (hex: string, f: number) => { const n = parseInt(hex.slice(1), 16); const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };
/** Weathered larch planks, horizontal; one texture tile = 2 m x 2 m (10 planks). */
export const woodTexture = (tone = '#7a5233', seed = 3) => once(`wood${tone}${seed}`, () => canvasTexture(512, (c, s, r) => {
    const planks = 10, h = s / planks;
    for (let i = 0; i < planks; i++) {
        const f = .78 + r() * .32; c.fillStyle = shade(tone, f); c.fillRect(0, i * h, s, h);
        // grain: long thin streaks, a few knots
        for (let k = 0; k < 26; k++) { c.strokeStyle = `rgba(30,18,10,${.05 + r() * .12})`; c.lineWidth = .6 + r() * 1.4; const y = i * h + r() * h; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s * .3, y + (r() - .5) * 6, s * .7, y + (r() - .5) * 6, s, y + (r() - .5) * 4); c.stroke(); }
        for (let k = 0; k < 2; k++) { if (r() < .5) continue; c.fillStyle = 'rgba(40,22,12,.45)'; c.beginPath(); c.ellipse(r() * s, i * h + h * (.3 + r() * .4), 3 + r() * 4, 2 + r() * 2, 0, 0, Math.PI * 2); c.fill(); }
        // sun-bleached top edge, dark joint below
        c.fillStyle = 'rgba(255,240,220,.08)'; c.fillRect(0, i * h + 1, s, 3);
        c.fillStyle = 'rgba(15,8,4,.75)'; c.fillRect(0, (i + 1) * h - 2.5, s, 2.5);
        // butt joints
        for (let x = r() * s * .5; x < s; x += s * (.35 + r() * .4)) { c.fillStyle = 'rgba(15,8,4,.6)'; c.fillRect(x, i * h, 2, h); }
    }
}, seed));
/** Rubble stone masonry (chalet ground floors), one tile = 2 m x 2 m. */
export const stoneTexture = () => once('stone', () => canvasTexture(512, (c, s, r) => {
    c.fillStyle = '#5d5850'; c.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
        const rowH = 26 + r() * 30; let x = -r() * 40;
        while (x < s) {
            const w = 34 + r() * 60, g = 105 + r() * 55, tint = r() * 22, warm = r() < .35 ? 14 : 0;
            c.fillStyle = `rgb(${g + tint + warm},${g + tint * .6 + warm * .5},${g - tint * .3})`;
            c.beginPath(); c.roundRect(x + 2, y + 2, w - 4, rowH - 4, 6 + r() * 8); c.fill();
            c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.roundRect(x + 4, y + 3, w - 10, (rowH - 6) * .45, 5); c.fill();
            c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(x + 3, y + rowH - 6, w - 6, 3);
            x += w;
        }
        y += rowH;
    }
}, 11));
/** Lime plaster with slight mottling; one tile = 4 m. */
export const plasterTexture = () => once('plaster', () => canvasTexture(256, (c, s, r) => {
    c.fillStyle = '#e9e3d6'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${r() < .5 ? '120,110,95' : '255,255,250'},${.03 + r() * .05})`; c.beginPath(); c.arc(r() * s, r() * s, 1 + r() * 6, 0, Math.PI * 2); c.fill(); }
}, 5));
/** Woven seat fabric. */
export const fabricTexture = () => once('fabric', () => canvasTexture(128, (c, s, r) => {
    c.fillStyle = '#2a3e57'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) { c.fillStyle = `rgba(0,0,0,${.12 + r() * .06})`; c.fillRect(i, 0, 2, s); c.fillStyle = `rgba(255,255,255,${.03 + r() * .03})`; c.fillRect(0, i, s, 1.5); }
}, 7));
/** Hot-dip galvanised steel: mottled grey (spangle). */
export const galvTexture = () => once('galv', () => canvasTexture(256, (c, s, r) => {
    c.fillStyle = '#9aa1a6'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) { const g = 130 + r() * 70; c.fillStyle = `rgba(${g},${g + 4},${g + 8},.35)`; c.beginPath(); c.moveTo(r() * s, r() * s); for (let k = 0; k < 5; k++) c.lineTo(r() * s, r() * s); c.fill(); }
}, 13));
/** Concrete with formwork lines. */
export const concreteTexture = () => once('concrete', () => canvasTexture(256, (c, s, r) => {
    c.fillStyle = '#b4b2ac'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1200; i++) { c.fillStyle = `rgba(${r() < .5 ? '80,80,78' : '230,230,225'},${.04 + r() * .06})`; c.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3); }
    for (let y = 0; y < s; y += s / 4) { c.fillStyle = 'rgba(70,70,68,.25)'; c.fillRect(0, y, s, 1.5); }
}, 17));

// ---- materials ------------------------------------------------------------------------------------------------------------------
const std = (o: T.MeshStandardMaterialParameters) => new T.MeshStandardMaterial(o);
const phys = (o: T.MeshPhysicalMaterialParameters) => new T.MeshPhysicalMaterial(o);
export const M = {
    galv: tiled(std({ color: 0xc6ccd0, map: galvTexture(), metalness: .62, roughness: .42 }), 1.5),
    paint: std({ color: 0x3d444b, metalness: .55, roughness: .38 }),            // painted steel (chair frames, station frames)
    chrome: std({ color: 0xd9dee2, metalness: .9, roughness: .18 }),
    rubber: std({ color: 0x17191b, roughness: .92 }),
    fabric: std({ color: 0xffffff, map: fabricTexture(), roughness: .92 }),
    cabin: phys({ color: 0xe8ebee, metalness: .3, roughness: .3, clearcoat: 1, clearcoatRoughness: .12 }),   // pearl white shell
    trim: phys({ color: 0x2c3238, metalness: .5, roughness: .35, clearcoat: .6, clearcoatRoughness: .2 }),   // graphite
    glass: phys({ color: 0x223441, metalness: .1, roughness: .04, transparent: true, opacity: .42, envMapIntensity: 1.6, depthWrite: false }),
    bubble: phys({ color: 0x3a5f80, metalness: 0, roughness: .06, transparent: true, opacity: .32, envMapIntensity: 1.4, depthWrite: false, side: T.DoubleSide }),
    interior: std({ color: 0x3a4148, roughness: .8 }),
    concrete: tiled(std({ color: 0xffffff, map: concreteTexture(), roughness: .9 }), 3),
    larch: tiled(std({ color: 0xffffff, map: woodTexture('#6b4528', 21), roughness: .85 }), 2),
    snow: std({ color: 0xf7fafe, roughness: .86 }),
    rope: std({ color: 0x3b3f42, metalness: .7, roughness: .45 }),
    grate: std({ color: 0x5a6168, metalness: .6, roughness: .5 }),
    signal: std({ color: 0xd8b13a, roughness: .6 }),                               // yellow safety paint
};
