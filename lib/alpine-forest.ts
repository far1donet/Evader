import * as T from 'three';

type Tree = { x: number; y: number; d: number; height: number; index: number };

const bark = new T.Color(0x514239);
const barkLight = new T.Color(0x6e5b48);
const needles = new T.Color(0x1a2e29);
const tips = new T.Color(0x3e584d);
const snow = new T.Color(0xe7f2f8);
const snowShade = new T.Color(0xb5ccd8);
const TAU = Math.PI * 2;

/**
 * A snow-loaded spruce, one unit tall: a trunk and stacked drooping skirts of branches with a jagged outline. Snow lies on
 * the upper faces (white, blue in the folds); dark needles show at the tips and from below. Foliage and snow are one mesh
 * so each stand needs one draw call. `detailed`: 11 tiers x 16 segments near the rider, 6 x 9 further away.
 */
function firGeometry(detailed: boolean) {
    const positions: number[] = [];
    const colors: number[] = [];
    let seed = detailed ? 937 : 211;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const push = (vs: T.Vector3[], cs: T.Color[]) => { vs.forEach((v, i) => { positions.push(v.x, v.y, v.z); colors.push(cs[i].r, cs[i].g, cs[i].b); }); };
    const ring = (radius: number, y: number, angle: number) => new T.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
    // trunk
    for (let side = 0; side < 7; side++) {
        const a = side * TAU / 7, b = (side + 1) * TAU / 7;
        const fa = ring(.022, -.04, a), fb = ring(.022, -.04, b), ta = ring(.003, 1, a), tb = ring(.003, 1, b);
        push([fa, ta, tb], [bark, barkLight, barkLight]); push([fa, tb, fb], [bark, barkLight, bark]);
    }
    const tiers = detailed ? 11 : 6, seg = detailed ? 16 : 9;
    const shade = new T.Color(), tip = new T.Color(), top = new T.Color();
    for (let tier = 0; tier < tiers; tier++) {
        const level = tier / (tiers - 1);
        const y = .1 + .86 * Math.sqrt(level) * (.55 + .45 * level) / 1;   // tiers closer together toward the crown
        const rOut = (.03 + .2 * (1 - level) ** 1.1) * (.9 + random() * .2);
        const drop = Math.max(rOut * (.62 + random() * .2), .075), rMid = rOut * .5, rIn = .01;
        const turn = tier * Math.PI / seg + random() * .3;
        const snowy = .55 + .45 * (1 - level) * (.6 + random() * .4);       // more snow on the broad lower tiers
        for (let s = 0; s < seg; s++) {
            const a0 = turn + s * TAU / seg, a1 = turn + (s + 1) * TAU / seg, am = (a0 + a1) / 2;
            const jag = (k: number) => .74 + .3 * Math.abs(Math.sin(k * 12.9898 + tier * 4.1)), j0 = jag(s), j1 = jag((s + 1) % seg);
            const yo0 = y - drop + (random() - .5) * .012, yo1 = y - drop + (random() - .5) * .012;
            const c = V3(0, y + .01, 0), m0 = ring(rMid * j0, y - drop * .42, a0), m1 = ring(rMid * j1, y - drop * .42, a1);
            const o0 = ring(rOut * j0, yo0, a0), o1 = ring(rOut * j1, yo1, a1), om = ring(rOut * 1.06, y - drop * 1.05, am);
            tip.copy(needles).lerp(tips, random() * .7);
            const snowed = random() < snowy * .8;                              // snow lies on some branches, not all
            top.copy(snow).lerp(snowShade, random() * .4); shade.copy(needles).lerp(tips, .5);
            const inner = snowed ? top : shade, mid = snowed && random() < .5 ? top : tip;
            // upper faces: snow on the inner part of loaded branches, needles at the jagged tips
            push([c, m1, m0], [inner, inner, inner]);
            push([m0, m1, o1], [mid, mid, tip]);
            push([m0, o1, o0], [mid, tip, tip]);
            if (detailed) push([o0, o1, om], [tip, tip, needles]);
            // underside: dark needles, a little below so the skirt has thickness
            const u0 = ring(rIn, y - .03, a0), u1 = ring(rIn, y - .03, a1), d0 = ring(rOut * j0 * .96, yo0 - .012, a0), d1 = ring(rOut * j1 * .96, yo1 - .012, a1);
            push([u0, d0, d1], [needles, tip, tip]); push([u0, d1, u1], [needles, tip, needles]);
        }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}
const V3 = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

export function makeAlpineForest(trees: Tree[]) {
    const stands = new Map<string, Tree[]>();
    for (const tree of trees) {
        const detailed = tree.index < 300;
        const key = `${Math.floor(tree.d / 140)}:${Math.sign(tree.x)}:${detailed}`;
        const stand = stands.get(key);
        if (stand) stand.push(tree);
        else stands.set(key, [tree]);
    }
    const material = new T.MeshStandardMaterial({
        vertexColors: true,
        side: T.DoubleSide,
        roughness: .94,
    });
    const nearGeometry = firGeometry(true);
    const farGeometry = trees.length > 300 ? firGeometry(false) : nearGeometry;
    const forest = new T.Group();
    const transform = new T.Object3D();
    const color = new T.Color();
    for (const stand of stands.values()) {
        const detailed = stand[0].index < 300;
        const mesh = new T.InstancedMesh(detailed ? nearGeometry : farGeometry, material, stand.length);
        mesh.castShadow = detailed;
        mesh.receiveShadow = true;
        stand.forEach((tree, i) => {
            const variation = Math.sin(tree.index * 17.12);
            const width = tree.height * (.91 + variation * .18);
            transform.position.set(tree.x, tree.y, -tree.d);
            transform.rotation.set(variation * .019, tree.index * 2.39996, variation * .027);
            transform.scale.set(width, tree.height, width * (.92 + variation * .06));
            transform.updateMatrix();
            mesh.setMatrixAt(i, transform.matrix);
            const tint = .90 + variation * .09;
            mesh.setColorAt(i, color.setRGB(tint, tint, tint));
        });
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        forest.add(mesh);
    }
    return forest;
}
