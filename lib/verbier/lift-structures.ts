import * as T from 'three';
import { Builder, M, V, bend, box, loft, rbox, roundedRect, smoothNormals, tube, wheel } from './craft.ts';
import type { LiftKind } from './lift-profile.ts';

/**
 * Lift towers and stations (generic designs with typical proportions, no manufacturer's model or branding).
 * Coordinates: local frame of the structure, +y up, the rope runs along z (travel toward -z), uphill track at +x.
 *
 * Tower: concrete footing, tapered galvanised column, ladder, crossarm with diagonal braces and a catwalk, and at each
 * end a sheave train (rubber-lined wheels on a rocking beam) carrying the rope at y = 0 (the cable height).
 * Station: concrete platform, steel columns, the terminal hood over the bullwheel with its rails, the bullwheel itself,
 * glazed walls for gondolas, loading lane railings, a small operator cabin, and the drive / machine house.
 * `detail: 'low'` gives the same silhouettes with a fraction of the parts, for towers seen from far away.
 */
export function towerParts(b: Builder, kind: LiftKind, height: number, gauge: number, detail: 'high' | 'low', at: T.Matrix4) {
    const half = gauge / 2, put = (g: T.BufferGeometry, m: T.Material) => b.add(g, m, at);
    if (kind === 'surface') {
        put(box(.7, .5, .7, 0, -height - .05, 0), M.concrete);
        put(tube(V(0, -height, 0), V(0, .25, 0), .13, detail === 'high' ? 10 : 6, .1), M.galv);
        put(rbox(.18, .16, 1.4, .04, half * .4, .2, 0), M.paint);
        if (detail === 'high') for (const z of [-.4, 0, .4]) put(wheel(.12, .06, half * .4 + .1, .08, z, 12), M.rubber);
        return;
    }
    const big = kind === 'cablecar', rBase = big ? 1.1 : kind === 'chair' ? .36 : .44, rTop = big ? .7 : rBase * .72;
    const head = big ? 1.6 : .9;                                   // crossarm sits this far above the rope
    // footing and column
    const arm = gauge + (big ? 3 : 1.7);
    if (detail === 'low') {
        put(box(rBase * 4.4, 1.2, rBase * 4.4, 0, -height - .35, 0), M.concrete);
        put(new T.CylinderGeometry(rTop, rBase, height + head - .2, 7, 1, true).translate(0, (-height + .3 + head) / 2 - .05, 0), M.galv);
        put(box(arm, big ? .7 : .42, big ? .9 : .46, 0, head, 0), M.galv);
        for (const s of [-1, 1]) put(box(.3, .3, big ? 3.4 : 2.2, s * half, .15, 0), M.paint);
        return;
    }
    put(rbox(rBase * 4.4, 1.2, rBase * 4.4, .08, 0, -height - .35, 0, 1), M.concrete);
    put(new T.CylinderGeometry(rBase * 1.9, rBase * 1.9, .08, 16).translate(0, -height + .26, 0), M.galv);
    put(new T.CylinderGeometry(rTop, rBase, height + head - .2, 18).translate(0, (-height + .3 + head) / 2 - .05, 0), M.galv);
    put(rbox(arm, big ? .7 : .42, big ? .9 : .46, .06, 0, head, 0, 1), M.galv);                              // crossarm, box section
    for (const s of [-1, 1]) put(tube(V(0, head - 2.2, 0), V(s * arm * .38, head - .18, 0), .07, 8), M.galv);   // braces
    // ladder up the column (on the -z face) and a catwalk with railing along the crossarm
    const ladderZ = -rBase - .12, top = head - .3;
    for (const s of [-1, 1]) put(tube(V(s * .2, -height + 1.2, ladderZ), V(s * .2, top, -rTop - .12), .022, 6), M.galv);
    for (let y = -height + 1.5; y < top; y += .32) { const t = (y + height) / (top + height), z = ladderZ + (rBase - rTop) * t; put(box(.4, .025, .025, 0, y, z), M.galv); }
    put(box(arm * .92, .05, .6, 0, head - .28, -.62), M.grate);
    put(tube(V(-arm * .46, head + .75, -.9), V(arm * .46, head + .75, -.9), .025, 6), M.galv);
    for (let k = 0; k <= 4; k++) { const x = -arm * .46 + k * arm * .23; put(tube(V(x, head - .26, -.9), V(x, head + .75, -.9), .02, 5), M.galv); }
    // sheave trains: a rocking beam under each end of the crossarm, wheels carrying the rope on top
    const nWheels = big ? 6 : kind === 'chair' ? 6 : 8, r = big ? .32 : .2, span = (nWheels - 1) * r * 2.25;
    for (const s of [-1, 1]) {
        const x = s * half;
        put(tube(V(x, head - .2, 0), V(x, .55, 0), .07, 8), M.galv);                               // hanger from the arm
        put(rbox(.16, .22, span + r * 2, .05, x - s * .17, -r * .2, 0), M.paint);                  // rocking beam (outboard side plate)
        put(rbox(.16, .22, span + r * 2, .05, x + s * .17, -r * .2, 0), M.paint);
        for (let k = 0; k < nWheels; k++) {
            const z = -span / 2 + k * span / (nWheels - 1);
            put(wheel(r * 1.02, .09, x, -r, z, 12), M.rubber);                                     // rubber-lined sheave
            put(wheel(r * .45, .14, x, -r, z, 8), M.galv);                                          // hub
        }
        put(box(.03, .1, span * .3, x + s * .27, -.05, 0), M.signal);                               // rope catcher
    }
}

/** A station (terminal) in its local frame: rope at y = 0 at the bullwheel, line leaving toward +z (downhill side) for
 * the bottom station; the caller mirrors it for the top. `ground` is the platform height relative to the rope. */
export function stationParts(b: Builder, kind: LiftKind, gauge: number, ground: number, at: T.Matrix4) {
    const half = gauge / 2, put = (g: T.BufferGeometry, m: T.Material) => b.add(g, m, at);
    if (kind === 'surface') {
        put(rbox(3.2, .5, 4, .1, 0, ground + .1, -1), M.concrete);
        put(tube(V(0, ground, -1.5), V(0, .6, -1.5), .2, 12, .16), M.galv);
        put(wheel(gauge / 2, .18, 0, .3, -1.5, 24).rotateZ(0), M.paint);
        const hut = roundedRect(2.8, 2.6, .12, 12);
        put(loft(hut, [{ y: ground, sx: 1, sz: 1, dx: -4.2, dz: -1 }, { y: ground + 2.5, sx: 1, sz: 1, dx: -4.2, dz: -1 }]).main, M.concrete);
        put(rbox(3.4, .28, 3.2, .1, -4.2, ground + 2.62, -1), M.snow);
        put(box(1.1, .7, .04, -4.2 + 1.41, ground + 1.5, -1), M.glass);
        return;
    }
    const big = kind === 'cablecar', glazed = kind === 'gondola' || kind === 'mixed' || big;
    const len = big ? 18 : 22, wid = gauge + (big ? 8 : 4), z0 = -6, zc = z0 + len / 2 - 4;   // hood spans from behind the bullwheel to the exit
    // platform and the loading lane (rubber mats), with railings along it
    put(rbox(wid + 3, 2.6, len + 6, .15, 0, ground - 1.25, zc + 2), M.concrete);                     // slab, top flush with the snow
    put(box(gauge + 1.4, .03, len * .7, 0, ground + .01, zc + 1), M.rubber);
    for (const s of [-1, 1]) {
        put(tube(V(s * (half + .9), ground + 1.05, zc - len * .3), V(s * (half + .9), ground + 1.05, zc + len * .45), .03, 6), M.galv);
        for (let k = 0; k <= 6; k++) put(tube(V(s * (half + .9), ground, zc - len * .3 + k * len * .125), V(s * (half + .9), ground + 1.05, zc - len * .3 + k * len * .125), .025, 6), M.galv);
    }
    // columns and the terminal hood: a long shell with rounded ends over the rope loop
    const hoodBase = big ? 2.4 : .55, hoodTop = hoodBase + (big ? 2.6 : 2.1);
    for (const s of [-1, 1]) for (const k of [0, 1, 2, 3]) put(rbox(.34, hoodBase + .1 - ground, .34, .06, s * (wid / 2 - .55), (hoodBase + .1 + ground) / 2, zc - len / 2 + 2.5 + k * (len - 5) / 3), M.paint);
    const plan = roundedRect(wid, len, Math.min(wid / 2 - .2, 3.2), 56);
    const hood = loft(plan, [{ y: hoodBase, sx: 1, sz: 1, dz: zc }, { y: hoodBase + .25, sx: 1.02, sz: 1.01, dz: zc }, { y: hoodTop - .5, sx: 1, sz: 1, dz: zc }, { y: hoodTop - .15, sx: .96, sz: .985, dz: zc }, { y: hoodTop, sx: .9, sz: .96, dz: zc }], { capTop: true, capBottom: true });
    put(smoothNormals(hood.main), M.cabin);
    put(loft(plan, [{ y: hoodBase - .02, sx: .97, sz: .985, dz: zc }, { y: hoodBase - .01, sx: .97, sz: .985, dz: zc }], { capBottom: true }).main, M.paint);   // dark underside
    put(smoothNormals(loft(plan, [{ y: hoodBase + .28, sx: 1.025, sz: 1.012, dz: zc }, { y: hoodBase + .55, sx: 1.025, sz: 1.012, dz: zc }]).main), M.trim);   // dark band
    put(loft(plan, [{ y: hoodTop + .02, sx: .88, sz: .95, dz: zc }, { y: hoodTop + .38, sx: .8, sz: .9, dz: zc }], { capTop: true }).main, M.snow);  // snow on the roof
    // bullwheel under the hood (rim, spokes, hub) and the station rails the grips run on
    const R = half, bw = new T.TorusGeometry(R, .09, 8, 48); bw.rotateX(Math.PI / 2); bw.translate(0, .15, 0); put(bw, M.paint);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; put(tube(V(0, .2, 0), V(Math.cos(a) * R, .15, Math.sin(a) * R), .05, 6), M.paint); }
    put(new T.CylinderGeometry(.45, .45, .5, 16).translate(0, .3, 0), M.galv);
    put(tube(V(0, .5, 0), V(0, hoodBase, 0), .3, 12), M.paint);                                       // bullwheel shaft to the drive
    for (const s of [-1, 1]) put(rbox(.18, .24, len - 6, .04, s * half, .28, zc + 1.5), M.galv);
    if (glazed) {
        // glazed side walls with mullions, open where the line enters and where people board
        for (const s of [-1, 1]) {
            const x = s * (wid / 2 + .02), y0 = ground + 1.0, y1 = hoodBase;
            put(box(.03, y1 - y0, len * .55, x, (y0 + y1) / 2, zc - len * .12), M.glass);
            for (let k = 0; k <= 5; k++) put(box(.08, y1 - y0, .08, x, (y0 + y1) / 2, zc - len * .395 + k * len * .11), M.trim);
            put(box(.1, 1.0, len * .55, x, ground + .5, zc - len * .12), M.trim);
        }
    }
    // operator cabin beside the loading point
    const op = roundedRect(2.2, 2.4, .25, 16), ox = half + 2.6, oz = zc + len * .25;
    put(loft(op, [{ y: ground, sx: 1, sz: 1, dx: ox, dz: oz }, { y: ground + 1.1, sx: 1, sz: 1, dx: ox, dz: oz }]).main, M.cabin);
    put(loft(op, [{ y: ground + 1.1, sx: 1, sz: 1, dx: ox, dz: oz }, { y: ground + 2.3, sx: .98, sz: .98, dx: ox, dz: oz }]).main, M.glass);
    put(rbox(2.6, .2, 2.8, .08, ox, ground + 2.4, oz), M.trim); put(rbox(2.5, .22, 2.7, .1, ox, ground + 2.58, oz), M.snow);
    // drive / machine house behind the bullwheel, offset to the side
    const hx = -(wid / 2 + 4.2), hz = z0 + 2, hw = 7, hl = 9, hh = 5;
    const house = roundedRect(hw, hl, .15, 16);
    put(loft(house, [{ y: ground - 1.5, sx: 1, sz: 1, dx: hx, dz: hz }, { y: ground + 1.2, sx: 1, sz: 1, dx: hx, dz: hz }]).main, M.concrete);
    put(loft(house, [{ y: ground + 1.2, sx: 1.01, sz: 1.01, dx: hx, dz: hz }, { y: ground + hh, sx: 1.01, sz: 1.01, dx: hx, dz: hz }]).main, M.larch);
    for (let k = 0; k < 3; k++) { put(box(.06, 1.1, 1.6, hx + hw / 2 + .05, ground + hh - 1.7, hz - 2.8 + k * 2.8), M.glass); put(box(.1, 1.25, 1.75, hx + hw / 2 + .02, ground + hh - 1.7, hz - 2.8 + k * 2.8), M.trim); }
    put(rbox(hw + .9, .32, hl + .9, .08, hx, ground + hh + .12, hz), M.trim); put(rbox(hw + .8, .4, hl + .8, .18, hx, ground + hh + .42, hz), M.snow);
    put(box(1.4, 2.3, .08, hx, ground + 1.15, hz + hl / 2 + .04), M.trim);                                 // door
    put(box(1.6, .08, .9, hx, ground + 2.45, hz + hl / 2 + .45), M.trim);                                  // canopy over the door
}
