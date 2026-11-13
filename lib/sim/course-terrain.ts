import { SNOW, blendSnow, type SnowMaterial } from './snow.ts';
import { smoothstep } from './math3.ts';
import type { ContactSample, SimTerrain } from './terrain.ts';

/**
 * Adapter that exposes an EVADER course to the physics core.
 *
 * Coordinates: the game describes a point by lateral offset `x` and course distance `d`; the simulation uses world
 * x/z with z = -d (the course runs toward -Z). Heights are the same function the renderer samples, so the rendered
 * terrain and the physics surface agree up to the render mesh resolution (see docs/KNOWN_ISSUES.md).
 *
 * Snow material is chosen from the course's own snow-depth field (groomed piste -> settled -> fresh powder), the
 * kicker zones (compacted takeoff, groomed landing), wind-exposed hardpack bands, and the weather.
 * Rails and boxes are solid contact surfaces with their own low-friction material: the board is never attached to them.
 */
export type CourseFunctions = {
    height(x: number, d: number): number;
    snowDepth(x: number, d: number): number;
    center(d: number): number;
    /** 0 outside a kicker, 1 on the takeoff ramp, 2 on the landing / knuckle. */
    parkZone(x: number, d: number): 0 | 1 | 2;
};
export type SimRail = { x: number; d: number; end: number; width: number; top: number; slope: number; round: boolean };

/** Plastic / steel park-feature surface: low sliding friction and almost no edge hold. Estimates, uncalibrated. */
export const RAIL_SURFACE: SnowMaterial = {
    id: 'rail', name: 'Park rail / box', muLong: .11, muLatFlat: .13, phiDeg: 14, bearing: 3e6, yieldDepth: .004, compDamp: 3e5,
    plowDensity: 0, roughness: 0, edgeBite: .15, spray: 0, trackPersistence: 0,
};

export class CourseTerrain implements SimTerrain {
    private fn: CourseFunctions;
    rails: SimRail[] = [];
    /** Extra fresh snow from the weather (0..1), raises the powder share everywhere off-piste. */
    freshSnow = 0;
    private scratchA: SnowMaterial = { ...SNOW.groomed };
    private scratchB: SnowMaterial = { ...SNOW.groomed };
    /** Number of terrain evaluations, for the performance dashboard. */
    evaluations = 0;
    constructor(fn: CourseFunctions) { this.fn = fn; }

    height(x: number, z: number) {
        this.evaluations++;
        return this.fn.height(x, -z);
    }

    material(x: number, z: number): SnowMaterial {
        const d = -z, f = this.fn;
        const zone = f.parkZone(x, d);
        if (zone === 1) return SNOW.parkTakeoff;
        if (zone === 2) return SNOW.parkLanding;
        const depth = f.snowDepth(x, d) + this.freshSnow * .12;
        // Wind-scoured bands on the open piste are firmer (hardpack), deterministic so replays agree.
        const off = Math.abs(x - f.center(d));
        const scour = off < 18 ? smoothstep(Math.sin(d * .021 + x * .05) * Math.cos(d * .0067), .72, .9) * (1 - this.freshSnow) : 0;
        if (depth < .05) return scour > .01 ? blendSnow(SNOW.groomed, SNOW.hardpack, scour, this.scratchA) : SNOW.groomed;
        if (depth < .16) return blendSnow(SNOW.groomed, SNOW.settledPowder, smoothstep(depth, .05, .16), this.scratchA);
        return blendSnow(SNOW.settledPowder, SNOW.freshPowder, smoothstep(depth, .16, .38), this.scratchB);
    }

    /** Rail whose deck footprint contains (x, d), or undefined. */
    railAt(x: number, d: number): SimRail | undefined {
        for (const r of this.rails) if (d >= r.d && d <= r.end && Math.abs(x - r.x) <= r.width / 2) return r;
        return undefined;
    }
    railTop(r: SimRail, x: number, d: number) {
        const flat = r.top + (d - r.d) * r.slope;
        if (!r.round) return flat;
        const h = r.width / 2, u = Math.min(1, Math.abs(x - r.x) / h);
        return flat - h * (1 - Math.sqrt(1 - u * u));
    }

    /**
     * One-call contact query used by the simulation: surface height, normal and material at (x, z) for a point at
     * height y. A rail deck counts as the surface only for points at or above its top (minus a small capture band);
     * points below are under the deck and see the snow. Forward differences: three height evaluations.
     */
    contact(x: number, z: number, y: number, out: ContactSample): ContactSample {
        const d = -z;
        const rail = this.rails.length ? this.railAt(x, d) : undefined;
        if (rail) {
            const top = this.railTop(rail, x, d);
            if (y > top - .06) {
                out.h = top;
                // Deck normal: along-course grade, plus the crown of a round rail.
                const dzdx = rail.round ? (this.railTop(rail, x + .01, d) - this.railTop(rail, x - .01, d)) / .02 : 0;
                const dydz = -rail.slope; // height change per +z (z = -d)
                const l = Math.hypot(dzdx, 1, dydz);
                out.nx = -dzdx / l; out.ny = 1 / l; out.nz = -dydz / l;
                out.mat = RAIL_SURFACE; out.rail = true;
                return out;
            }
        }
        const e = .06;
        const h = this.height(x, z);
        out.h = h; out.rail = false;
        if (y > h) return out; // not in contact: the caller does not use the normal or material
        const hx = this.height(x + e, z), hz = this.height(x, z + e);
        const dx = (hx - h) / e, dz = (hz - h) / e, l = Math.hypot(dx, 1, dz);
        out.nx = -dx / l; out.ny = 1 / l; out.nz = -dz / l;
        out.mat = this.material(x, z); out.rail = false;
        return out;
    }
}
