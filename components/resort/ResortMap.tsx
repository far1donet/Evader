'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ChevronLeft, Map as MapIcon, Box, X, Play, CableCar, ArrowRight, Navigation, FastForward, Info } from 'lucide-react';
import { loadResort, overviewGrid, overviewHeight, type Resort, type ResortLift, type RouteSummary, type Station } from '@/lib/verbier/terrain';
import { reliefImage, drawMap, mapTexture, pick, along, PISTE_COLOUR, type View } from '@/lib/verbier/map-render';

export type Arrival = { title: string; detail: string; onReplay?: () => void };
type Selection = { kind: 'station'; item: Station } | { kind: 'lift'; item: ResortLift } | { kind: 'route'; item: RouteSummary } | null;
type Ride = { lift: ResortLift; t: number; duration: number };
const CLASS_NAME: Record<string, string> = { blue: 'Blue', red: 'Red', black: 'Black', itinerary: 'Itinerary', park: 'Snowpark', skicross: 'Ski cross' };
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
const km = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

/**
 * Verbier 4 Vallées resort map: where you are, the lifts you can take from here and the pistes you can ride down.
 * Real geography: swissALTI3D relief, OpenStreetMap piste and lift lines, official station names. 2D and 3D views.
 */
export default function ResortMap({ station, onStation, onRide, onClose, arrival, onDismissArrival, loading }: {
    station: string; onStation: (id: string) => void; onRide: (r: RouteSummary) => void; onClose: () => void;
    arrival: Arrival | null; onDismissArrival: () => void; loading: boolean;
}) {
    const [resort, setResort] = useState<Resort | null>(null), [err, setErr] = useState('');
    const [mode, setMode] = useState<'2d' | '3d'>(() => { try { return (localStorage.getItem('evader-map-view') as '2d' | '3d') || '2d'; } catch { return '2d'; } });
    const [sel, setSel] = useState<Selection>(null), [ride, setRide] = useState<Ride | null>(null);
    useEffect(() => { let live = true; loadResort().then(r => { if (live) setResort(r); }).catch(() => setErr('The resort map could not be loaded. Check the connection and try again.')); return () => { live = false; }; }, []);
    useEffect(() => { try { localStorage.setItem('evader-map-view', mode); } catch { /* per-viewer convenience only */ } }, [mode]);
    const relief = useMemo(() => resort ? reliefImage(resort) : null, [resort]);
    const here = resort?.stations.find(s => s.id === station);
    // first visit (or a station id from an older build): start in Verbier village, at the Médran lifts
    useEffect(() => { if (resort && !here) onStation((resort.stations.find(s => s.name === 'Verbier – Médran') ?? resort.stations[0]).id); }, [resort, here, onStation]);
    const liftsUp = useMemo(() => resort && here ? here.liftsUp.map(id => resort.lifts.find(l => l.id === id)!).sort((a, b) => b.vertical - a.vertical) : [], [resort, here]);
    const routesFrom = useMemo(() => resort && here ? resort.routes.filter(r => r.fromStation === here.id) : [], [resort, here]);
    const byDest = useMemo(() => {
        const m = new Map<string, RouteSummary[]>();
        for (const r of routesFrom) { const k = r.toStation ?? '—'; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
        for (const list of m.values()) list.sort((a, b) => order(a.klass) - order(b.klass) || a.length - b.length);
        return [...m.entries()].sort((a, b) => (resort?.stations.find(s => s.id === a[0])?.z ?? 0) - (resort?.stations.find(s => s.id === b[0])?.z ?? 0));
    }, [routesFrom, resort]);
    const highlight = useMemo(() => new Set(routesFrom.map(r => r.id)), [routesFrom]);
    const stationName = (id: string | null) => resort?.stations.find(s => s.id === id)?.name ?? 'end of the mapped line';

    // lift ride: accelerated playback of the real ride (real duration shown)
    useEffect(() => {
        if (!ride) return;
        let raf = 0, last = performance.now();
        const step = (now: number) => {
            const dt = (now - last) / 1000; last = now;
            setRide(r => r && { ...r, t: Math.min(1, r.t + dt / r.duration) });
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [ride?.lift.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (ride && ride.t >= 1) { onStation(ride.lift.to); setSel(null); setRide(null); } }, [ride, onStation]);
    const startLift = (l: ResortLift) => { onDismissArrival(); setSel(null); setRide({ lift: l, t: 0, duration: Math.min(18, Math.max(6, l.rideS / 18)) }); };
    const rider = ride ? along(ride.lift.points, ride.t) : null;
    const onPick = (e: number, n: number, tol: number) => { if (!resort || ride) return; setSel(pick(resort, e, n, tol, highlight)); };

    if (err) return <div className="resort"><div className="resort-error">{err}<button className="secondary-button" onClick={onClose}>Back</button></div></div>;
    if (!resort || !relief || !here) return <div className="resort"><div className="resort-loading">Loading the Verbier 4 Vallées map…</div></div>;
    return <div className="resort">
        <div className="resort-map">
            {mode === '2d'
                ? <Map2D resort={resort} relief={relief} station={station} sel={sel} highlight={highlight} rider={rider} onPick={onPick} />
                : <Map3D resort={resort} relief={relief} station={station} sel={sel} ride={ride} onPick={onPick} onStationLabel={id => !ride && setSel({ kind: 'station', item: resort.stations.find(s => s.id === id)! })} />}
            <div className="resort-top">
                <button className="secondary-button" onClick={onClose}><ChevronLeft size={17} />Menu</button>
                <div className="resort-toggle" role="group" aria-label="Map view">
                    <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}><MapIcon size={15} />2D</button>
                    <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15} />3D</button>
                </div>
            </div>
            <div className="resort-legend"><span><i style={{ background: PISTE_COLOUR.blue }} />Blue</span><span><i style={{ background: PISTE_COLOUR.red }} />Red</span><span><i style={{ background: PISTE_COLOUR.black }} />Black</span><span><i className="dash" style={{ background: PISTE_COLOUR.itinerary }} />Itinerary</span><span><i className="lift" />Lift</span></div>
            <p className="resort-credit">© swisstopo · © OpenStreetMap contributors (ODbL)</p>
            {ride && <div className="lift-ride">
                <span className="eyebrow">{ride.lift.typeLabel.toUpperCase()} · RIDING</span>
                <strong>{ride.lift.name}</strong>
                <span>{stationName(ride.lift.from)} → {stationName(ride.lift.to)}</span>
                <div className="progress-track"><div style={{ width: `${ride.t * 100}%` }} /></div>
                <span className="lift-ride-stats">{Math.round(ride.lift.bottomZ + (ride.lift.topZ - ride.lift.bottomZ) * ride.t).toLocaleString()} m · real ride {mmss(ride.lift.rideS)}</span>
                <button className="text-button" onClick={() => setRide(r => r && { ...r, t: 1 })}><FastForward size={15} />Skip</button>
            </div>}
        </div>
        <aside className="resort-panel">
            {arrival && <div className="arrival"><button className="icon-button" aria-label="Close" onClick={onDismissArrival}><X size={16} /></button><span className="eyebrow">RUN COMPLETE</span><strong>{arrival.title}</strong><p>{arrival.detail}</p>{arrival.onReplay && <button className="text-button" onClick={arrival.onReplay}>Watch the replay</button>}</div>}
            <span className="eyebrow">YOU ARE AT</span>
            <h1 className="station-title">{here.name}</h1>
            <p className="station-meta">{Math.round(here.z).toLocaleString()} m · {here.liftsUp.length} lift{here.liftsUp.length === 1 ? '' : 's'} · {routesFrom.length} run{routesFrom.length === 1 ? '' : 's'} down</p>
            {sel && <Detail sel={sel} resort={resort} here={here} stationName={stationName} loading={loading}
                onClose={() => setSel(null)} onRide={onRide} onLift={startLift} onTravel={id => { onDismissArrival(); setSel(null); onStation(id); }} />}
            {!sel && <>
                <h2 className="panel-heading"><CableCar size={16} />Lifts from here</h2>
                {liftsUp.length ? <div className="lift-list">{liftsUp.map(l => <button key={l.id} className="lift-row" disabled={!!ride} onClick={() => setSel({ kind: 'lift', item: l })}>
                    <span className="lift-type">{l.typeLabel}</span><strong>{l.name}</strong>
                    <span className="lift-to"><ArrowRight size={13} />{stationName(l.to)} · +{l.vertical} m · {mmss(l.rideS)}</span>
                </button>)}</div> : <p className="panel-note">No lift leaves from this station. Ride down to the next one.</p>}
                <h2 className="panel-heading"><Navigation size={16} />Ride down to</h2>
                {byDest.length ? byDest.map(([dest, list]) => <div key={dest} className="dest-group">
                    <span className="dest-name">{stationName(dest)}</span>
                    <div className="route-chips">{list.map(r => <button key={r.id} disabled={!!ride} className="route-chip" onClick={() => setSel({ kind: 'route', item: r })}>
                        <i style={{ background: PISTE_COLOUR[r.klass] }} />{CLASS_NAME[r.klass]} · {km(r.length)} · −{r.drop} m
                    </button>)}</div>
                </div>) : <p className="panel-note">No mapped piste leaves from here. Take a lift.</p>}
                <p className="panel-note small"><Info size={12} /> Tap any lift, run or station on the map. Station names: Swiss public-transport register / swisstopo. Lift data: OpenStreetMap.</p>
            </>}
        </aside>
    </div>;
}
const order = (k: string) => ({ blue: 1, red: 2, black: 3, itinerary: 4, park: 5, skicross: 6 } as Record<string, number>)[k] ?? 9;

function Detail({ sel, resort, here, stationName, loading, onClose, onRide, onLift, onTravel }: {
    sel: NonNullable<Selection>; resort: Resort; here: Station; stationName: (id: string | null) => string; loading: boolean;
    onClose: () => void; onRide: (r: RouteSummary) => void; onLift: (l: ResortLift) => void; onTravel: (id: string) => void;
}) {
    return <div className="detail-card">
        <button className="icon-button detail-close" aria-label="Close details" onClick={onClose}><X size={16} /></button>
        {sel.kind === 'lift' && (() => {
            const l = sel.item, atBottom = l.from === here.id;
            return <>
                <span className="eyebrow">{l.typeLabel.toUpperCase()}</span><h2>{l.name}</h2>
                <p>{stationName(l.from)} <ArrowRight size={13} /> {stationName(l.to)}</p>
                <dl>
                    <div><dt>Bottom</dt><dd>{Math.round(l.bottomZ).toLocaleString()} m</dd></div><div><dt>Top</dt><dd>{Math.round(l.topZ).toLocaleString()} m</dd></div>
                    <div><dt>Vertical</dt><dd>{l.vertical} m</dd></div><div><dt>Length</dt><dd>{km(l.length)}</dd></div>
                    <div><dt>Ride</dt><dd>{mmss(l.rideS)}{l.durationS ? '' : ' (est.)'}</dd></div>{l.capacity && <div><dt>Capacity</dt><dd>{l.capacity.toLocaleString()} p/h</dd></div>}
                    {l.occupancy && <div><dt>Seats</dt><dd>{l.occupancy}</dd></div>}{l.guide && <div><dt>Guide</dt><dd>{l.guide.name} · {l.guide.type}</dd></div>}
                </dl>
                {l.note && <p className="panel-note small">{l.note}</p>}
                {atBottom ? <button className="drop-button" onClick={() => onLift(l)}><CableCar size={17} />Ride this lift</button>
                    : <button className="secondary-button" onClick={() => onTravel(l.from)}><Navigation size={16} />Go to {stationName(l.from)}</button>}
            </>;
        })()}
        {sel.kind === 'route' && (() => {
            const r = sel.item, fromHere = r.fromStation === here.id;
            return <>
                <span className="eyebrow" style={{ color: PISTE_COLOUR[r.klass] === '#15181b' ? '#dfe7ec' : PISTE_COLOUR[r.klass] }}>{CLASS_NAME[r.klass].toUpperCase()} RUN</span>
                <h2>{stationName(r.fromStation)} <ArrowRight size={15} /> {stationName(r.toStation)}</h2>
                <p>{r.description}</p>
                <dl><div><dt>Length</dt><dd>{km(r.length)}</dd></div><div><dt>Drop</dt><dd>{r.drop} m</dd></div>
                    <div><dt>Start</dt><dd>{Math.round(r.startElevation).toLocaleString()} m</dd></div><div><dt>Finish</dt><dd>{Math.round(r.endElevation).toLocaleString()} m</dd></div></dl>
                {fromHere || !r.fromStation ? <button className="drop-button" disabled={loading} onClick={() => onRide(r)}><Play size={17} />{loading ? 'Loading terrain…' : 'Drop in'}</button>
                    : <button className="secondary-button" onClick={() => onTravel(r.fromStation!)}><Navigation size={16} />Go to {stationName(r.fromStation)}</button>}
            </>;
        })()}
        {sel.kind === 'station' && (() => {
            const s = sel.item;
            return <>
                <span className="eyebrow">STATION · {Math.round(s.z).toLocaleString()} M</span><h2>{s.name}</h2>
                <p>{s.liftsUp.length} lift{s.liftsUp.length === 1 ? '' : 's'} up ({s.liftsUp.map(id => resort.lifts.find(l => l.id === id)?.name).join(', ') || 'none'}) · {s.routesFrom.length} run{s.routesFrom.length === 1 ? '' : 's'} down</p>
                <p className="panel-note small">Name: {s.nameSource}</p>
                {s.id !== here.id && <button className="secondary-button" onClick={() => onTravel(s.id)}><Navigation size={16} />Go to this station</button>}
            </>;
        })()}
    </div>;
}

// ---- 2D --------------------------------------------------------------------------------------------------------------------------
function Map2D({ resort, relief, station, sel, highlight, rider, onPick }: {
    resort: Resort; relief: HTMLCanvasElement; station: string; sel: Selection; highlight: Set<string>; rider: { e: number; n: number } | null;
    onPick: (e: number, n: number, tol: number) => void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null), view = useRef<View | null>(null), raf = useRef(0);
    const props = useRef({ station, sel, highlight, rider }); props.current = { station, sel, highlight, rider };
    const redraw = () => {
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => {
            const c = canvas.current, v = view.current; if (!c || !v) return;
            const p = props.current;
            drawMap(c.getContext('2d')!, resort, relief, v, { station: p.station, highlightRoutes: p.highlight, rider: p.rider, pixelRatio: Math.min(devicePixelRatio, 2),
                selectedLift: p.sel?.kind === 'lift' ? p.sel.item.id : null, selectedRoute: p.sel?.kind === 'route' ? p.sel.item.id : null });
        });
    };
    useEffect(() => {
        const c = canvas.current!, here = resort.stations.find(s => s.id === station)!;
        const resize = () => {
            const r = c.getBoundingClientRect(), pr = Math.min(devicePixelRatio, 2);
            c.width = Math.round(r.width * pr); c.height = Math.round(r.height * pr);
            view.current = { ...(view.current ?? { e: here.e, n: here.n, scale: r.width < 700 ? .09 : .14 }), w: r.width, h: r.height };
            redraw();
        };
        const ro = new ResizeObserver(resize); ro.observe(c); resize();
        // pan / pinch / wheel / tap
        const pts = new Map<number, { x: number; y: number }>(); let moved = 0, pinch = 0;
        const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } };
        const move = (e: PointerEvent) => {
            const p = pts.get(e.pointerId), v = view.current; if (!p || !v) return;
            if (pts.size === 1) { v.e -= (e.clientX - p.x) / v.scale; v.n += (e.clientY - p.y) / v.scale; moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y); }
            p.x = e.clientX; p.y = e.clientY;
            if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) zoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d; moved += 10; }
            redraw();
        };
        const up = (e: PointerEvent) => {
            const v = view.current; pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
            if (moved < 6 && v) { const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; onPickRef.current((x - v.w / 2) / v.scale + v.e, v.n - (y - v.h / 2) / v.scale, 16 / v.scale); }
        };
        const zoom = (k: number, cx: number, cy: number) => {
            const v = view.current!, r = c.getBoundingClientRect(), x = cx - r.left - v.w / 2, y = cy - r.top - v.h / 2;
            const ns = Math.min(3, Math.max(.025, v.scale * k)); v.e += x / v.scale - x / ns; v.n -= y / v.scale - y / ns; v.scale = ns;
        };
        const wheel = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); redraw(); };
        c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('wheel', wheel, { passive: false });
        return () => { ro.disconnect(); cancelAnimationFrame(raf.current); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('wheel', wheel); };
    }, [resort, relief]); // eslint-disable-line react-hooks/exhaustive-deps
    const onPickRef = useRef(onPick); onPickRef.current = onPick;
    useEffect(() => { const s = resort.stations.find(x => x.id === station); if (s && view.current) { view.current.e = s.e; view.current.n = s.n; } redraw(); }, [station]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (rider && view.current) { view.current.e = rider.e; view.current.n = rider.n; } redraw(); }, [rider?.e, rider?.n, sel, highlight]); // eslint-disable-line react-hooks/exhaustive-deps
    return <canvas ref={canvas} className="map-canvas" aria-label="Resort map: drag to move, pinch or scroll to zoom, tap a lift, run or station" />;
}

// ---- 3D --------------------------------------------------------------------------------------------------------------------------
function Map3D({ resort, relief, station, sel, ride, onPick, onStationLabel }: {
    resort: Resort; relief: HTMLCanvasElement; station: string; sel: Selection; ride: Ride | null;
    onPick: (e: number, n: number, tol: number) => void; onStationLabel: (id: string) => void;
}) {
    const host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null);
    const state = useRef({ station, sel, ride, onPick, onStationLabel }); state.current = { station, sel, ride, onPick, onStationLabel };
    const api = useRef<{ focus: (id: string) => void; select: () => void } | null>(null);
    useEffect(() => {
        const el = host.current!, b = resort.box, cx = (b.e0 + b.e1) / 2, cn = (b.n0 + b.n1) / 2;
        const V = (e: number, n: number, h: number) => new T.Vector3(e - cx, h, -(n - cn));
        const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = T.SRGBColorSpace;
        el.prepend(renderer.domElement); renderer.domElement.className = 'map-canvas';
        const scene = new T.Scene(); scene.background = new T.Color(0xb7cde0); scene.fog = new T.Fog(0xb7cde0, 16000, 46000);
        const cam = new T.PerspectiveCamera(45, 1, 15, 120000);
        scene.add(new T.HemisphereLight(0xeaf3ff, 0x6d7782, 1.6)); const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, 1.2, -.6); scene.add(sun);
        // terrain from the 10 m overview (every 3rd cell = 30 m mesh), draped with the piste map
        const g = overviewGrid(), m = g.meta, step = 3;
        const nx = Math.floor((m.nx - 1) / step) + 1, ny = Math.floor((m.ny - 1) / step) + 1;
        const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i, e = m.e0 + i * step * m.cell, n = m.n1 - j * step * m.cell, h = g.height(j * step * m.nx + i * step);
            pos[k * 3] = e - cx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -(n - cn);
            uv[k * 2] = (e - b.e0) / (b.e1 - b.e0); uv[k * 2 + 1] = (n - b.n0) / (b.n1 - b.n0);
        }
        const idx: number[] = [];
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(idx);
        const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize);
        const tex = new T.CanvasTexture(mapTexture(resort, relief, maxTex)); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const terrain = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex })); scene.add(terrain);
        // horizon around the survey box (SRTM 40 m, every 4th cell)
        const hz = resort.horizon, hs = 4, hnx = Math.floor(hz.nx / hs), hny = Math.floor(hz.ny / hs);
        const hpos = new Float32Array(hnx * hny * 3);
        for (let j = 0; j < hny; j++) for (let i = 0; i < hnx; i++) {
            const e = hz.e0 + i * hs * hz.cell, n = hz.n1 - j * hs * hz.cell, inside = e > b.e0 + 250 && e < b.e1 - 250 && n > b.n0 + 250 && n < b.n1 - 250;
            const k = (j * hnx + i) * 3; hpos[k] = e - cx; hpos[k + 1] = overviewHeight(e, n) - (inside ? 60 : 0); hpos[k + 2] = -(n - cn);
        }
        const hidx: number[] = [];
        for (let j = 0; j < hny - 1; j++) for (let i = 0; i < hnx - 1; i++) { const a = j * hnx + i; hidx.push(a, a + hnx, a + 1, a + 1, a + hnx, a + hnx + 1); }
        const hgeo = new T.BufferGeometry(); hgeo.setAttribute('position', new T.BufferAttribute(hpos, 3)); hgeo.setIndex(hidx); hgeo.computeVertexNormals();
        scene.add(new T.Mesh(hgeo, new T.MeshLambertMaterial({ color: 0xe9eef2 })));
        // lifts: cables above the mapped line, stations as boxes
        const cableMat = new T.LineBasicMaterial({ color: 0x1b2125 }), stationMat = new T.MeshLambertMaterial({ color: 0x4b5258 });
        const liftLines = new Map<string, T.Vector3[]>();
        for (const l of resort.lifts) {
            const lift = l.type === 'cable_car' ? 22 : l.type === 'gondola' || l.type === 'mixed_lift' ? 16 : l.type === 'chair_lift' ? 11 : 5;
            const pts = l.points.map(([e, n, z], i) => V(e, n, z + (i === 0 || i === l.points.length - 1 ? 8 : lift)));
            liftLines.set(l.id, pts);
            scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), cableMat));
            for (const p of [pts[0], pts[pts.length - 1]]) { const s = new T.Mesh(new T.BoxGeometry(26, 14, 20), stationMat); s.position.copy(p).setY(p.y - 2); scene.add(s); }
        }
        const highlight = new T.Group(); scene.add(highlight);
        const cabin = new T.Mesh(new T.BoxGeometry(14, 12, 14), new T.MeshLambertMaterial({ color: 0xd7fa65 })); cabin.visible = false; scene.add(cabin);
        // labels (HTML, clickable)
        const lab = labels.current!; lab.innerHTML = '';
        const rank = (s: Station) => (s.id === state.current.station ? 100 : 0) + s.liftsUp.length * 2 + s.liftsArrive.length + (s.nameSource.startsWith('common') ? 3 : 0);
        const labelEls = resort.stations.map(s => {
            const btn = document.createElement('button'); btn.className = 'map-label'; btn.textContent = s.name;
            btn.onclick = () => state.current.onStationLabel(s.id); lab.appendChild(btn); return { s, btn, p: V(s.e, s.n, s.z + 40), w: 0 };
        });
        const controls = new OrbitControls(cam, renderer.domElement);
        controls.enableDamping = true; controls.maxPolarAngle = 1.42; controls.minDistance = 250; controls.maxDistance = 40000; controls.screenSpacePanning = false;
        const focus = (id: string, keepOffset = true) => {
            const s = resort.stations.find(x => x.id === id); if (!s) return;
            const target = V(s.e, s.n, s.z), offset = keepOffset && controls.target.lengthSq() ? cam.position.clone().sub(controls.target) : new T.Vector3(-2600, 2400, 3400);
            controls.target.copy(target); cam.position.copy(target).add(offset);
        };
        focus(state.current.station, false);
        const select = () => {
            highlight.clear(); const s = state.current.sel;
            const line = s?.kind === 'lift' ? liftLines.get(s.item.id) : s?.kind === 'route' ? s.item.line.map(([e, n]) => V(e, n, overviewHeight(e, n) + 6)) : null;
            if (line && line.length > 1) highlight.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(line), Math.max(8, line.length * 4), 7, 6), new T.MeshBasicMaterial({ color: 0xd7fa65 })));
        };
        api.current = { focus: id => focus(id), select };
        // tap to pick
        const ray = new T.Raycaster(); let downAt: { x: number; y: number } | null = null;
        const pd = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
        const pu = (e: PointerEvent) => {
            if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; downAt = null;
            const r = renderer.domElement.getBoundingClientRect();
            ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), cam);
            const hit = ray.intersectObject(terrain)[0]; if (!hit) return;
            state.current.onPick(hit.point.x + cx, -hit.point.z + cn, Math.max(25, hit.distance * .02));
        };
        renderer.domElement.addEventListener('pointerdown', pd); renderer.domElement.addEventListener('pointerup', pu);
        const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix(); };
        const ro = new ResizeObserver(resize); ro.observe(el); resize();
        let raf = 0, wasRiding = false; const tmp = new T.Vector3();
        const loop = () => {
            raf = requestAnimationFrame(loop);
            const rd = state.current.ride;
            if (rd) {
                const pts = liftLines.get(rd.lift.id)!, p = along(pts.map(v => [v.x, -v.z, v.y] as [number, number, number]), rd.t);
                const at = new T.Vector3(p.e, p.z - 6, -p.n), dir = new T.Vector3(Math.sin(p.heading), 0, -Math.cos(p.heading));
                cabin.visible = true; cabin.position.copy(at); cabin.rotation.y = -p.heading;
                cam.position.copy(at).addScaledVector(dir, -160).add(new T.Vector3(70, 70, 0)); controls.target.copy(at).addScaledVector(dir, 120); cam.lookAt(controls.target);
                controls.enabled = false; wasRiding = true;
            } else {
                if (wasRiding) { cabin.visible = false; controls.enabled = true; focus(state.current.station, false); wasRiding = false; }
                controls.update();
            }
            renderer.render(scene, cam);
            const r = el.getBoundingClientRect(), placed: [number, number, number, number][] = [];
            // nearest and most important first; a label that would overlap one already placed is hidden
            const order = labelEls.map(l => ({ l, dist: cam.position.distanceTo(l.p) })).sort((a, b) => rank(b.l.s) - rank(a.l.s) || a.dist - b.dist);
            for (const { l, dist } of order) {
                const { s, btn, p } = l;
                tmp.copy(p).project(cam);
                const important = s.id === state.current.station || s.liftsUp.length >= 2 || s.nameSource.startsWith('common');
                let show = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && (important || dist < 6000) && dist < 26000;
                const x = (tmp.x + 1) / 2 * r.width, y = (1 - tmp.y) / 2 * r.height;
                if (show) {
                    if (!l.w) l.w = btn.offsetWidth || s.name.length * 7 + 14;
                    const box: [number, number, number, number] = [x - l.w / 2, y - 30, l.w, 22];
                    if (s.id !== state.current.station && placed.some(q => box[0] < q[0] + q[2] && box[0] + box[2] > q[0] && box[1] < q[1] + q[3] && box[1] + box[3] > q[1])) show = false;
                    else placed.push(box);
                }
                btn.style.display = show ? '' : 'none';
                if (show) { btn.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`; btn.classList.toggle('here', s.id === state.current.station); }
            }
        };
        loop();
        return () => {
            cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', pd); renderer.domElement.removeEventListener('pointerup', pu);
            scene.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Line) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(mt => mt.dispose()); } });
            tex.dispose(); renderer.dispose(); renderer.domElement.remove(); lab.innerHTML = ''; api.current = null;
        };
    }, [resort, relief]);
    useEffect(() => { api.current?.focus(station); }, [station]);
    useEffect(() => { api.current?.select(); }, [sel]);
    return <div ref={host} className="map3d"><div ref={labels} className="map-labels" /></div>;
}
