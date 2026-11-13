import { type V3, smoothstep } from './math3.ts';
import { SNOW, blendSnow, type SnowMaterial } from './snow.ts';

/** World convention: +Y up. The course runs toward -Z (course distance d = -z); x is lateral. */
export interface SimTerrain {
    height(x: number, z: number): number;
    /** Snow material at a point; may return a shared scratch object (copy if you keep it). */
    material(x: number, z: number): SnowMaterial;
}
const EPS = .08;
export function terrainNormal(t: SimTerrain, x: number, z: number, out: V3): V3 {
    const dx = (t.height(x + EPS, z) - t.height(x - EPS, z)) / (2 * EPS);
    const dz = (t.height(x, z + EPS) - t.height(x, z - EPS)) / (2 * EPS);
    const l = Math.hypot(dx, 1, dz);
    out.x = -dx / l; out.y = 1 / l; out.z = -dz / l; return out;
}
/** Constant-slope plane for validation. angle > 0 descends toward -Z. */
export class PlaneTerrain implements SimTerrain {
    slope: number; angleRad: number; mat: SnowMaterial; h0: number;
    constructor(angleRad: number, mat: SnowMaterial = SNOW.groomed, h0 = 0) { this.angleRad = angleRad; this.mat = mat; this.h0 = h0; this.slope = Math.tan(angleRad); }
    height(_x: number, z: number) { return this.h0 + z * this.slope; }
    material() { return this.mat; }
}
/** Adapter around plain functions (exposes the course heightfield to the simulation). */
export class FnTerrain implements SimTerrain {
    private scratch: SnowMaterial = { ...SNOW.groomed };
    private h: (x: number, z: number) => number; private powder: (x: number, z: number) => number;
    private base: SnowMaterial; private deep: SnowMaterial;
    constructor(h: (x: number, z: number) => number, powder: (x: number, z: number) => number,
        base: SnowMaterial = SNOW.groomed, deep: SnowMaterial = SNOW.freshPowder) { this.h = h; this.powder = powder; this.base = base; this.deep = deep; }
    height(x: number, z: number) { return this.h(x, z); }
    material(x: number, z: number) {
        const p = smoothstep(this.powder(x, z), 0, 1);
        return p < .002 ? this.base : p > .998 ? this.deep : blendSnow(this.base, this.deep, p, this.scratch);
    }
}
