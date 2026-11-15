/**
 * Free-ride passport: what you have done on the real mountain, kept on this device (localStorage). Stations visited,
 * lifts ridden, vertical metres ridden down, distance and top speed in free ride, and goals built from them.
 */
export type Passport = { stations: string[]; lifts: string[]; descent: number; distance: number; topSpeed: number; tutorial?: boolean };
export const EMPTY_PASSPORT: Passport = { stations: [], lifts: [], descent: 0, distance: 0, topSpeed: 0 };
const KEY = 'evader-passport-v1';

export function loadPassport(): Passport {
    try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p && Array.isArray(p.stations)) return { ...EMPTY_PASSPORT, ...p }; } catch { /* private mode */ }
    return { ...EMPTY_PASSPORT, stations: [], lifts: [] };
}
export function savePassport(p: Passport) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

/** Fold in a free-ride sample; returns a new passport and whether anything changed (to save sparingly). */
export function record(p: Passport, s: { station?: string; lift?: string; descent?: number; distance?: number; speedKmh?: number }): [Passport, boolean] {
    let changed = false; const q = { ...p };
    if (s.station && !p.stations.includes(s.station)) { q.stations = [...p.stations, s.station]; changed = true; }
    if (s.lift && !p.lifts.includes(s.lift)) { q.lifts = [...p.lifts, s.lift]; changed = true; }
    if (s.descent && s.descent > 0) { q.descent = p.descent + s.descent; changed = true; }
    if (s.distance && s.distance > 0) { q.distance = p.distance + s.distance; changed = true; }
    if (s.speedKmh && s.speedKmh > p.topSpeed) { q.topSpeed = s.speedKmh; changed = true; }
    return [q, changed];
}

export type Goal = { name: string; detail: string; value: number; target: number; unit: string };
/** Goals with progress. `stationsTotal`/`liftsTotal` are the counts in the resort. */
export function goals(p: Passport, stationsTotal: number, liftsTotal: number): Goal[] {
    const has = (n: string) => p.stations.some(s => s.includes(n));
    return [
        { name: 'Learn to ride', detail: 'Finish the six-step tutorial at Les Ruinettes.', value: p.tutorial ? 1 : 0, target: 1, unit: '' },
        { name: 'Lift collector', detail: 'Ride 10 different lifts.', value: Math.min(10, p.lifts.length), target: 10, unit: 'lifts' },
        { name: 'Top of the 4 Vallées', detail: 'Reach Mont-Fort (3,330 m).', value: has('Mont-Fort') ? 1 : 0, target: 1, unit: '' },
        { name: 'Thousand-metre day', detail: 'Ride down 1,000 vertical metres in free ride.', value: Math.min(1000, Math.round(p.descent)), target: 1000, unit: 'm' },
        { name: 'Vertical 10k', detail: 'Ride down 10,000 vertical metres in total.', value: Math.min(10000, Math.round(p.descent)), target: 10000, unit: 'm' },
        { name: 'Fast and clean', detail: 'Reach 70 km/h.', value: Math.min(70, Math.round(p.topSpeed)), target: 70, unit: 'km/h' },
        { name: 'Grand tour', detail: 'Visit Verbier, Savoleyres, Bruson, Siviez, Nendaz and Thyon stations.',
            value: ['Médran', 'Savoleyres', 'Bruson', 'Siviez', 'Nendaz', 'Thyon'].filter(has).length, target: 6, unit: 'areas' },
        { name: 'Explorer', detail: `Visit half of the ${stationsTotal} stations.`, value: Math.min(Math.ceil(stationsTotal / 2), p.stations.length), target: Math.ceil(stationsTotal / 2), unit: 'stations' },
        { name: 'Every lift', detail: `Ride all ${liftsTotal} lifts.`, value: Math.min(liftsTotal, p.lifts.length), target: liftsTotal, unit: 'lifts' },
    ];
}
