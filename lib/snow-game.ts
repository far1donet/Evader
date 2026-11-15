import { preset, GRAVITY, groundAcceleration, snowMaterial, ridgeHeight, makeAlpineSky } from './alpine.ts';
import { GearPreview, type GearView } from './gear-preview.ts';
import { LA_CHAUX_FEATURES, FIRST_KICKER, approach, kickerAt, kickerRise, parkFlightX, parkFlightSideSpeed, type ParkFlight } from './park-jumps.ts';
import { makeAlpineForest } from './alpine-forest.ts';
import { BoardTracks } from './board-tracks.ts';
import { PowderSpray } from './powder-spray.ts';
import { boardAcrossRail, crossesRail, makeParkRails, railRideHeight, type ParkRail } from './park-rails.ts';
import * as T from 'three';
import { RiderRig, type RiderKit } from './rider-rig.ts';
import { BOARD_WAIST_M } from './snowboard-gear.ts';
import { rotationStep, landingWindow, completedRotation, landingTime, airPhase, TAU } from './trick-motion.ts';
import { springStep, VectorSpring, type Spring } from './motion.ts';
import { RealityRide, PHYSICS_VERSION } from './reality-ride.ts';
import { IDLE_INTENT, type AssistLevel, type RiderIntent, type Stance } from './sim/rider-controller.ts';
import { GRABS, type FreestyleEvent } from './sim/freestyle.ts';
import { BOARDS, type BoardCategory } from './sim/boards.ts';
import { readGamepad, type PadConfig } from './input.ts';
import { Diagnostics } from './diagnostics.ts';
import { verbierRun, lapseTemperature, RUNS as VERBIER_RUNS, type RunClass } from './verbier/terrain.ts';
import { liftGroup, poleGroup, skicrossGroup, skicrossShape } from './verbier/scenery.ts';
import { SNOW, type SnowMaterial } from './sim/snow.ts';
import { makeCloudSea } from './verbier/cloud-sea.ts';

/** Snow depth on a real-terrain run: groomed inside the piste width, deeper and varied off-piste, deepest on cold,
 *  north-facing, high slopes; an itinerary is ungroomed everywhere. Depths are game estimates, not measurements. */
/** Snow surface on a real-terrain run (guide section 07): groomed piste, hardpack in mogul fields, ice on very steep
 *  faces, sun crust on south-facing slopes, wind-packed snow on high exposed ground. Otherwise chosen from depth. */
export function demSurface(x: number, d: number, c: Course, weather: string): SnowMaterial | undefined {
    const run = verbierRun(c.dem!);
    if (run.mogulAmplitude(x, d) > .2) return SNOW.hardpack;
    if (Math.abs(x - run.centreX(d)) < run.pisteHalfWidth) return undefined;
    const s = run.slopeAt(x, d);
    if (s.deg > 40) return SNOW.icy;
    if (weather !== 'snow' && s.downN < -.35 && s.elevation < 2700) return SNOW.crust;
    if (s.elevation > 2700 && s.deg < 28 && weather !== 'snow') return SNOW.windPacked;
    return undefined;
}
function demSnowDepth(x: number, d: number, c: Course) {
    const run = verbierRun(c.dem!);
    const off = Math.abs(x - run.centreX(d)) - run.pisteHalfWidth;
    if (off < 0) return .025;
    const s = run.slopeAt(x, d);
    const north = Math.max(0, s.downN);                     // 1 = faces north (shaded, keeps powder)
    const alt = Math.min(1, Math.max(0, (s.elevation - 1700) / 1200));
    const steep = Math.max(0, 1 - Math.max(0, s.deg - 30) / 15); // very steep faces hold little loose snow
    const ramp = run.pisteHalfWidth === 0 ? 1 : Math.min(1, off / 8); // itineraries are ungroomed right on the line
    return .025 + ramp * steep * (.08 + .22 * alt + .14 * north);
}
export type Mode = 'freeride' | 'slopestyle' | 'time-trial' | 'training';
export type PhysicsModel = 'reality' | 'classic';
export type Settings = {
    autoLand?: boolean;
    /** 'reality' = rigid-body snowboard simulation (lib/sim). 'classic' = the original v0.4 model. Undefined = classic. */
    physics?: PhysicsModel;
    assistLevel?: AssistLevel;
    board?: BoardCategory;
    stance?: Stance;
    padDeadzone?: number;
    padCurve?: number;
    padSensitivity?: number;
    invertLean?: boolean;
    diagnostics?: boolean;
    /** Phones: 'tilt' = steer by tilting, jump/spin/flip/grab by touch gestures (no buttons); 'buttons' = stick + buttons. */
    phoneControls?: 'tilt' | 'buttons';
    /** Degrees of tilt for a full edge (smaller = more sensitive), and whether left/right tilt is inverted. */
    tiltSensitivity?: number;
    invertTilt?: boolean;
    quality: string;
    renderScale?: number;
    volume: number;
    assist: boolean;
    motion: boolean;
    weather: string;
    fov: number;
};
export type { RiderKit } from './rider-rig.ts';
export type Look = {
    jacket: string;
    board: string;
    kit?: RiderKit;
};
export type Course = {
    classicFeatures?: boolean;
    originalKickers?: boolean;
    packedSnow?: boolean;
    id: number;
    name: string;
    region: string;
    subtitle: string;
    length: number;
    drop: number;
    difficulty: string;
    spacing: number;
    rails: number;
    seed: number;
    /** Real-terrain course: id of a Verbier run (lib/verbier). Its height comes from the DEM; no procedural banks. */
    dem?: string;
    /** Published piste class of a real-terrain run. */
    runClass?: RunClass;
};
/** Real-terrain runs in Verbier – 4 Vallées (lib/verbier): mapped run lines on swissALTI3D 2 m terrain. */
const CLASS_LABEL: Record<string, string> = { blue: 'BLUE', red: 'RED', black: 'BLACK', itinerary: 'ITINERARY', park: 'PARK', skicross: 'SKI CROSS' };
const VERBIER_COURSES: Course[] = VERBIER_RUNS.map((r, i) => ({
    id: 10 + i, name: r.name, region: 'VERBIER · 4 VALLÉES', subtitle: r.description, length: r.length,
    drop: Math.round(r.startElevation - r.endElevation), difficulty: CLASS_LABEL[r.klass] ?? r.klass.toUpperCase(), spacing: 1e9,
    rails: r.klass === 'park' ? 4 : 0, seed: 300 + i, dem: r.id, runClass: r.klass as RunClass,
}));
/** A playable course for any resort route (station to station along mapped pistes). Load it with loadRun first. */
export function routeCourse(r: { id: string; name: string; description: string; klass: string; length: number; drop: number }, index = 0): Course {
    return { id: 1000 + index, name: r.name, region: 'VERBIER · 4 VALLÉES', subtitle: r.description, length: r.length, drop: r.drop,
        difficulty: CLASS_LABEL[r.klass] ?? r.klass.toUpperCase(), spacing: 1e9, rails: r.klass === 'park' ? 4 : 0, seed: 500 + index, dem: r.id, runClass: r.klass as RunClass };
}
export const COURSES: Course[] = [
    { id: 0, name: 'AIGUILLE NOIRE', region: 'THE ALPINE RANGE', subtitle: 'Big lines. Bigger possibilities.', length: 1600, drop: 416, difficulty: 'INTERMEDIATE', spacing: 190, rails: 5, seed: 27 },
    { id: 1, name: 'NORTHLINE PARK', region: 'THE NORTHERN RIDGE', subtitle: 'A perfectly imperfect playground.', length: 1200, drop: 300, difficulty: 'BEGINNER', spacing: 125, rails: 8, seed: 56 },
    { id: 2, name: 'WHITEOUT PASS', region: 'THE HIGH BACKCOUNTRY', subtitle: 'Find your way through the wild.', length: 1900, drop: 494, difficulty: 'ADVANCED', spacing: 260, rails: 2, seed: 91 },
    ...VERBIER_COURSES,
];
export type Frame = {
    t: number;
    x: number;
    d: number;
    y: number;
    heading: number;
    spin: number;
    flip: number;
    grab: boolean;
    tuck?: boolean;
    speed?: number;
    vy?: number;
    airTime?: number;
    ground?: boolean;
    load?: number;
    pop?: number;
    extension?: number;
    landing?: number;
    spinVelocity?: number;
    flipVelocity?: number;
    grabKind?: number;
    rail?: boolean;
    spinInput?: number;
    edge?: number;
    edgeAngle?: number;
    skidAngle?: number;
    landingPitch?: number;
    landingSpin?: number;
    /** Reality physics: board orientation quaternion (x, y, z, w) of the rendered rig, and rider posture. */
    q?: [number, number, number, number];
    crouch?: number;
    twist?: number;
    crashed?: boolean;
};
export type Run = {
    /** Physics model that produced the frames; replays never re-simulate, they interpolate recorded state. */
    physics?: string;
    terrainRevision?: 2 | 3 | 4 | 5;
    course: Course;
    mode: Mode;
    score: number;
    time: number;
    distance: number;
    tricks: number;
    bails: number;
    gates: number;
    totalGates: number;
    frames: Frame[];
};
export type HUD = {
    speed: number;
    score: number;
    time: number;
    distance: number;
    progress: number;
    combo: number;
    trick: string;
    trickScore: number;
    feedback: string;
    air: boolean;
    gates: number;
    totalGates: number;
    /** Real-terrain runs: rider altitude (m, from the DEM) and air temperature from the altitude lapse rate (deg C). */
    altitude?: number;
    temperature?: number;
};
const clamp = T.MathUtils.clamp;
/** Air temperature at Verbier village (1,500 m) per weather setting: game assumptions for a winter day. */
const VILLAGE_TEMP: Record<string, number> = { clear: -4, dusk: -7, snow: -6 };
const GRAB_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'BracketRight'];
const DAYLIGHT = new T.Vector3(-158, 118, -95);
const DUSK_LIGHT = new T.Vector3(-158, 48, -95);
const HARD_LANDING_SPEED = 8.5;
const CHASE_HEIGHT = 2.0;
const CHASE_DISTANCE = 5.0;
export function center(d: number, c: Course) { if (c.dem) return verbierRun(c.dem).centreX(d); return Math.sin(d / (c.id === 2 ? 125 : 220)) * (c.id === 1 ? 6 : 16); }
export function rampAt(d: number, x: number, c: Course) {
    if (c.dem === 'la-chaux-park') {
        // Park lanes side by side (S, M, L): every feature whose footprint contains this point adds its rise.
        let h = 0;
        for (const f of LA_CHAUX_FEATURES) {
            const t = d - f.base; if (t < 0 || t > f.profile.runout) continue;
            h += kickerRise(t, Math.abs(x - (center(f.base + f.profile.lip, c) + f.x)), f.profile);
        }
        return h;
    }
    const { base, profile, exists } = kickerAt(d, c);
    if (!exists) return 0;
    const offset = Math.abs(x - center(base + (c.classicFeatures ? 12 : profile.lip), c));
    return kickerRise(d - base, offset, profile);
}
function bankRise(x: number, d: number, c: Course, legacy = false) {
 const edge = Math.max(0, Math.abs(x - center(d, c)) - 23);
 if (legacy) return edge * edge * .024;
 const pitch = c.id === 1 ? .012 : c.id === 2 ? .021 : .017;
 const shoulder = pitch * edge ** 2 / (1 + edge / 17);
 const drifts = 2.35 * Math.sin(d * .034 + x * .09) + .8 * Math.sin(d * .085 - x * .22);
 return shoulder + T.MathUtils.smoothstep(edge, 0, 22) * drifts;
}
export function snowDepth(x: number, d: number, c: Course) {
    if (c.dem) return demSnowDepth(x, d, c);
    if (c.packedSnow) return .025;
    const offset = Math.abs(x - center(d, c));
    const groomedEdge = c.id === 2 ? 8 : c.id === 1 ? 13 : 11;
    const shoulder = T.MathUtils.smoothstep(offset, groomedEdge, groomedEdge + 10);
    const backcountry = T.MathUtils.smoothstep(offset, groomedEdge + 5, groomedEdge + 15);
    const wind = .5 + .22 * Math.sin(d * .047 + x * .21 + c.seed)
        + .17 * Math.cos(d * .023 - x * .14) + .09 * Math.sin(x * .41 + d * .092);
    return .025 + shoulder * (.07 + .09 * wind) + backcountry * (.10 + .32 * wind);
}
export function height(x: number, d: number, c: Course) {
 if (c.dem) { const run = verbierRun(c.dem); return run.height(x, d) + rampAt(d, x, c) + (c.dem === 'la-chaux-skicross' ? skicrossShape(run, x, d) : 0); }
 const buildup = Math.max(0, snowDepth(x, d, c) - .04);
 return 180 - d * (c.drop / c.length) + Math.sin(d * .024) * .9
    + Math.sin(x * .15 + d * .012) * .25 + bankRise(x, d, c) + rampAt(d, x, c)
    + buildup * (.74 + .23 * Math.sin(x * .73 - d * .18 + .9 * Math.cos(d * .12)));
}
function supportHeight(x: number, d: number, c: Course, speed: number) {
    const depth = Math.max(0, snowDepth(x, d, c) - .045);
    const float = T.MathUtils.smoothstep(speed, 3, 21);
    return height(x, d, c) - depth * (.44 - float * .27);
}
/** 0 outside a kicker, 1 on its takeoff ramp, 2 on its knuckle / landing. Used to pick park snow for the simulation. */
export function parkZone(x: number, d: number, c: Course): 0 | 1 | 2 {
    if (c.dem === 'la-chaux-park') {
        for (const f of LA_CHAUX_FEATURES) {
            const t = d - f.base; if (t < 0 || t > f.profile.runout) continue;
            if (Math.abs(x - (center(f.base + f.profile.lip, c) + f.x)) > f.profile.shoulder) continue;
            return t <= f.profile.lip ? 1 : 2;
        }
        return 0;
    }
    const k = kickerAt(d, c);
    if (!k.exists) return 0;
    const off = Math.abs(x - center(k.base + (c.classicFeatures ? 12 : k.profile.lip), c));
    if (off > k.profile.shoulder) return 0;
    const t = d - k.base;
    return t >= 0 && t <= k.profile.lip ? 1 : t > k.profile.lip && t <= k.profile.runout ? 2 : 0;
}
const RIG_FLIP = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
export function pathSlope(x:number,d:number,heading:number,c:Course) {
 const dx=Math.sin(heading)*.05, dd=Math.cos(heading)*.05;
 return (height(x+dx,d+dd,c)-height(x-dx,d-dd,c))/.1;
}
export function landingScore(spin: number, flip: number, grabTime: number, airTime: number, repeat: number, grabKind = 0) {
    const degrees = completedRotation(spin, Math.PI) * 180, flips = completedRotation(flip, TAU);
    const name = [flips ? `${flips > 1 ? 'DOUBLE ' : ''}${flip < 0 ? 'FRONTFLIP' : 'BACKFLIP'}` : '', degrees ? `${degrees}°` : '', grabTime > .16 ? ['INDY', 'MUTE', 'MELON'][grabKind] : ''].filter(Boolean).join(' ') || 'STRAIGHT AIR';
    const base = 90 + degrees * 1.35 + flips * 550 + (grabTime > .16 ? 170 + grabTime * 90 : 0);
    return { name, score: Math.round(base * (1 + Math.min(airTime, 3) * .14) * Math.max(.35, 1 - repeat * .18)) };
}
export class SnowGame {
    parkFlight?: ParkFlight;
    replayLandingPitch?: number;
    replayLandingSpin?: number;
    sky = makeAlpineSky();
    environmentTarget?: T.WebGLRenderTarget;
    renderer: T.WebGLRenderer;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(62, 1, .1, 3600);
    world = new T.Group();
    rider = new T.Group();
    body = new T.Group();
    jacket: T.MeshStandardMaterial;
    boardMat: T.MeshStandardMaterial;
    rig!: RiderRig;
    physicsAccumulator = 0;
    steerFilter = 0;
    edgeAngle = 0;
    skidAngle = 0;
    landingImpact = 0;
    visualGrab = false;
    cameraFocus = new T.Vector3();
    cameraSpring = new VectorSpring();
    focusSpring = new VectorSpring();
    steerSpring: Spring = { value: 0, velocity: 0 };
    previous?: {
        x: number;
        y: number;
        d: number;
        heading: number;
        spin: number;
        flip: number;
    };
    visualTuck = false;
    clock = new T.Clock();
    settings: Settings;
    look: Look;
    course = COURSES[0];
    mode: Mode = 'freeride';
    state: 'menu' | 'ride' | 'pause' | 'result' | 'replay' | 'garage' = 'menu';
    keys = new Set<string>();
    touch = new Set<string>();
    frameId = 0;
    /** True while another full-screen view (the resort map) owns the GPU: the game stops rendering. */
    suspended = false;
    resizeObserver: ResizeObserver;
    private readonly host: HTMLElement;
    private readonly gearPreview: GearPreview;
    private garageHost?: HTMLElement;
    spinInput = 0;
    spinVelocity = 0;
    flipVelocity = 0;
    spinOrigin = 0;
    flipOrigin = 0;
    load = 0;
    pop = 0;
    extension = 0;
    grabContactTime = 0;
    grabKind = 0;
    grabLocked = -1;
    lastGrabKind = 0;
    jumpPending = false;
    jumpReleased = false;
    x = 0;
    d = 0;
    y = 180;
    vy = 0;
    speed = 0;
    heading = 0;
    spin = 0;
    flip = 0;
    airTime = 0;
    grabTime = 0;
    ground = true;
    lastRamp = -1;
    score = 0;
    time = 0;
    tricks = 0;
    bails = 0;
    combo = 1;
    flowTimer = 0;
    bailTimer = 0;
    trick = '';
    trickScore = 0;
    feedback = '';
    toastTimer = 0;
    gateCount = 0;
    gateIndex = 0;
    frames: Frame[] = [];
    recordTimer = 0;
    repeats = new Map<string, number>();
    run?: Run;
    replayTime = 0;
    replayPlaying = true;
    photo = false;
    cameraMode = 0;
    photoAngle = 0;
    features: T.Group[] = [];
    obstacles: {
        x: number;
        d: number;
        r: number;
    }[] = [];
    rails: ParkRail[] = [];
    railActive = -1;
    railTime = 0;
    railDone = new Set<number>();
    powder: PowderSpray;
    boardTracks: BoardTracks;
    snow: T.Points;
    snowPositions: Float32Array;
    audio?: AudioContext;
    noiseGain?: GainNode;
    noiseFilter?: BiquadFilterNode;
    onHUD: (h: HUD) => void;
    onEnd: (r: Run) => void;
    onPause: () => void;
    hudTimer = 0;
    performanceTime = 0;
    performanceFrames = 0;
    performanceLabel?: HTMLDivElement;
    /** Reality physics ride (undefined in Classic mode, in menus and in the headless legacy tests). */
    reality?: RealityRide;
    realityEvents: FreestyleEvent[] = [];
    /** Rendered board orientation from the simulation, and the one from the previous 120 Hz tick for interpolation. */
    renderQ = new T.Quaternion(); prevRenderQ = new T.Quaternion(); replayHasQ = false;
    intent: RiderIntent = { ...IDLE_INTENT };
    keySteer = 0;
    /** Selected grab (index into GRABS) for Reality physics. */
    realityGrab = 0;
    padLatch = new Set<string>();
    /** On-screen thumb-stick (phones): x = edge / steer, y = fore-aft pressure (+ = forward), each -1..1. */
    stick = { x: 0, y: 0 };
    /** Tilt + gesture input (phones). `fingers` touching the screen; drag offsets give shoulder wind and flip throw. */
    gesture = { enabled: false, steer: 0, lean: 0, brake: 0, tuck: false, fingers: 0, wind: 0, flip: 0, side: 1, startedInAir: false };
    private gestureKeys = new Set<string>();
    padId = '';
    diagnostics?: Diagnostics;
    crashVisual = 0;
    constructor(host: HTMLElement, settings: Settings, look: Look, onHUD: (h: HUD) => void, onEnd: (r: Run) => void, onPause: () => void) {
        this.host = host;
        this.settings = settings;
        this.look = look;
        this.onHUD = onHUD;
        this.onEnd = onEnd;
        this.onPause = onPause;
        this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, preset(settings.quality).pixel) * (settings.renderScale ?? 1));
        this.renderer.shadowMap.enabled = settings.quality !== 'low';
        this.renderer.shadowMap.type = T.PCFShadowMap;
        this.renderer.toneMapping = T.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.renderer.setSize(host.clientWidth, host.clientHeight, false);
        this.camera.aspect = host.clientWidth / host.clientHeight;
        this.camera.updateProjectionMatrix();
        host.appendChild(this.renderer.domElement);
        this.performanceLabel=document.createElement('div');
        this.performanceLabel.className='performance-label';
        this.performanceLabel.textContent='Preparing terrain…';
        host.appendChild(this.performanceLabel);
        this.diagnostics = new Diagnostics(host);
        this.diagnostics.setVisible(!!settings.diagnostics);
        this.renderer.domElement.setAttribute('aria-label', '3D snowboarding mountain');
        this.scene.add(this.world);
        // High-key alpine light: strong low sun, shadows filled by the blue sky (snow shadows read blue, not grey).
        this.scene.add(new T.HemisphereLight(0xaecbff, 0x8ea4bd, 1.2));
        const sun = new T.DirectionalLight(0xfff0da, 3.1);
        sun.position.copy(DAYLIGHT);
        sun.castShadow = true;
        sun.shadow.mapSize.set(preset(settings.quality).shadow, preset(settings.quality).shadow);
        sun.shadow.camera.left = -92;
        sun.shadow.camera.right = 92;
        sun.shadow.camera.top = 92;
        sun.shadow.camera.bottom = -92;
        sun.shadow.radius = 3;
        sun.shadow.camera.far = 700;
        sun.shadow.normalBias = .015;
        sun.shadow.bias = -.0001;
        this.scene.add(sun);
        this.scene.add(sun.target);
        sun.name = 'sun';
        this.sky.material.uniforms.sunDirection.value.copy(DAYLIGHT);
        this.scene.add(this.sky);
        const reflectionScene = new T.Scene();
        reflectionScene.add(this.sky.clone());
        const pmrem = new T.PMREMGenerator(this.renderer);
        this.environmentTarget = pmrem.fromScene(reflectionScene, .04, .1, 5000);
        this.scene.environment = this.environmentTarget.texture;
        this.scene.environmentIntensity = .52;
        pmrem.dispose();
        this.jacket = new T.MeshPhysicalMaterial({ color: look.jacket, roughness: .78, sheen: .8, sheenRoughness: .6, sheenColor: 0x8faaa7 });
        this.boardMat = new T.MeshPhysicalMaterial({ color: look.board, roughness: .24, metalness: .04, clearcoat: 1, clearcoatRoughness: .19 });
        this.makeRider();
        this.setLook(look);
        this.scene.add(this.rider);
        this.gearPreview = new GearPreview(this.rider, this.rig.board, this.environmentTarget.texture);
        this.powder = new PowderSpray(settings.quality);
        this.scene.add(this.powder.points);
        this.boardTracks = new BoardTracks((x, d) => height(x, d, this.course));
        this.scene.add(this.boardTracks.mesh);
        this.snowPositions = new Float32Array(400 * 3);
        for (let i = 0; i < 400; i++) {
            this.snowPositions[i * 3] = Math.random() * 110 - 55;
            this.snowPositions[i * 3 + 1] = Math.random() * 45;
            this.snowPositions[i * 3 + 2] = Math.random() * 150 - 110;
        }
        const sg = new T.BufferGeometry();
        sg.setAttribute('position', new T.BufferAttribute(this.snowPositions, 3));
        this.snow = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: .12, transparent: true, opacity: .7 }));
        this.scene.add(this.snow);
        this.buildWorld();
        this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver.observe(host);
        window.addEventListener('keydown', this.keydown);
        window.addEventListener('keyup', this.keyup);
        window.addEventListener('blur', this.blur);
        document.addEventListener('visibilitychange', this.visibility);
        this.tick();
    }
    mesh(g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, parent: T.Object3D = this.body) { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
    makeRider() { this.rider.add(this.body); this.rig = new RiderRig(this.body, this.jacket, this.boardMat); this.rig.setBoard(BOARDS[this.settings?.board ?? 'all-mountain']); }
    private resizeCanvas() {
        const host = this.garageHost ?? this.host;
        const { clientWidth: width, clientHeight: height } = host;
        if (!width || !height) return;
        const camera = this.garageHost ? this.gearPreview.camera : this.camera;
        this.renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    setGarageHost(host?: HTMLElement) {
        if (host === this.garageHost) return;
        this.resizeObserver.unobserve(this.garageHost ?? this.host);
        this.garageHost = host;
        const target = host ?? this.host;
        target.appendChild(this.renderer.domElement);
        this.renderer.domElement.setAttribute('aria-label', host ? '3D rider and snowboard preview' : '3D snowboarding mountain');
        if (host) {
            this.gearPreview.scene.add(this.rider);
            this.rider.position.set(0, 0, 0);
            this.rider.rotation.set(0, 0, 0);
            this.body.quaternion.identity();
        } else {
            this.scene.add(this.rider);
            this.rider.visible = true;
        }
        this.resizeObserver.observe(target);
        this.resizeCanvas();
    }
    setGearView(view: GearView) { this.gearPreview.setView(view); }
    rotateGearView(radians: number) { this.gearPreview.rotate(radians); }
    buildWorld() {
        this.world.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.LineSegments) {
            if (o instanceof T.InstancedMesh) o.dispose();
            o.geometry.dispose();
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            ms.forEach(m => m.dispose());
        } });
        this.world.clear();
        this.obstacles = [];
        this.rails = [];
        this.features = [];
        const c = this.course;
        let seed = c.seed;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const detail = preset(this.settings.quality);
        const piste = snowMaterial(c.length, c.spacing, c.id === 1, detail.step <= 1.5);
        const nx = Math.ceil(118 / detail.step);
        const makePisteTile = (start: number, span: number, step: number) => {
            const g = new T.PlaneGeometry(2, span, nx, Math.ceil(span / step));
            g.rotateX(-Math.PI / 2);
            g.translate(0, 0, -start - span / 2);
            const p = g.attributes.position;
            const colors = new Float32Array(p.count * 3);
            const centers = new Float32Array(p.count * 2);
            const paint = new Float32Array(p.count * 3);
            const depths = new Float32Array(p.count);
            const normals = new Float32Array(p.count * 3);
            for (let i = 0; i < p.count; i++) {
                const u = p.getX(i), d = -p.getZ(i), line = center(d, c);
                const x = 150 * (.33 * u + .67 * u ** 3) + line * (1 - u * u);
                p.setXYZ(i, x, height(x, d, c), -d);
                const dx = (height(x - .12, d, c) - height(x + .12, d, c)) / .24;
                const dz = (height(x, d + .12, c) - height(x, d - .12, c)) / .24;
                const scale = 1 / Math.hypot(dx, 1, dz);
                normals[i * 3] = dx * scale;
                normals[i * 3 + 1] = scale;
                normals[i * 3 + 2] = dz * scale;
                const wind = Math.sin(x * .16 + d * .085) * Math.cos(x * .072 - d * .12);
                const depth = snowDepth(x, d, c);
                const powder = T.MathUtils.smoothstep(depth, .07, .44);
                const snow = .86 + .07 * wind * powder;
                colors[i * 3] = snow * (.93 - .035 * powder);
                colors[i * 3 + 1] = snow * (.97 - .02 * powder);
                colors[i * 3 + 2] = snow;
                if (c.dem) {
                    // Real terrain: faces steeper than ~40 degrees shed snow and show rock.
                    const rock = 1 - T.MathUtils.smoothstep(scale, .74, .84);
                    if (rock > 0) { colors[i * 3] = T.MathUtils.lerp(colors[i * 3], .36, rock); colors[i * 3 + 1] = T.MathUtils.lerp(colors[i * 3 + 1], .38, rock); colors[i * 3 + 2] = T.MathUtils.lerp(colors[i * 3 + 2], .42, rock); }
                }
                depths[i] = depth;
                centers[i * 2] = line;
                const { base, profile, exists } = kickerAt(d, c);
                centers[i * 2 + 1] = center(base + (c.classicFeatures ? 12 : profile.lip), c);
                paint[i * 3] = exists && !c.dem ? profile.lip : -100; // the lip dye assumes evenly spaced legacy kickers
                paint[i * 3 + 1] = profile.width;
                paint[i * 3 + 2] = profile.knuckle;
            }
            g.setAttribute('color', new T.BufferAttribute(colors, 3));
            g.setAttribute('pisteCenters', new T.BufferAttribute(centers, 2));
            g.setAttribute('kickerPaint', new T.BufferAttribute(paint, 3));
            g.setAttribute('snowDepth', new T.BufferAttribute(depths, 1));
            g.setAttribute('normal', new T.BufferAttribute(normals, 3));
            const ground = new T.Mesh(g, piste);
            ground.receiveShadow = true;
            return ground;
        };
        // Coarsen distant rows while sharing identical vertices at tile boundaries.
        for (let start = -60; start < c.length + 160; start += 100) {
            const span = Math.min(100, c.length + 160 - start);
            const near = makePisteTile(start, span, detail.step);
            if (detail.step > 1.5) {
                this.world.add(near);
                continue;
            }
            const far = makePisteTile(start, span, 3.6);
            const tile = new T.LOD();
            tile.position.z = -start - span / 2;
            near.position.z = far.position.z = -tile.position.z;
            tile.addLevel(near, 0);
            tile.addLevel(far, 175, .1);
            this.world.add(tile);
        }
        // Snow-capped ridgelines are real world geometry, surrounding the rideable terrain.
        for (let side of [-1, 1]) {
            const mg = new T.PlaneGeometry(1750, c.length + 1900, detail.ridge, detail.ridge);
            mg.rotateX(-Math.PI / 2);
            mg.translate(side * 1025, 0, -c.length / 2);
            const mp = mg.attributes.position;
            const heights = new Float32Array(mp.count);
            for (let i = 0; i < mp.count; i++) {
                const x = mp.getX(i), d = -mp.getZ(i), dist = Math.abs(x);
                const ridge = T.MathUtils.smoothstep(dist, 150, 720);
                const massif = 1 - Math.abs(Math.sin(d * .0037 + x * .0044 + c.seed));
                const gullies = ridgeHeight(x + side * 346, d + c.seed * 15);
                const crest = 90 + 440 * massif ** 1.45 + 255 * gullies;
                const valley = height(side * 150, d, c) - 1;
                // Real-terrain courses: the surrounding mountains are the DEM itself.
                const h = c.dem ? height(x, d, c) - (dist < 160 ? 1 : 0) : valley + ridge * (crest - Math.max(0, dist - 1120) * .38);
                heights[i] = h;
                mp.setY(i, h);
            }
            mg.computeVertexNormals();
            const cs = new Float32Array(mp.count * 3), n = mg.attributes.normal;
            const snow = new T.Color(0xe8eff8), stone = new T.Color(0x596479), color = new T.Color();
            for (let i = 0; i < mp.count; i++) {
                const x = mp.getX(i), d = -mp.getZ(i);
                const strata = Math.sin(heights[i] * .077 + x * .044 + d * .032) * .13;
                // Real terrain (30 m DEM) rarely exceeds 45 degrees, so rock starts showing from ~33 degrees, and wind-scoured
                // high ground (above ~2,900 m) shows more rock, as in the guide's high-alpine biome.
                const demRock = c.dem ? (1 - T.MathUtils.smoothstep(n.getY(i) + strata * .5, .72, .86)) * (.75 + .25 * T.MathUtils.smoothstep(heights[i], 2600, 3000)) : 0;
                const cliff = c.dem ? demRock : 1 - T.MathUtils.smoothstep(n.getY(i) + strata, .39, .83);
                const exposed = cliff * (c.dem ? T.MathUtils.smoothstep(Math.abs(x), 150, 260) : T.MathUtils.smoothstep(Math.abs(x), 172, 390));
                color.copy(snow).lerp(stone, exposed * .91).toArray(cs, i * 3);
            }
            mg.setAttribute('color', new T.BufferAttribute(cs, 3));
            const mm = new T.Mesh(mg, new T.MeshStandardMaterial({ vertexColors: true, roughness: .94, envMapIntensity: .48 }));
            mm.receiveShadow = true;
            this.world.add(mm);
        }
        const trees = c.dem ? this.realTrees(c, detail.trees) : Array.from({ length: detail.trees }, (_, index) => {
            const canReach = index < 300;
            const sample = rand() * c.length;
            const side = rand() > .5 ? 1 : -1;
            const d = canReach ? sample : clamp(sample + side * 19 * Math.sin(sample * .033 + c.seed), 0, c.length);
            const offset = rand();
            const middle = center(d, c);
            const glade = 86 + 10 * Math.cos(d * .037 + side * 3);
            const x = canReach ? middle + side * (26 + offset * 100)
                : middle + side * T.MathUtils.lerp(glade, 145 - side * middle, offset);
            const treeHeight = 7 + rand() * 11;
            if (canReach) this.obstacles.push({ x, d, r: 1.25 });
            return { x, y: height(x, d, c), d, height: treeHeight, index };
        }).filter((t): t is NonNullable<typeof t> => t !== null);
        this.world.add(makeAlpineForest(trees));
        const obj = new T.Object3D();
        seed=c.seed+981; // Stable obstacle layout across all graphics presets.
        const rockG = new T.IcosahedronGeometry(1, 2);
        // Real terrain already carries its rock outcrops (2 m DEM, rock-coloured by slope): no invented boulders there.
        const rocks = new T.InstancedMesh(rockG, new T.MeshStandardMaterial({ color: 0x73828a, roughness: 1 }), c.dem ? 0 : 100);
        rocks.castShadow = true;
        for (let i = 0; i < (c.dem ? 0 : 100); i++) {
            const d = rand() * c.length, x = center(d, c) + (rand() > .5 ? 1 : -1) * (33 + rand() * 55);
            this.obstacles.push({x,d,r:3});
            obj.position.set(x, height(x, d, c), -d);
            obj.scale.set(2 + rand() * 4, 2 + rand() * 3, 2 + rand() * 3);
            obj.rotation.set(rand(), rand(), rand());
            obj.updateMatrix();
            rocks.setMatrixAt(i, obj.matrix);
        }
        this.world.add(rocks);
        if (c.dem) {
            const run = verbierRun(c.dem), h = (x: number, d: number) => height(x, d, c);
            this.world.add(liftGroup(run, h), poleGroup(run, h, d => center(d, c)));
            if (c.dem === 'la-chaux-skicross') this.world.add(skicrossGroup(run, h));
        }
        const poleMat = new T.MeshStandardMaterial({ color: 0x18343d, roughness: .54 });
        const flagMat = new T.MeshStandardMaterial({ color: 0x56d2ca, side: T.DoubleSide, roughness: .8 });
        const kickerBases: number[] = [];
        const laneOf = (base: number) => LA_CHAUX_FEATURES.find(f => f.base === base)?.x ?? 0;
        if (c.dem === 'la-chaux-park') kickerBases.push(...LA_CHAUX_FEATURES.map(f => f.base));
        else if (!c.dem) for (let d = FIRST_KICKER; d < c.length - 50; d += c.spacing) kickerBases.push(d);
        for (const d of kickerBases) {
            const { profile, exists } = kickerAt(d, c);
            if (!exists) continue;
            const lip = d + profile.lip, line = center(c.classicFeatures ? d + 12 : lip, c) + (c.dem === 'la-chaux-park' ? laneOf(d) : 0);
            const group = new T.Group();
            for (let side of [-1, 1]) {
                const x = line + side * (profile.width + 2.5), y = height(x, lip, c);
                this.mesh(new T.CylinderGeometry(.07, .07, 3), poleMat, x, y + 1.5, -lip, group);
                this.mesh(new T.PlaneGeometry(1.7, .7), flagMat, x + side * .8, y + 2.7, -lip, group);
            }
            this.world.add(group);
        }
        this.rails = makeParkRails(c, d => center(d, c), (x, d) => height(x, d, c), poleMat);
        for (const rail of this.rails) this.world.add(rail.mesh);
        // Real-terrain runs: no gates or finish banner; the run ends at the mapped lift station (drawn with the lifts).
        for (let i = 1; i <= (c.dem ? 0 : Math.floor(c.length / 180) - 1); i++) {
            const d = i * 180, x = center(d, c), group = new T.Group();
            for (const side of [-1, 1]) {
                this.mesh(new T.CylinderGeometry(.065, .065, 3.8), poleMat, x + side * 12, height(x + side * 12, d, c) + 1.9, -d, group);
                this.mesh(new T.PlaneGeometry(1.2, 1.3), new T.MeshStandardMaterial({ color: 0xff7967, side: T.DoubleSide }), x + side * 11.4, height(x + side * 12, d, c) + 2.8, -d, group);
            }
            this.world.add(group);
            this.features.push(group);
        }
        const finish = new T.Group(), fd = c.length - 10, fx = center(fd, c), fy = height(fx, fd, c);
        for (const side of [-1, 1])
            this.mesh(new T.BoxGeometry(.4, 8, .4), poleMat, fx + side * 20, fy + 4, -fd, finish);
        this.mesh(new T.BoxGeometry(40, 1, .5), flagMat, fx, fy + 8, -fd, finish);
        if (!c.dem) this.world.add(finish);
        // Real terrain: valley cloud sea (winter inversion) below the lowest station, in clear weather.
        if (c.dem) this.world.add(makeCloudSea(new T.Vector3(center(c.length / 2, c), 0, -c.length / 2)));
        this.setAtmosphere();
        this.x = center(0, c);
        this.y = height(this.x, 0, c);
        this.rider.position.set(this.x, this.y, 0);
        this.camera.position.set(this.x + 11, this.y + 5, 16);
        this.camera.lookAt(this.x, this.y + 1, -15);
    }
    /** Trees detected in SWISSIMAGE for a real-terrain run, thinned to the graphics preset; near ones are solid. */
    realTrees(c: Course, budget: number) {
        const run = verbierRun(c.dem!), t = run.trees, n = t.length / 3, keep = Math.min(n, Math.max(budget * 3, 1500));
        const out: { x: number; y: number; d: number; height: number; index: number }[] = [];
        for (let k = 0; k < keep; k++) {
            const i = Math.floor(k * n / keep), x = t[i * 3], d = t[i * 3 + 1];
            if (Math.abs(x - center(d, c)) < 140) this.obstacles.push({ x, d, r: 1.1 });
            out.push({ x, y: height(x, d, c), d, height: t[i * 3 + 2], index: k });
        }
        return out;
    }
    setAtmosphere() {
        const weather = this.settings.weather;
        const dusk = weather === 'dusk', snowing = weather === 'snow';
        const horizon = dusk ? 0xd6a9a8 : snowing ? 0xb5c9d6 : 0xd5e5f5;
        // High-altitude real terrain: clearer air (guide section 13.4), so distant ridges keep their contrast.
        const clarity = this.course?.dem ? .32 : 1;
        this.scene.fog = new T.FogExp2(horizon, (snowing ? .0045 : dusk ? .0011 : .00066) * (snowing ? 1 : clarity));
        this.snow.visible = snowing;
        this.scene.environmentIntensity = dusk ? .35 : .52;
        const sun = this.scene.getObjectByName('sun') as T.DirectionalLight;
        sun.color.set(dusk ? 0xffae83 : snowing ? 0xdbe8fa : 0xfff0da);
        sun.intensity = snowing ? .85 : dusk ? 2.1 : 3.1;
        this.powder.setSun(dusk ? DUSK_LIGHT : DAYLIGHT);
        const sea = this.world.getObjectByName('cloud-sea') as T.Mesh<T.BufferGeometry, T.ShaderMaterial> | undefined;
        if (sea) { sea.visible = !snowing; sea.material.uniforms.sunDirection.value.copy(dusk ? DUSK_LIGHT : DAYLIGHT).normalize(); }
        const { uniforms } = this.sky.material;
        uniforms.zenith.value.set(dusk ? 0x4d6294 : snowing ? 0x8faabd : 0x2a68b4);
        uniforms.horizon.value.set(horizon);
        uniforms.sunDirection.value.copy(dusk ? DUSK_LIGHT : DAYLIGHT);
        uniforms.clouds.value = snowing ? .35 : dusk ? .58 : .74;   // clear: scattered cloud, deep blue sky
        uniforms.sunStrength.value = snowing ? .03 : 1;
    }
    setCourse(c: Course) { this.powder.clear(); this.course = c; this.state = 'menu'; this.boardTracks.clear(); this.buildWorld(); }
    setLook(look: Look) {
        this.look = look;
        this.jacket.color.set(look.jacket);
        this.boardMat.color.set(look.board);
        this.rig.setKit(look.kit);
    }
    setSettings(s: Settings) {
        const changed=this.settings.quality!==s.quality;
        if ((this.settings.board ?? 'all-mountain') !== (s.board ?? 'all-mountain')) this.rig.setBoard(BOARDS[s.board ?? 'all-mountain']);
        this.settings=s;
        if (changed) this.powder.setQuality(s.quality);
        const detail=preset(s.quality);
        this.renderer.setPixelRatio(Math.min(devicePixelRatio,detail.pixel) * (s.renderScale ?? 1));
        this.renderer.shadowMap.enabled=s.quality!=='low';
        const sun=this.scene.getObjectByName('sun') as T.DirectionalLight;
        if(sun.shadow.mapSize.x!==detail.shadow){sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(detail.shadow,detail.shadow);}
        this.camera.fov=s.fov;this.camera.updateProjectionMatrix();this.setAtmosphere();
        this.diagnostics?.setVisible(!!s.diagnostics);
        if (this.reality) this.configureReality(this.reality);
        if(changed && (this.state==='menu'||this.state==='garage')) this.buildWorld();
    }
    start(mode: Mode) { this.powder.clear(); if (this.course.classicFeatures || this.course.originalKickers || this.course.packedSnow) this.setCourse({ ...this.course, classicFeatures: false, originalKickers: false, packedSnow: false }); this.parkFlight = undefined; this.mode = mode; this.state = 'ride'; this.x = center(0, this.course); this.d = 0; this.y = height(this.x, 0, this.course); this.vy = 0; this.speed = 12; this.heading = 0; this.steerFilter = 0; this.edgeAngle = 0; this.skidAngle = 0; this.steerSpring = { value: 0, velocity: 0 }; this.previous = undefined; this.physicsAccumulator = 0; this.landingImpact = 0; this.spin = 0; this.flip = 0; this.spinVelocity = 0; this.flipVelocity = 0; this.load = 0; this.pop = 0; this.extension = 0; this.jumpPending = false; this.jumpReleased = false; this.grabLocked = -1; this.grabKind = 0; this.grabContactTime = 0; this.visualGrab = false; this.visualTuck = false; this.spinInput = 0; this.ground = true; this.score = 0; this.time = 0; this.tricks = 0; this.bails = 0; this.combo = 1; this.bailTimer = 0; this.lastRamp = -1; this.frames = []; this.repeats.clear(); this.railDone.clear(); this.railActive = -1; this.gateCount = 0; this.gateIndex = 0; this.flowTimer = 0; this.toastTimer = 3; this.trick = ''; this.trickScore = 0; this.recordTimer = 0; this.frames.push(this.snapshot()); this.feedback = mode === 'training' ? 'Hold SPACE to load, release to pop · Q / E spin · SHIFT grab' : 'Find your line'; this.photo = false; this.keys.clear(); this.touch.clear(); this.boardTracks.clear(); this.reality = undefined; if (this.settings.physics === 'reality') this.startReality(); this.camera.position.set(this.x, this.y + CHASE_HEIGHT, CHASE_DISTANCE); this.cameraFocus.set(this.x, this.y + 1.05, -5.15); this.cameraSpring.reset(this.camera.position); this.focusSpring.reset(this.cameraFocus); this.initAudio(); this.audio?.resume().catch(() => { }); }
    configureReality(ride: RealityRide) {
        const w = this.settings.weather;
        ride.configure({
            assist: this.settings.assistLevel ?? 'balanced', stance: this.settings.stance ?? 'regular',
            freshSnow: w === 'snow' ? .6 : 0,
            // Steady cross-slope breeze; stronger in a snowstorm (m/s).
            wind: w === 'snow' ? { x: 3.2, z: 1.1 } : w === 'dusk' ? { x: -1.2, z: .4 } : { x: .8, z: 0 },
        });
    }
    startReality() {
        const c = this.course;
        const rails = this.rails.map(r => ({ x: r.x, d: r.d, end: r.end, width: r.width, top: r.top, slope: r.slope, round: r.name === 'LONG TUBE' }));
        const weather = this.settings.weather;
        const ride = new RealityRide({ height: (x, d) => height(x, d, c), snowDepth: (x, d) => snowDepth(x, d, c), center: d => center(d, c), parkZone: (x, d) => parkZone(x, d, c),
            surface: c.dem ? (x, d) => demSurface(x, d, c, weather) : undefined }, rails, this.settings.board ?? 'all-mountain');
        this.configureReality(ride);
        this.reality = ride;
        // A rider drops in from a standstill with a short push (about 3 m/s); gravity does the rest.
        // Real-terrain runs start on summits and stations where the fall line can point anywhere: face along the mapped line.
        ride.place(center(2, c), 2, 3, c.dem ? Math.atan2(1, (center(12, c) - center(2, c)) / 10) : undefined);
        this.syncReality(1 / 120);
        this.prevRenderQ.copy(this.renderQ);
        this.feedback = this.mode === 'training'
            ? 'A/D edge · S speed check · hold SPACE to crouch, release to pop · hold Q/E while crouched to wind a spin · SHIFT grab (1–9, 0, -, = choose)'
            : 'Find your line';
    }
    initAudio() { if (this.audio)
        return; try {
        this.audio = new AudioContext();
        const b = this.audio.createBuffer(1, this.audio.sampleRate * 2, this.audio.sampleRate);
        const data = b.getChannelData(0);
        for (let i = 0; i < data.length; i++)
            data[i] = Math.random() * 2 - 1;
        const src = this.audio.createBufferSource();
        src.buffer = b;
        src.loop = true;
        this.noiseFilter = this.audio.createBiquadFilter();
        this.noiseFilter.type = 'lowpass';
        this.noiseFilter.frequency.value = 500;
        this.noiseGain = this.audio.createGain();
        this.noiseGain.gain.value = 0;
        src.connect(this.noiseFilter).connect(this.noiseGain).connect(this.audio.destination);
        src.start();
    }
    catch { /* Silent play remains available. */ } }
    sound(freq: number, duration = .12) { if (!this.audio || this.settings.volume === 0)
        return; const osc = this.audio.createOscillator(), gain = this.audio.createGain(); osc.frequency.setValueAtTime(freq, this.audio.currentTime); osc.frequency.exponentialRampToValueAtTime(freq * .4, this.audio.currentTime + duration); gain.gain.setValueAtTime(this.settings.volume * .08, this.audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + duration); osc.connect(gain).connect(this.audio.destination); osc.start(); osc.stop(this.audio.currentTime + duration); }
    keydown = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest('input,textarea,[role="slider"],[role="combobox"],[role="tablist"]'))
        return; const k = e.code; if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k))
        e.preventDefault(); if (!e.repeat) {
        if (k === 'Escape' && this.state === 'ride') {
            this.state = 'pause';
            this.keys.clear();
            this.onPause();
        }
        else if (k === 'KeyR' && this.state === 'ride')
            this.resetMarker();
        else if (k === 'KeyC')
            this.cameraMode = (this.cameraMode + 1) % 3;
        else if (k === 'Space' && this.state === 'ride')
            this.prepareJump();
        else if (['Digit1', 'Digit2', 'Digit3'].includes(k) && !this.reality)
            this.grabKind = Number(k.slice(-1)) - 1;
        else if (this.reality && GRAB_KEYS.includes(k))
            this.realityGrab = GRAB_KEYS.indexOf(k);
    } this.keys.add(k); };
    keyup = (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === 'Space')
        this.jumpReleased = true; };
    blur = () => { this.keys.clear(); this.touch.clear(); if (this.state === 'ride') {
        this.state = 'pause';
        this.onPause();
    } };
    visibility = () => { if (document.hidden)
        this.blur(); };
    /** Thumb-stick input. Classic physics has no analog steering, so the stick also drives the A/D keys there. */
    setStick(x: number, y: number) {
        this.stick.x = clamp(x, -1, 1); this.stick.y = clamp(y, -1, 1);
        const left = this.stick.x < -.35, right = this.stick.x > .35;
        if (left) this.touch.add('KeyA'); else this.touch.delete('KeyA');
        if (right) this.touch.add('KeyD'); else this.touch.delete('KeyD');
    }
    /** Tilt reading from the phone (already calibrated and shaped by the page). */
    setTilt(steer: number, lean: number) {
        const g = this.gesture;
        g.steer = clamp(steer, -1, 1);
        g.lean = clamp(lean, -1, 1);
        g.tuck = lean > .85;
        g.brake = clamp((-lean - .55) / .45, 0, 1);
    }
    /** Touch gesture state from the page. A touch that starts in the air is a grab until it lifts, never a crouch. */
    setGesture(fingers: number, wind: number, flip: number, side: number) {
        const g = this.gesture;
        if (g.fingers === 0 && fingers > 0) g.startedInAir = !this.ground;
        g.fingers = fingers; g.wind = clamp(wind, -1, 1); g.flip = clamp(flip, -1, 1); g.side = side;
    }
    /** Classic physics reads keys, so gestures are translated to the same virtual keys it already understands. */
    private applyGestureKeys() {
        const g = this.gesture, want = new Set<string>();
        if (g.steer > .3) want.add('KeyD'); if (g.steer < -.3) want.add('KeyA');
        if (g.tuck) want.add('KeyW'); if (g.brake > .3) want.add('KeyS');
        if (g.fingers > 0) want.add(g.startedInAir || !this.ground ? 'ShiftLeft' : 'Space');
        if (g.wind > .4) want.add('KeyE'); if (g.wind < -.4) want.add('KeyQ');
        if (g.flip > .4) want.add('KeyX'); if (g.flip < -.4) want.add('KeyV');
        for (const k of this.gestureKeys) if (!want.has(k)) this.press(k, false);
        for (const k of want) if (!this.gestureKeys.has(k)) this.press(k, true);
        this.gestureKeys = want;
    }
    press(k: string, on: boolean) { if (on) {
        this.touch.add(k);
        if (k === 'Space')
            this.prepareJump();
    }
    else {
        this.touch.delete(k);
        if (k === 'Space')
            this.jumpReleased = true;
    } }
    resetMarker() { if (this.reality) { this.powder?.clear(); this.boardTracks?.breakTrail(); this.reality.place(center(this.d, this.course), this.d, 3); this.syncReality(1 / 120); this.prevRenderQ.copy(this.renderQ); this.previous = undefined; this.combo = 1; this.bails++; this.toast('Line reset'); return; } this.powder?.clear(); this.boardTracks?.breakTrail(); this.parkFlight = undefined; this.edgeAngle = 0; this.skidAngle = 0; this.x = center(this.d, this.course); this.y = height(this.x, this.d, this.course); this.vy = 0; this.ground = true; this.heading = 0; this.spin = 0; this.flip = 0; this.speed = 10; this.combo = 1; this.railActive = -1; this.bails++; this.jumpPending = false; this.load = 0; this.spinVelocity = 0; this.flipVelocity = 0; this.previous = undefined; this.toast('Line reset'); }
    prepareJump() { if (this.ground && this.state === 'ride' && this.bailTimer <= 0) {
        this.jumpPending = true;
        this.jumpReleased = false;
        this.load = 0;
    } }
    jump(power = 3.6) { if (this.ground && this.state === 'ride' && this.bailTimer <= 0) {
        this.ground = false;
        this.parkFlight = undefined;
        this.vy = power + this.speed * pathSlope(this.x,this.d,this.heading,this.course);
        this.spinOrigin = this.spin;
        this.flipOrigin = this.flip;
        this.spinVelocity = 0;
        this.flipVelocity = 0;
        this.airTime = 0;
        this.grabTime = 0;
        this.grabContactTime = 0;
        this.grabLocked = -1;
        this.jumpPending = false;
        this.jumpReleased = false;
        this.load = 0;
        this.pop = 1;
        this.extension = 0;
        this.sound(160);
    } }
    launchKicker(lipX: number, lipD: number, base: number, profile: ReturnType<typeof kickerAt>['profile']) {
        this.y = supportHeight(lipX, lipD, this.course, this.speed);
        this.jump(0);
        const slope = pathSlope(lipX, lipD - .16, this.heading, this.course);
        this.vy = this.speed * slope;
        if (!this.settings.autoLand || this.course.classicFeatures) return;

        const downhillSpeed = this.speed * Math.cos(this.heading);
        const lateralSpeed = this.speed * Math.sin(this.heading);
        if (downhillSpeed < 8 || Math.abs(this.heading) > .5) return;
        const naturalVy = this.vy;
        const landingCenter = center(lipD, this.course);
        let bestCost = Infinity;
        for (let targetD = base + profile.knuckle + 3; targetD <= base + profile.runout - 3; targetD += 1) {
            const duration = (targetD - lipD) / downhillSpeed;
            if (duration > 3.5) break;
            const freeX = lipX + lateralSpeed * duration;
            const targetX = clamp(freeX, landingCenter - profile.width * .8, landingCenter + profile.width * .8);
            if (Math.abs(targetX - freeX) > 6.5) continue;
            const targetLateralSpeed = clamp(lateralSpeed + (targetX - freeX) / duration, -1.8, 1.8);
            const heading = Math.atan2(targetLateralSpeed, downhillSpeed);
            const targetSpeed = Math.hypot(downhillSpeed, targetLateralSpeed);
            const launchVy = (supportHeight(targetX, targetD, this.course, targetSpeed) - this.y) / duration + .5 * GRAVITY * duration;
            const adjustment = Math.abs(launchVy - naturalVy);
            if (launchVy < 0 || adjustment > 3.2) continue;
            const deckD = base + profile.knuckle;
            const deckTime = (deckD - lipD) / downhillSpeed;
            const deckX = approach(lipX, lateralSpeed, targetX, targetLateralSpeed, deckTime, duration);
            if (this.y + launchVy * deckTime - .5 * GRAVITY * deckTime ** 2 <= height(deckX, deckD, this.course)) continue;
            const forwardSlope = pathSlope(targetX, targetD, heading, this.course);
            const crossSlope = pathSlope(targetX, targetD, heading + Math.PI / 2, this.course);
            const impact = (targetSpeed * forwardSlope - (launchVy - GRAVITY * duration))
                / Math.hypot(1, forwardSlope, crossSlope);
            if (impact <= 0 || impact >= HARD_LANDING_SPEED - .35) continue;
            const cost = adjustment + .16 * impact + .12 * Math.abs(targetX - freeX);
            if (cost >= bestCost) continue;
            bestCost = cost;
            this.vy = launchVy;
            this.parkFlight = { duration, originX: lipX, lateralSpeed, targetX, targetLateralSpeed, downhillSpeed, landingPitch: Math.atan(forwardSlope) };
        }
    }
    alignParkLanding(flight: ParkFlight, dt: number) {
        const remaining = flight.duration - this.airTime;
        const timeToOpen = clamp(.39 + .019 * (Math.abs(this.spinVelocity) + Math.abs(this.flipVelocity)), .39, .57);
        if (!flight.alignment && remaining <= timeToOpen) {
            const stopTime = timeToOpen * .4;
            const window = landingWindow(this.spin + this.spinVelocity * stopTime, this.flip + this.flipVelocity * stopTime, true);
            flight.alignment = {
                start: this.airTime - dt,
                spin: this.spin, spinRate: this.spinVelocity, spinTarget: window.spinTarget,
                flip: this.flip, flipRate: this.flipVelocity, flipTarget: window.flipTarget,
            };
        }
        const a = flight.alignment;
        if (!a) return false;
        const elapsed = this.airTime - a.start, duration = flight.duration - a.start;
        const spin = approach(a.spin, a.spinRate, a.spinTarget, 0, elapsed, duration);
        const flip = approach(a.flip, a.flipRate, a.flipTarget, 0, elapsed, duration);
        this.spinVelocity = (spin - this.spin) / dt;
        this.flipVelocity = (flip - this.flip) / dt;
        this.spin = spin;
        this.flip = flip;
        return true;
    }
    toast(message: string, score = 0) { this.trick = message; this.trickScore = score; this.toastTimer = 2.7; }
    bail(message = 'BAIL') { this.parkFlight = undefined; this.jumpPending = false; this.load = 0; this.spinVelocity = 0; this.flipVelocity = 0; this.combo = 1; this.bails++; this.bailTimer = 1; this.ground = true; this.visualGrab = false; this.vy = 0; this.speed = 5; this.railActive = -1; this.toast(message); this.feedback = 'Combo lost'; this.sound(70, .3); }
    land(spinOffset = 0) {
        const guided = this.parkFlight?.alignment;
        if (guided) {
            this.spin = guided.spinTarget;
            this.flip = guided.flipTarget;
        }
        this.parkFlight = undefined;
        const window = landingWindow(this.spin - spinOffset, this.flip, this.settings.assist || this.mode === 'training');
        if (!window.valid) {
            this.bail('UNDER-ROTATED');
            return false;
        }
        const spin = this.spin - this.spinOrigin, flip = this.flip - this.flipOrigin;
        const key = `${completedRotation(spin, Math.PI)}-${this.grabTime > .16 ? this.lastGrabKind : -1}-${completedRotation(flip, TAU)}`;
        const result = landingScore(spin, flip, this.grabTime, this.airTime, this.repeats.get(key) || 0, this.lastGrabKind);
        const freeDismount = boardAcrossRail(this.spinOrigin) && result.name === 'STRAIGHT AIR';
        if (!freeDismount) this.repeats.set(key, (this.repeats.get(key) || 0) + 1);
        if (this.airTime > .25 && !freeDismount) {
            if (this.flowTimer > 0)
                this.combo = Math.min(5, this.combo + .5);
            const pts = Math.round(result.score * this.combo);
            this.score += pts;
            this.tricks++;
            this.feedback = guided ? 'PARK LANDING' : window.spinError < .09 && window.flipError < .09 ? 'PERFECT LANDING' : window.spinError > Math.PI / 10 || window.flipError > Math.PI / 10 ? 'ASSISTED LANDING' : 'CLEAN LANDING';
            this.toast(result.name, pts);
            this.flowTimer = 8;
            this.sound(380, .1);
        }
        // Retain continuous angles (including switch stance) across contact.
        this.ground = true;
        this.vy = 0;
        this.spinVelocity = 0;
        this.flipVelocity = 0;
        this.visualGrab = false;
        this.landingImpact = Math.min(1, .25 + this.airTime * .32);
        return true;
    }
    finish() { this.frames.push(this.snapshot()); this.state = 'result'; const run: Run = { physics: this.reality ? PHYSICS_VERSION : 'classic-0.4', terrainRevision: 5, course: this.course, mode: this.mode, score: this.score, time: this.time, distance: this.d, tricks: this.tricks, bails: this.bails, gates: this.gateCount, totalGates: this.features.length, frames: this.frames }; this.run = run; this.onEnd(run); }
    replay(run: Run) {
        this.powder?.clear();
        const revision = run.terrainRevision ?? 1;
        const classicFeatures = revision < 3, originalKickers = revision === 3, packedSnow = revision < 5;
        if (this.course.seed !== run.course.seed || this.course.spacing !== run.course.spacing || this.course.rails !== run.course.rails || !!this.course.classicFeatures !== classicFeatures || !!this.course.originalKickers !== originalKickers || !!this.course.packedSnow !== packedSnow) {
            this.course = { ...run.course, classicFeatures, originalKickers, packedSnow };
            this.boardTracks?.clear();
            this.buildWorld();
        }
        this.powder?.clear();
        this.run = run;
        this.previous = undefined;
        this.state = 'replay';
        this.replayTime = 0;
        this.replayPlaying = true;
        this.photo = false;
        this.cameraMode = 0;
    }
    setReplayTime(t: number) { const time = clamp(t, 0, this.run?.time || 0); if (time !== this.replayTime) this.powder?.clear(); this.replayTime = time; }
    getHUD(): HUD { return { speed: Math.round(this.speed * 3.6), score: this.score, time: this.time, distance: Math.round(this.d), progress: this.d / this.course.length, combo: this.combo, trick: this.toastTimer > 0 ? this.trick : '', trickScore: this.trickScore, feedback: this.feedback, air: !this.ground, gates: this.gateCount, totalGates: this.features.length , ...(this.course.dem ? { altitude: Math.round(this.y), temperature: Math.round(lapseTemperature(this.y, VILLAGE_TEMP[this.settings.weather] ?? -6)) } : {}) }; }
    tick = () => { this.frameId = requestAnimationFrame(this.tick); const dt = Math.min(this.clock.getDelta(), .10); if (this.suspended) return; if (this.state === 'ride') {
        this.physicsAccumulator += dt;
        let substeps = 0;
        while (this.physicsAccumulator >= 1 / 120 && substeps++ < 12) {
            this.previous = { x: this.x, y: this.y, d: this.d, heading: this.heading, spin: this.spin, flip: this.flip };
            this.update(1 / 120);
            this.physicsAccumulator -= 1 / 120;
            if (this.state !== 'ride')
                break;
        }
    }
    else
        this.physicsAccumulator = 0; if (this.state === 'replay')
        this.updateReplay(dt);
        const inspectingGear = this.state === 'garage' && this.garageHost;
        if (inspectingGear) {
            if (this.gearPreview.showsRider) {
                const headwear = this.gearPreview.view === 'headwear';
                this.rig.pose({ dt, time: performance.now() * .001, turn: 0, speed: headwear ? 0 : 12, air: false, grab: false, landing: 0, menu: headwear });
            }
            this.gearPreview.update(dt);
        } else {
            this.visual(dt);
        }
        if (this.noiseGain && this.audio) {
        this.noiseGain.gain.setTargetAtTime(this.state === 'ride' ? this.settings.volume * (.015 + this.speed * .002) : 0, this.audio.currentTime, .2);
        this.noiseFilter!.frequency.setTargetAtTime(this.ground ? 350 + this.speed * 25 : 1600, this.audio.currentTime, .2);
    }
        if (inspectingGear) this.renderer.render(this.gearPreview.scene, this.gearPreview.camera);
        else this.renderer.render(this.scene, this.camera);
        if (this.diagnostics?.visible) {
            const r = this.reality, sim = r?.sim;
            this.diagnostics.frame(dt, { quality: this.settings.quality, renderer: this.renderer, physicsMs: r?.lastTickMs ?? 0, physics: r ? `Reality 960 Hz · ${BOARDS[r.board].name} · ${r.ctl.assist}` : 'Classic 120 Hz',
                particles: this.powder.activeCount?.() ?? 0, contacts: sim?.diag.contacts ?? 0, speed: this.speed, slip: r ? r.ctl.slipAngle(sim!) : this.skidAngle, edge: sim?.edgeAngle ?? this.edgeAngle,
                legForce: sim?.legAxial ?? 0, balance: sim?.balanceLoad ?? 0, terrainEvals: r?.terrain.evaluations ?? 0 });
            if (r) r.terrain.evaluations = 0;
        }
        this.performanceTime+=dt;this.performanceFrames++;
        if(this.performanceTime>=1 && this.performanceLabel){
            this.performanceLabel.textContent=`${this.settings.quality.toUpperCase()} · ${Math.round(this.performanceFrames/this.performanceTime)} FPS · ${this.renderer.domElement.width} × ${this.renderer.domElement.height}`;
            this.performanceTime=0;this.performanceFrames=0;
        }
    };
    update(dt: number) {
        if (this.reality) { this.updateReality(dt); return; }
        if (this.gesture?.enabled) this.applyGestureKeys();
        this.time += dt;
        this.bailTimer = Math.max(0, this.bailTimer - dt);
        this.flowTimer = Math.max(0, this.flowTimer - dt);
        if (this.flowTimer === 0)
            this.combo = 1;
        this.toastTimer = Math.max(0, this.toastTimer - dt);
        const active = (k: string) => this.keys.has(k) || this.touch.has(k);
        let steer = (active('KeyD') || active('ArrowRight') ? 1 : 0) - (active('KeyA') || active('ArrowLeft') ? 1 : 0);
        let brake = active('KeyS') || active('ArrowDown'), boost = active('KeyW') || active('ArrowUp'), spin = (active('KeyE') ? 1 : 0) - (active('KeyQ') ? 1 : 0), grab = active('ShiftLeft') || active('ShiftRight'), flip = (active('KeyX') ? 1 : 0) - (active('KeyV') ? 1 : 0);
        const pad = Array.from(navigator.getGamepads?.() || []).find(p => p && p.connected);
        if (pad) {
            const ax = pad.axes[0] || 0;
            steer = Math.abs(ax) > .12 ? ax : steer;
            brake ||= !!pad.buttons[6]?.pressed;
            boost ||= !!pad.buttons[7]?.pressed;
            grab ||= !!pad.buttons[4]?.pressed;
            spin = Math.abs(pad.axes[2] || 0) > .2 ? pad.axes[2] : spin;
            if (pad.buttons[2]?.pressed)
                flip = 1;
            const jump = pad.buttons[0]?.pressed;
            if (jump && !this.keys.has('PadJump'))
                this.prepareJump();
            if (!jump && this.keys.has('PadJump'))
                this.jumpReleased = true;
            if (jump)
                this.keys.add('PadJump');
            else
                this.keys.delete('PadJump');
            if (pad.buttons[9]?.pressed && !this.keys.has('PadPause')) {
                this.keys.add('PadPause');
                this.state = 'pause';
                this.onPause();
                return;
            }
            if (!pad.buttons[9]?.pressed)
                this.keys.delete('PadPause');
        }
        this.spinInput = spin;
        this.visualTuck = !!boost;
        this.landingImpact = Math.max(0, this.landingImpact - dt * 2.6);
        const kicker = kickerAt(this.d, this.course, this.x - center(this.d, this.course));
        const lipD = kicker.base + kicker.profile.lip;
        const kickerCenter = center(kicker.base + (this.course.classicFeatures ? 12 : kicker.profile.lip), this.course) + (kicker.x ?? 0);
        const onApproach = kicker.exists && this.d < lipD && Math.abs(this.x - kickerCenter) < kicker.profile.width + 1;
        if (this.jumpPending) {
            this.load = Math.min(1, this.load + dt / .38);
            const bufferAtLip = this.settings.autoLand && onApproach && lipD - this.d < 6 && this.speed > 8;
            if (this.jumpReleased && this.load >= .28 && !bufferAtLip)
                this.jump(2.4 + this.load * 1.4);
        }
        else
            this.load = 0;
        if (this.bailTimer > 0)
            steer = 0;
        this.steerSpring ??= { value: 0, velocity: 0 };
        this.steerFilter = springStep(this.steerSpring, steer, 3.2, dt);
        if (this.ground) {
            const rail = this.rails[this.railActive];
            const powder = rail ? 0 : T.MathUtils.smoothstep(snowDepth(this.x, this.d, this.course), .055, .50);
            const grade = rail?.slope ?? pathSlope(this.x, this.d, 0, this.course);
            const crossGrade = rail ? 0 : pathSlope(this.x, this.d, Math.PI / 2, this.course);
            const normalGravity = GRAVITY / Math.hypot(1, grade, crossGrade);
            const grip = normalGravity * T.MathUtils.lerp(.94, .54, powder);
            const fallLine = clamp(Math.atan2(-crossGrade, Math.max(.22, -grade)), -.34, .34);
            const edge = this.steerFilter;
            // A flatter board drifts toward the fall line. An edged board can
            // turn only as fast as the snow can push it sideways.
            const alignment = Math.sin(fallLine - this.heading) * Math.min(this.speed * .54, 8) * (1 - .4 * Math.abs(edge));
            const turnForce = clamp(edge * grip + alignment, -grip, grip);
            this.heading = clamp(this.heading + turnForce / Math.max(3.5, this.speed) * dt, -1.1, 1.1);
            this.edgeAngle = T.MathUtils.damp(this.edgeAngle ?? 0, clamp(Math.atan2(turnForce, normalGravity), -.61, .61), 10, dt);
            const skidDirection = Math.abs(edge) > .15 ? Math.sign(edge) : Math.sign(this.skidAngle || this.heading || 1);
            const skidTarget = brake ? skidDirection * .77 : edge * (.07 + .16 * powder);
            this.skidAngle = T.MathUtils.damp(this.skidAngle ?? 0, skidTarget, 9, dt);
            const brakeGrip = brake ? .39 + .45 * Math.abs(Math.sin(this.skidAngle)) : 0;
            const slope = rail?.slope ?? grade * Math.cos(this.heading) + crossGrade * Math.sin(this.heading);
            this.speed = Math.max(0, this.speed + groundAcceleration(slope, this.speed, boost, brakeGrip, edge, powder) * dt);
        } else {
            this.edgeAngle = T.MathUtils.damp(this.edgeAngle ?? 0, 0, 8, dt);
            this.skidAngle = T.MathUtils.damp(this.skidAngle ?? 0, 0, 8, dt);
        }
        const oldD = this.d, oldY = this.y, oldX = this.x, previousRail = this.railActive;
        this.railActive = -1;
        let airStep = dt;
        this.d += (this.parkFlight?.downhillSpeed ?? this.speed * Math.cos(this.heading)) * dt;
        this.x = this.parkFlight ? parkFlightX(this.parkFlight, this.airTime + dt) : this.x + Math.sin(this.heading) * this.speed * dt;
        const boundary = 70;
        this.x = clamp(this.x, center(this.d, this.course) - boundary, center(this.d, this.course) + boundary);
        let floor = supportHeight(this.x, this.d, this.course, this.speed);
        if (this.ground && previousRail >= 0) {
            const rail = this.rails[previousRail];
            if (rail && this.d <= rail.end && Math.abs(this.heading) <= .24) {
                this.railActive = previousRail;
            } else {
                this.jump(0);
                if (rail) this.vy = rail.slope * this.speed * Math.cos(this.heading);
            }
        }
        if (this.ground && !this.jumpPending && onApproach)
            this.load = rampAt(this.d, this.x, this.course) / kicker.profile.rise * .65;
        if (this.ground && previousRail < 0 && this.bailTimer === 0 && onApproach && this.d >= lipD) {
            const fraction = (lipD - oldD) / (this.d - oldD);
            const lipX = T.MathUtils.lerp(oldX, this.x, fraction);
            this.launchKicker(lipX, lipD, kicker.base, kicker.profile);
            airStep *= 1 - fraction;
            if (this.parkFlight) {
                this.x = parkFlightX(this.parkFlight, airStep);
                floor = supportHeight(this.x, this.d, this.course, this.speed);
            }
        }
        if (this.ground) {
            this.y = floor;
            const spinStep = (this.rails[this.railActive]?.width ?? 0) >= .65 ? Math.PI / 2 : Math.PI;
            this.spin = T.MathUtils.damp(this.spin, Math.round(this.spin / spinStep) * spinStep, 12, dt);
            this.flip = T.MathUtils.damp(this.flip, Math.round(this.flip / TAU) * TAU, 12, dt);
            this.pop = 0;
            this.extension = 0;
            this.visualGrab = false;
        }
        else if (airStep > 0) {
            this.airTime += airStep;
            const flight = this.parkFlight;
            const gap = Math.max(0, this.y - floor);
            const touchdown = flight ? Math.max(0, flight.duration - this.airTime)
                : landingTime(gap, this.vy - this.speed * pathSlope(this.x, this.d, this.heading, this.course));
            const phase = airPhase(this.airTime, touchdown);
            this.pop = phase.pop;
            this.extension = phase.extension;
            this.visualGrab = !!grab && this.airTime > .12 && this.extension < .5;
            if (this.visualGrab && this.grabLocked < 0) {
                this.grabLocked = this.grabKind;
                this.lastGrabKind = this.grabKind;
            }
            if (!grab)
                this.grabLocked = -1;
            // A boardslide comes off the box across the direction of travel. Open the
            // hips toward the nearest rideable stance before the short drop ends.
            const unwinding = boardAcrossRail(this.spinOrigin) && this.airTime - airStep < .23;
            if (unwinding) {
                const target = Math.round(this.spinOrigin / Math.PI) * Math.PI;
                const angle = T.MathUtils.lerp(this.spinOrigin, target, T.MathUtils.smoothstep(this.airTime, 0, .23));
                this.spinVelocity = (angle - this.spin) / airStep;
                this.spin = angle;
            } else if (!flight || !this.alignParkLanding(flight, airStep)) {
                const rotation = rotationStep(this.spinVelocity, spin, airStep, false, this.visualGrab || !!boost);
                const inversion = rotationStep(this.flipVelocity, flip, airStep, true, this.visualGrab || !!boost);
                this.spinVelocity = rotation.velocity;
                this.flipVelocity = inversion.velocity;
                this.spin += rotation.angle;
                this.flip += inversion.angle;
            }
            this.grabContactTime = this.visualGrab ? this.grabContactTime + airStep : 0;
            if (this.grabContactTime > .22)
                this.grabTime += airStep;
            this.y += this.vy * airStep - .5 * GRAVITY * airStep * airStep;
            this.vy -= GRAVITY * airStep;
            const assist = this.settings.assist || this.mode === 'training';
            const parallel = Math.abs(this.heading) <= .28 && landingWindow(this.spin, this.flip, assist).valid;
            const across = Math.abs(this.heading) <= .42 && landingWindow(this.spin - Math.PI / 2, this.flip, assist).valid;
            const caughtRail = !flight && this.bailTimer === 0 && (parallel || across) ? this.rails.findIndex((rail, i) =>
                i !== previousRail && (parallel || rail.width >= .65) && crossesRail(rail, { x: oldX, d: oldD, y: oldY }, this, airStep),
            ) : -1;
            if (caughtRail >= 0) {
                this.land(parallel ? 0 : Math.PI / 2);
                this.speed *= Math.cos(this.heading);
                this.heading = 0;
                this.railActive = caughtRail;
            } else if (this.y <= floor) {
                this.y = floor;
                const lateral = flight ? parkFlightSideSpeed(flight, this.airTime) : this.speed * Math.sin(this.heading);
                const downhill = flight?.downhillSpeed ?? this.speed * Math.cos(this.heading);
                const incomingHeading = Math.atan2(lateral, downhill);
                const forwardSlope = pathSlope(this.x, this.d, incomingHeading, this.course);
                const crossSlope = pathSlope(this.x, this.d, incomingHeading + Math.PI / 2, this.course);
                const normalLength = Math.hypot(1, forwardSlope, crossSlope);
                const incomingSpeed = Math.hypot(lateral, downhill);
                const impact = Math.max(0, (incomingSpeed * forwardSlope - this.vy) / normalLength);
                if (impact > HARD_LANDING_SPEED) this.bail('HARD LANDING');
                else if (this.land()) {
                    // Redirect velocity along the landing face, absorbing the normal impact.
                    this.landingImpact = clamp(impact / HARD_LANDING_SPEED, .12, 1);
                    const along = incomingSpeed - impact * forwardSlope / normalLength;
                    const across = -impact * crossSlope / normalLength;
                    this.speed = Math.hypot(along, across) * (1 - Math.min(.24, impact * .02));
                    this.heading = incomingHeading + Math.atan2(across, Math.max(.01, along));
                }
            }
        }
        const rail = this.rails[this.railActive];
        if (rail) {
            const boardslide = boardAcrossRail(this.spin);
            const deckHalfWidth = rail.width * .42;
            this.x = clamp(this.x, rail.x - deckHalfWidth, rail.x + deckHalfWidth);
            this.y = railRideHeight(rail, this.d);
            this.railTime += dt;
            this.feedback = `${boardslide ? 'BOARDSLIDE' : '50–50'} · ${rail.name}`;
            if (!this.railDone.has(this.railActive) && this.d > rail.end - 1 && this.railTime >= .16) {
                const pts = Math.round(((boardslide ? 240 : 180) + this.railTime * 170) * this.combo);
                this.score += pts;
                this.tricks++;
                this.railDone.add(this.railActive);
                this.flowTimer = 8;
                this.combo = Math.min(5, this.combo + .5);
                this.toast(boardslide ? 'BOARDSLIDE' : '50–50 GRIND', pts);
            }
        } else {
            this.railTime = 0;
        }
        for (const o of this.obstacles) {
            if (Math.abs(this.d - o.d) < 1.7 && Math.abs(this.x - o.x) < o.r && this.y - floor < 3 && this.bailTimer === 0) {
                this.bail('TREE STRIKE');
                this.x += this.x > center(this.d, this.course) ? -2 : 2;
                break;
            }
        }
        this.bookkeeping(dt);
    }
    /** Gates, snow tracks, replay frames, HUD and the finish line: shared by both physics models. */
    bookkeeping(dt: number) {
        const gi = Math.floor(this.d / 180);
        if (gi > this.gateIndex && gi <= this.features.length) {
            this.gateIndex = gi;
            if (Math.abs(this.x - center(gi * 180, this.course)) < 12) {
                this.gateCount++;
                if (this.mode === 'time-trial') {
                    this.score += 100;
                    this.toast('GATE CLEARED', 100);
                }
            }
            else if (this.mode === 'time-trial')
                this.toast('MISSED GATE');
        }
        if (this.boardTracks) {
            if (this.ground && this.railActive < 0 && this.bailTimer === 0 && this.speed > .25) {
                this.boardTracks.record({
                    x: this.x, d: this.d, heading: this.heading, edgeAngle: this.edgeAngle,
                    skidAngle: this.skidAngle, depth: snowDepth(this.x, this.d, this.course),
                });
            } else {
                this.boardTracks.breakTrail();
            }
        }
        this.recordTimer += dt;
        if (this.recordTimer >= 1 / 60 - 1e-8) {
            this.frames.push(this.snapshot());
            this.recordTimer -= 1 / 60;
        }
        this.hudTimer += dt;
        if (this.hudTimer > .1) {
            this.onHUD(this.getHUD());
            this.hudTimer = 0;
        }
        if (this.d >= this.course.length - 10 || this.time > (this.reality ? 600 : 240))
            this.finish();
    }
    /** Rider intent from keyboard, touch and gamepad (Reality physics). Input expresses intent; the simulation decides. */
    readIntent(dt: number): RiderIntent {
        const active = (k: string) => this.keys.has(k) || this.touch.has(k);
        const s = this.settings;
        const pad = readGamepad({ deadzone: s.padDeadzone ?? .12, curve: s.padCurve ?? 1.5, sensitivity: s.padSensitivity ?? 1, invertLean: !!s.invertLean });
        const latch = (name: string, on: boolean) => { const was = this.padLatch.has(name); if (on) this.padLatch.add(name); else this.padLatch.delete(name); return on && !was; };
        const keySteer = (this.keys.has('KeyD') || active('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || active('ArrowLeft') ? 1 : 0);
        // Keys ramp over ~0.2 s, the time a rider takes to roll from flat to a committed edge.
        this.keySteer += clamp(keySteer - this.keySteer, -dt * 5, dt * 5);
        const i = this.intent;
        const st = this.stick ?? { x: 0, y: 0 };
        i.steer = pad && pad.lx !== 0 ? pad.lx : st.x !== 0 ? st.x : this.keySteer;
        i.lean = pad && pad.ly !== 0 ? -pad.ly : st.y !== 0 ? st.y : (active('KeyF') ? 1 : 0) - (active('KeyZ') ? 1 : 0);
        i.wind = pad && pad.rx !== 0 ? pad.rx : (active('KeyE') ? 1 : 0) - (active('KeyQ') ? 1 : 0);
        i.flip = pad && pad.ry !== 0 ? pad.ry : (active('KeyX') ? 1 : 0) - (active('KeyV') ? 1 : 0);
        i.crouch = Math.max(pad?.rt ?? 0, pad?.a ? 1 : 0, active('Space') ? 1 : 0);
        i.brake = Math.max(pad?.lt ?? 0, active('KeyS') || active('ArrowDown') ? 1 : 0);
        i.tuck = active('KeyW') || active('ArrowUp') || !!pad?.y;
        i.grab = active('ShiftLeft') || active('ShiftRight') || !!pad?.lb || !!pad?.rb;
        const gz = this.gesture;
        if (gz?.enabled && !(pad && (pad.lx || pad.ly))) {
            i.steer = gz.steer; i.lean = gz.lean; i.tuck = i.tuck || gz.tuck; i.brake = Math.max(i.brake, gz.brake);
            i.wind = gz.wind || i.wind; i.flip = gz.flip || i.flip;
            if (gz.fingers > 0) {
                if (gz.startedInAir || !this.ground) {
                    i.grab = true;
                    this.realityGrab = gz.fingers > 1 ? 12 : gz.side < 0 ? 0 : 2; // truck driver / indy / melon
                } else i.crouch = 1;
            }
        }
        if (this.bailTimer > 0) Object.assign(i, IDLE_INTENT);
        if (pad) {
            this.padId = pad.id;
            if (latch('left', pad.left)) this.realityGrab = (this.realityGrab + GRABS.length - 1) % GRABS.length;
            if (latch('right', pad.right)) this.realityGrab = (this.realityGrab + 1) % GRABS.length;
            if (latch('up', pad.up)) this.cameraMode = (this.cameraMode + 1) % 3;
            if (latch('select', pad.select)) this.resetMarker();
            if (latch('start', pad.start)) { this.state = 'pause'; this.keys.clear(); this.onPause(); }
        } else this.padLatch.clear();
        return i;
    }
    /** Copy the simulation state into the game's shared fields (HUD, camera, tracks, replay recording). */
    syncReality(dt: number) {
        const ride = this.reality!, sim = ride.sim;
        this.x = ride.x; this.d = ride.d; this.y = ride.y; this.speed = ride.speed; this.vy = ride.vy;
        this.heading = ride.heading; this.ground = ride.ground; this.airTime = ride.tricks.airTime;
        this.edgeAngle = ride.crashed ? 0 : sim.edgeAngle;
        this.skidAngle = ride.crashed ? 0 : clamp(ride.ctl.slipAngle(sim), -1.4, 1.4);
        this.steerFilter = this.intent.steer;
        this.visualGrab = ride.tricks.grabbing; this.visualTuck = this.intent.tuck;
        this.grabKind = this.realityGrab; this.grabLocked = this.visualGrab ? this.realityGrab : -1;
        this.load = clamp(ride.compression, 0, 1);
        this.pop = ride.ctl.pop === 'extend' ? 1 : Math.max(0, this.pop - dt * 4);
        this.spinVelocity = ride.crashed ? 0 : sim.board.w.y; this.flipVelocity = 0; this.spinInput = this.intent.wind;
        this.bailTimer = ride.crashed ? 1 : 0;
        this.crashVisual = ride.crashed ? ride.crashTime : 0;
        // Leg force above body weight shows as landing compression in the rig.
        const legLoad = clamp((sim.legAxial - 1600) / 2600, 0, 1);
        this.landingImpact = ride.ground ? Math.max(this.landingImpact - dt * 2.6, legLoad) : Math.max(0, this.landingImpact - dt * 2.6);
        // Air: extension rises as the ground approaches (landing preparation in the rig).
        const gap = ride.ctl.gapBelow(sim), fall = Math.max(.5, -sim.board.v.y);
        this.extension = ride.ground ? 0 : 1 - T.MathUtils.smoothstep(gap / fall, .15, .55);
        // The rig's lead foot: regular riders have their left foot toward the board's +x end in the simulation frame.
        const regular = (this.settings.stance ?? 'regular') === 'regular';
        this.spin = (regular ? ride.ctl.travelSign > 0 : ride.ctl.travelSign < 0) ? Math.PI : 0;
        this.flip = 0;
        const q = sim.board.q;
        this.renderQ.set(q.x, q.y, q.z, q.w);
        if (regular) this.renderQ.multiply(RIG_FLIP);
        this.railActive = sim.railContacts > 0 ? this.rails.findIndex(r => this.d >= r.d - .5 && this.d <= r.end + .5 && Math.abs(this.x - r.x) < 1.3) : -1;
    }
    updateReality(dt: number) {
        const ride = this.reality!;
        this.time += dt;
        this.flowTimer = Math.max(0, this.flowTimer - dt);
        if (this.flowTimer === 0) this.combo = 1;
        this.toastTimer = Math.max(0, this.toastTimer - dt);
        const intent = this.readIntent(dt);
        if (this.state !== 'ride') return;
        this.previous = { x: this.x, y: this.y, d: this.d, heading: this.heading, spin: this.spin, flip: this.flip };
        this.prevRenderQ.copy(this.renderQ);
        const events = this.realityEvents; events.length = 0;
        ride.tick(intent, GRABS[this.realityGrab].id, events);
        // Trees and rocks are solid: hitting one stops the body.
        if (!ride.crashed) for (const o of this.obstacles) {
            if (Math.abs(ride.d - o.d) < 1.7 && Math.abs(ride.x - o.x) < o.r && ride.y - height(ride.x, ride.d, this.course) < 3) {
                const kind = o.r > 2 ? 'ROCK STRIKE' : 'TREE STRIKE';
                ride.crash(kind, .15);
                events.push({ type: 'crash', kind });
                break;
            }
        }
        for (const e of events) this.onRealityEvent(e);
        this.syncReality(dt);
        this.bookkeeping(dt);
    }
    onRealityEvent(e: FreestyleEvent) {
        if (e.type === 'takeoff') { if (e.kind === 'ollie' || e.kind === 'nollie') this.sound(e.kind === 'ollie' ? 160 : 190); this.feedback = e.kind === 'nollie' ? 'NOLLIE' : e.kind === 'ollie' ? 'OLLIE' : ''; return; }
        if (e.type === 'crash') { this.combo = 1; this.bails++; this.toast(e.kind); this.feedback = 'Combo lost'; this.sound(70, .3); return; }
        const pts = Math.round(e.score * this.combo);
        if (e.type === 'landed') {
            this.feedback = `${e.landing} · ${e.air.toFixed(2)} s air`;
            if (e.air < .3 && e.spinDeg === 0 && !e.grab) return;
        } else this.feedback = `${e.name} · ${e.time.toFixed(1)} s`;
        if (this.flowTimer > 0) this.combo = Math.min(5, this.combo + .5);
        this.score += pts; this.tricks++; this.flowTimer = 8;
        this.toast(e.name, pts); this.sound(380, .1);
    }
    snapshot(): Frame { return { t: this.time, x: this.x, d: this.d, y: this.y, heading: this.heading, spin: this.spin, flip: this.flip, grab: this.visualGrab, tuck: this.visualTuck, speed: this.speed, vy: this.vy, airTime: this.airTime, ground: this.ground, load: this.load, pop: this.pop, extension: this.extension, landing: this.landingImpact, spinVelocity: this.spinVelocity, flipVelocity: this.flipVelocity, grabKind: this.grabLocked >= 0 ? this.grabLocked : this.grabKind, rail: this.railActive >= 0, spinInput: this.spinInput, edge: this.steerFilter, edgeAngle: this.edgeAngle, skidAngle: this.skidAngle, landingPitch: this.parkFlight?.landingPitch, landingSpin: this.parkFlight?.alignment?.spinTarget, ...(this.reality ? { q: [this.renderQ.x, this.renderQ.y, this.renderQ.z, this.renderQ.w] as [number, number, number, number], crouch: this.load, crashed: this.reality.crashed || undefined } : {}) }; }
    updateReplay(dt: number) {
        const frames = this.run?.frames;
        if (!frames?.length)
            return;
        if (this.replayPlaying && !this.photo)
            this.replayTime += dt;
        if (this.replayTime > frames[frames.length - 1].t) {
            this.replayTime = frames[frames.length - 1].t;
            this.replayPlaying = false;
        }
        let lo = 0, hi = frames.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (frames[mid].t < this.replayTime)
                lo = mid + 1;
            else
                hi = mid;
        }
        const b = frames[lo], a = frames[Math.max(0, lo - 1)], mix = clamp((this.replayTime - a.t) / Math.max(.001, b.t - a.t), 0, 1);
        for (const key of ['x', 'd', 'y', 'heading', 'spin', 'flip'] as const)
            this[key] = T.MathUtils.lerp(a[key], b[key], mix);
        if (!this.run?.terrainRevision)
            this.y += bankRise(this.x, this.d, this.course) - bankRise(this.x, this.d, this.course, true);
        for (const key of ['speed', 'vy', 'airTime', 'load', 'pop', 'extension', 'spinVelocity', 'flipVelocity', 'spinInput'] as const)
            this[key] = T.MathUtils.lerp(a[key] ?? 0, b[key] ?? 0, mix);
        this.steerFilter = T.MathUtils.lerp(a.edge ?? clamp(a.heading, -1, 1), b.edge ?? clamp(b.heading, -1, 1), mix);
        this.edgeAngle = T.MathUtils.lerp(a.edgeAngle ?? (a.edge ?? a.heading) * .26, b.edgeAngle ?? (b.edge ?? b.heading) * .26, mix);
        this.skidAngle = T.MathUtils.lerp(a.skidAngle ?? 0, b.skidAngle ?? 0, mix);
        const landingPitch = a.landingPitch ?? b.landingPitch;
        this.replayLandingPitch = landingPitch === undefined ? undefined
            : T.MathUtils.lerp(landingPitch, b.landingPitch ?? landingPitch, mix);
        this.replayLandingSpin = (mix < .5 ? a : b).landingSpin;
        this.landingImpact = T.MathUtils.lerp(a.landing ?? 0, b.landing ?? 0, mix);
        this.time = this.replayTime;
        const discrete = mix < .5 ? a : b;
        this.visualGrab = !!discrete.grab;
        this.visualTuck = !!discrete.tuck;
        this.grabKind = discrete.grabKind ?? 0;
        this.grabLocked = this.visualGrab ? this.grabKind : -1;
        this.railActive = discrete.rail ? this.rails.findIndex(rail =>
            this.d >= rail.d - .5 && this.d <= rail.end + .5 && Math.abs(this.x - rail.x) < 1,
        ) : -1;
        this.ground = discrete.ground ?? (Math.abs(this.y - height(this.x, this.d, this.course)) < .3);
        this.replayHasQ = !!(a.q && b.q);
        if (a.q && b.q) {
            this.renderQ.fromArray(a.q).slerp(new T.Quaternion().fromArray(b.q), mix);
            this.crashVisual = discrete.crashed ? 1 : 0;
            this.bailTimer = discrete.crashed ? 1 : 0;
            this.extension = 0;
        }
    }
    visual(dt: number) {
        const menu = this.state === 'menu' || this.state === 'garage';
        if (menu) {
            this.rider.position.set(center(0, this.course), height(center(0, this.course), 0, this.course), 0);
            this.body.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(0, .18, 0)), 1 - Math.exp(-dt * 8));
            this.rig.pose({ dt, time: performance.now() * .001, turn: 0, speed: 0, air: false, grab: false, landing: 0, menu: true });
            const t = performance.now() * .00007;
            const close = this.state === 'garage';
            const target = new T.Vector3(this.rider.position.x + (close ? 0 : -7), this.rider.position.y + (close ? 1.1 : 2), close ? 0 : -12);
            const pos = new T.Vector3(this.rider.position.x + (close ? 2.6 : 13) + Math.sin(t) * 2, this.rider.position.y + (close ? 1.65 : 5), close ? 3.7 : 18);
            this.camera.position.lerp(pos, 1 - Math.exp(-dt * 2));
            this.camera.lookAt(target);
        }
        else {
            const alpha = this.state === 'ride' ? clamp(this.physicsAccumulator * 120, 0, 1) : 1, prev = this.previous;
            const rx = prev ? T.MathUtils.lerp(prev.x, this.x, alpha) : this.x, ry = prev ? T.MathUtils.lerp(prev.y, this.y, alpha) : this.y, rd = prev ? T.MathUtils.lerp(prev.d, this.d, alpha) : this.d, rh = prev ? T.MathUtils.lerp(prev.heading, this.heading, alpha) : this.heading;
            this.rider.position.set(rx, ry, -rd);
            this.rider.rotation.set(0, 0, 0);
            const blendAngle = (a: number, b: number) => T.MathUtils.lerp(a, b, alpha);
            const rs = prev && !this.reality ? blendAngle(prev.spin, this.spin) : this.spin, rf = prev ? blendAngle(prev.flip, this.flip) : this.flip;
            const rail = this.rails[this.railActive];
            const realityView = (this.state === 'ride' && !!this.reality) || (this.state === 'replay' && this.replayHasQ);
            const normal = rail ? new T.Vector3(0, 1, rail.slope).normalize()
                : new T.Vector3(-(height(rx + .4, rd, this.course) - height(rx - .4, rd, this.course)) / .8, 1, (height(rx, rd + .4, this.course) - height(rx, rd - .4, this.course)) / .8).normalize();
            const worldEdge = rail ? 0 : this.edgeAngle;
            const edgeRoll = worldEdge * Math.cos(rs);
            if (this.ground && !realityView) this.rider.position.addScaledVector(normal, Math.abs(Math.sin(edgeRoll)) * BOARD_WAIST_M * .48);
            const takeoffPitch = clamp(Math.atan2(this.vy, Math.max(1, this.speed)), -.42, .50);
            const savedPitch = this.state === 'replay' ? this.replayLandingPitch : this.parkFlight?.landingPitch;
            const slopePitch = savedPitch ?? Math.atan(pathSlope(rx, rd, rh, this.course));
            const pitch = T.MathUtils.lerp(takeoffPitch * (.25 + .75 * this.pop), slopePitch, this.extension);
            const targetRotation = this.ground
                ? new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), normal)
                    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2 - rh - this.skidAngle + rs))
                    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), edgeRoll))
                : new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -rh - this.skidAngle)
                    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), rf + pitch))
                    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2 + rs));
            if (realityView) {
                // The board's orientation IS the simulation's: no smoothing toward a target, only interpolation between
                // the last two 120 Hz states.
                const q = this.state === 'ride' ? this.prevRenderQ.clone().slerp(this.renderQ, alpha) : this.renderQ.clone();
                if (this.bailTimer > 0) {
                    // Falling: not a ragdoll yet. The body rolls onto its side while it slides (see docs/KNOWN_ISSUES.md).
                    const roll = Math.min(1, (this.crashVisual || 1) * 2.4) * 1.35;
                    q.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(Math.cos(rh), 0, Math.sin(rh)), roll));
                }
                this.body.quaternion.copy(q);
                const turnEdge = clamp(this.edgeAngle * (this.reality?.ctl.travelSign ?? 1) / .61, -1, 1);
                // Body mechanics from the simulation: lateral acceleration (speed x yaw rate) in g, snow softness, fore/aft press.
                const rr = this.reality, bv = rr?.sim.board.v;
                const carveG = rr && this.ground && bv ? Math.sign(turnEdge) * Math.min(2, Math.hypot(bv.x, bv.z) * Math.abs(rr.sim.board.w.y) / 9.81) : 0;
                const regular = (this.settings.stance ?? 'regular') === 'regular';
                const press = rr ? clamp(rr.ctl.cmd.copX / .12, -1, 1) * (regular ? -1 : 1) : 0;
                this.rig.pose({ carveG, soft: rr?.ctl.soft ?? 0, press, dt, time: this.time, turn: rh, edge: turnEdge, speed: this.speed, air: !this.ground, grab: this.visualGrab, landing: this.landingImpact, menu: false, tuck: this.visualTuck, load: this.load, pop: this.pop, extension: this.extension, spinVelocity: this.spinVelocity, flipVelocity: 0, spin: rs, landingSpin: rs, grabKind: this.grabLocked >= 0 ? this.grabLocked : this.grabKind, rail: this.railActive >= 0, spinInput: this.spinInput });
            } else {
            if (this.bailTimer > 0)
                targetRotation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 1.4));
            this.body.quaternion.slerp(targetRotation, 1 - Math.exp(-dt * (this.ground ? 20 : 48)));
            const landingSpin = this.state === 'replay' ? this.replayLandingSpin : this.parkFlight?.alignment?.spinTarget;
            this.rig.pose({ dt, time: this.time, turn: rh, edge: worldEdge / .61, speed: this.speed, air: !this.ground, grab: this.visualGrab, landing: this.landingImpact, menu: false, tuck: this.visualTuck, load: this.load, pop: this.pop, extension: this.extension, spinVelocity: this.spinVelocity, flipVelocity: this.flipVelocity, spin: rs, landingSpin, grabKind: this.grabLocked >= 0 ? this.grabLocked : this.grabKind, rail: this.railActive >= 0, spinInput: this.spinInput });
            }
            const angle = this.photo ? this.photoAngle : this.cameraMode === 2 ? 1.3 : 0;
            const chase = this.cameraMode === 0 && !this.photo;
            const airtimeView = this.ground ? 0 : T.MathUtils.smoothstep(this.airTime, .08, .75) * (1 - this.extension);
            const radius = this.photo ? 12 : this.cameraMode === 1 ? .2
                : chase ? CHASE_DISTANCE + (this.speed - 12) * .046 + airtimeView * 1.55 : 7.8 + this.speed * .06 + airtimeView * 1.8;
            const eyeHeight = this.cameraMode === 1 && !this.photo ? 1.7 : (chase ? CHASE_HEIGHT : 3) - .64 * airtimeView;
            const orbit = angle - rh;
            const pos = new T.Vector3(rx + Math.sin(orbit) * radius, ry + eyeHeight, -rd + Math.cos(orbit) * radius);
            const lookAhead = this.cameraMode === 1 ? 18 : (chase ? 5.15 : 8) - 2.2 * airtimeView;
            const look = new T.Vector3(rx + Math.sin(rh) * lookAhead, ry + 1.05 - .45 * this.extension, -rd - Math.cos(rh) * lookAhead);
            if (this.state === 'replay' || this.photo) {
                this.camera.position.lerp(pos, 1 - Math.exp(-dt * 7));
                this.cameraFocus.lerp(look, 1 - Math.exp(-dt * 7));
                this.cameraSpring.reset(this.camera.position);
                this.focusSpring.reset(this.cameraFocus);
            }
            else {
                this.cameraSpring.step(pos, 2.1, dt, this.camera.position);
                this.focusSpring.step(look, 2.2, dt, this.cameraFocus);
            }
            this.camera.position.y=Math.max(this.camera.position.y,height(this.camera.position.x,-this.camera.position.z,this.course)+1.2);
            this.camera.lookAt(this.cameraFocus);
            this.rider.visible = this.cameraMode !== 1 || this.photo;
            const desired = this.settings.fov + (this.settings.motion ? this.speed * .14 : 0), fov = T.MathUtils.damp(this.camera.fov, desired, 3, dt);
            if (Math.abs(this.camera.fov - fov) > .01) {
                this.camera.fov = fov;
                this.camera.updateProjectionMatrix();
            }
            if (this.state === 'ride' || (this.state === 'replay' && this.replayPlaying && !this.photo)) {
                const grounded = this.ground && !rail;
                this.powder.update(dt, {
                    x: rx, y: grounded ? height(rx, rd, this.course) : ry, z: -rd, heading: rh, speed: this.speed,
                    edge: this.edgeAngle / .61, skid: this.skidAngle, depth: grounded ? snowDepth(rx, rd, this.course) : 0,
                    landing: this.landingImpact, slopeX: -normal.x / normal.y, slopeZ: -normal.z / normal.y, grounded,
                }, this.renderer.domElement.height);
            }
        }
        if (menu) {
            this.rider.visible = true;
        }
        this.snow.position.set(this.rider.position.x, this.rider.position.y, -this.d);
        if (this.snow.visible) {
            for (let i = 0; i < 400; i++) {
                const j = i * 3;
                this.snowPositions[j + 1] -= dt * 3;
                if (this.snowPositions[j + 1] < 0)
                    this.snowPositions[j + 1] = 45;
            }
            this.snow.geometry.attributes.position.needsUpdate = true;
        }
        const sun = this.scene.getObjectByName('sun') as T.DirectionalLight;
        this.sky.position.copy(this.camera.position);
        sun.position.copy(this.rider.position).add(this.settings.weather === 'dusk' ? DUSK_LIGHT : DAYLIGHT);
        sun.target.position.copy(this.rider.position);
        sun.target.updateMatrixWorld();
    }
    capture() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
    resume() { this.jumpPending = false; this.load = 0; this.state = 'ride'; this.keys.clear(); this.touch.clear(); this.clock.getDelta(); }
    menu() { this.reality = undefined; this.powder.clear(); this.previous = undefined; this.state = 'menu'; this.d = 0; this.cameraMode = 0; this.photo = false; this.keys.clear(); this.touch.clear(); }
    dispose() { cancelAnimationFrame(this.frameId); window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); this.resizeObserver.disconnect(); this.audio?.close().catch(() => { }); this.scene.add(this.rider); this.gearPreview.dispose(); this.powder.dispose(); this.scene.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.LineSegments) {
        if (o instanceof T.InstancedMesh) o.dispose();
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => m.dispose());
    } }); (this.scene.getObjectByName('sun') as T.DirectionalLight).shadow.dispose(); this.rig.dispose(); this.environmentTarget?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); this.performanceLabel?.remove(); this.diagnostics?.dispose(); }
}
