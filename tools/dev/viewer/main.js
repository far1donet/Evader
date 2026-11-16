// Close-up shots of lift and building models with the game's sky, sun, hemisphere light and tone mapping.
// URL hash selects the shot: #chair #gondola #cablecar #tower #station-chair #station-gondola #village #mixed
import * as T from 'three';
import { makeAlpineSky } from '/lib/alpine.ts';
import { chairModel, gondolaModel, cableCarModel, hangerModel, lowModel, passengerGeometry } from '/lib/verbier/lift-vehicles.ts';
import { liftScenery } from '/lib/verbier/lift-ride.ts';
import { buildingMesh } from '/lib/verbier/buildings.ts';

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);
const scene = new T.Scene(), camera = new T.PerspectiveCamera(50, innerWidth / innerHeight, .1, 20000);
const DAYLIGHT = new T.Vector3(-158, 118, -95);
scene.add(new T.HemisphereLight(0xaecbff, 0x8ea4bd, 1.2));
const sun = new T.DirectionalLight(0xfff0da, 3.1); sun.position.copy(DAYLIGHT); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 700 }); sun.shadow.normalBias = .015; sun.shadow.bias = -.0001;
scene.add(sun, sun.target);
const sky = makeAlpineSky(); sky.material.uniforms.sunDirection.value.copy(DAYLIGHT).normalize(); scene.add(sky);
const rs = new T.Scene(); rs.add(sky.clone()); const pmrem = new T.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(rs, .04, .1, 5000).texture; scene.environmentIntensity = .52;
scene.fog = new T.FogExp2(0xc8d8e6, .0012);
// gentle snow slope
const ground = (x, d) => .12 * d + 1.2 * Math.sin(x * .03) * Math.cos(d * .02);
const gg = new T.PlaneGeometry(1200, 1200, 240, 240); gg.rotateX(-Math.PI / 2);
const pa = gg.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, ground(pa.getX(i), -pa.getZ(i))); gg.computeVertexNormals();
const snow = new T.Mesh(gg, new T.MeshStandardMaterial({ color: 0xf4f8fc, roughness: .78 })); snow.receiveShadow = true; scene.add(snow);
const add = (model, x, y, z, yaw = 0) => {
    const g = new T.Group();
    for (const p of model.parts) { const m = new T.Mesh(p.geometry, p.material); m.castShadow = m.receiveShadow = true; g.add(m); }
    if (model.bar) { const b = new T.Group(); b.position.copy(model.bar.pivot); for (const p of model.bar.parts) { const m = new T.Mesh(p.geometry, p.material); m.castShadow = true; b.add(m); } g.add(b); }
    g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g); return g;
};
const shot = location.hash.slice(1) || 'chair';
const look = (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); sun.target.position.set(tx, ty, tz); sun.position.set(tx, ty, tz).add(DAYLIGHT); };
const liftLine = (type, len, opts = {}) => {
    const pts = Array.from({ length: 7 }, (_, i) => [0, -40 + i * len / 6, 0]);
    return { id: 'demo', name: 'demo', type, osm: [], points: pts, occupancy: opts.seats ?? 6, capacity: 2400, rideS: len / 5, length: len, pylons: opts.pylons };
};
if (shot === 'chair') { const y = 14; add(chairModel(6), 0, y, 0, .5); add(chairModel(6, { bubble: true }), -9, y + .6, -8, .5); look(-3.4, y - 1.9, -4.6, 0, y - 2.2, 0); }
if (shot === 'gondola') { const y = 12; add(gondolaModel(), 0, y, 0, .6); add(gondolaModel(), 10, y + 1, -14, .6); look(3.6, y - 2.0, -3.4, 0, y - 2.3, 0); }
if (shot === 'cablecar') { const y = 22; add(cableCarModel(), 0, y, 0, .4); look(9, y - 4.5, -9, 0, y - 4.6, 0); }
if (shot === 'tower' || shot === 'station-chair' || shot === 'station-gondola' || shot === 'mixed') {
    const type = shot === 'station-gondola' ? 'gondola' : shot === 'mixed' ? 'mixed_lift' : 'chair_lift';
    const sc = liftScenery(liftLine(type, 900), ground, { vehicles: true, vehicleDetail: () => true }); sc.group.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); scene.add(sc.group);
    const h = sc.profile.heads.find(x => !x.station), st = sc.profile.heads[0];
    if (shot === 'tower' || shot === 'mixed') look(h.x + 9, h.y - 3, -h.d + 9, h.x, h.y - 4, -h.d);
    else look(st.x + 16, st.ground + 6.5, -st.d - 24, st.x, st.ground + 2.5, -st.d - 3);
}
if (shot === 'village') {
    const list = []; let k = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        const kind = [0, 0, 0, 1, 0, 3, 0, 2, 0, 0, 1, 0, 4, 0, 0, 3, 0, 0, 1, 0][k++];
        list.push({ e: i * 26 + (j % 2) * 8, n: j * 24, length: kind === 1 ? 22 : kind === 2 ? 28 : kind === 3 ? 9 : kind === 4 ? 18 : 12 + (k % 3) * 2, width: kind === 1 ? 14 : kind === 2 ? 16 : kind === 3 ? 7 : kind === 4 ? 10 : 9 + (k % 2) * 2, angle: .15 * (k % 3), floors: kind === 1 ? 5 : kind === 3 ? 1 : 2 + (k % 2), kind, registered: true });
    }
    const m = buildingMesh(list, (e, n) => [e, n], ground, { shadows: true, lod: (x, d) => Math.hypot(x - 20, d - 10) < 60 ? 2 : 1 }); scene.add(m.mesh);
    look(-28, 22, 10, 50, 6, -40);
}
if (shot === 'chalet') {
    const list = [{ e: 0, n: 0, length: 14, width: 10, angle: .3, floors: 3, kind: 0, registered: true }, { e: 24, n: 6, length: 24, width: 14, angle: .3, floors: 5, kind: 1, registered: true }];
    const m = buildingMesh(list, (e, n) => [e, n], ground, { shadows: true, lod: () => 2 }); scene.add(m.mesh);
    look(-16, 9, 18, 6, 6, -2);
}
if (shot === 'window') {
    const list = [{ e: 0, n: 0, length: 14, width: 10, angle: 0, floors: 3, kind: 0, registered: true }];
    const m = buildingMesh(list, (e, n) => [e, n], (x, d) => 0, { shadows: true, lod: () => 2 }); scene.add(m.mesh);
    look(2, 4.5, -13, 2, 4.5, 0);
}
renderer.render(scene, camera);
renderer.render(scene, camera);
window.__ready = true;
