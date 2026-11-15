/**
 * Verbier – 4 Vallées feature registry, transcribed from "Verbier 4 Vallées — Complete Ski & Snowboard Game Development
 * Guide" (reference date 14 November 2026). Every record has a stable id, type, sector, source, effective date and an
 * accuracy status. Geometry the guide does not supply is null; it is never invented.
 */
import { PISTES, LIFTS } from './registry-data.ts';
import { ANCHORS as GAZETTEER_ANCHORS } from './anchors-data.ts';
export { PISTES, LIFTS };

export const REGISTRY_DATE = '2026-11-14';
export const SOURCE_GUIDE = 'Verbier 4 Vallées game development guide, 2026 (operator-published data as of the research date)';

export const DOMAIN = {
    villages: ['Verbier', 'La Tzoumaz', 'Bruson', 'Nendaz', 'Veysonnaz', 'Thyon'],
    extentKm: 410, liftCount: 82, topElevation: 3330, altitudeBand: [1400, 3330],
    status: 'published marketing measures; counts vary with operator definitions',
} as const;

export type Status = 'published' | 'approximate' | 'game-design' | 'not-supplied';

/** Elevation anchors: published label elevations, located with the swisstopo gazetteer (or a lift station mapped in
 *  OpenStreetMap) and measured on swissALTI3D 2 m. Unresolved ones say why. */
export const ANCHORS = GAZETTEER_ANCHORS;

/** Marked freeride itineraries: published figures, kept as published even where they do not reconcile with endpoints. */
export const ITINERARIES = [
    { id: 'it-mont-gele-chaux', name: 'Mont-Gelé–Chaux', lengthM: 2000, verticalM: 600, maxSlopeDeg: 34, start: 'Mont Gelé summit (3,003 m stated)', finish: 'La Chaux / Cabane Mont-Fort (2,430 m stated)', terrain: 'ungroomed open alpine south face' },
    { id: 'it-mont-gele-tortin', name: 'Mont-Gelé–Tortin (Grande Journée)', lengthM: 4300, verticalM: 950, maxSlopeDeg: 34, start: 'Mont Gelé summit (3,003 m stated)', finish: 'Tortin (2,045 m stated)', terrain: 'ungroomed east-facing alpine descent' },
    { id: 'it-col-des-mines', name: 'Col des Mines', lengthM: 3300, verticalM: 900, maxSlopeDeg: null, start: 'Lac des Vaux (2,550 m stated)', finish: 'Etiértses blue near Mayentzet (1,950 m stated)', terrain: 'ungroomed descent towards Verbier' },
    { id: 'it-chassoure-tortin', name: 'Chassoure–Tortin', lengthM: 4300, verticalM: 950, maxSlopeDeg: 33, start: 'Chassoure below the cable car (2,743 m stated)', finish: 'Tortin (2,045 m stated)', terrain: 'north-facing ungroomed steep moguls / powder' },
    { id: 'it-clambin', name: 'Clambin', lengthM: 1600, verticalM: 300, maxSlopeDeg: null, start: 'Hattey red under Les Ruinettes (1,850 m stated)', finish: 'Médran, Verbier (1,650 m stated)', terrain: 'forest and hamlet' },
    { id: 'it-vallon-d-arbi', name: "Vallon d'Arbi", lengthM: 5500, verticalM: 900, maxSlopeDeg: null, start: 'Lac des Vaux (2,550 m stated)', finish: 'Rue du Marteau / La Tzoumaz lift area (1,720 m stated)', terrain: 'remote valley and forest' },
    { id: 'it-les-otanes', name: 'Les Otanes', lengthM: 2200, verticalM: 500, maxSlopeDeg: null, start: 'La Pasay summit (2,100 m stated)', finish: 'Bruson gondola upper station (1,690 m stated)', terrain: 'fir and larch forest' },
    { id: 'it-gentianes-tortin', name: 'Gentianes–Tortin', lengthM: 3300, verticalM: 775, maxSlopeDeg: null, start: 'Col des Gentianes (2,820 m stated)', finish: 'Tortin (2,045 m stated)', terrain: 'long ungroomed mogul descent' },
] as const;

export const EXPERT_ZONES = [
    { id: 'zone-bec-des-rosses', name: 'Bec des Rosses', elevation: 3222, note: 'Xtreme Verbier competition face: exposure, cliffs, couloirs. Not a marked piste. Cliff geometry needs survey / photogrammetry; not built in this version.' },
] as const;

/** Verbier Snowpark at La Chaux: published structure. Exact feature dimensions and placements are not published. */
export const SNOWPARK = {
    id: 'park-la-chaux', name: 'Verbier Snowpark — La Chaux', elevation: 2250, access: 'Chaux-Express / Chaux 2 lift area',
    entries: 2, lines: ['S', 'M', 'L'], smallFeatures: { count: 5, kind: 'table-top / whoop' },
    kickers: { count: 3, publishedRangeM: [9, 13] as const }, jibs: ['rails', 'tubes', 'boxes'],
    status: 'structure published; positions and sizes in the game are a design within the published ranges',
} as const;

export const FUN_ZONES = [
    { id: 'fz-skicross', name: 'La Chaux Skicross', location: 'La Chaux', lengthM: 700, features: ['start gate', 'banked turns', 'whoops', 'jumps', 'netting'] },
    { id: 'fz-mini-kl', name: 'La Chaux Mini KL', location: 'La Chaux', topSpeedKmh: 70 },
    { id: 'fz-funslope', name: 'Savoleyres Funslope', location: 'Taillay', lengthM: 400, elevation: 2226, features: ['twister 10 m', 'curved wall 15 m', '23 elements incl. tunnel, banked turns, jumps'] },
    { id: 'fz-stadium-sud', name: 'Raiffeisen Sud stadium', location: 'Savoleyres', lengthM: 700, verticalM: 200, startElevation: 2350 },
    { id: 'fz-stadium-casino', name: 'Raiffeisen Casino stadium', location: 'La Tzoumaz', lengthM: 1183, verticalM: 309, startElevation: 2356 },
    { id: 'fz-stadium-pasay', name: 'Raiffeisen La Pasay stadium', location: 'Bruson', lengthM: 1090, verticalM: 420, startElevation: 2110 },
    { id: 'fz-stadium-grand-tsai', name: 'Raiffeisen Grand-Tsai stadium', location: 'Bruson', lengthM: 210 },
    { id: 'fz-race-experience', name: 'Verbier Race Experience', location: 'Savoleyres / La Tzoumaz', runSeconds: 60, gates: 15 },
    { id: 'fz-meino', name: "Meïno's playground", location: 'La Pasay, Bruson', features: ['snow tunnels', 'slides'] },
] as const;

/**
 * Versioned infrastructure: the historical Verbier–Savoleyres system and the Esserts–Planards–Savoleyres Télémixte are
 * separate dated objects. A scene for a given date must never contain both (see `infrastructureFor`).
 */
export const SAVOLEYRES_LINK = [
    { id: 'savoleyres-historic', name: 'Historical Verbier–Savoleyres system', validFrom: null, validTo: '2025-12-01', status: 'replaced' },
    { id: 'telemixte-upper', name: 'Télémixte Planards–Savoleyres (upper section)', validFrom: '2025-12-01', validTo: null, status: 'operating since December 2025',
        capacityPerHour: 2650, tripMinutes: 5.29, chairs: { count: 30, seats: 6 } },
    { id: 'telemixte-lower', name: 'Télémixte Les Esserts–Planards (lower section)', validFrom: '2026-12-01', validTo: null,
        status: 'scheduled for December 2026; operating status not independently confirmed',
        capacityPerHour: 1675, tripMinutes: 6.48, cabins: { count: 59, seats: 10 } },
] as const;
/** Infrastructure objects valid on a date (ISO). Historical and modern links never overlap. */
export function infrastructureFor(dateIso: string) {
    return SAVOLEYRES_LINK.filter(o => (o.validFrom === null || o.validFrom <= dateIso) && (o.validTo === null || dateIso < o.validTo));
}

/** Game behaviour per published piste class (guide section 04). Colours are not measured slope angles. */
export const CLASS_BEHAVIOUR = {
    blue: 'stable carving, moderate gradients',
    red: 'sharper turns, sustained steeper sections, real skidding risk',
    black: 'steep sections, moguls possible, punishing mistakes',
    itinerary: 'marked but ungroomed: bumps, unpredictable snow, exposure',
    connection: 'transfer / travel line, not a downhill piste',
    'bus-connection': 'bus transfer',
} as const;

export const SOURCES = [
    { name: 'Operator interactive piste map', url: 'https://verbier4vallees.ch/en/useful-information/interactive-map' },
    { name: 'Operator live winter inventory', url: 'https://verbier4vallees.ch/en/useful-information/live-information-winter' },
    { name: 'Freeride itineraries', url: 'https://verbier4vallees.ch/en/experiences-in-verbier/freeriding' },
    { name: 'Fun zones', url: 'https://verbier4vallees.ch/en/experiences-in-verbier/fun-zones' },
    { name: 'New Savoleyres project', url: 'https://tmx-savoleyres.ch/en' },
    { name: 'swissALTI3D 2 m, 2024 (terrain) © swisstopo', url: 'https://www.swisstopo.admin.ch/en/height-model-swissalti3d' },
    { name: 'SWISSIMAGE (tree positions) © swisstopo', url: 'https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10' },
    { name: 'swisstopo gazetteer / search service (anchor positions)', url: 'https://api3.geo.admin.ch/' },
    { name: 'OpenSkiData: run and lift lines from OpenStreetMap contributors (ODbL)', url: 'https://openskidata.org/' },
] as const;
export const RIGHTS = 'Place and run names are factual references. No resort logos, piste-map artwork or branding are used. Terrain and imagery-derived data © swisstopo (free geodata, attribution required). Run and lift lines © OpenStreetMap contributors, available under the Open Database License (ODbL), via OpenSkiData.';
