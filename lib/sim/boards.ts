/**
 * Board and rider specifications for the physics core.
 *
 * CALIBRATION STATUS: dimensions are typical adult snowboard catalogue ranges
 * (length ~150-165 cm, waist ~24.5-27 cm, sidecut radius ~7-9.5 m, stance
 * ~52-60 cm) written from general knowledge. They were NOT measured from, or
 * checked against, specific products. Stiffness values are plausible estimates.
 * Lengths in metres, masses in kg, angles in radians.
 */
export type BoardCategory = 'freestyle-twin' | 'all-mountain' | 'directional-freeride' | 'powder' | 'park' | 'wide';
export type BoardSpec = {
    category: BoardCategory;
    name: string;
    length: number;
    waist: number;
    tipWidth: number;
    /** Sidecut radius of the edge arc (m). */
    sidecutRadius: number;
    /** Length of edge that contacts snow when the board is flat (m). */
    effectiveEdge: number;
    stanceWidth: number;
    /** Stance setback toward the tail (m). */
    setback: number;
    /** Camber lift at board centre (m) and radius of the tip/tail rise (m). */
    camber: number;
    tipRadius: number;
    /** Board mass without boots/bindings (kg). */
    mass: number;
    /** Longitudinal bending stiffness EI (N m^2) and torsional stiffness GJ (N m^2/rad). Reserved for the flex model. */
    flexEI: number;
    torsionGJ: number;
    /** Edge angle (rad) where the edge begins to bite, and where it is fully engaged. */
    biteStart: number;
    biteFull: number;
};
export const BOARDS: Record<BoardCategory, BoardSpec> = {
    'freestyle-twin': { category: 'freestyle-twin', name: 'Freestyle twin 154', length: 1.54, waist: .250, tipWidth: .298, sidecutRadius: 7.6, effectiveEdge: 1.14, stanceWidth: .55, setback: 0, camber: .006, tipRadius: .60, mass: 2.9, flexEI: 600, torsionGJ: 90, biteStart: .05, biteFull: .38 },
    'all-mountain': { category: 'all-mountain', name: 'All-mountain 157', length: 1.57, waist: .252, tipWidth: .303, sidecutRadius: 8.0, effectiveEdge: 1.18, stanceWidth: .57, setback: .01, camber: .007, tipRadius: .62, mass: 3.2, flexEI: 700, torsionGJ: 100, biteStart: .05, biteFull: .36 },
    'directional-freeride': { category: 'directional-freeride', name: 'Directional freeride 160', length: 1.60, waist: .254, tipWidth: .308, sidecutRadius: 8.6, effectiveEdge: 1.21, stanceWidth: .58, setback: .025, camber: .007, tipRadius: .66, mass: 3.3, flexEI: 780, torsionGJ: 110, biteStart: .05, biteFull: .34 },
    powder: { category: 'powder', name: 'Powder board 158', length: 1.58, waist: .262, tipWidth: .320, sidecutRadius: 8.8, effectiveEdge: 1.00, stanceWidth: .56, setback: .045, camber: .002, tipRadius: .75, mass: 3.3, flexEI: 540, torsionGJ: 80, biteStart: .06, biteFull: .42 },
    park: { category: 'park', name: 'Park 152', length: 1.52, waist: .250, tipWidth: .296, sidecutRadius: 7.2, effectiveEdge: 1.12, stanceWidth: .56, setback: 0, camber: .005, tipRadius: .58, mass: 2.9, flexEI: 520, torsionGJ: 80, biteStart: .05, biteFull: .40 },
    wide: { category: 'wide', name: 'Wide all-mountain 160W', length: 1.60, waist: .266, tipWidth: .318, sidecutRadius: 8.2, effectiveEdge: 1.20, stanceWidth: .58, setback: .01, camber: .007, tipRadius: .64, mass: 3.5, flexEI: 800, torsionGJ: 115, biteStart: .05, biteFull: .38 },
};
export type RiderSpec = {
    mass: number;
    /** Boots, bindings, lower-leg effective mass carried by the board body (kg). */
    gearMass: number;
    /** Rider COM distance above the foot plane along the leg: neutral, deepest crouch, fully extended (m). */
    heightNeutral: number; heightMin: number; heightMax: number;
    /** Height of the foot plane above the board base: binding + boot sole (m). */
    footHeight: number;
    /** Leg suspension: stiffness (N/m), damping (N s/m). */
    legK: number; legC: number;
    maxLegForce: number;      // N, compressive push
    maxLegPull: number;       // N, pulling the board up with strapped feet
    /** Ankle/hip authority for holding the COM laterally against the board frame (N m). */
    maxAnkleTorque: number;
    /** Aerodynamics: drag area (m^2) upright and tucked; air density at altitude (kg/m^3). */
    cdaUpright: number; cdaTuck: number;
    /** Whole-body inertia about the vertical axis (kg m^2): torso, legs and arms twisting against the board. Uncalibrated estimate. */
    yawInertia: number;
    airDensity: number;
};
export const DEFAULT_RIDER: RiderSpec = {
    mass: 75, gearMass: 8.5, heightNeutral: .74, heightMin: .48, heightMax: .90, footHeight: .06,
    legK: 1.4e4, legC: 1800, maxLegForce: 4200, maxLegPull: 500, maxAnkleTorque: 190,
    cdaUpright: .55, cdaTuck: .26, airDensity: .95, yawInertia: 2.6,
};
/** Half-width of the board outline at distance x from centre. Sidecut arc inside the effective edge, tip rounding beyond. */
export function halfWidth(spec: BoardSpec, x: number) {
    const L2 = spec.length / 2, E2 = spec.effectiveEdge / 2, ax = Math.abs(x);
    const arc = spec.waist / 2 + Math.min(ax, E2) ** 2 / (2 * spec.sidecutRadius);
    if (ax <= E2) return arc;
    const t = (ax - E2) / Math.max(1e-6, L2 - E2);
    return arc * (1 - .22 * t * t);
}
/** Height of the base above the contact plane at x (camber in the middle, rise of the tips). */
export function baseLift(spec: BoardSpec, x: number) {
    const E2 = spec.effectiveEdge / 2, ax = Math.abs(x);
    if (ax <= E2) return spec.camber * (1 - (ax / E2) ** 2);
    const d = ax - E2;
    return d * d / (2 * spec.tipRadius);
}
export type Station = { x: number; z: number; lift: number; area: number; dx: number; edge: -1 | 1 };
/** Contact stations along both edges. Each carries its share of planform area. */
export function makeStations(spec: BoardSpec, perEdge = 13): Station[] {
    const out: Station[] = [], L2 = spec.length / 2 - .02, dx = 2 * L2 / (perEdge - 1);
    for (const edge of [-1, 1] as const)
        for (let i = 0; i < perEdge; i++) {
            const x = -L2 + dx * i, w = halfWidth(spec, x);
            out.push({ x, z: edge * w, lift: baseLift(spec, x), area: dx * w, dx, edge });
        }
    return out;
}
