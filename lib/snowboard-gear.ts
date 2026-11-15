import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOARD_THICKNESS = .0105;
const EDGE_THICKNESS = .0017;
export const BOARD_LENGTH_CM = 190;
export const BOARD_WAIST_M = .34;
const LENGTH = BOARD_LENGTH_CM / 100;
const LONGITUDINAL_SEGMENTS = 88;
const CROSS_SEGMENTS = 12;

function halfWidth(t: number, width: number) {
    const contact = t < 0 ? .76 : .72;
    const flare = t < 0 ? .060 : .073;
    const position = Math.abs(t);
    if (position <= contact)
        return width * (.5 + flare * (position / contact) ** 2);
    // Keep a short flat face across the rounded tail, with a fully oval shovel.
    const tip = (position - contact) / (1 - contact);
    const shape = t < 0 ? 3.35 : 2.16;
    const curve = Math.max(0, 1 - tip ** shape) ** (1 / shape);
    const endWidth = t < 0 ? .53 : 0;
    return width * (.5 + flare) * T.MathUtils.lerp(endWidth, 1, curve);
}

function deckHeight(t: number) {
    const nose = t >= 0, contact = nose ? .72 : .76;
    const position = Math.abs(t);
    const camber = position <= contact ? .007 * (1 - (position / contact) ** 2) ** 2 : 0;
    const rocker = (nose ? .076 : .049) * T.MathUtils.smoothstep(position, contact - .04, 1);
    return BOARD_THICKNESS + camber + rocker;
}

export function boardEdgeAt(x: number, side: -1 | 1, length = LENGTH, width = BOARD_WAIST_M) {
    const t = T.MathUtils.clamp(2 * x / length, -1, 1);
    return new T.Vector3(t * length * .5, deckHeight(t), side * halfWidth(t, width));
}

export function boardOutline(length = LENGTH, width = BOARD_WAIST_M) {
    const side = (sign: number) => Array.from({ length: LONGITUDINAL_SEGMENTS + 1 }, (_, i) => {
        // Cosine spacing gives the rounded nose and tail finer corner detail.
        const t = -Math.cos(i * Math.PI / LONGITUDINAL_SEGMENTS);
        return new T.Vector3(length * t * .5, deckHeight(t), sign * halfWidth(t, width));
    });
    return [...side(-1), ...side(1).reverse().slice(1)];
}

export function makeBoardGeometry(length = LENGTH, width = BOARD_WAIST_M) {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const geometry = new T.BufferGeometry();
    const point = (x: number, y: number, z: number, bottom = false) => {
        const index = positions.length / 3;
        positions.push(x, y, z);
        // The base is viewed from the opposite side, so only the transverse axis flips.
        uvs.push(x / length + .5, (bottom ? z : -z) / (width * 1.16) + .5);
        return index;
    };
    for (const top of [true, false]) {
        const start = indices.length;
        const rows: number[][] = [];
        for (let i = 0; i <= LONGITUDINAL_SEGMENTS; i++) {
            const t = -Math.cos(i * Math.PI / LONGITUDINAL_SEGMENTS);
            const x = t * length * .5, y = deckHeight(t) - (top ? 0 : BOARD_THICKNESS);
            const half = halfWidth(t, width);
            const row = [];
            if (i === LONGITUDINAL_SEGMENTS) {
                const tip = point(x, y, 0, !top);
                for (let j = 0; j <= CROSS_SEGMENTS; j++) row.push(tip);
            } else {
                for (let j = 0; j <= CROSS_SEGMENTS; j++)
                    row.push(point(x, y, half * (2 * j / CROSS_SEGMENTS - 1), !top));
            }
            rows.push(row);
        }
        for (let i = 0; i < LONGITUDINAL_SEGMENTS; i++) {
            for (let j = 0; j < CROSS_SEGMENTS; j++) {
                const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
                if (top) {
                    indices.push(a, b, c);
                    if (i < LONGITUDINAL_SEGMENTS - 1) indices.push(b, d, c);
                } else {
                    indices.push(a, c, b);
                    if (i < LONGITUDINAL_SEGMENTS - 1) indices.push(b, c, d);
                }
            }
        }
        geometry.addGroup(start, indices.length - start, top ? 0 : 1);
    }
    const outline = boardOutline(length, width);
    const addWall = (offset: number, thickness: number, material: number) => {
        const start = indices.length, first = positions.length / 3;
        for (const p of [...outline, outline[0]]) {
            point(p.x, p.y - offset, p.z);
            point(p.x, p.y - offset - thickness, p.z);
        }
        for (let i = 0; i < outline.length; i++) {
            const a = first + i * 2;
            indices.push(a, a + 3, a + 1, a, a + 2, a + 3);
        }
        geometry.addGroup(start, indices.length - start, material);
    };
    addWall(0, BOARD_THICKNESS - EDGE_THICKNESS, 2);
    addWall(BOARD_THICKNESS - EDGE_THICKNESS, EDGE_THICKNESS, 3);
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 512;

function boardTexture(draw: (context: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;
    draw(canvas.getContext('2d')!);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

function wear(context: CanvasRenderingContext2D) {
    for (let i = 0; i < 880; i++) {
        const x = i * 757 % TEXTURE_WIDTH, y = i * 193 % TEXTURE_HEIGHT;
        const abrasion = i % 7 === 0;
        context.strokeStyle = abrasion ? '#ffe3cb35' : '#e7eaf715';
        context.lineWidth = abrasion ? 1 + i % 3 : 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 7 + i % (abrasion ? 95 : 31), y + (i % 3) - 1);
        context.stroke();
    }
}

export function deckTexture() {
    return boardTexture(context => {
        // Alpha carries the frost and scrape coverage, leaving the swatch opaque.
        const patches = [[200, 272, 155], [384, 162, 101], [580, 356, 164], [950, 278, 122],
            [1164, 148, 140], [1393, 382, 138], [1648, 305, 156], [1817, 184, 122]];
        for (const [x, y, radius] of patches) {
            for (let i = 0; i < 5; i++) {
                const span = radius * (.47 + .11 * i);
                context.save();
                context.translate(x + Math.sin(x * .2 + i * 18) * 64, y + Math.cos(y * .5 + i * 11) * 88);
                context.rotate((i - 2) * .24 + Math.cos(x * .13) * .45);
                context.scale(.7 + .2 * i, 1.45 - .1 * i);
                const scuff = context.createRadialGradient(0, 0, span * .12, 0, 0, span);
                scuff.addColorStop(0, i % 2 ? '#eee2ce51' : '#f0eee64b');
                scuff.addColorStop(.55, '#eae4db29');
                scuff.addColorStop(1, '#eae4db00');
                context.fillStyle = scuff;
                context.fillRect(-span, -span, span * 2, span * 2);
                context.restore();
            }
        }
        for (let i = 0; i < 580; i++) {
            const x = (i * 757 + i * i * 73) % TEXTURE_WIDTH;
            const y = (i * 193 + i * i * 47) % TEXTURE_HEIGHT;
            const length = 8 + i % 69;
            context.strokeStyle = i % 11 === 0 ? '#f6f0e978' : i % 7 === 0 ? '#65554a29' : '#f5f0e825';
            context.lineWidth = i % 11 === 0 ? 1.3 + (i % 5) * .2 : .55 + (i % 6) * .15;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + length * .32, y + Math.sin(i * 1.36) * 2.3);
            context.lineTo(x + length, y + Math.sin(i * .68) * (i % 11 === 0 ? 10 : 2));
            context.stroke();
        }
    });
}

export function applyWeatheredDeck(material: T.MeshStandardMaterial) {
    material.map = deckTexture();
    material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
            #ifdef USE_MAP
                vec4 abrasion = texture2D(map, vMapUv);
                diffuseColor.rgb = mix(diffuseColor.rgb, abrasion.rgb, abrasion.a * .46);
            #endif
        `);
    };
    material.customProgramCacheKey = () => 'weathered-opaque-deck';
    material.roughness = .51;
    material.metalness = .018;
    if (material instanceof T.MeshPhysicalMaterial) {
        material.clearcoat = .36;
        material.clearcoatRoughness = .39;
    }
}

function drawEvaderWordmark(context: CanvasRenderingContext2D) {
    const e = [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, .5], [.8, .5]]];
    const letters = [
        e,
        [[[0, 0], [.5, 1], [1, 0]]],
        [[[0, 1], [.5, 0], [1, 1]], [[.24, .52], [.76, .52]]],
        [[[0, 1], [0, 0], [.61, 0], [1, .23], [1, .77], [.61, 1], [0, 1]]],
        e,
        [[[0, 1], [0, 0], [.7, 0], [1, .2], [1, .38], [.7, .55], [0, .55]], [[.52, .55], [1, 1]]],
    ];
    context.beginPath();
    letters.forEach((paths, letter) => {
        for (const path of paths) path.forEach(([x, y], point) => {
            const u = 286 + letter * 257 + x * 188 - y * 17;
            const v = 110 + y * 292;
            if (point === 0) context.moveTo(u, v);
            else context.lineTo(u, v);
        });
    });
    context.lineJoin = 'bevel';
    context.strokeStyle = '#2c213066';
    context.lineWidth = 47;
    context.stroke();
    context.strokeStyle = '#f1eadf';
    context.lineWidth = 34;
    context.stroke();
}

export function alpineBaseTexture() {
    return boardTexture(context => {
        const ink = context.createLinearGradient(0, 240, TEXTURE_WIDTH, 272);
        ink.addColorStop(0, '#292e54');
        ink.addColorStop(.24, '#3c3c64');
        ink.addColorStop(.43, '#553d57');
        ink.addColorStop(.56, '#76454b');
        ink.addColorStop(.68, '#93503b');
        ink.addColorStop(.78, '#a8703c');
        ink.addColorStop(.89, '#bf9152');
        ink.addColorStop(1, '#a97943');
        context.fillStyle = ink;
        context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        for (let i = 0; i < 74; i++) {
            const x = 1230 + (i * 251 + i * i * 7) % 818, y = (i * 157 + i * i * 43) % TEXTURE_HEIGHT;
            const radius = 24 + i % 49;
            const wash = context.createRadialGradient(x, y, 0, x, y, radius);
            wash.addColorStop(0, i % 3 === 0 ? '#502e305c' : '#edc47c56');
            wash.addColorStop(1, '#d0985400');
            context.fillStyle = wash;
            context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        drawEvaderWordmark(context);
        wear(context);
    });
}

export function baseTexture() {
    return boardTexture(context => {
        const ink = context.createLinearGradient(TEXTURE_WIDTH, 450, 0, 40);
        ink.addColorStop(0, '#d3a253');
        ink.addColorStop(.20, '#bc823d');
        ink.addColorStop(.39, '#93493b');
        ink.addColorStop(.61, '#623846');
        ink.addColorStop(.82, '#302b50');
        ink.addColorStop(1, '#232540');
        context.fillStyle = ink;
        context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        for (let i = 0; i < 148; i++) {
            const x = i * 293 % TEXTURE_WIDTH, y = i * 151 % TEXTURE_HEIGHT;
            context.strokeStyle = i % 4 ? '#e6c6ae15' : '#30212e28';
            context.lineWidth = 2 + i % 19;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + 18 + i % 150, y + 12 * Math.sin(i));
            context.stroke();
        }
        drawEvaderWordmark(context);
        wear(context);
    });
}

type BootSection = [height: number, halfWidth: number, toe: number, heel: number];

function bootShell(sections: BootSection[], squareness = 2.2) {
    const points: number[] = [], indices: number[] = [], uvs: number[] = [];
    const segments = 36;
    for (const [height, width, toe, heel] of sections) {
        const center = (heel - toe) / 2;
        const depth = (heel + toe) / 2;
        for (let i = 0; i < segments; i++) {
            const angle = i * 2 * Math.PI / segments;
            const x = Math.cos(angle), z = Math.sin(angle);
            points.push(
                width * Math.sign(x) * Math.abs(x) ** (2 / squareness),
                height,
                center + depth * Math.sign(z) * Math.abs(z) ** (2 / squareness),
            );
            uvs.push(i / segments, height * 4);
        }
    }
    for (let layer = 0; layer < sections.length - 1; layer++) {
        for (let i = 0; i < segments; i++) {
            const a = layer * segments + i, b = layer * segments + (i + 1) % segments;
            indices.push(a, a + segments, b, b, a + segments, b + segments);
        }
    }
    const bottom = points.length / 3;
    const top = bottom + 1;
    const [bottomY, , bottomToe, bottomHeel] = sections[0];
    const [topY, , topToe, topHeel] = sections[sections.length - 1];
    points.push(0, bottomY, (bottomHeel - bottomToe) / 2, 0, topY, (topHeel - topToe) / 2);
    uvs.push(.5, .5, .5, .5);
    const last = (sections.length - 1) * segments;
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        indices.push(bottom, i, next, top, last + next, last + i);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

// Close both sides of a curved plate so straps read as shaped hardware in close-up.
function bindingPanel(surface: (u: number, v: number, layer: number) => [number, number, number]) {
    const points: number[] = [], indices: number[] = [], uvs: number[] = [];
    const width = 20, height = 7, columns = width + 1, faceSize = columns * (height + 1);
    for (let layer = 0; layer < 2; layer++) {
        const offset = layer * faceSize;
        for (let v = 0; v <= height; v++) {
            for (let u = 0; u <= width; u++) {
                points.push(...surface(u / width * 2 - 1, v / height, layer));
                uvs.push(u / width, v / height);
                if (u === width || v === height) continue;
                const a = offset + v * columns + u, b = a + 1, c = a + columns, d = c + 1;
                if (layer === 0) indices.push(a, b, c, b, d, c);
                else indices.push(a, c, b, b, c, d);
            }
        }
    }
    const edge = (a: number, b: number) => indices.push(a, a + faceSize, b, b, a + faceSize, b + faceSize);
    for (let u = 0; u < width; u++) {
        edge(u, u + 1);
        edge(height * columns + u + 1, height * columns + u);
    }
    for (let v = 0; v < height; v++) {
        edge((v + 1) * columns, v * columns);
        edge(v * columns + width, (v + 1) * columns + width);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

type AddGearMesh = (geometry: T.BufferGeometry, material: T.Material, parent: T.Object3D, position?: number[]) => T.Mesh;

export function addBootBinding(
    boot: T.Group,
    side: number,
    attach: AddGearMesh,
    rubber: T.Material,
    fabric: T.Material,
    steel: T.Material,
    /** When given, the binding (highback, straps, ratchets) goes here and only the boot goes in `boot`, so the boot can
     * step out of the binding (skating with the rear foot free). */
    bindingParent?: T.Object3D,
) {
    // Small fasteners share a draw call with their matching shell or strap.
    const bootParts = new Map<T.Material, T.Mesh[]>(), bindingParts = new Map<T.Material, T.Mesh[]>();
    let parts = bootParts;
    const add: AddGearMesh = (geometry, material, _parent, position) => {
        const mesh = new T.Mesh(geometry, material);
        if (position) mesh.position.fromArray(position);
        const layer = parts.get(material);
        if (layer) layer.push(mesh);
        else parts.set(material, [mesh]);
        return mesh;
    };
    const polymer = new T.MeshStandardMaterial({ color: 0x202329, roughness: .70, side: T.DoubleSide });
    const reinforced = new T.MeshStandardMaterial({ color: 0x30343b, roughness: .77, side: T.DoubleSide });
    const bootShellMaterial = new T.MeshStandardMaterial({ color: 0x24272d, roughness: .93 });
    const heelTrim = new T.MeshStandardMaterial({ color: 0x2c4431, roughness: .67, side: T.DoubleSide });

    // Footbed, rubber outsole and the fitted upper are separate layers.
    add(bootShell([[-.109, .112, .165, .132], [-.102, .123, .178, .143], [-.081, .121, .178, .143]], 3.4), polymer, boot);
    add(bootShell([[-.083, .103, .170, .133], [-.074, .109, .177, .136], [-.056, .108, .177, .133]], 2.8), rubber, boot);
    add(bootShell([
        [-.061, .104, .174, .126], [-.029, .103, .173, .122], [.016, .096, .163, .116],
        [.051, .091, .130, .110], [.079, .093, .091, .105], [.128, .091, .078, .092],
        [.182, .091, .091, .084], [.223, .095, .098, .080],
    ]), bootShellMaterial, boot);
    add(bootShell([[.206, .096, .100, .081], [.221, .097, .098, .080], [.229, .092, .093, .076]]), fabric, boot);
    add(bootShell([[-.06, .107, .176, .129], [-.041, .103, .177, .117], [-.018, .095, .174, .103]], 2.6), reinforced, boot);

    // The back leans forward and wraps around the heel at the lower mounting points.
    parts = bindingParts;
    add(bindingPanel((u, v, layer) => {
        const wrap = 1 - u * u;
        return [u * (.116 - v * .031), -.063 + v * (.252 + .038 * wrap),
            .095 + .048 * wrap - v * .048 - layer * .012];
    }), polymer, boot);
    add(bindingPanel((u, v, layer) => {
        const wrap = 1 - u * u;
        return [u * .084, -.043 + .055 * v + .021 * wrap, .133 + .016 * wrap - layer * .005];
    }), heelTrim, boot);
    add(bindingPanel((u, v, layer) => {
        const wrap = 1 - u * u;
        return [u * (.065 - .014 * v), .041 + .12 * v, .134 + .007 * wrap - .020 * v - layer * .003];
    }), reinforced, boot);

    // Toe cap hooks onto the rounded front. Ankle strap rises over the instep.
    add(bindingPanel((u, v, layer) => {
        const arch = 1 - u * u;
        return [u * .111, -.041 + .063 * arch + (v - .5) * (.018 + .018 * arch) - layer * .005,
            -.095 - .077 * arch + (v - .5) * .029 + layer * .005];
    }), reinforced, boot);
    add(bindingPanel((u, v, layer) => {
        const arch = 1 - u * u;
        return [u * .112, -.012 + .141 * arch + (v - .5) * (.023 + .034 * arch) - layer * .007,
            .038 - .124 * arch + (v - .5) * .021 + layer * .006];
    }), polymer, boot);

    // Ratchet housings, pivots, and the exposed ends of the toothed ladder straps.
    const ratchetSide = -side;
    for (const [height, depth] of [[.023, -.120], [.057, -.001]]) {
        const body = add(new T.BoxGeometry(.021, .027, .045), reinforced, boot, [ratchetSide * .105, height, depth]);
        body.rotation.z = -.28 * ratchetSide;
        add(new T.BoxGeometry(.026, .011, .030), polymer, boot, [ratchetSide * .117, height + .009, depth]);
        const pivot = add(new T.CylinderGeometry(.0065, .0065, .004, 8), steel, boot, [ratchetSide * .132, height, depth + .012]);
        pivot.rotation.z = Math.PI / 2;
        for (let i = 0; i < 4; i++) {
            add(new T.BoxGeometry(.004, .005, .021), polymer, boot, [-ratchetSide * (.10 + .001 * i), height - i * .008, depth]);
        }
    }

    parts = bootParts;
    const lace = (positions: number[][]) => add(new T.TubeGeometry(
        new T.CatmullRomCurve3(positions.map(point => new T.Vector3(...point as [number, number, number]))), 9, .0028, 5, false,
    ), fabric, boot);
    for (let row = 0; row < 3; row++) {
        const height = .131 + row * .023, depth = -.099 + (row === 0 ? .005 : 0);
        lace([[-.053, height, depth + .024], [0, height + .008, depth], [.053, height + .015, depth + .018]]);
        lace([[.050, height, depth + .024], [0, height + .009, depth + .001], [-.051, height + .015, depth + .018]]);
    }
    for (const x of [-.076, .076]) {
        for (let lug = 0; lug < 6; lug++) {
            add(new T.BoxGeometry(.027, .008, .014), rubber, boot, [x, -.078, -.138 + lug * .047]);
        }
    }
    for (const [map, parent] of [[bootParts, boot], [bindingParts, bindingParent ?? boot]] as const) for (const [material, meshes] of map) {
        const geometries = meshes.map(mesh => {
            mesh.updateMatrix();
            return mesh.geometry.applyMatrix4(mesh.matrix);
        });
        const assembled = mergeGeometries(geometries);
        if (assembled) {
            attach(assembled, material, parent);
            geometries.forEach(geometry => geometry.dispose());
        } else {
            for (const geometry of geometries) attach(geometry, material, parent);
        }
    }
}
