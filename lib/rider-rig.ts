import * as T from 'three';
import { wrapAngle } from './trick-motion.ts';
import { ClothedLimb, springStep, VectorSpring, type Spring } from './motion.ts';
import { addBootBinding, alpineBaseTexture, applyWeatheredDeck, baseTexture, boardEdgeAt, makeBoardGeometry } from './snowboard-gear.ts';
export { boardOutline, deckTexture, makeBoardGeometry } from './snowboard-gear.ts';
// A clothed, articulated rider built in metres. Materials and silhouettes stay
// independent of scoring/physics, so graphics quality cannot affect a run.
export type RiderPose = {
    dt: number;
    time: number;
    turn: number;
    edge?: number;
    speed: number;
    air: boolean;
    grab: boolean;
    landing: number;
    menu: boolean;
    tuck?: boolean;
    load?: number;
    pop?: number;
    extension?: number;
    spinVelocity?: number;
    flipVelocity?: number;
    spin?: number;
    landingSpin?: number;
    grabKind?: number;
    rail?: boolean;
    spinInput?: number;
    /** Lateral acceleration in g, signed like `edge` (from the simulation's speed and yaw rate). */
    carveG?: number;
    /** Snow softness under the board, 0 firm .. 1 fresh powder. */
    soft?: number;
    /** Fore/aft pressure on the board, -1..1 toward the rig's +x end (drives the visible board flex). */
    press?: number;
    /** Rig-space target for the front hand (surface lifts: holding the hanger). */
    hold?: T.Vector3;
};
export type SeatedPose = { dt: number; time: number; sit: number; hands: 'bar' | 'knees' | 'side'; look?: number };
export type RiderKit = 'ochre' | 'shadow' | 'alpine';
const UP = new T.Vector3(0, 1, 0);
const GRAB_CONTACTS = [boardEdgeAt(.31, -1), boardEdgeAt(-.18, -1), boardEdgeAt(-.31, 1)];
/**
 * The rig was authored about 11 % larger than an average adult (1.92 m to the helmet top on a 1.90 m board). Real-scale
 * mode (`setBoard`) scales the whole rig by RIG_SCALE so the rider stands about 1.75 m tall in boots, and rebuilds the
 * board at the selected equipment's real length, waist and stance width.
 */
export const RIG_SCALE = .9;
/**
 * Anatomical grab targets (real-scale mode). `hand`: which hand reaches; `x`: position along the board as a fraction of
 * the half-length, + toward the leading (front-foot) end; `side`: toe or heel edge (the rider faces the toe edge, -z in the
 * rig); `pitch`: torso pitch needed to get there. Order matches GRABS in lib/sim/freestyle.ts.
 */
export const GRAB_TARGETS: { hand: 'front' | 'rear' | 'both'; x: number; side: 'toe' | 'heel'; pitch: number; tilt: number }[] = [
    { hand: 'rear', x: -.1, side: 'toe', pitch: -.8, tilt: .15 },   // indy
    { hand: 'front', x: .1, side: 'toe', pitch: -.8, tilt: -.15 },  // mute
    { hand: 'front', x: .05, side: 'heel', pitch: .7, tilt: .2 },   // melon
    { hand: 'rear', x: -.08, side: 'heel', pitch: .72, tilt: -.2 }, // stalefish
    { hand: 'front', x: .9, side: 'toe', pitch: -.7, tilt: -.45 },  // nose
    { hand: 'rear', x: -.9, side: 'toe', pitch: -.7, tilt: .45 },   // tail
    { hand: 'front', x: .05, side: 'heel', pitch: .85, tilt: .3 },  // method (melon grab, body arched)
    { hand: 'front', x: .12, side: 'toe', pitch: -.9, tilt: -.3 },  // japan (mute grab, knee tucked)
    { hand: 'rear', x: .42, side: 'toe', pitch: -1.05, tilt: -.75 }, // crail (body folds toward the nose)
    { hand: 'rear', x: 0, side: 'heel', pitch: .75, tilt: 0 },      // roast beef (between the legs)
    { hand: 'front', x: -.02, side: 'heel', pitch: .75, tilt: 0 },  // chicken salad (between the legs)
    { hand: 'front', x: -.55, side: 'toe', pitch: -1.05, tilt: .8 },  // seatbelt (across the body toward the tail)
    { hand: 'both', x: .1, side: 'toe', pitch: -.85, tilt: 0 },     // truck driver (both hands, mute + indy)
];
export type RigBoard = { length: number; waist: number; stanceWidth: number };
function weaveTexture() { const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d')!; ctx.fillStyle = '#929292'; ctx.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 4)
    for (let x = 0; x < 128; x += 4) {
        ctx.fillStyle = (x / 4 + y / 4) % 2 ? '#9b9b9b' : '#888888';
        ctx.fillRect(x, y, 3, 1);
    } const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(12, 12); return t; }
const JACKET_PROFILE = [[-.241, .235, .173], [-.202, .253, .178], [-.105, .258, .182], [.025, .239, .177],
    [.18, .222, .154], [.31, .245, .146], [.411, .260, .137], [.485, .223, .116], [.55, .110, .088]];
const SHELL_COLUMNS = 65;
const FIT_SECTORS = 48;
const FIT_ROWS = 24;
const FIT_BOTTOM = -.27;
const FIT_TOP = .245;

function garmentSector(x: number, z: number) {
    return Math.floor(T.MathUtils.euclideanModulo(Math.atan2(z, x), Math.PI * 2) * FIT_SECTORS / (Math.PI * 2));
}

function yokeHeight(angle: number) {
    const shoulder = T.MathUtils.smoothstep(Math.abs(Math.cos(angle)), .48, .99);
    return .475 - shoulder * .136 - Math.max(0, Math.sin(angle)) * .035;
}

function jacketPoint(y: number, angle: number, inset = 0) {
    let i = 0;
    while (i < JACKET_PROFILE.length - 2 && y > JACKET_PROFILE[i + 1][0]) i++;
    const a = JACKET_PROFILE[i], b = JACKET_PROFILE[i + 1];
    const mix = T.MathUtils.smoothstep(y, a[0], b[0]);
    const rx = T.MathUtils.lerp(a[1], b[1], mix), rz = T.MathUtils.lerp(a[2], b[2], mix);
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const back = T.MathUtils.smoothstep(sin, .12, .76);
    const waist = Math.exp(-(((y + .012) / .18) ** 2));
    // The fabric hangs in broad panels. The shallow pinches follow the shoulder
    // and waist instead of wrapping the torso in equally spaced rings.
    const lowerFold = Math.exp(-(((y - .061 - cos * .104) / .040) ** 2))
        - .64 * Math.exp(-(((y - .094 - cos * .104) / .024) ** 2));
    const upperFold = Math.exp(-(((y - .30 + cos * .094) / .037) ** 2));
    const dropFold = Math.exp(-(((y + .139 + cos * .061) / .041) ** 2));
    const drape = .0032 * Math.cos(angle * 4 + y * 18) * waist
        + back * (.017 * lowerFold - .008 * upperFold + .008 * dropFold);
    const front = 1 - T.MathUtils.smoothstep(sin, -.16, .73);
    const hemLift = .141 * front * (1 - T.MathUtils.smoothstep(y, JACKET_PROFILE[0][0], .106));
    const shapedX = Math.sign(cos) * Math.abs(cos) ** .88;
    const shapedZ = Math.sign(sin) * Math.abs(sin) ** .84;
    return new T.Vector3(shapedX * (rx + drape + inset), y + hemLift,
        shapedZ * (rz + drape + inset) + y * .052);
}

function jacketGeometry() {
    const shellRows = 46, yokeRows = 12, rows = shellRows + yokeRows, cols = SHELL_COLUMNS - 1;
    const positions: number[] = [], uv: number[] = [], colors: number[] = [];
    const shell: number[] = [], yoke: number[] = [];
    for (let iy = 0; iy <= rows; iy++) {
        for (let ix = 0; ix <= cols; ix++) {
            const u = ix / cols, angle = u * Math.PI * 2;
            const seam = yokeHeight(angle);
            const y = iy < shellRows ? T.MathUtils.lerp(JACKET_PROFILE[0][0], seam, iy / shellRows)
                : T.MathUtils.lerp(seam, JACKET_PROFILE.at(-1)![0], (iy - shellRows) / yokeRows);
            positions.push(...jacketPoint(y, angle).toArray());
            uv.push(u, iy / rows);
            const front = Math.max(0, -Math.sin(angle));
            const zipper = (1 - T.MathUtils.smoothstep(Math.abs(Math.cos(angle)), .016, .065)) * front ** 12;
            const hem = .105 * (1 - T.MathUtils.smoothstep(y, -.238, -.204));
            const waist = .046 * Math.cos((y - Math.cos(angle) * .083) * 28) * Math.max(0, Math.sin(angle));
            const pocket = (1 - T.MathUtils.smoothstep(Math.abs(Math.abs(Math.cos(angle)) - (.36 + 1.16 * (y + .056))), .013, .043))
                * T.MathUtils.smoothstep(y, -.059, -.028) * (1 - T.MathUtils.smoothstep(y, .107, .142)) * front ** 2;
            const panel = .89 - .16 * T.MathUtils.smoothstep(Math.abs(Math.cos(angle)), .79, 1)
                + waist - .74 * zipper - .55 * pocket - hem;
            colors.push(panel, panel, panel);
            if (iy < rows && ix < cols) {
                const k = iy * (cols + 1) + ix;
                const indices = iy >= shellRows ? yoke : shell;
                indices.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
            }
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex([...shell, ...yoke]);
    g.addGroup(0, shell.length, 0);
    g.addGroup(shell.length, yoke.length, 1);
    g.computeVertexNormals();
    return g;
}

// Tailored hood rings run from the face opening to the back seam.
const HOOD_PROFILE = [[-.164, .167, .180, .009], [-.119, .183, .209, .019],
    [-.058, .190, .226, .023], [.033, .192, .218, .015], [.109, .176, .187, .004],
    [.168, .129, .148, -.006], [.204, .066, .093, -.016], [.223, 0, 0, -.029]];

function hoodCrownLimit(row: number) {
    const descent = T.MathUtils.smoothstep(row, .3, 4.9);
    return .68 - 1.32 * descent + .42 * T.MathUtils.smoothstep(row, 5, 7);
}

function hoodPoint(row: number, angle: number) {
    const [depth, width, height, lift] = HOOD_PROFILE[row];
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const tuck = Math.exp(-(((Math.abs(cos) - .67) / .19) ** 2)) * Math.max(0, sin);
    const wrinkle = width * (.019 * Math.sin(angle * 5 + depth * 26) + .024 * Math.cos(angle * 9 - depth * 39) * tuck);
    const x = cos * (width + wrinkle) * (.96 + .055 * sin);
    const y = lift + Math.sign(sin) * Math.abs(sin) ** .77 * (height + wrinkle);
    const z = depth - (1 - row / (HOOD_PROFILE.length - 1)) * sin * .022;
    return new T.Vector3(x, y, z);
}

function hoodGeometry() {
    const columns = 64, crownColumns = 28, positions: number[] = [], uv: number[] = [], colors: number[] = [];
    const sides: number[] = [], crown: number[] = [];
    for (let row = 0; row < HOOD_PROFILE.length; row++) {
        const firstSeam = Math.asin(hoodCrownLimit(row));
        const secondSeam = Math.PI - firstSeam;
        for (let i = 0; i <= columns; i++) {
            const angle = i <= crownColumns ? T.MathUtils.lerp(firstSeam, secondSeam, i / crownColumns)
                : T.MathUtils.lerp(secondSeam, firstSeam + Math.PI * 2, (i - crownColumns) / (columns - crownColumns));
            positions.push(...hoodPoint(row, angle).toArray());
            uv.push(i / columns, row / (HOOD_PROFILE.length - 1));
            const shade = .91 + .045 * Math.cos(angle * 8 + row * 1.2);
            colors.push(shade, shade, shade);
            if (row === HOOD_PROFILE.length - 1 || i === columns) continue;
            const strip = i < crownColumns ? crown : sides;
            const a = row * (columns + 1) + i, b = a + columns + 1;
            strip.push(a, a + 1, b);
            if (row < HOOD_PROFILE.length - 2) strip.push(a + 1, b + 1, b);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex([...sides, ...crown]);
    g.addGroup(0, sides.length, 0);
    g.addGroup(sides.length, crown.length, 1);
    g.computeVertexNormals();
    return g;
}

function hoodLiningGeometry(rim: T.Vector3[]) {
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i < rim.length; i++) {
        const a = rim[i];
        positions.push(a.x * .997, a.y, a.z + .002, a.x * .64, .008 + (a.y - .008) * .64, -.032);
        const outer = i * 2, inner = outer + 1, next = (outer + 2) % (rim.length * 2);
        indices.push(outer, inner, next, next, inner, next + 1);
    }
    const lining = new T.BufferGeometry();
    lining.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    lining.setIndex(indices);
    lining.computeVertexNormals();
    return lining;
}
function beanieGeometry() {
    const geometry = new T.SphereGeometry(.2, 80, 32, 0, 2 * Math.PI, 0, Math.PI * .56);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const crown = Math.hypot(x, z);
        const rib = Math.cos(Math.atan2(z, x) * 46) * .014 * T.MathUtils.smoothstep(crown, .018, .065);
        position.setXYZ(i, x * (1 + rib), y * 1.17, z * (1 + rib));
    }
    geometry.computeVertexNormals();
    return geometry;
}

function shapeTrouser(geometry: T.BufferGeometry, side: number) {
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const t = uv.getY(i), a = uv.getX(i) * 2 * Math.PI;
        const knee = Math.exp(-(((t - .49 + .065 * Math.cos(a)) / .13) ** 2));
        const hem = T.MathUtils.smoothstep(t, .73, .96);
        const folds = knee * .089 * Math.sin(t * 65 - a * side * 2)
            + hem * (.12 + .062 * Math.cos(t * 81 + a * 2));
        position.setXYZ(i, position.getX(i) * (1 + folds), position.getY(i) - hem * (.009 + .007 * Math.sin(a)),
            position.getZ(i) * (1 + folds * .76));
    }
    geometry.computeVertexNormals();
}

function mittenGeometry() {
    const geometry = new T.SphereGeometry(1, 28, 22);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const palm = .046 * (1 + .12 * Math.max(0, -y));
        const cuff = 1 - .24 * T.MathUtils.smoothstep(y, .25, .92);
        const turn = .012 * T.MathUtils.smoothstep(-y, .17, .97);
        p.setXYZ(i, Math.sign(x) * Math.abs(x) ** .83 * palm * cuff, y * .067 - .044, z * .030 - turn);
    }
    geometry.computeVertexNormals();
    return geometry;
}
export class RiderRig {
    root: T.Group;
    pelvis = new T.Group();
    torso = new T.Group();
    head = new T.Group();
    board = new T.Group();
    jacket: T.MeshStandardMaterial;
    deck: T.MeshStandardMaterial;
    baseMap: T.CanvasTexture;
    private readonly baseMaterial: T.MeshStandardMaterial;
    private alpineBaseMap?: T.CanvasTexture;
    parts: {
        mesh: T.Mesh;
        a: T.Vector3;
        b: T.Vector3;
    }[] = [];
    legs: ClothedLimb[] = [];
    arms: ClothedLimb[] = [];
    hands: T.Group[] = [];
    boots: T.Group[] = [];
    cuffs: T.Mesh[] = [];
    hips: T.Mesh;
    chest: T.Mesh;
    private jacketRest: Float32Array;
    private jacketSectors: Uint8Array;
    private garmentEnvelope = new Float32Array(FIT_ROWS * FIT_SECTORS);
    private hemLift = new Float32Array(SHELL_COLUMNS);
    private smoothedHemLift = new Float32Array(SHELL_COLUMNS);
    private shellMatrix = new T.Matrix4();
    private samplePoint = new T.Vector3();
    private sampleLower = new T.Vector3();
    private lowerRotation = new T.Quaternion();
    shoulders: T.Mesh[] = [];
    crouch = .12;
    lean = 0;
    grabWeight = 0;
    wristSprings = [new VectorSpring(), new VectorSpring()];
    activeGrabKind = 0;
    /** Real-scale mode: board dimensions in rig units, half stance width (rig units), set by setBoard. */
    realBoard?: { length: number; width: number; stanceHalf: number };
    private boardMesh?: T.Mesh;
    private boardMaterials?: T.Material[];
    twistSpring: Spring = { value: 0, velocity: 0 };
    spotSpring: Spring = { value: 0, velocity: 0 };
    crouchSpring: Spring = { value: .12, velocity: 0 };
    leanSpring: Spring = { value: 0, velocity: 0 };
    grabSpring: Spring = { value: 0, velocity: 0 };
    leadSpring: Spring = { value: 1, velocity: 0 };
    tuckSpring: Spring = { value: 0, velocity: 0 };
    carveSpring: Spring = { value: 0, velocity: 0 };
    softSpring: Spring = { value: 0, velocity: 0 };
    private boardRest?: Float32Array;
    private flexState = { press: 0, load: 0 };
    groundedLead = 1;
    takeoffLead = 1;
    wasAirborne = false;
    kit?: RiderKit;
    outfit: {
        hoodUp: T.Group;
        hoodDown: T.Group;
        beanie: T.Group;
        pants: T.MeshStandardMaterial;
        legFabric: T.MeshStandardMaterial;
        lens: T.BufferGeometry;
        lensMaterial: T.MeshPhysicalMaterial;
        goggleFrame: T.MeshStandardMaterial;
        goggleStrap: T.MeshStandardMaterial;
    };
    constructor(root: T.Group, jacket: T.MeshStandardMaterial, deck: T.MeshStandardMaterial) {
        this.root = root;
        this.jacket = jacket;
        this.deck = deck;
        jacket.roughness = .88;
        if (jacket instanceof T.MeshPhysicalMaterial) {
            jacket.sheen = .31;
            jacket.sheenRoughness = .84;
            jacket.sheenColor.set(0x9d9b92);
        }
        jacket.bumpMap = weaveTexture();
        jacket.bumpScale = .0032;
        applyWeatheredDeck(deck);
        const pants = new T.MeshStandardMaterial({ color: 0x172123, roughness: .94, bumpMap: jacket.bumpMap, bumpScale: .003 });
        const legFabric = pants.clone();
        legFabric.vertexColors = true;
        const sleeves = new T.MeshStandardMaterial({ color: 0x15191e, roughness: .95, bumpMap: jacket.bumpMap, bumpScale: .004 });
        const fabricBlack = new T.MeshStandardMaterial({ color: 0x172025, roughness: .88, bumpMap: jacket.bumpMap, bumpScale: .002 });
        const rubber = new T.MeshStandardMaterial({ color: 0x14222a, roughness: .94 });
        const trim = new T.MeshStandardMaterial({ color: 0x586c76, metalness: .45, roughness: .45 });
        const add = (g: T.BufferGeometry, m: T.Material | T.Material[], p: T.Object3D, pos: T.Vector3 | number[] = []) => {
            if (m === jacket && !g.hasAttribute('color'))
                g.setAttribute('color', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
            const mesh = new T.Mesh(g, m);
            if (pos instanceof T.Vector3) mesh.position.copy(pos);
            else if (pos.length) mesh.position.fromArray(pos);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            p.add(mesh);
            return mesh;
        };
        const ellipsoid = (r: number, s: number[], m: T.Material, p: T.Object3D, pos: number[]) => { const mesh = add(new T.SphereGeometry(r, 24, 20), m, p, pos); mesh.scale.fromArray(s); return mesh; };
        this.root.add(this.board, this.torso, this.pelvis);
        this.baseMap = baseTexture();
        this.baseMaterial = new T.MeshStandardMaterial({ map: this.baseMap, roughness: .52 });
        const sidewall = new T.MeshStandardMaterial({ color: 0x242628, roughness: .7 });
        const edge = new T.MeshStandardMaterial({ color: 0x818a90, metalness: .85, roughness: .32 });
        this.boardMaterials = [deck, this.baseMaterial, sidewall, edge];
        this.boardMesh = add(makeBoardGeometry(), this.boardMaterials, this.board);
        for (const side of [-1, 1]) {
            const boot = new T.Group();
            boot.position.set(side * .39, .12, 0);
            boot.rotation.y = T.MathUtils.degToRad(side > 0 ? -17 : 9);
            this.boots.push(boot);
            this.board.add(boot);
            addBootBinding(boot, side, add, rubber, fabricBlack, trim);
            const leg = new ClothedLimb(.44, .43, .110, legFabric, 'leg');
            shapeTrouser(leg.mesh.geometry, side);
            this.legs.push(leg);
            root.add(leg.mesh);
        }
        jacket.vertexColors = true;
        const raglan = sleeves.clone();
        raglan.vertexColors = true;
        this.chest = add(jacketGeometry(), [jacket, raglan], this.torso);
        this.chest.frustumCulled = false;
        this.jacketRest = Float32Array.from(this.chest.geometry.attributes.position.array);
        this.jacketSectors = Uint8Array.from({ length: this.jacketRest.length / 3 },
            (_, i) => garmentSector(this.jacketRest[i * 3], this.jacketRest[i * 3 + 2]));
        this.hips = ellipsoid(.211, [1.04, .57, .69], pants, this.pelvis, [0, -.038, 0]);
        const stitch = (points: T.Vector3[], radius: number, material: T.Material, parent = this.torso, closed = false) =>
            add(new T.TubeGeometry(new T.CatmullRomCurve3(points, closed), points.length * 3, radius, 6, closed), material, parent);
        const neckSeam = Array.from({ length: 24 }, (_, i) => jacketPoint(.53, i * Math.PI / 12, .003));
        stitch(neckSeam, .006, fabricBlack, this.torso, true);
        const yoke = Array.from({ length: 33 }, (_, i) => {
            const angle = i * Math.PI / 16;
            return jacketPoint(yokeHeight(angle) + .005, angle, .0015);
        });
        stitch(yoke.slice(0, -1), .0022, fabricBlack, this.torso, true);
        const pull = add(new T.BoxGeometry(.011, .025, .008), trim, this.torso, jacketPoint(.473, -Math.PI / 2, .012));
        pull.rotation.z = -.14;
        const patch = add(new T.BoxGeometry(.033, .01, .004), fabricBlack, this.torso, jacketPoint(.337, -1.115, .004));
        patch.rotation.y = -.32;
        for (const side of [-1, 1]) {
            const pocketPull = add(new T.BoxGeometry(.009, .015, .005), trim, this.torso, jacketPoint(.135, -Math.PI / 2 + side * .60, .004));
            pocketPull.rotation.z = -side * .4;
            const shoulderSeam = Array.from({ length: 9 }, (_, i) => {
                const angle = (side === 1 ? 0 : Math.PI) + (i / 8 - .5) * 1.72;
                return jacketPoint(.397 + Math.sin(i / 8 * Math.PI) * .069, angle, .002);
            });
            stitch(shoulderSeam, .0028, fabricBlack);
            this.shoulders.push(ellipsoid(.096, [1.00, .69, 1.03], sleeves, this.torso, [side * .246, .411, .003]));
            const arm = new ClothedLimb(.31, .29, .084, sleeves, 'arm');
            this.arms.push(arm);
            root.add(arm.mesh);
            const cuff = add(new T.SphereGeometry(.067, 20, 12), sleeves, root);
            cuff.scale.set(1, .68, .92);
            this.cuffs.push(cuff);
            const hand = new T.Group();
            this.hands.push(hand);
            root.add(hand);
            add(mittenGeometry(), fabricBlack, hand);
            const thumb = ellipsoid(.025, [.66, 1.49, .80], fabricBlack, hand, [side * .042, -.034, -.019]);
            thumb.rotation.z = side * .24;
        }
        const hoodDown = new T.Group();
        this.torso.add(hoodDown);
        const foldedRim = [
            new T.Vector3(-.088, .505, -.117), new T.Vector3(-.158, .553, -.027),
            new T.Vector3(-.149, .602, .105), new T.Vector3(0, .572, .185),
            new T.Vector3(.149, .605, .104), new T.Vector3(.158, .55, -.025),
            new T.Vector3(.088, .502, -.117),
        ];
        stitch(foldedRim, .027, jacket, hoodDown);
        stitch(foldedRim.map(p => p.clone().add(new T.Vector3(0, .022, -.008))), .008, sleeves, hoodDown);
        ellipsoid(.143, [1.04, .55, .54], jacket, hoodDown, [0, .499, .140]);
        for (const side of [-1, 1]) {
            const end = .30 + side * .014;
            const cord = [new T.Vector3(side * .071, .507, -.115), new T.Vector3(side * .068, .40, -.145), new T.Vector3(side * .057, end, -.160)];
            stitch(cord, .0034, fabricBlack, hoodDown);
            add(new T.CylinderGeometry(.0038, .0038, .014, 8), trim, hoodDown, cord[2]);
        }
        this.torso.add(this.head);
        this.head.position.set(0, .646, .004);
        this.head.scale.setScalar(.79);
        ellipsoid(.17, [.94, 1.16, .96], fabricBlack, this.head, [0, -.012, 0]);
        const neck = add(new T.CylinderGeometry(.095, .121, .215, 24), fabricBlack, this.head, [0, -.203, 0]);
        neck.rotation.x = .1;
        ellipsoid(.123, [.98, .78, .41], sleeves, this.head, [0, -.084, -.124]);
        const hoodUp = new T.Group(), beanie = new T.Group();
        this.head.add(hoodUp, beanie);
        const hoodCrown = sleeves.clone();
        hoodCrown.side = T.DoubleSide;
        hoodCrown.vertexColors = true;
        add(hoodGeometry(), [jacket, hoodCrown], hoodUp);
        const hoodRim = Array.from({ length: 48 }, (_, i) => hoodPoint(0, i * Math.PI / 24));
        const lining = fabricBlack.clone();
        lining.side = T.DoubleSide;
        lining.bumpMap = null;
        add(hoodLiningGeometry(hoodRim), lining, hoodUp);
        stitch(hoodRim, .009, sleeves, hoodUp, true);
        for (const side of [-1, 1]) {
            const seam = HOOD_PROFILE.map((_, row) => {
                const angle = Math.asin(hoodCrownLimit(row));
                return hoodPoint(row, side === 1 ? angle : Math.PI - angle).add(new T.Vector3(0, .0018, 0));
            });
            stitch(seam, .0035, sleeves, hoodUp);
        }
        add(beanieGeometry(), sleeves, beanie, [0, .041, .006]).scale.set(.89, .94, .86);
        const rim = add(new T.TorusGeometry(.165, .013, 10, 48), fabricBlack, beanie, [0, .029, .005]);
        rim.rotation.x = Math.PI / 2;
        rim.scale.y = 1.01;
        const lp: number[] = [], ln: number[] = [], lc: number[] = [], li: number[] = [], framePts: T.Vector3[] = [];
        const segments = 48, rings = 8;
        const radius = .199;
        for (let ring = 0; ring <= rings; ring++) {
            for (let i = 0; i <= segments; i++) {
                const a = i / segments * Math.PI * 2;
                const horizontal = Math.cos(a), vertical = Math.sin(a), r = ring / rings;
                const x = .174 * Math.sign(horizontal) * Math.abs(horizontal) ** .62 * r;
                const bridge = vertical < 0 ? .026 * Math.exp(-Math.pow(x / .046, 2)) * r : 0;
                const y = .038 + .060 * Math.sign(vertical) * Math.abs(vertical) ** .64 * r - .009 * (x / .174) ** 2 + bridge;
                const z = -Math.sqrt(radius ** 2 - x ** 2 - (y - .039) ** 2) - .013;
                lp.push(x, y, z);
                ln.push(x / radius, (y - .039) / radius, (z + .013) / radius);
                lc.push(1, 1, 1);
                if (ring === rings && i < segments) framePts.push(new T.Vector3(x, y, z));
                if (ring < rings && i < segments) {
                    const index = ring * (segments + 1) + i, outer = index + segments + 1;
                    li.push(index, outer + 1, outer);
                    if (ring > 0) li.push(index, index + 1, outer + 1);
                }
            }
        }
        const lensG = new T.BufferGeometry();
        lensG.setAttribute('position', new T.Float32BufferAttribute(lp, 3));
        lensG.setAttribute('normal', new T.Float32BufferAttribute(ln, 3));
        lensG.setAttribute('color', new T.Float32BufferAttribute(lc, 3));
        lensG.setIndex(li);
        const lensMaterial = new T.MeshPhysicalMaterial({
            vertexColors: true, metalness: .52, roughness: .20, clearcoat: .98,
            clearcoatRoughness: .11, emissiveIntensity: .07,
        });
        const goggleFrame = new T.MeshStandardMaterial({ roughness: .77 });
        const goggleStrap = new T.MeshStandardMaterial({ roughness: .89, bumpMap: jacket.bumpMap, bumpScale: .001 });
        add(lensG, lensMaterial, this.head);
        stitch(framePts, .009, goggleFrame, this.head, true);
        const webbing = add(new T.CylinderGeometry(.166, .168, .031, 48, 1, true), goggleStrap, this.head, [0, .036, .008]);
        webbing.scale.z = 1.06;
        for (const side of [-1, 1]) {
            const buckle = add(new T.BoxGeometry(.014, .038, .047), goggleFrame, this.head, [side * .166, .036, -.029]);
            buckle.rotation.y = side * .24;
        }
        this.outfit = { hoodUp, hoodDown, beanie, pants, legFabric, lens: lensG, lensMaterial, goggleFrame, goggleStrap };
        this.setKit();
        this.pose({ dt: 1, time: 0, turn: 0, speed: 0, air: false, grab: false, landing: 0, menu: true });
    }
    setKit(kit: RiderKit = 'ochre') {
        if (this.kit === kit) return;
        this.kit = kit;
        this.baseMaterial.map = kit === 'alpine' ? (this.alpineBaseMap ??= alpineBaseTexture()) : this.baseMap;
        this.baseMaterial.needsUpdate = true;
        const { hoodUp, hoodDown, beanie, pants, legFabric, lens, lensMaterial, goggleFrame, goggleStrap } = this.outfit;
        const alpine = kit === 'alpine', shadow = kit === 'shadow';
        hoodUp.visible = !alpine;
        hoodDown.visible = beanie.visible = alpine;
        pants.color.set(alpine ? 0xb5b2bc : shadow ? 0x20212d : 0x111a24);
        legFabric.color.copy(pants.color);
        goggleFrame.color.set(alpine ? 0xc1c5c6 : 0x151b20);
        goggleStrap.color.set(alpine ? 0xd6d8d4 : 0x232a2a);
        lensMaterial.emissive.set(alpine ? 0x623114 : shadow ? 0x203833 : 0x353147);
        const dark = new T.Color(alpine ? 0x1c171a : shadow ? 0x152021 : 0x24232b);
        const tint = new T.Color(alpine ? 0x9e5328 : shadow ? 0x497068 : 0x776485);
        const shade = new T.Color(), position = lens.attributes.position, lensColor = lens.attributes.color;
        for (let i = 0; i < position.count; i++) {
            const band = T.MathUtils.smoothstep(position.getY(i) - position.getX(i) * .14, alpine ? .033 : -.004, .107);
            shade.copy(dark).lerp(tint, band);
            lensColor.setXYZ(i, shade.r, shade.g, shade.b);
        }
        lensColor.needsUpdate = true;
        this.legs.forEach((leg, i) => {
            const geometry = leg.mesh.geometry, uv = geometry.attributes.uv;
            let color = geometry.attributes.color;
            if (!color) {
                color = new T.BufferAttribute(new Float32Array(uv.count * 3), 3);
                geometry.setAttribute('color', color);
            }
            const side = i ? 1 : -1;
            for (let vertex = 0; vertex < uv.count; vertex++) {
                const a = uv.getX(vertex) * Math.PI * 2, t = uv.getY(vertex);
                const outward = side * Math.cos(a);
                const crease = .82 + .17 * Math.cos(t * 31 + a * 2.8) ** 2;
                const seam = T.MathUtils.smoothstep(outward, .977, 1);
                const stripe = shadow ? seam * T.MathUtils.smoothstep(t, .24, .29) * (1 - T.MathUtils.smoothstep(t, .86, .94)) : 0;
                const cool = T.MathUtils.smoothstep(t, .45, .79);
                const badge = !shadow && !alpine ? seam * T.MathUtils.smoothstep(t, .276, .289)
                    * (1 - T.MathUtils.smoothstep(t, .325, .34)) : 0;
                const base = crease - seam * .094;
                color.setXYZ(vertex, base - stripe * .10, base + stripe * .62 + badge * .66, base + stripe * (.26 + .6 * cool) + badge * .36);
            }
            color.needsUpdate = true;
        });
    }
    private sampleTrouser(leg: ClothedLimb, hip: T.Vector3, knee: T.Vector3) {
        const { position, skinWeight } = leg.mesh.geometry.attributes;
        const upper = leg.upper.quaternion;
        const lower = this.lowerRotation.copy(upper).multiply(leg.lower.quaternion);
        for (let i = 0; i < position.count; i += 2) {
            const point = this.samplePoint.fromBufferAttribute(position, i);
            const shin = this.sampleLower.copy(point);
            shin.y += leg.upperLength;
            point.applyQuaternion(upper).add(hip)
                .lerp(shin.applyQuaternion(lower).add(knee), skinWeight.getY(i))
                .applyMatrix4(this.shellMatrix);
            const row = Math.floor((point.y - FIT_BOTTOM) * FIT_ROWS / (FIT_TOP - FIT_BOTTOM));
            if (row < 0 || row >= FIT_ROWS) continue;
            const index = row * FIT_SECTORS + garmentSector(point.x, point.z);
            this.garmentEnvelope[index] = Math.max(this.garmentEnvelope[index], Math.hypot(point.x, point.z) + .010);
        }
    }
    private garmentRadius(sector: number, y: number) {
        const row = Math.floor((y - FIT_BOTTOM) * FIT_ROWS / (FIT_TOP - FIT_BOTTOM));
        let radius = 0;
        for (let i = Math.max(0, row - 1); i <= Math.min(FIT_ROWS - 1, row + 1); i++) {
            const start = i * FIT_SECTORS;
            radius = Math.max(radius, this.garmentEnvelope[start + sector],
                this.garmentEnvelope[start + (sector + 1) % FIT_SECTORS] - .006,
                this.garmentEnvelope[start + (sector + FIT_SECTORS - 1) % FIT_SECTORS] - .006);
        }
        return radius;
    }
    private fitJacket(flex: number, dt: number) {
        const geometry = this.chest.geometry;
        const position = geometry.attributes.position;
        const pressure = T.MathUtils.smoothstep(flex, .04, .52);
        const compact = Math.max(pressure, this.grabWeight);
        const maxDrape = .062 + .025 * pressure;
        this.hemLift.fill(0);
        // Lift only the sections pushed up by trousers. The hem at the back
        // stays long until the rider compresses far enough to touch it.
        for (let i = 0; i < position.count; i++) {
            const index = i * 3;
            const x = this.jacketRest[index], y = this.jacketRest[index + 1], z = this.jacketRest[index + 2];
            if (y > .17) continue;
            const column = i % SHELL_COLUMNS;
            const hemY = this.jacketRest[column * 3 + 1];
            if (this.garmentRadius(this.jacketSectors[i], y) <= Math.hypot(x, z) + maxDrape * .81) continue;
            const required = Math.min(y + .039 - hemY, .048 + compact * .29, .19 - hemY);
            this.hemLift[column] = Math.max(this.hemLift[column], required);
        }
        const last = SHELL_COLUMNS - 1;
        const seamLift = Math.max(this.hemLift[0], this.hemLift[last]);
        this.hemLift[0] = this.hemLift[last] = seamLift;
        for (let i = 0; i < SHELL_COLUMNS; i++) {
            const a = this.hemLift[(i + last - 1) % last], b = this.hemLift[i], c = this.hemLift[(i + 1) % last];
            const smooth = Math.max(b * .88, (a + 2 * b + c) * .25);
            this.smoothedHemLift[i] = T.MathUtils.damp(this.smoothedHemLift[i], smooth, smooth > this.smoothedHemLift[i] ? 44 : 19, dt);
        }
        let changed = false;
        for (let i = 0; i < position.count; i++) {
            const index = i * 3;
            const x = this.jacketRest[index], y = this.jacketRest[index + 1], z = this.jacketRest[index + 2];
            if (y >= FIT_TOP) continue;
            const radius = Math.hypot(x, z), dx = x / radius, dz = z / radius;
            const column = i % SHELL_COLUMNS;
            const hemY = this.jacketRest[column * 3 + 1];
            const hem = Math.max(0, (FIT_TOP - y) / (FIT_TOP - hemY));
            const front = 1 - T.MathUtils.smoothstep(dz, -.20, .69);
            const foldUp = Math.min(.21 - hemY, Math.max(this.smoothedHemLift[column], compact * .11 * front));
            const fittedY = y + foldUp * hem ** 1.06;
            const clearRadius = this.garmentRadius(this.jacketSectors[i], fittedY);
            const drape = radius + Math.min(maxDrape, Math.max(0, clearRadius - radius))
                * (1 - T.MathUtils.smoothstep(y, .14, FIT_TOP));
            const fittedX = dx * drape, fittedZ = dz * drape;
            if (Math.abs(position.getX(i) - fittedX) + Math.abs(position.getY(i) - fittedY) + Math.abs(position.getZ(i) - fittedZ) < .0003)
                continue;
            position.setXYZ(i, fittedX, fittedY, fittedZ);
            changed = true;
        }
        if (changed) {
            position.needsUpdate = true;
            geometry.computeVertexNormals();
        }
    }
    segment(mesh: T.Mesh, a: T.Vector3, b: T.Vector3) { const delta = b.clone().sub(a); mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(UP, delta.clone().normalize()); mesh.scale.y = delta.length(); }
    /** Switch to real scale and rebuild the board for a real equipment spec (metres). */
    setBoard(spec: RigBoard) {
        this.root.scale.setScalar(RIG_SCALE);
        const length = spec.length / RIG_SCALE, width = spec.waist / RIG_SCALE, stanceHalf = spec.stanceWidth / 2 / RIG_SCALE;
        this.realBoard = { length, width, stanceHalf };
        if (this.boardMesh) {
            this.boardMesh.geometry.dispose();
            this.boardMesh.geometry = makeBoardGeometry(length, width);
            this.boardRest = undefined;
        }
        this.boots.forEach((boot, i) => { boot.position.x = (i === 0 ? -1 : 1) * stanceHalf; });
    }
    /** Grab contact on the board for the active grab kind and hand, in rig units. */
    grabContact(kind: number, lead: number, hand: number) {
        const rb = this.realBoard;
        if (!rb) return GRAB_CONTACTS[Math.min(kind, 2)];
        const g = GRAB_TARGETS[kind] ?? GRAB_TARGETS[0];
        // Two-handed grabs: the rear hand takes the indy side of the same edge.
        const x = g.hand === 'both' && hand !== (lead > 0 ? 1 : 0) ? -g.x : g.x;
        return boardEdgeAt(lead * x * rb.length / 2, g.side === 'toe' ? -1 : 1, rb.length, rb.width);
    }
    /** Which hand(s) grab: returns weights for hand 0 (-x shoulder) and hand 1 (+x shoulder). */
    grabHands(kind: number, lead: number): [number, number] {
        if (!this.realBoard) return kind === 0 ? [0, 1] : [1, 0];
        const g = GRAB_TARGETS[kind] ?? GRAB_TARGETS[0];
        if (g.hand === 'both') return [1, 1];
        const front = lead > 0 ? 1 : 0;
        const idx = g.hand === 'front' ? front : 1 - front;
        return idx === 1 ? [0, 1] : [1, 0];
    }
    pose(p: RiderPose) {
        const load = p.load ?? 0, pop = p.pop ?? 0, extension = p.extension ?? 0, spinVelocity = p.spinVelocity ?? 0, flipVelocity = p.flipVelocity ?? 0;
        const breathing = p.menu ? Math.sin(p.time * 1.45) * .006 : 0;
        const edge = T.MathUtils.clamp(p.edge ?? p.turn, -1, 1);
        const speedWeight = T.MathUtils.smoothstep(p.speed, 3, 23);
        const tuck = springStep(this.tuckSpring, p.tuck && !p.air && !p.menu ? 1 : 0, 3.1, p.dt);
        const spin = p.spin ?? 0, alignment = Math.cos(spin);
        const projectedSpin = spin + T.MathUtils.clamp(spinVelocity * .11, -.55, .55);
        const landingSpin = p.landingSpin ?? Math.round(projectedSpin / Math.PI) * Math.PI;
        const landingLead = Math.cos(landingSpin) >= 0 ? 1 : -1;
        const opening = p.air ? T.MathUtils.smoothstep(extension, .15, .91) : 1;
        if (p.menu)
            this.groundedLead = 1;
        else if (!p.air && (!p.rail || Math.abs(alignment) > .38))
            this.groundedLead = alignment >= 0 ? 1 : -1;
        if (p.air && !this.wasAirborne) this.takeoffLead = this.groundedLead;
        this.wasAirborne = p.air;
        const leadTarget = p.air ? T.MathUtils.lerp(this.takeoffLead, landingLead, opening) : this.groundedLead;
        const lead = springStep(this.leadSpring, leadTarget, 3.4 + opening * 1.5, p.dt);
        const bank = edge * speedWeight;
        // Carving: lateral g bends the legs (hips toward the snow); powder: the rider rides deeper and sits back.
        const carve = springStep(this.carveSpring, p.air || p.menu ? 0 : T.MathUtils.clamp(p.carveG ?? 0, -1.4, 1.4), 4.2, p.dt);
        const soft = springStep(this.softSpring, p.air || p.menu ? 0 : p.soft ?? 0, 2.4, p.dt);
        const groundCrouch = .064 + speedWeight * .012 + tuck * .144 + Math.abs(bank) * .104 + Math.min(.16, Math.abs(carve) * .13)
            + soft * .085 + load * .34 + p.landing * .27;
        const rotationCrouch = Math.min((Math.abs(flipVelocity) + .45 * Math.abs(spinVelocity)) / 6, 1) * .20;
        const compact = T.MathUtils.lerp(.265 + rotationCrouch, .055, pop) + (p.grab ? .39 : 0);
        const airCrouch = .07 + T.MathUtils.lerp(compact, .085, extension);
        const compression = p.menu ? .096 : p.air ? airCrouch : groundCrouch;
        this.crouch = springStep(this.crouchSpring, T.MathUtils.clamp(compression, .055, .73), p.landing > .10 || pop > .32 ? 5.0 : 3.9, p.dt);
        const flex = Math.max(0, this.crouch - .07);
        // Input is downhill-left/right, while flex is expressed across the deck.
        // A 180 swaps which local edge and foot face that direction.
        this.lean = springStep(this.leanSpring, p.menu || p.air ? 0 : bank * lead * .64, 3.1, p.dt);
        const requestedGrab = p.grabKind ?? 0;
        if (requestedGrab !== this.activeGrabKind && this.grabWeight < .02)
            this.activeGrabKind = requestedGrab;
        this.grabWeight = springStep(this.grabSpring, p.grab && p.air && requestedGrab === this.activeGrabKind ? 1 : 0, 5, p.dt);
        // Wind the upper body into rotations, then let the head pick up the landing.
        const windup = -(p.spinInput ?? 0) * load * .43;
        const stanceTwist = -.245 * lead - bank * .10;
        const rotationTwist = T.MathUtils.clamp(spinVelocity * .097, -.46, .46);
        const twistTarget = p.air ? T.MathUtils.lerp(rotationTwist, stanceTwist, opening) : windup + stanceTwist;
        const twist = springStep(this.twistSpring, p.menu ? -.05 : twistTarget, 3.8, p.dt);
        const turnError = wrapAngle(spin - landingSpin);
        const spotTarget = p.air ? -turnError * opening * .8 + T.MathUtils.clamp(spinVelocity * .07, -.3, .3) * (1 - opening) : -bank * .17;
        const spot = springStep(this.spotSpring, spotTarget, 3.4, p.dt);
        const rail = p.rail ? Math.sin(p.time * 3.1) * .055 : 0;
        const hipY = 1.145 - this.crouch;
        const pressure = p.air ? .035 + pop * .035 : .055 - load * .105 - p.landing * .033 - soft * .085;
        const hipX = lead * pressure + rail * .35;
        const hipZ = -.012 - flex * (p.air ? .16 : .38) - this.lean * .24;
        this.pelvis.position.set(hipX, hipY + breathing, hipZ);
        const frontKneePressure = p.air ? .013 : -.035 + load * .063 + p.landing * .029;
        this.pelvis.rotation.set(-flex * .12, twist * (p.air ? -.24 : .28), this.lean * .10 + lead * frontKneePressure);
        this.pelvis.updateMatrix();
        this.torso.position.copy(this.pelvis.position);
        // Angulation: the legs and hips go to the inside of the turn, the chest counter-tilts to the outside so the
        // shoulders stay closer to level than the board (a high-edge carve, not a lean of the whole body).
        const torsoPitch = (p.air ? -.045 : -.12) - flex * .63 - tuck * .17 + this.lean * .30
            - T.MathUtils.clamp(flipVelocity * .018, -.11, .11);
        const contact = this.grabContact(this.activeGrabKind, lead, 1);
        const target = this.realBoard ? GRAB_TARGETS[this.activeGrabKind] ?? GRAB_TARGETS[0] : undefined;
        const grabTilt = target ? target.tilt * lead : this.activeGrabKind === 0 ? -.24 : .24;
        const grabPitch = target ? target.pitch : this.activeGrabKind === 2 ? .76 : -.81;
        const handWeights = this.grabHands(this.activeGrabKind, lead);
        const stanceHalf = this.realBoard?.stanceHalf ?? .39;
        this.torso.rotation.set(T.MathUtils.lerp(torsoPitch, grabPitch, this.grabWeight), twist,
            this.lean * .22 + lead * (p.air ? .025 + pop * .045 : -.065 - soft * .09) + rail + grabTilt * this.grabWeight);
        this.torso.updateMatrix();
        this.shellMatrix.copy(this.torso.matrix).invert();
        this.garmentEnvelope.fill(0);
        this.head.rotation.y = T.MathUtils.damp(this.head.rotation.y, p.menu ? -.13 : -.94 * lead + spot + lead * .32 * this.lean, 9, p.dt);
        this.head.rotation.x = T.MathUtils.damp(this.head.rotation.x, .025 + flex * .20 - extension * .16, 9, p.dt);
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            const leading = side * lead;
            const ankle = new T.Vector3(side * stanceHalf, .305, 0), hip = new T.Vector3(side * .17, -.015, 0).applyMatrix4(this.pelvis.matrix);
            const kneePole = new T.Vector3(side * ((p.air ? .41 : .34) + .035 * leading),
                .57 - (!p.air ? .045 * leading : 0), -.65 + .08 * leading - this.lean * .07);
            const knee = this.legs[i].pose(hip, ankle, kneePole).joint;
            this.sampleTrouser(this.legs[i], hip, knee);
            const shoulder = new T.Vector3(side * .263, .41, 0).applyMatrix4(this.torso.matrix);
            const balance = .10 + rotationCrouch * .23;
            const sweep = twist * side * .45, landingReach = extension * .10;
            const wrist = new T.Vector3(
                hipX + side * (.40 + balance + landingReach + leading * .058),
                hipY + .06 + pop * (.19 + leading * .06) + leading * (.022 + Math.abs(bank) * .03) + extension * .09 + rail * side,
                hipZ - .04 - this.lean * side * .18 - leading * .10 + sweep + load * .12,
            );
            if (!p.air || opening > 0) {
                const turnReach = Math.abs(bank) * (.09 + (1 + leading) * .054);
                const railReach = p.rail ? .135 : 0;
                const settledWrist = new T.Vector3(
                    hipX + side * (.345 + leading * .02 + turnReach + railReach + p.landing * .055),
                    hipY - .153 + leading * .031 + turnReach * .7 + railReach * .68 + load * .072 + p.landing * .13,
                    hipZ - .023 - leading * .078 - this.lean * side * .21 + rail * side,
                );
                wrist.lerp(settledWrist, p.air ? opening * .65 : 1);
            }
            if (!p.air && !p.rail) {
                // Carving arms: the front hand leads forward over the nose at waist-chest height, the rear hand stays low
                // by the back knee; past ~0.8 g at speed the inside hand reaches down toward the snow.
                const cw = T.MathUtils.smoothstep(Math.abs(carve), .15, .7) * speedWeight;
                const inside = -Math.sign(this.lean || 1);                    // rig z of the turn's inside (toe = -z)
                if (leading > 0) wrist.add(new T.Vector3(side * .13 * cw, .14 * cw, inside * .06 * cw));
                else wrist.add(new T.Vector3(-side * .05 * cw, -.05 * cw, inside * .10 * cw));
                const drag = T.MathUtils.smoothstep(Math.abs(carve), .75, 1.15) * T.MathUtils.smoothstep(p.speed, 8, 14);
                if (drag > 0 && leading < 0) wrist.lerp(new T.Vector3(hipX + side * .30, .26, inside * .46), drag * .85);
            }
            wrist.lerp(new T.Vector3(hipX + side * .21, hipY + .04, hipZ + .14), tuck * (1 - load));
            if (p.hold && leading > 0) wrist.copy(p.hold);
            if (!p.air) {
                const reach = .577 + Math.abs(bank) * .011;
                wrist.sub(shoulder).clampLength(0, reach).add(shoulder);
            }
            const kind = this.activeGrabKind, grabSide = handWeights[1] > 0 && handWeights[0] === 0 ? 1 : 0, grab = handWeights[i] * this.grabWeight;
            const handContact = handWeights[0] && handWeights[1] ? this.grabContact(kind, lead, i) : contact;
            const handTarget = new T.Vector3(handContact.x, handContact.y + .103, handContact.z * 1.12);
            wrist.lerp(handTarget, grab);
            // Non-grabbing arm reaches away to balance, not through the torso.
            if (i !== grabSide && handWeights[i] === 0 && this.grabWeight > .01) {
                wrist.x += side * this.grabWeight * .06;
                wrist.y += this.grabWeight * .08;
            }
            const elbowPole = shoulder.clone().add(p.air
                ? new T.Vector3(side * .36, -.31, kind === 2 && grab > 0 ? .38 : -.37)
                : new T.Vector3(side * .16, -.32, .21));
            this.wristSprings[i].step(wrist, 5, p.dt, wrist);
            const ik = this.arms[i].pose(shoulder, wrist, elbowPole);
            this.cuffs[i].position.copy(ik.end);
            this.hands[i].position.copy(ik.end);
            const forearm = ik.end.clone().sub(ik.joint).normalize();
            const handDirection = grab > 0 ? forearm.clone().lerp(handContact.clone().sub(ik.end).normalize(), grab).normalize() : forearm;
            this.hands[i].quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), handDirection);
            this.cuffs[i].quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), forearm);
        }
        this.fitJacket(flex, p.dt);
        this.flexBoard(p.air ? 0 : p.press ?? 0, p.air ? 0 : Math.max(p.landing, load * .5), p.dt);
    }
    /**
     * On a lift: standing on the board (sit 0) blending to seated (sit 1). Seated: hips 0.58 m above the board and 0.38 m
     * behind it (the board rests on the chair's footrest), knees up, back against the backrest, hands on the safety bar or
     * the knees. The board stays strapped on, as riders keep at least the front foot in.
     */
    poseSeated(o: SeatedPose) {
        const k = T.MathUtils.clamp(o.sit, 0, 1), s = k * k * (3 - 2 * k), lerp = T.MathUtils.lerp;
        const stanceHalf = this.realBoard?.stanceHalf ?? .39;
        this.crouch = springStep(this.crouchSpring, .1, 4, o.dt);
        this.pelvis.position.set(0, lerp(1.145 - this.crouch, .80, s), lerp(-.03, .42, s));
        this.pelvis.rotation.set(lerp(-.02, .2, s), 0, 0);
        this.pelvis.updateMatrix();
        this.torso.position.copy(this.pelvis.position);
        this.torso.rotation.set(lerp(-.12, .17, s), lerp(-.06, 0, s), 0);
        this.torso.updateMatrix();
        this.shellMatrix.copy(this.torso.matrix).invert();
        this.garmentEnvelope.fill(0);
        this.grabWeight = springStep(this.grabSpring, 0, 5, o.dt);
        const look = (o.look ?? 0) + Math.sin(o.time * .23) * .35 * s;
        this.head.rotation.y = T.MathUtils.damp(this.head.rotation.y, lerp(-.5, look, s), 3, o.dt);
        this.head.rotation.x = T.MathUtils.damp(this.head.rotation.x, lerp(.04, .12 + Math.sin(o.time * .17) * .08, s), 3, o.dt);
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            const ankle = new T.Vector3(side * stanceHalf, .305, 0), hip = new T.Vector3(side * .17, -.015, 0).applyMatrix4(this.pelvis.matrix);
            const kneePole = new T.Vector3(side * .34, lerp(.57, 1.4, s), lerp(-.65, -1.1, s));
            const knee = this.legs[i].pose(hip, ankle, kneePole).joint;
            this.sampleTrouser(this.legs[i], hip, knee);
            const shoulder = new T.Vector3(side * .263, .41, 0).applyMatrix4(this.torso.matrix);
            const rest = new T.Vector3(side * .36, this.pelvis.position.y - .15, this.pelvis.position.z - .03);
            const seated = o.hands === 'bar' ? new T.Vector3(side * .25, this.pelvis.position.y + .36, -.12)
                : o.hands === 'knees' ? new T.Vector3(side * .19, knee.y + .07, knee.z + .1)
                : new T.Vector3(side * .42, this.pelvis.position.y + .02, this.pelvis.position.z - .05);
            const wrist = rest.lerp(seated, s);
            this.wristSprings[i].step(wrist, 4, o.dt, wrist);
            const ik = this.arms[i].pose(shoulder, wrist, shoulder.clone().add(new T.Vector3(side * .3, -.3, .22)));
            this.cuffs[i].position.copy(ik.end); this.hands[i].position.copy(ik.end);
            const forearm = ik.end.clone().sub(ik.joint).normalize();
            this.hands[i].quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), forearm);
            this.cuffs[i].quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), forearm);
        }
        this.fitJacket(.08 + .32 * s, o.dt);
        this.flexBoard(0, 0, o.dt);
    }
    /** Visible board flex: a press bends the unweighted end up (nose / tail press), landings bend both ends up. */
    private flexBoard(press: number, load: number, dt: number) {
        const mesh = this.boardMesh; if (!mesh) return;
        const fs = this.flexState;
        fs.press = T.MathUtils.damp(fs.press, T.MathUtils.clamp(press, -1, 1), 14, dt);
        fs.load = T.MathUtils.damp(fs.load, T.MathUtils.clamp(load, 0, 1), 14, dt);
        const pos = mesh.geometry.attributes.position as T.BufferAttribute;
        if (!this.boardRest || this.boardRest.length !== pos.array.length) this.boardRest = Float32Array.from(pos.array as Float32Array);
        if (Math.abs(fs.press) < .01 && fs.load < .01 && (mesh.userData.flexed ?? 0) === 0) return;
        const rest = this.boardRest, half = (this.realBoard?.length ?? 1.9) / 2;
        for (let i = 0; i < pos.count; i++) {
            const x = rest[i * 3] / half;
            const lift = .085 * Math.max(0, -Math.sign(fs.press) * x) ** 2 * Math.abs(fs.press) + .03 * fs.load * x * x;
            pos.setY(i, rest[i * 3 + 1] + lift);
        }
        pos.needsUpdate = true; mesh.geometry.computeVertexNormals();
        mesh.userData.flexed = Math.abs(fs.press) < .01 && fs.load < .01 ? 0 : 1;
    }
    dispose() { this.legs.forEach(x => x.dispose()); this.arms.forEach(x => x.dispose()); this.jacket.bumpMap?.dispose(); this.deck.map?.dispose(); this.baseMap.dispose(); this.alpineBaseMap?.dispose(); }
}
