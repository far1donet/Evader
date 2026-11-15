// Verbier – 4 Vallées: quality gates from the game-development guide (sections 08–10), checked against swissALTI3D data.
// Run: node --experimental-strip-types tests/verbier.mjs
import assert from 'node:assert/strict';
import * as T from 'three';
import { PISTES, LIFTS, ANCHORS, ITINERARIES, SNOWPARK, infrastructureFor, FUN_ZONES } from '../lib/verbier/registry.ts';
import { verbierRun, moguls, RUNS, resortSync, worldHeight, tileLoaded } from '../lib/verbier/terrain.ts';
import { curvature } from '../lib/verbier/scenery.ts';
import { LA_CHAUX_FEATURES } from '../lib/park-jumps.ts';
import { COURSES, height, snowDepth, SnowGame, center, routeCourse } from '../lib/snow-game.ts';
import { makeParkRails } from '../lib/park-rails.ts';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';
import { lineFollower } from '../tools/gamebot.mjs';

// ---- registry completeness and honesty ------------------------------------------------------------------------------
{
    assert.equal(PISTES.length, 107, 'all 107 named piste / connection records');
    assert.equal(LIFTS.length, 35, 'all 35 named lift records (not the whole 82-lift domain)');
    const count = k => PISTES.filter(p => p.classification === k).length;
    assert.deepEqual([count('blue'), count('red'), count('black'), count('itinerary'), count('connection'), count('bus-connection')], [29, 46, 13, 13, 5, 1]);
    assert(PISTES.every(p => p.geometry === null) && LIFTS.every(l => l.geometry === null), 'geometry the guide does not supply stays null');
    assert.equal(new Set(PISTES.map(p => p.id)).size, 107, 'stable unique ids');
    assert.equal(ITINERARIES.length, 8); assert.equal(FUN_ZONES.length, 9);
    assert.equal(SNOWPARK.smallFeatures.count, 5); assert.equal(SNOWPARK.kickers.count, 3);
    console.log('Registry: 107 pistes (29 blue, 46 red, 13 black, 13 itineraries, 6 connections), 35 lifts, 8 itineraries, 9 fun zones; no invented geometry passed.');
}

// ---- versioned infrastructure: the old and new Savoleyres links never share a scene ----------------------------------
{
    for (const date of ['2024-02-01', '2025-11-30', '2025-12-15', '2026-11-14', '2026-12-20', '2030-01-01']) {
        const ids = infrastructureFor(date).map(o => o.id);
        assert(!(ids.includes('savoleyres-historic') && ids.some(i => i.startsWith('telemixte'))), `no mixed infrastructure on ${date}`);
    }
    assert.deepEqual(infrastructureFor('2026-11-14').map(o => o.id), ['telemixte-upper'], 'on the reference date only the upper Télémixte operates');
    console.log('Infrastructure versioning: historical link and Télémixte never coexist; on 14 Nov 2026 only the upper section passed.');
}

// ---- anchors: gazetteer positions, swissALTI3D heights; cross-checked against the shipped 2 m tiles ------------------------
{
    for (const m of RUNS) verbierRun(m.id);                                    // loads the tiles around the featured runs
    const resolved = ANCHORS.filter(a => a.resolved);
    // villages span a range of heights around their rounded published figure; stations and summits are points
    for (const a of resolved) assert(Math.abs(a.error) <= (a.gazetteer?.startsWith('Ort ') ? 40 : 25), `${a.name}: DEM ${a.demElevation} m vs published ${a.publishedElevation} m`);
    assert(resolved.length >= 15, `${resolved.length} of ${ANCHORS.length} anchors resolved`);
    assert(ANCHORS.filter(a => !a.resolved).every(a => a.status && a.status.length > 10), 'unresolved anchors say why');
    let checked = 0;
    for (const a of resolved) {
        if (!tileLoaded(a.e, a.n)) continue;
        assert(Math.abs(worldHeight(a.e, a.n) - a.demElevation) < 4, `${a.name}: tile ${worldHeight(a.e, a.n).toFixed(1)} vs ${a.demElevation}`);
        checked++;
    }
    assert(checked >= 6, `anchors cross-checked against the shipped tiles (${checked})`);
    console.log(`Anchors: ${resolved.length}/${ANCHORS.length} within tolerance of published elevations (stations/summits 25 m, villages 40 m); ${checked} cross-checked against the shipped 2 m tiles (snow-smoothed, <4 m) passed.`);
}

// ---- the resort: real lifts and stations, every run ends at a lift station, the domain is connected ----------------------------
{
    const r = resortSync();
    const lift = name => r.lifts.find(l => l.name === name), station = name => r.stations.find(s => s.name === name);
    for (const n of ['Châble - Verbier', 'Médran 2', 'Funispace', 'Attelas', 'Mont-Gelé', 'Chaux-Express', 'Chaux 2', 'Jumbo', 'Mont-Fort', 'Tortin - Col des Gentianes', 'Tortin-Chassoure', 'Lac des Vaux 1', 'Lac des Vaux 2', 'Mayentzet', 'Tzoumaz', 'TMX Savoleyres', 'Siviez', 'Châble - Mayens de Bruson'])
        assert(lift(n), `mapped lift ${n}`);
    for (const n of ['Le Châble', 'Verbier – Médran', 'Les Ruinettes', 'Les Attelas', 'Mont-Gelé', 'La Chaux', 'Col des Gentianes', 'Mont-Fort', 'Tortin', 'Chassoure', 'Savoleyres', 'La Tzoumaz (Tzoumaz)', 'Siviez'])
        assert(station(n), `station ${n}`);
    assert(Math.abs(lift('Médran 2').vertical - 680) < 40, `Médran 2 climbs ${lift('Médran 2').vertical} m (Verbier 1,520 m to Les Ruinettes 2,200 m)`);
    assert(Math.abs(lift('Funispace').vertical - 530) < 40, `Funispace climbs ${lift('Funispace').vertical} m (Les Ruinettes to Les Attelas)`);
    assert.equal(r.stations.find(s => s.id === lift('Mont-Fort').to).name, 'Mont-Fort'); assert.equal(r.stations.find(s => s.id === lift('Médran 2').from).name, 'Verbier – Médran');
    for (const l of r.lifts) { assert(l.topZ > l.bottomZ, `${l.name} goes up`); assert(r.stations.some(s => s.id === l.from) && r.stations.some(s => s.id === l.to)); }
    const ids = new Set(r.routes.map(x => x.id));
    for (const x of r.routes.filter(x => !x.featured)) {
        const to = r.stations.find(s => s.id === x.toStation), end = x.line[x.line.length - 1];
        assert(to && to.liftsUp.length > 0, `${x.name} ends where a lift goes up`);
        assert(Math.hypot(end[0] - to.e, end[1] - to.n) < 450, `${x.name} ends at ${to.name}`);
        assert(r.stations.find(s => s.id === x.fromStation).routesFrom.includes(x.id) && ids.has(x.id));
        assert(x.drop > 5, `${x.name} goes down (${x.drop} m)`);
    }
    // from Verbier village, lifts and pistes reach the whole Verbier sector
    const seen = new Set([station('Verbier – Médran').id]), queue = [...seen];
    while (queue.length) {
        const id = queue.shift(), s = r.stations.find(x => x.id === id);
        for (const next of [...s.liftsUp.map(id => r.lifts.find(l => l.id === id).to), ...s.routesFrom.map(id => r.routes.find(x => x.id === id).toStation)])
            if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
    for (const n of ['Mont-Fort', 'Tortin', 'Savoleyres', 'La Chaux', 'Les Attelas', 'Siviez']) assert(seen.has(station(n).id), `${n} reachable from Verbier`);
    const network = r.routes.filter(x => !x.featured);
    console.log(`Resort: ${r.lifts.length} mapped lifts, ${r.stations.length} named stations, ${network.length} station-to-station runs, all ending where a lift goes up; ${seen.size} stations reachable from Verbier – Médran passed.`);
}

// ---- runs: real descents along the mapped lines --------------------------------------------------------------------------
{
    assert.equal(RUNS.length, 8);
    const report = [];
    for (const meta of RUNS) {
        const run = verbierRun(meta.id);
        assert.equal(run.length, meta.length); assert(run.centre.length >= run.length, `${run.name}: centre line covers the run`);
        let low = Infinity, maxRise = 0, maxDeg = 0;
        for (let d = 0; d <= run.length; d += 5) {
            const h = run.terrain(run.centreX(d), d); low = Math.min(low, h); maxRise = Math.max(maxRise, h - low);
            maxDeg = Math.max(maxDeg, run.slopeAt(run.centreX(d), d).deg);
        }
        // header = raw swissALTI3D; grid = snow-smoothed (a few metres on steep faces)
        assert(Math.abs(run.terrain(run.centreX(0), 0) - run.startElevation) < 4 && Math.abs(run.terrain(run.centreX(run.length), run.length) - run.endElevation) < 4, `${run.name}: header elevations match the grid`);
        assert(run.startElevation > run.endElevation + 80, `${run.name}: a real descent`);
        assert(maxRise < 8, `${run.name}: no long climb along the line (max rise ${maxRise.toFixed(1)} m)`);
        report.push(`${run.name} ${Math.round(run.startElevation - run.endElevation)} m / max ${maxDeg.toFixed(0)} deg`);
    }
    // Mont Fort: the steep upper face (guide: about 35 deg near the top)
    const mf = verbierRun('mont-fort'); let mfMax = 0;
    for (let d = 0; d < 400; d += 5) mfMax = Math.max(mfMax, mf.slopeAt(mf.centreX(d), d).deg);
    assert(mfMax > 30 && mfMax < 45, `Mont Fort upper face max ${mfMax.toFixed(1)} deg`);
    const at = verbierRun('attelas'); assert(Math.abs(at.startElevation - 2727) < 30, 'Attelas starts near the Attelas station (2,727 m)');
    const samples = Array.from({ length: 40 }, (_, i) => moguls(i * 1.7, i * 2.3));
    assert(new Set(samples.map(v => v.toFixed(2))).size > 30, 'irregular mogul field');
    // trees from the aerial imagery are below the treeline only
    for (const meta of RUNS) { const run = verbierRun(meta.id); for (let i = 0; i < run.trees.length; i += 3 * 97) assert(run.terrain(run.trees[i], run.trees[i + 1]) < 2400, `${run.name}: tree below the treeline`); }
    console.log(`Runs: ${report.join('; ')}; Mont Fort face ${mfMax.toFixed(0)} deg passed.`);
}

// ---- piste classes as data: groomed corridors vs ungroomed itinerary --------------------------------------------------
{
    const red = COURSES.find(c => c.dem === 'attelas'), itin = COURSES.find(c => c.dem === 'chassoure-tortin');
    const ra = verbierRun('attelas'), rc = verbierRun('chassoure-tortin');
    assert(snowDepth(ra.centreX(400), 400, red) < .03, 'red piste is groomed on its corridor');
    assert(snowDepth(rc.centreX(800), 800, itin) > .05, 'itinerary is ungroomed on its line');
    assert(rc.mogulAmplitude(rc.centreX(800), 800) > 0, 'itinerary carries moguls');
    assert(ra.mogulAmplitude(ra.centreX(400), 400) === 0, 'groomed red: no moguls on the corridor');
    console.log('Piste classes: groomed red corridor, ungroomed itinerary with moguls passed.');
}

// ---- La Chaux park and ski cross ------------------------------------------------------------------------------------------
{
    const small = LA_CHAUX_FEATURES.filter(f => f.line === 'S'), big = LA_CHAUX_FEATURES.filter(f => f.line !== 'S');
    assert.equal(small.length, 5); assert.equal(big.length, 3);
    for (const f of big) { const table = f.profile.knuckle - f.profile.lip; assert(table >= 9 && table <= 13, `kicker table ${table} m in 9-13 m`); }
    const park = COURSES.find(c => c.dem === 'la-chaux-park'), pr = verbierRun('la-chaux-park');
    assert(pr.h.park && pr.h.park.polygon.length > 3, 'park footprint from the mapped snow_park polygon');
    for (const f of LA_CHAUX_FEATURES) {
        const lip = f.base + f.profile.lip, x = pr.centreX(lip) + f.x;
        assert(height(x, lip, park) - pr.height(x, lip) > f.profile.rise * .8, `${f.line} feature at ${f.base} is collision geometry above the snow`);
        assert(f.base + f.profile.runout < park.length - 20, 'feature inside the park');
    }
    const sx = COURSES.find(c => c.dem === 'la-chaux-skicross'), sr = verbierRun('la-chaux-skicross');
    let banked = 0; for (let d = 30; d < sr.length - 20; d += 2) if (Math.abs(curvature(sr, d)) > .01) banked++;
    assert(banked > 5, 'ski cross has banked turns on the real bends');
    assert(Math.max(...[175, 395].map(d => height(sr.centreX(d + 10), d + 10, sx) - sr.height(sr.centreX(d + 10), d + 10))) > 1.4, 'ski-cross jumps built up');
    console.log(`La Chaux: S/M/L lanes in the mapped footprint (5 table-tops, 9/11/13 m tables); ski cross with ${banked} banked samples and 2 jumps passed.`);
}

// ---- riding the real terrain under Reality physics ---------------------------------------------------------------------
{
    const net = resortSync().routes.filter(x => !x.featured), sample = [0, 37, 91, 150, 211].map(i => net[i % net.length]);
    for (const course of [...COURSES.filter(c => c.dem), ...sample.map((x, i) => routeCourse(x, i))]) {
        const g = Object.create(SnowGame.prototype);
        Object.assign(g, { course, mode: 'freeride', state: 'ride', x: 0, d: 0, y: 0, vy: 0, speed: 0, heading: 0, spin: 0, flip: 0, airTime: 0, grabTime: 0, ground: true,
            settings: { physics: 'reality', assistLevel: 'balanced', quality: 'high', volume: 0, assist: false, motion: false, weather: 'clear', fov: 62 },
            spinInput: 0, spinVelocity: 0, flipVelocity: 0, load: 0, pop: 0, extension: 0, landingImpact: 0, grabKind: 0, grabLocked: -1, time: 0, bailTimer: 0, flowTimer: 0, toastTimer: 0, score: 0, tricks: 0, bails: 0, combo: 1,
            keys: new Set(), touch: new Set(), repeats: new Map(), railDone: new Set(), railActive: -1, railTime: 0, obstacles: [], gateCount: 0, gateIndex: 0,
            features: [], recordTimer: 0, frames: [], hudTimer: 0, onHUD: () => {}, onEnd: () => {}, sound: () => {}, onPause: () => {},
            realityEvents: [], intent: { ...IDLE_INTENT }, keySteer: 0, realityGrab: 0, padLatch: new Set(), renderQ: new T.Quaternion(), prevRenderQ: new T.Quaternion(), replayHasQ: false, crashVisual: 0,
            stick: { x: 0, y: 0 }, gesture: { enabled: false } });
        g.rails = makeParkRails(course, d => center(d, course), (x, d) => height(x, d, course), new T.MeshStandardMaterial());
        g.startReality();
        const y0 = g.y; let n = 0;
        g.readIntent = lineFollower(g, course, center, { maxSpeed: 11 });
        while (g.state === 'ride' && n++ < 120 * 25) { g.update(1 / 120); assert(Number.isFinite(g.x + g.y + g.d)); }
        assert(y0 - g.y > 8, `${course.name}: descends under gravity (${(y0 - g.y).toFixed(0)} m lower)`);
        assert(g.getHUD().altitude > 1400 && g.getHUD().altitude < 3400, 'HUD shows a real altitude');
    }
    console.log('Reality physics on all eight featured runs and five network runs: rides down the real slopes, HUD altitude from the DEM passed.');
}
console.log('Verbier validation passed.');
