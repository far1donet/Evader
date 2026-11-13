import { lerp } from './math3.ts';

/**
 * Snow mechanics parameters in SI units. These are TUNABLE ENGINEERING ESTIMATES
 * chosen to produce plausible riding behaviour (kinetic friction ~0.03-0.15,
 * soft-snow bearing, edge hold up to roughly 55-60 degrees lean on groomed snow).
 * They are NOT measured values and have NOT been calibrated against instrumented riding data.
 */
export type SnowMaterial = {
    id: string;
    name: string;
    /** Kinetic friction coefficient of the base sliding along its length. */
    muLong: number;
    /** Kinetic friction of a FLAT base sliding sideways (edges not engaged). */
    muLatFlat: number;
    /** Edge-hold friction angle (degrees): peak lateral/normal force ratio of a fully engaged edge is tan(phi). */
    phiDeg: number;
    /** Bearing stiffness, Pa per metre of penetration (normal support). */
    bearing: number;
    /** Penetration depth (m) at which support stiffens (snow densifies). */
    yieldDepth: number;
    /** Normal damping on compression, Pa*s/m (rebound uses a fraction: energy lost to compaction). */
    compDamp: number;
    /** Effective density for momentum-transfer plowing (kg/m^3). */
    plowDensity: number;
    /** Surface roughness amplitude (m): chatter on hard surfaces. */
    roughness: number;
    /** 0..1 how readily the edge bites. */
    edgeBite: number;
    spray: number;
    trackPersistence: number;
};
const M = (m: SnowMaterial) => m;
export const SNOW: Record<string, SnowMaterial> = {
    freshPowder: M({ id: 'freshPowder', name: 'Fresh dry powder', muLong: .075, muLatFlat: .16, phiDeg: 36, bearing: 5e4, yieldDepth: .22, compDamp: 4e4, plowDensity: 70, roughness: 0, edgeBite: .55, spray: 1, trackPersistence: .55 }),
    settledPowder: M({ id: 'settledPowder', name: 'Settled powder', muLong: .065, muLatFlat: .14, phiDeg: 42, bearing: 2e5, yieldDepth: .12, compDamp: 6e4, plowDensity: 150, roughness: 0, edgeBite: .7, spray: .7, trackPersistence: .65 }),
    windPacked: M({ id: 'windPacked', name: 'Wind-packed snow', muLong: .055, muLatFlat: .12, phiDeg: 50, bearing: 6e5, yieldDepth: .05, compDamp: 1.2e5, plowDensity: 250, roughness: .004, edgeBite: .8, spray: .35, trackPersistence: .45 }),
    groomed: M({ id: 'groomed', name: 'Groomed snow', muLong: .045, muLatFlat: .10, phiDeg: 58, bearing: 8e5, yieldDepth: .03, compDamp: 1.5e5, plowDensity: 300, roughness: .002, edgeBite: .9, spray: .3, trackPersistence: .5 }),
    hardpack: M({ id: 'hardpack', name: 'Hardpack', muLong: .04, muLatFlat: .09, phiDeg: 55, bearing: 2e6, yieldDepth: .012, compDamp: 2.5e5, plowDensity: 400, roughness: .006, edgeBite: .9, spray: .2, trackPersistence: .3 }),
    icy: M({ id: 'icy', name: 'Icy snow', muLong: .03, muLatFlat: .06, phiDeg: 33, bearing: 3e6, yieldDepth: .004, compDamp: 3e5, plowDensity: 500, roughness: .004, edgeBite: .7, spray: .1, trackPersistence: .1 }),
    wet: M({ id: 'wet', name: 'Wet snow', muLong: .09, muLatFlat: .18, phiDeg: 45, bearing: 3e5, yieldDepth: .06, compDamp: 1.5e5, plowDensity: 400, roughness: .002, edgeBite: .8, spray: .45, trackPersistence: .7 }),
    slush: M({ id: 'slush', name: 'Spring slush', muLong: .14, muLatFlat: .26, phiDeg: 38, bearing: 1.5e5, yieldDepth: .09, compDamp: 1.2e5, plowDensity: 600, roughness: .003, edgeBite: .6, spray: .6, trackPersistence: .75 }),
    crust: M({ id: 'crust', name: 'Breakable crust', muLong: .065, muLatFlat: .14, phiDeg: 48, bearing: 5e5, yieldDepth: .035, compDamp: 2e5, plowDensity: 350, roughness: .008, edgeBite: .75, spray: .25, trackPersistence: .6 }),
    parkTakeoff: M({ id: 'parkTakeoff', name: 'Compacted park takeoff', muLong: .045, muLatFlat: .10, phiDeg: 58, bearing: 1.6e6, yieldDepth: .015, compDamp: 2.2e5, plowDensity: 350, roughness: .001, edgeBite: .9, spray: .15, trackPersistence: .2 }),
    parkLanding: M({ id: 'parkLanding', name: 'Groomed park landing', muLong: .05, muLatFlat: .10, phiDeg: 55, bearing: 6e5, yieldDepth: .05, compDamp: 1.8e5, plowDensity: 300, roughness: .001, edgeBite: .9, spray: .3, trackPersistence: .4 }),
};
export const SNOW_IDS = Object.keys(SNOW);

/** Blend two materials (groomed -> powder transitions). Stiffness/damping blend geometrically. */
export function blendSnow(a: SnowMaterial, b: SnowMaterial, t: number, out: SnowMaterial = { ...a }): SnowMaterial {
    const k: (keyof SnowMaterial)[] = ['muLong', 'muLatFlat', 'phiDeg', 'yieldDepth', 'plowDensity', 'roughness', 'edgeBite', 'spray', 'trackPersistence'];
    for (const key of k) (out as any)[key] = lerp(a[key] as number, b[key] as number, t);
    out.bearing = Math.exp(lerp(Math.log(a.bearing), Math.log(b.bearing), t));
    out.compDamp = Math.exp(lerp(Math.log(a.compDamp), Math.log(b.compDamp), t));
    out.id = t < .5 ? a.id : b.id; out.name = t < .5 ? a.name : b.name;
    return out;
}
