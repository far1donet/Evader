import * as T from 'three';

type Tree = { x: number; y: number; d: number; height: number; index: number };

const bark = new T.Color(0x514239);
const barkLight = new T.Color(0x6e5b48);
const needles = new T.Color(0x1e3735);
const tips = new T.Color(0x49635b);
const snow = new T.Color(0xe7f2f8);
const snowShade = new T.Color(0xb5ccd8);
const TAU = Math.PI * 2;

/** Foliage and snow are part of the same mesh so each stand needs one draw call. */
function firGeometry(detailed: boolean) {
    const positions: number[] = [];
    const colors: number[] = [];
    const tint = new T.Color();
    let seed = 937;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const triangle = (a: T.Vector3, b: T.Vector3, c: T.Vector3, first: T.Color, last: T.Color) => {
        tint.copy(first).lerp(last, random() * .75);
        for (const vertex of [a, b, c]) {
            positions.push(vertex.x, vertex.y, vertex.z);
            colors.push(tint.r, tint.g, tint.b);
        }
    };
    const ring = (radius: number, y: number, angle: number) =>
        new T.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));

    for (let side = 0; side < 7; side++) {
        const a = side * TAU / 7;
        const b = (side + 1) * TAU / 7;
        const footA = ring(.019, -.04, a);
        const footB = ring(.019, -.04, b);
        const topA = ring(.002, 1, a);
        const topB = ring(.002, 1, b);
        triangle(footA, topA, topB, bark, barkLight);
        triangle(footA, topB, footB, bark, barkLight);
    }

    const tiers = detailed ? 9 : 6;
    for (let tier = 0; tier < tiers; tier++) {
        const level = tier / (tiers - 1);
        const y = .18 + level * .76;
        const spread = .017 + .105 * (1 - level) ** 1.12;
        const branches = detailed && tier < 5 ? 7 : 5;
        for (let branch = 0; branch < branches; branch++) {
            const angle = branch * TAU / branches + tier * 1.17 + (random() - .5) * .55;
            const length = spread * (.73 + random() * .52);
            const join = y + (random() - .5) * .047;
            const droop = length * (.18 + random() * .27);
            const point = (along: number, across: number, up: number) => new T.Vector3(
                length * (along * Math.cos(angle) - across * Math.sin(angle)),
                join + up - along * droop,
                length * (along * Math.sin(angle) + across * Math.cos(angle)),
            );
            const root = point(.04, 0, .006);
            const crest = point(.44, 0, length * .39);
            const left = point(.43, -.34, -.012);
            const right = point(.49, .32, -.012);
            const end = point(1, 0, .005);
            triangle(root, crest, left, needles, tips);
            triangle(root, right, crest, needles, tips);
            triangle(left, crest, end, needles, tips);
            triangle(right, end, crest, needles, tips);
            triangle(root, left, right, needles, tips);
            triangle(left, end, right, needles, tips);
            if (detailed) {
                triangle(crest, point(.66, -.43, -.005), end, needles, tips);
                triangle(crest, end, point(.70, .39, -.005), needles, tips);
            }
            // Snow rests on the ridge of the branch and leaves needles visible at the ends.
            if (random() > .16) {
                const cap = point(.40, 0, length * .43 + .007);
                const capLeft = point(.46, -.24, .005);
                const capRight = point(.51, .22, .005);
                const capTip = point(.83 + random() * .10, .01, .018);
                triangle(root, cap, capLeft, snowShade, snow);
                triangle(root, capRight, cap, snowShade, snow);
                triangle(capLeft, cap, capTip, snow, snowShade);
                triangle(capRight, capTip, cap, snow, snowShade);
            }
        }
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

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
