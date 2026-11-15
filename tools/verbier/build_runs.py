"""Build EVADER's Verbier runs from real data.

Inputs (cache dir):
  alti/alti2m.npy + .json   swissALTI3D 2 m mosaic (c) swisstopo   -> tools/verbier/fetch_swissalti3d.py
  osd/runs-4v.geojson       OpenSkiData runs (OpenStreetMap, ODbL)
  osd/lifts-4v.geojson      OpenSkiData lifts (OpenStreetMap, ODbL)
  swissimage/               SWISSIMAGE tiles (c) swisstopo, fetched here (WMTS, EPSG:3857, zoom 17)
Outputs:
  public/terrain/<run>.bin  per-run binary: JSON header + centre line + 2 m near grid + 16 m far grid + trees
  lib/verbier/runs-meta.ts  menu metadata (no geometry)
  docs/verbier/build-report.json
Frame: each run is ROTATED (not bent) so its start->end direction points down the screen; every real bend is kept.
Run: python3 tools/verbier/build_runs.py <cache dir>
"""
import json, math, os, struct, sys, unicodedata, urllib.request, io
import numpy as np
from PIL import Image

CACHE = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
M = np.load(os.path.join(CACHE, 'alti/alti2m.npy')); MM = json.load(open(os.path.join(CACHE, 'alti/alti2m.json')))

def wgs_to_lv95(lat, lon):
    p, l = (lat * 3600 - 169028.66) / 10000, (lon * 3600 - 26782.5) / 10000
    e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - .36 * l * p * p - 44.54 * l ** 3
    n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return e, n
def lv95_to_wgs(e, n):
    y, x = (e - 2600000) / 1e6, (n - 1200000) / 1e6
    lon = 2.6779094 + 4.728982 * y + .791484 * y * x + .1306 * y * x * x - .0436 * y ** 3
    lat = 16.9023892 + 3.238272 * x - .270978 * y * y - .002528 * x * x - .0447 * y * y * x - .014 * x ** 3
    return lat * 100 / 36, lon * 100 / 36

def gauss_blur(a, sigma_cells):
    if sigma_cells <= 0: return a
    r = int(math.ceil(sigma_cells * 3)); k = np.exp(-.5 * (np.arange(-r, r + 1) / sigma_cells) ** 2); k /= k.sum()
    p = np.pad(a, r, mode='edge')
    p = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 1, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 0, p)
# Snow cover smooths the bare-earth surface: off-piste a ~3 m blur, groomed pistes a ~9 m blur (groomers fill hollows).
M_off = gauss_blur(M, 1.5); M_piste = gauss_blur(M, 4.5)

def sample(grid, e, n):
    """Bilinear sample of a 2 m mosaic-aligned grid at LV95 arrays e, n."""
    c = (e - MM['e0']) / 2.0; r = (MM['n1'] - n) / 2.0
    c = np.clip(c, 0, grid.shape[1] - 1.001); r = np.clip(r, 0, grid.shape[0] - 1.001)
    c0 = np.floor(c).astype(int); r0 = np.floor(r).astype(int); tc = c - c0; tr = r - r0
    a, b, cc, d = grid[r0, c0], grid[r0, c0 + 1], grid[r0 + 1, c0], grid[r0 + 1, c0 + 1]
    return (a * (1 - tc) + b * tc) * (1 - tr) + (cc * (1 - tc) + d * tc) * tr

runs = json.load(open(os.path.join(CACHE, 'osd/runs-4v.geojson')))['features']
lifts = json.load(open(os.path.join(CACHE, 'osd/lifts-4v.geojson')))['features']
def norm(s): return ''.join(ch for ch in unicodedata.normalize('NFD', (s or '').lower()) if ch.isalnum())
for f in runs:
    g = f['geometry']; pts = g['coordinates'][0] if g['type'] == 'Polygon' else g['coordinates']
    f['lv'] = [wgs_to_lv95(q[1], q[0]) for q in pts]

def chain(names, top_min=None):
    """Join named OpenStreetMap segments (ends within 40 m) into one downhill line, starting from the highest start."""
    want = {norm(n) for n in names}
    segs = [f for f in runs if norm(f['properties'].get('name')) in want and f['geometry']['type'] == 'LineString']
    def z(pt): return float(sample(M, np.array([pt[0]]), np.array([pt[1]]))[0])
    start = max(segs, key=lambda f: z(f['lv'][0]))
    used = {id(start)}; line = list(start['lv']); parts = [start]
    while True:
        end = line[-1]; best = None
        for f in segs:
            if id(f) in used: continue
            dd = math.hypot(f['lv'][0][0] - end[0], f['lv'][0][1] - end[1])
            if dd < 40 and z(f['lv'][-1]) < z(end) + 5 and (best is None or dd < best[0]): best = (dd, f)
        if not best: break
        used.add(id(best[1])); parts.append(best[1]); line += best[1]['lv'][1:]
    return line, parts

def resample(line, step):
    out = [line[0]]
    for i in range(1, len(line)):
        a, b = out[-1], line[i]; seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while seg >= step:
            t = step / seg; a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); out.append(a); seg = math.hypot(b[0] - a[0], b[1] - a[1])
    if math.hypot(out[-1][0] - line[-1][0], out[-1][1] - line[-1][1]) > step * .3: out.append(line[-1])
    return out

# ---- SWISSIMAGE tree detection --------------------------------------------------------------------------------------
TILE_DIR = os.path.join(CACHE, 'swissimage'); os.makedirs(TILE_DIR, exist_ok=True)
Z = 17; tiles = {}
def tile_img(tx, ty):
    key = (tx, ty)
    if key in tiles: return tiles[key]
    path = os.path.join(TILE_DIR, f'{Z}_{tx}_{ty}.jpeg')
    if not os.path.exists(path):
        url = f'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{Z}/{tx}/{ty}.jpeg'
        try: urllib.request.urlretrieve(url, path)
        except Exception: tiles[key] = None; return None
    tiles[key] = np.asarray(Image.open(path).convert('RGB'), dtype=np.int16); return tiles[key]
def pix(lat, lon):
    n = 2 ** Z; x = (lon + 180) / 360 * n; lr = math.radians(lat)
    y = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    return int(x), int(y), int((x % 1) * 256), int((y % 1) * 256)
def is_tree(lat, lon):
    tx, ty, px, py = pix(lat, lon); im = tile_img(tx, ty)
    if im is None: return False
    p = im[max(0, py - 1):py + 2, max(0, px - 1):px + 2].reshape(-1, 3)
    r, g, b = p[:, 0], p[:, 1], p[:, 2]
    # Conifer canopy in summer imagery: dark and green-dominant. Shadowed rock is dark but not green.
    hit = (g < 105) & (r < 95) & (g >= r + 4) & (g >= b - 2)
    return hit.mean() > .55

# ---- runs ---------------------------------------------------------------------------------------------------------
GROOM = {'classic': 'groomed', 'classic+skating': 'groomed', 'mogul': 'moguls', 'backcountry': 'ungroomed', None: 'groomed'}
CLASS = {'easy': 'blue', 'intermediate': 'red', 'advanced': 'black', 'expert': 'black', 'freeride': 'itinerary'}
HALF = {'blue': 22, 'red': 18, 'black': 15, 'itinerary': 0, 'park': 70, 'skicross': 9}  # track groomed between the netting (+-8.5 m)
def park_axis():
    poly = next(f for f in runs if f['geometry']['type'] == 'Polygon' and 'snow_park' in (f['properties'].get('uses') or []))
    pts = np.array(poly['lv'][:-1]); c = pts.mean(axis=0)
    u, s, vt = np.linalg.svd(pts - c); ax = vt[0]
    if sample(M, np.array([c[0] + ax[0] * 100]), np.array([c[1] + ax[1] * 100]))[0] > sample(M, np.array([c[0] - ax[0] * 100]), np.array([c[1] - ax[1] * 100]))[0]: ax = -ax
    half = max(abs((pts - c) @ ax)) + 70
    line = [(c[0] - ax[0] * half, c[1] - ax[1] * half), (c[0] + ax[0] * half, c[1] + ax[1] * half)]
    return line, [poly], [list(map(float, p)) for p in pts]
RUNS = [
    ('attelas', 'ATTELAS', ['Attelas'], 'Red piste from Les Attelas toward Ruinettes / Mayentzet.'),
    ('hattey-clambin', 'HATTEY → CLAMBIN', ['Hattey', 'Piste de Clambin, Hattey', 'Piste de Clambin, Clambin', 'Clambin'], 'Hattey red into the Clambin forest itinerary, down to the Médran side of Verbier.'),
    ('la-chaux-park', 'LA CHAUX SNOWPARK', None, 'Verbier Snowpark in its mapped footprint: S, M and L lines side by side.'),
    ('la-chaux-skicross', 'LA CHAUX SKI CROSS', ['Ski Cross'], 'The mapped ski-cross line: start gate, banked turns, whoops and jumps.'),
    ('mont-fort', 'MONT-FORT', ['Mont-Fort'], 'Black from the 3,330 m summit station; mogul section near the top.'),
    ('chassoure-tortin', 'CHASSOURE → TORTIN', ['Chassoure-Tortin', 'Chassoure - Tortin', 'Châssoure - Tortin'], 'Yellow itinerary: ungroomed, north-facing, moguls and powder.'),
    ('fis', 'FIS', ['FIS'], 'Black: the FIS piste from Les Ruinettes toward Verbier.'),
    ('mont-gele-chaux', 'MONT-GELÉ → LA CHAUX', ['Mt-Gelé - La Chaux'], 'Itinerary off the Mont-Gelé cable car: open, ungroomed south face.'),
]
OUT = os.path.join(ROOT, 'public/terrain'); os.makedirs(OUT, exist_ok=True)
meta_all, report = [], []
for rid, name, names, desc in RUNS:
    if rid == 'la-chaux-park': line, parts, polygon = park_axis()
    else: line, parts = chain(names); polygon = None
    line = resample(line, 2.0)
    E = np.array([p[0] for p in line]); N = np.array([p[1] for p in line])
    hs = sample(M, E, N)
    # Frame: the d axis is the horizontal direction (searched every degree) along which the run backtracks least, so that
    # x(d) stays single-valued; x = right of travel. Start->end is the first guess.
    def frame_for(a):
        ue, un = math.cos(a), math.sin(a); dp = (E - E[0]) * ue + (N - N[0]) * un
        # ties (straight lines) go to the start->end direction
        return float(max(0.0, max(np.maximum.accumulate(dp) - dp))) + .02 * abs(a - a0) * 180 / math.pi + (0 if dp[-1] > 0 else 1e9), ue, un
    a0 = math.atan2(N[-1] - N[0], E[-1] - E[0])
    cands = [frame_for(a0 + math.radians(k)) for k in range(-80, 81)]
    _, ue, un = min(cands, key=lambda c: c[0])
    re, rn = un, -ue
    dproj = (E - E[0]) * ue + (N - N[0]) * un; xproj = (E - E[0]) * re + (N - N[0]) * rn
    backtrack = float(max(0.0, max(np.maximum.accumulate(dproj) - dproj)))
    # A run that turns back on itself (hairpin) cannot be shown by a rotation: it is laid out CURVILINEARLY instead
    # (d = distance along the real line, x = offset along its normal). Heights along and beside the line stay real;
    # its bends are drawn unrolled. Far terrain then uses the straight start->end frame.
    curvilinear = backtrack > 25
    truncated = False
    if curvilinear:
        ue, un = E[-1] - E[0], N[-1] - N[0]; Ls = math.hypot(ue, un); ue /= Ls; un /= Ls; re, rn = un, -ue
        sarc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(E), np.diff(N)))])
        te = np.gradient(E); tn = np.gradient(N)
        k = np.ones(21) / 21; te = np.convolve(np.pad(te, 10, mode='edge'), k, 'valid'); tn = np.convolve(np.pad(tn, 10, mode='edge'), k, 'valid')
        tl = np.hypot(te, tn); te /= tl; tn /= tl
        dproj = sarc; xproj = np.zeros_like(sarc)
    # centre line x(d) every metre: first crossing of each d, smoothed over 6 m
    dmax = float(np.max(dproj)); ds = np.arange(0, math.floor(dmax) + 1, 1.0)
    order = np.maximum.accumulate(dproj)
    cx = np.interp(ds, order + np.arange(len(order)) * 1e-6, xproj)
    k = np.ones(7) / 7; cx = np.convolve(np.pad(cx, 3, mode='edge'), k, 'valid')
    length = float(ds[-1])
    # class, grooming per d (from the OpenStreetMap segments)
    p0 = parts[0]['properties']
    klass = 'park' if rid == 'la-chaux-park' else 'skicross' if rid == 'la-chaux-skicross' else CLASS.get(p0.get('difficulty'), 'red')
    if rid == 'hattey-clambin': klass = 'red'
    def to_world(xv, dv):
        if not curvilinear: return E[0] + dv * ue + xv * re, N[0] + dv * un + xv * rn
        si = min(max(dv, 0), sarc[-1]); pe = float(np.interp(si, sarc, E)); pn = float(np.interp(si, sarc, N))
        return pe + xv * float(np.interp(si, sarc, tn)), pn - xv * float(np.interp(si, sarc, te))
    def to_course(we, wn):
        if not curvilinear: return (we - E[0]) * re + (wn - N[0]) * rn, (we - E[0]) * ue + (wn - N[0]) * un
        i = int(np.argmin((E - we) ** 2 + (N - wn) ** 2)); dist = math.hypot(E[i] - we, N[i] - wn)
        side = (we - E[i]) * tn[i] - (wn - N[i]) * te[i]
        return (math.copysign(dist, side), float(sarc[i])) if dist < 400 else (None, None)
    zones = []
    for f in parts:
        fe = np.array([q[0] for q in f['lv']]); fn = np.array([q[1] for q in f['lv']])
        fd = np.array([to_course(a, b)[1] if curvilinear else (a - E[0]) * ue + (b - N[0]) * un for a, b in zip(fe, fn)], dtype=float) if curvilinear else (fe - E[0]) * ue + (fn - N[0]) * un
        zones.append(dict(d0=round(float(fd.min()), 1), d1=round(float(fd.max()), 1), name=f['properties'].get('name'), grooming=GROOM.get(f['properties'].get('grooming'), 'groomed'),
                          difficulty=f['properties'].get('difficulty'), osm=[s.get('id') for s in f['properties'].get('sources', [])]))
    half = HALF[klass]
    # Grids in the course frame: near 2 m (centre +-260 m), far 16 m (+-2.4 km).
    xmin, xmax = float(cx.min()) - 260, float(cx.max()) + 260
    nd0, nd1 = -120.0, length + 120.0
    nx, nd = int((xmax - xmin) / 2) + 1, int((nd1 - nd0) / 2) + 1
    gx = xmin + np.arange(nx) * 2.0; gd = nd0 + np.arange(nd) * 2.0
    XX, DD = np.meshgrid(gx, gd)
    if curvilinear:
        si = np.clip(DD, 0, sarc[-1]); pe = np.interp(si, sarc, E) + np.clip(DD - sarc[-1], 0, None) * ue + np.clip(DD, None, 0) * ue
        pn = np.interp(si, sarc, N) + np.clip(DD - sarc[-1], 0, None) * un + np.clip(DD, None, 0) * un
        nre = np.interp(si, sarc, tn); nrn = np.interp(si, sarc, -te)
        WE = pe + XX * nre; WN = pn + XX * nrn
    else:
        WE = E[0] + DD * ue + XX * re; WN = N[0] + DD * un + XX * rn
    centre_at = np.interp(DD, ds, cx)
    on = np.abs(XX - centre_at)
    w_piste = np.clip(1 - (on - half) / 12, 0, 1) if half > 0 else np.zeros_like(on)
    near = sample(M_off, WE, WN) * (1 - w_piste) + sample(M_piste, WE, WN) * w_piste
    base = float(np.floor(near.min() / 10) * 10 - 50)
    fx0, fx1, fd0, fd1 = -2400.0, 2400.0, -1500.0, length + 1500.0
    fnx, fnd = int((fx1 - fx0) / 16) + 1, int((fd1 - fd0) / 16) + 1
    FX, FD = np.meshgrid(fx0 + np.arange(fnx) * 16.0, fd0 + np.arange(fnd) * 16.0)
    fscale = (math.hypot(E[-1] - E[0], N[-1] - N[0]) / length) if curvilinear else 1.0
    far = sample(M_off, E[0] + FD * fscale * ue + FX * re, N[0] + FD * fscale * un + FX * rn)
    fbase = float(np.floor(far.min() / 10) * 10 - 50)
    q_near = np.clip(np.round((near - base) * 10), -32768, 32767).astype('<i2')
    q_far = np.clip(np.round((far - fbase) * 5), -32768, 32767).astype('<i2')   # 0.2 m steps: relief up to 6.5 km
    # trees from SWISSIMAGE: candidates every 4 m within +-240 m, outside the piste
    trees = []
    rng = np.random.default_rng(len(rid) * 7919)
    for dv in np.arange(-60, length + 60, 4.0):
        c = float(np.interp(dv, ds, cx))
        for xv in np.arange(c - 240, c + 240, 4.0):
            if abs(xv - c) < half + 3: continue
            jx, jd = xv + rng.uniform(-1.6, 1.6), dv + rng.uniform(-1.6, 1.6)
            we, wn = to_world(jx, jd)
            lat, lon = lv95_to_wgs(we, wn)
            if rng.random() < .55 and float(sample(M, np.array([we]), np.array([wn]))[0]) < 2350 and is_tree(lat, lon):
                trees.append((jx, jd, float(rng.uniform(9, 21))))
    # lifts near the run, in the course frame (pylons = mapped intermediate nodes)
    lift_out = []
    for f in lifts:
        p = f['properties']; g = f['geometry']
        if g['type'] != 'LineString' or p.get('status') not in ('operating', None): continue
        lv = [wgs_to_lv95(q[1], q[0]) for q in g['coordinates']]
        pts = [to_course(e, n) for e, n in lv]
        if any(x is None for x, d in pts): continue
        if not any(abs(x) < 2000 and -1200 < d < length + 1200 for x, d in pts): continue
        ground = sample(M, np.array([q[0] for q in lv]), np.array([q[1] for q in lv]))
        lift_out.append(dict(name=p.get('name'), type=p.get('liftType'), osm=[s.get('id') for s in p.get('sources', [])],
                             points=[[round(x, 1), round(d, 1), round(float(z), 1)] for (x, d), z in zip(pts, ground)]))
    park = None
    if polygon:
        park = dict(polygon=[[round(c[0], 1), round(c[1], 1)] for c in (to_course(e, n) for e, n in polygon)])
    header = dict(id=rid, name=name, description=desc, klass=klass, length=round(length, 1), halfWidth=half,
                  startElevation=round(float(hs[0]), 1), endElevation=round(float(hs[-1]), 1), backtrack=round(backtrack, 1), truncatedAtHairpin=truncated,
                  frame=dict(mode='curvilinear' if curvilinear else 'rotated', e0=float(E[0]), n0=float(N[0]), ue=ue, un=un), zones=zones,
                  centre=dict(count=len(cx), step=1.0),
                  near=dict(x0=xmin, d0=nd0, nx=nx, nd=nd, cell=2.0, base=base, scale=10),
                  far=dict(x0=fx0, d0=fd0, nx=fnx, nd=fnd, cell=16.0, base=fbase, scale=5),
                  trees=len(trees), lifts=lift_out, park=park,
                  sources=['swissALTI3D 2 m 2024 (c) swisstopo', 'SWISSIMAGE (c) swisstopo (tree positions)', 'OpenSkiData / OpenStreetMap contributors, ODbL (run and lift lines)'])
    hb = json.dumps(header, ensure_ascii=False).encode()
    hb += b' ' * ((4 - (len(hb) + 4) % 4) % 4)
    with open(os.path.join(OUT, f'{rid}.bin'), 'wb') as fo:
        fo.write(struct.pack('<I', len(hb))); fo.write(hb)
        fo.write(cx.astype('<f4').tobytes())
        fo.write(q_near.tobytes()); fo.write(b'\0' * ((4 - q_near.nbytes % 4) % 4))
        fo.write(q_far.tobytes()); fo.write(b'\0' * ((4 - q_far.nbytes % 4) % 4))
        fo.write(np.array(trees, dtype='<f4').reshape(-1).tobytes())
    size = os.path.getsize(os.path.join(OUT, f'{rid}.bin'))
    slopes = np.degrees(np.arctan((hs[:-10] - hs[10:]) / 20.0))
    meta_all.append({k: header[k] for k in ('id', 'name', 'description', 'klass', 'length', 'startElevation', 'endElevation')})
    report.append(dict(id=rid, name=name, segments=len(parts), length=round(length), drop=round(float(hs[0] - hs[-1])), maxSlope=round(float(slopes.max()), 1),
                       meanSlope=round(math.degrees(math.atan((hs[0] - hs[-1]) / max(1, len(hs) * 2))), 1), backtrack=round(backtrack, 1),
                       trees=len(trees), lifts=[l['name'] for l in lift_out], bytes=size, zones=[(z['name'], z['grooming'], z['d0'], z['d1']) for z in zones]))
    print(f"{name:24} {'CURV' if curvilinear else 'ROT '}segs {len(parts):2}  {length:6.0f} m  {hs[0]:7.1f} -> {hs[-1]:7.1f}  max {slopes.max():4.1f} deg  backtrack {backtrack:4.1f} m  trees {len(trees):5}  lifts {len(lift_out):2}  {size/1e6:.2f} MB")
with open(os.path.join(ROOT, 'lib/verbier/runs-meta.ts'), 'w') as f:
    f.write('// GENERATED by tools/verbier/build_runs.py. Menu metadata; geometry is loaded from public/terrain/<id>.bin.\n')
    f.write('export const RUNS_META = ' + json.dumps(meta_all, ensure_ascii=False) + ' as const;\n')
json.dump(report, open(os.path.join(ROOT, 'docs/verbier/build-report.json'), 'w'), indent=1, ensure_ascii=False)
