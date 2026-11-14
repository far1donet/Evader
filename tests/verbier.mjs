// Verbier – 4 Vallées: quality gates from the game-development guide (sections 08–10), checked against the DEM.
// Run: node --experimental-strip-types tests/verbier.mjs
import assert from 'node:assert/strict';
import * as T from 'three';
import { PISTES, LIFTS, ANCHORS, ITINERARIES, SNOWPARK, infrastructureFor, FUN_ZONES } from '../lib/verbier/registry.ts';
import { verbierRun, demHeight, VERBIER_ROUTES, moguls } from '../lib/verbier/terrain.ts';
import { LA_CHAUX_FEATURES } from '../lib/park-jumps.ts';
import { COURSES, height, snowDepth, SnowGame, center } from '../lib/snow-game.ts';
import { makeParkRails } from '../lib/park-rails.ts';
import { IDLE_INTENT } from '../lib/sim/rider-controller.ts';

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

// ---- anchors: displayed heights match the DEM; resolved anchors match published elevations ----------------------------
{
    let resolved = 0;
    for (const a of ANCHORS) {
        const h = demHeight(a.e, a.n);
        assert(Math.abs(h - a.demElevation) < 3, `${a.name}: runtime DEM sampling agrees with the build (${h.toFixed(1)} vs ${a.demElevation})`);
        if (a.resolved) { resolved++; assert(Math.abs(a.error) <= (a.kind === 'peak' ? 60 : 25), `${a.name} within tolerance`); }
    }
    assert(resolved >= 14, `${resolved} of ${ANCHORS.length} anchors resolved`);
    const low = ANCHORS.filter(a => a.confidence !== 'high').map(a => a.name);
    console.log(`Anchors: ${resolved}/${ANCHORS.length} match published elevations (stations ±25 m, summits ±60 m); low confidence: ${low.join(', ') || 'none'} passed.`);
}

// ---- runs: rideable, real heights, published characteristics ----------------------------------------------------------
{
    for (const r of VERBIER_ROUTES) {
        const run = verbierRun(r.id);
        let maxRise = 0, low = Infinity;
        for (let d = 0; d <= run.length; d += 5) {
            const p = run.toLocal(0, d), h = demHeight(p.e, p.n);
            low = Math.min(low, h); maxRise = Math.max(maxRise, h - low);
            // displayed (course) height equals the DEM wherever no moguls or park features are added
            if (run.mogulAmplitude(0, d) === 0 && r.id !== 'la-chaux-park') assert(Math.abs(run.height(0, d) - h) < 1e-9, `${r.name}: course height = DEM at d ${d}`);
        }
        assert(maxRise < 4, `${r.name}: no climb a rider would stall on (max rise ${maxRise.toFixed(1)} m)`);
        assert(run.length > 600 && run.startElevation > run.endElevation + 150, `${r.name}: a real descent`);
    }
    const mf = verbierRun('mont-fort'), top = (demHeight(mf.toLocal(0, 0).e, mf.toLocal(0, 0).n) - demHeight(mf.toLocal(0, 250).e, mf.toLocal(0, 250).n));
    const topDeg = Math.atan(top / 250) * 180 / Math.PI;
    assert(topDeg > 28 && topDeg < 42, `Mont Fort: first 250 m average ${topDeg.toFixed(1)} deg (guide: near 35 deg)`);
    assert(mf.mogulAmplitude(0, 100) > .4 && mf.mogulAmplitude(0, 400) === 0, 'Mont Fort: moguls on the top section only (groomed below)');
    const at = verbierRun('attelas-ruinettes'); assert(Math.abs(at.startElevation - at.endElevation - 500) < 60, 'Attelas: about 500 m vertical');
    // moguls are irregular, not repeated identical bumps
    const samples = Array.from({ length: 40 }, (_, i) => moguls(i * 1.7, i * 2.3));
    assert(new Set(samples.map(v => v.toFixed(2))).size > 30, 'irregular mogul field');
    console.log(`Runs: all five rideable (no climbs), course height equals the DEM, Mont Fort top ${topDeg.toFixed(1)} deg, Attelas ${Math.round(at.startElevation - at.endElevation)} m vertical passed.`);
}

// ---- piste classes as data: groomed corridors vs ungroomed itinerary --------------------------------------------------
{
    const red = COURSES.find(c => c.dem === 'attelas-ruinettes'), itin = COURSES.find(c => c.dem === 'chassoure-tortin');
    assert(snowDepth(0, 400, red) < .03, 'red piste is groomed on its corridor');
    assert(snowDepth(0, 400, itin) > .05, 'itinerary is ungroomed on its line');
    assert(verbierRun('chassoure-tortin').mogulAmplitude(0, 800) > 0, 'itinerary carries moguls');
    console.log('Piste classes: groomed red corridor, ungroomed itinerary with moguls passed.');
}

// ---- La Chaux park: published structure, physical features ------------------------------------------------------------
{
    const small = LA_CHAUX_FEATURES.filter(f => f.line === 'S'), big = LA_CHAUX_FEATURES.filter(f => f.line !== 'S');
    assert.equal(small.length, 5); assert.equal(big.length, 3);
    for (const f of big) { const table = f.profile.knuckle - f.profile.lip; assert(table >= 9 && table <= 13, `kicker table ${table} m in 9-13 m`); }
    const park = COURSES.find(c => c.dem === 'la-chaux-park');
    for (const f of LA_CHAUX_FEATURES) {
        const lip = f.base + f.profile.lip;
        assert(height(0, lip, park) - verbierRun('la-chaux-park').height(0, lip) > f.profile.rise * .8, 'feature is real collision geometry above the snow');
        assert(f.base + f.profile.runout < park.length - 20, 'feature inside the park');
    }
    console.log('La Chaux: 5 table-tops + kickers with 9, 11, 13 m tables built into the terrain passed.');
}

// ---- riding the real terrain under Reality physics ---------------------------------------------------------------------
{
    for (const course of COURSES.filter(c => c.dem)) {
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
        while (g.state === 'ride' && n++ < 120 * 25) { g.keys.clear(); if (g.x > 3) g.keys.add('KeyA'); if (g.x < -3) g.keys.add('KeyD'); if (g.speed > 14) g.keys.add('KeyS'); g.update(1 / 120); assert(Number.isFinite(g.x + g.y + g.d)); }
        assert(g.d > 40 && g.y < y0 - 8, `${course.name}: descends under gravity (${g.d.toFixed(0)} m, ${(y0 - g.y).toFixed(0)} m lower)`);
        assert(g.getHUD().altitude > 1400 && g.getHUD().altitude < 3400, 'HUD shows a real altitude');
    }
    console.log('Reality physics on all five Verbier runs: rides down the real slopes, HUD altitude from the DEM passed.');
}
console.log('Verbier validation passed.');
