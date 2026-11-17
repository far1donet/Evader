// The real free-ride world around a station, with the rider, rendered as the game does (sky, sun, shadows, tone mapping),
// with or without the PostFX pipeline. Hash: #<station id>[,fx|fx-cinematic][,cam=<behind|side|low>][,q=<quality>]
import * as T from 'three';
import { makeAlpineSky } from '/lib/alpine.ts';
import { loadResort, loadTilesAround, loadBuildings, FreeTerrain, setFreeTerrain } from '/lib/verbier/terrain.ts';
import { SurfaceMap, FreeView, clearSpot } from '/lib/verbier/free-world.ts';
import { height, snowDepth, FREE_COURSE } from '/lib/snow-game.ts';
import { RiderRig } from '/lib/rider-rig.ts';
import { PostFX } from '/lib/postfx.ts';

const opts = Object.fromEntries(location.hash.slice(1).split(',').map(s => s.includes('=') ? s.split('=') : [s, true]));
const stationId = location.hash.slice(1).split(',')[0] || 's72';
const renderer = new T.WebGLRenderer({ antialias: !opts.fx && !opts['fx-cinematic'] });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
renderer.toneMapping = opts.tm === 'agx' ? T.AgXToneMapping : T.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(opts.exp ?? (opts.fx || opts['fx-cinematic'] ? 1.3 : 1.15));
document.body.appendChild(renderer.domElement);
const scene = new T.Scene(), camera = new T.PerspectiveCamera(62, innerWidth / innerHeight, .1, 30000);
const DAYLIGHT = new T.Vector3(-158, 118, -95);
scene.add(new T.HemisphereLight(0xaecbff, 0x8ea4bd, 1.2));
const sun = new T.DirectionalLight(0xfff0da, 3.1); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, far: 900 }); sun.shadow.normalBias = .015; sun.shadow.bias = -.0001; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const sky = makeAlpineSky(); if (opts.skydebug) { sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4(air, 1.0);', 'gl_FragColor = vec4(vec3(vapor), 1.0);'); } const u = sky.material.uniforms; u.sunDirection.value.copy(DAYLIGHT); u.zenith.value.set(0x2a68b4); u.horizon.value.set(0xd5e5f5); u.clouds.value = .74; u.sunStrength.value = 1; scene.add(sky);
const rs = new T.Scene(); rs.add(sky.clone()); const pmrem = new T.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(rs, .04, .1, 5000).texture; scene.environmentIntensity = .52;
const fx = opts.fx || opts['fx-cinematic'];
if (!fx) scene.fog = new T.FogExp2(0xd5e5f5, .00066 * .32);

const r = await loadResort();
const st = r.stations.find(s => s.id === stationId) ?? r.stations[0];
await Promise.all([loadTilesAround(st.e, st.n, 1600), loadBuildings()]);
const [e, n] = clearSpot(r, st.e, st.n);
const sm = new SurfaceMap(r), run = new FreeTerrain(Math.round(e), Math.round(n), (we, wn) => sm.at(we, wn)); setFreeTerrain(run);
const view = new FreeView(run, sm, r, opts.q ?? 'ultra', (x, d) => height(x, d, FREE_COURSE), (x, d) => snowDepth(x, d, FREE_COURSE));
view.prime(0, 0); scene.add(view.group);
// rider on the snow, board along the fall line
const h = (x, d) => height(x, d, FREE_COURSE), gx = (h(1, 0) - h(-1, 0)) / 2, gd = (h(0, 1) - h(0, -1)) / 2;
const fall = new T.Vector2(-gx, -gd).normalize(), heading = Math.atan2(fall.x, fall.y);
const root = new T.Group(); scene.add(root);
const rig = new RiderRig(root, new T.MeshStandardMaterial({ color: 0xd9a032, roughness: .8 }), new T.MeshStandardMaterial({ color: 0xe4c27a, roughness: .5 }));
root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
for (let i = 0; i < 90; i++) rig.pose({ dt: 1 / 60, time: i / 60, turn: .3, edge: .45, speed: 14, air: false, grab: false, landing: 0, menu: false, carveG: .6 });
root.position.set(0, h(0, 0) + .02, 0); root.rotation.y = Math.PI / 2 - heading;
// camera: behind and above the rider, looking down the fall line
const back = opts.cam === 'side' ? new T.Vector2(fall.y, -fall.x) : fall.clone().multiplyScalar(-1);
const dist = opts.cam === 'low' ? 3.2 : 5.4, up = opts.cam === 'low' ? .8 : 2.2;
const cx = back.x * dist, cd = back.y * dist;
camera.position.set(cx, Math.max(h(cx, cd) + .8, h(0, 0) + up), -cd);
const ahead = opts.cam === 'far' ? 400 : 9;
camera.lookAt(fall.x * ahead, h(fall.x * 9, fall.y * 9) + (opts.cam === 'far' ? -10 : 1.0), -fall.y * ahead);
sun.target.position.set(0, h(0, 0), 0); sun.position.copy(sun.target.position).add(DAYLIGHT.clone().normalize().multiplyScalar(400));
let post = null;
if (fx) {
    post = new PostFX(renderer, scene, camera, opts['fx-cinematic'] ? 'cinematic' : 'ultra');
    post.setSize(innerWidth, innerHeight, 1);
    post.setAtmosphere({ color: new T.Color(0xd5e5f5), sun: DAYLIGHT, sunColor: new T.Color(0xfff0da).multiplyScalar(.9), density: +(opts.den ?? .00055), base: 1500, falloff: 1 / 650, max: .92 });
}
for (let i = 0; i < 3; i++) { if (post) post.render(1 / 60); else renderer.render(scene, camera); }
window.__ready = true;
