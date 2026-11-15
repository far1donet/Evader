"""Build EVADER's Verbier 4 Vallees resort from real data: one shared terrain, the real lift network, every piste route
between lift stations, and the featured runs.

Inputs (cache dir):
  alti/alti2m.npy + .json     swissALTI3D 2 m mosaic (c) swisstopo                      <- fetch_swissalti3d.py
  osd/runs-4v.geojson         OpenSkiData runs  (OpenStreetMap contributors, ODbL)    <- filter_openskidata.py
  osd/lifts-4v.geojson        OpenSkiData lifts (OpenStreetMap contributors, ODbL)    <- filter_openskidata.py
  dem/N46E007.hgt             SRTM 1" (NASA/USGS, public domain): distant horizon only, outside the swissALTI3D box
  swissimage16/, names/       fetched here: SWISSIMAGE WMTS tiles (c) swisstopo (tree detection), swissNAMES3D lookups
Outputs:
  public/resort/resort.json           stations, lifts, piste lines (map), route summaries, tile index
  public/resort/routes/<id>.json      rideable route: frame, centre line, zones, park polygon
  public/resort/tiles/<E>_<N>.bin     1 km terrain tile, 2 m snow surface + trees (zlib)
  public/resort/overview.bin          10 m snow surface for the whole box (zlib)
  public/resort/horizon.bin           40 m SRTM horizon around the box (zlib)
  lib/verbier/runs-meta.ts, docs/verbier/build-report.json
Run: python3 tools/verbier/build_resort.py <cache dir>
"""
import json, math, os, sys, zlib, struct, unicodedata, urllib.request, urllib.parse, heapq, concurrent.futures as cf
import numpy as np
from PIL import Image

CACHE = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public/resort')
for d in ('', 'routes', 'tiles'): os.makedirs(os.path.join(OUT, d), exist_ok=True)

# ---- coordinates --------------------------------------------------------------------------------------------------------
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
def norm(s): return ''.join(ch for ch in unicodedata.normalize('NFD', (s or '').lower()) if ch.isalnum())

# ---- terrain ------------------------------------------------------------------------------------------------------------
M = np.load(os.path.join(CACHE, 'alti/alti2m.npy')); MM = json.load(open(os.path.join(CACHE, 'alti/alti2m.json')))
E0, N1, W, H = MM['e0'], MM['n1'], MM['width'], MM['height']
N0, E1 = N1 - H * 2, E0 + W * 2
if np.isnan(M).any(): M = np.where(np.isnan(M), np.nanmean(M), M)
print('terrain', W, 'x', H, 'cells', E0, N0, E1, N1, flush=True)

def sample(grid, e, n, cell=2.0, e0=E0, n1=N1):
    e = np.asarray(e, float); n = np.asarray(n, float)
    c = np.clip((e - e0) / cell, 0, grid.shape[1] - 1.001); r = np.clip((n1 - n) / cell, 0, grid.shape[0] - 1.001)
    c0 = np.floor(c).astype(int); r0 = np.floor(r).astype(int); tc = c - c0; tr = r - r0
    return (grid[r0, c0] * (1 - tc) + grid[r0, c0 + 1] * tc) * (1 - tr) + (grid[r0 + 1, c0] * (1 - tc) + grid[r0 + 1, c0 + 1] * tc) * tr

def box_blur(a, w, axis):
    if w <= 1: return a
    r = w // 2; p = np.pad(a, [(r, w - 1 - r) if i == axis else (0, 0) for i in range(2)], mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    hi = np.take(c, np.arange(w, c.shape[axis]), axis=axis); lo = np.take(c, np.arange(0, c.shape[axis] - w), axis=axis)
    return ((hi - lo) / w).astype(np.float32)
def gauss(a, sigma_cells):
    """Three box passes per axis approximate a Gaussian of the given sigma (in cells)."""
    w = max(1, int(round(math.sqrt(4 * sigma_cells ** 2 + 1))))
    for _ in range(3): a = box_blur(box_blur(a, w, 1), w, 0)
    return a

# ---- OpenStreetMap data -----------------------------------------------------------------------------------------------------
def in4v(p): return any('4 Vall' in (s['properties'].get('name') or '') for s in p.get('skiAreas', []))
RUNS = json.load(open(os.path.join(CACHE, 'osd/runs-4v.geojson')))['features']
LIFTS = json.load(open(os.path.join(CACHE, 'osd/lifts-4v.geojson')))['features']

def resample(line, step):
    out = [line[0]]
    for i in range(1, len(line)):
        a, b = out[-1], line[i]; seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while seg >= step:
            t = step / seg; a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); out.append(a); seg = math.hypot(b[0] - a[0], b[1] - a[1])
    if math.hypot(out[-1][0] - line[-1][0], out[-1][1] - line[-1][1]) > step * .3: out.append(line[-1])
    return out

CLASS = {'novice': 'blue', 'easy': 'blue', 'intermediate': 'red', 'advanced': 'black', 'expert': 'black', 'freeride': 'itinerary', None: 'blue'}
RANK = {'blue': 1, 'red': 2, 'black': 3, 'itinerary': 4}
GROOM = {'classic': 'groomed', 'classic+skating': 'groomed', 'mogul': 'moguls', 'backcountry': 'ungroomed', None: 'groomed'}
HALF = {'blue': 22, 'red': 18, 'black': 15, 'itinerary': 0, 'park': 70, 'skicross': 9}

pistes = []
park_poly = None
for f in RUNS:
    p = f['properties']; g = f['geometry']
    # pistes: in the 4 Vallees ski area, or untagged inside the box (several real pistes carry no ski-area link)
    if not (in4v(p) or not p.get('skiAreas')) or p.get('status') not in ('operating', None): continue
    if g['type'] == 'Polygon' and 'snow_park' in (p.get('uses') or []):
        park_poly = [wgs_to_lv95(q[1], q[0]) for q in g['coordinates'][0]]; continue
    if g['type'] != 'LineString' or not ({'downhill', 'snow_park'} & set(p.get('uses') or [])): continue
    lv = resample([wgs_to_lv95(q[1], q[0]) for q in g['coordinates']], 5.0)
    if len(lv) < 3 or not all(E0 + 50 < e < E1 - 50 and N0 + 50 < n < N1 - 50 for e, n in lv): continue
    z = sample(M, [q[0] for q in lv], [q[1] for q in lv])
    if z[0] < z[-1] - 3: lv = lv[::-1]; z = z[::-1]                         # orient downhill
    klass = CLASS.get(p.get('difficulty'), 'blue')
    pistes.append(dict(i=len(pistes), name=p.get('name'), ref=p.get('ref'), klass=klass, grooming=GROOM.get(p.get('grooming'), 'groomed'),
                       difficulty=p.get('difficulty'), osm=[s.get('id') for s in p.get('sources', [])], pts=np.array(lv), z=np.array(z)))
print('pistes', len(pistes), flush=True)

TYPE_LABEL = {'gondola': 'Gondola', 'chair_lift': 'Chairlift', 'cable_car': 'Cable car', 'mixed_lift': 'Télémixte (chairs + cabins)', 'platter': 'Platter lift',
              't-bar': 'T-bar', 'drag_lift': 'Drag lift', 'rope_tow': 'Rope tow', 'funicular': 'Funicular'}
SPEED = {'gondola': 5.0, 'chair_lift': 5.0, 'cable_car': 10.0, 'mixed_lift': 5.0, 'platter': 3.0, 't-bar': 3.0, 'drag_lift': 3.0, 'rope_tow': 2.0, 'funicular': 6.0}
GUIDE = json.loads(open(os.path.join(ROOT, 'lib/verbier/registry-data.ts')).read().split('export const LIFTS = ')[1].split(' as const')[0].rstrip().rstrip(';'))
ALIAS = {'chablemayensdebruson': 'chablemayensdebruson', 'chableverbier': 'lechableverbier', 'tortinchassoure': 'chassoure', 'tortincoldesgentianes': 'tortingentianes',
         'tmxsavoleyres': 'piguetgallandtelemixteplanardssavoleyres', 'leschotteslameinagrepponblanc': 'leschottes', 'lesetablons': 'etablons',
         'tzoumaz': 'latzoumazsavoleyres', 'siviez': 'siviezplandufou', 'chauxexpress': 'chauxexpress'}
def guide_match(name):
    k = ALIAS.get(norm(name), norm(name))
    return next((g for g in GUIDE if norm(g['name']) == k), None)

lifts = []
for f in LIFTS:
    p = f['properties']; g = f['geometry']
    if not in4v(p) or p.get('status') != 'operating' or g['type'] != 'LineString': continue
    t = p.get('liftType')
    if t in ('magic_carpet', None): continue
    lv = [wgs_to_lv95(q[1], q[0]) for q in g['coordinates']]
    if not all(E0 < e < E1 and N0 < n < N1 for e, n in lv): continue
    z = sample(M, [q[0] for q in lv], [q[1] for q in lv])
    if z[0] > z[-1]: lv = lv[::-1]; z = z[::-1]                               # bottom -> top
    horiz = sum(math.hypot(lv[i + 1][0] - lv[i][0], lv[i + 1][1] - lv[i][1]) for i in range(len(lv) - 1))
    slope_len = math.hypot(horiz, float(z[-1] - z[0]))
    gm = guide_match(p.get('name'))
    dur = p.get('duration')
    lifts.append(dict(id=f"l{len(lifts):02d}", name=p.get('name') or TYPE_LABEL.get(t, t), type=t, typeLabel=TYPE_LABEL.get(t, t),
                      guide=dict(id=gm['id'], name=gm['name'], type=gm['type'], sector=gm['sector']) if gm else None,
                      capacity=p.get('capacity'), occupancy=p.get('occupancy'), detachable=p.get('detachable'), bubble=p.get('bubble'), heating=p.get('heating'),
                      durationS=dur, durationSource='OpenStreetMap' if dur else 'estimated from length and typical speed',
                      rideS=round(dur if dur else slope_len / SPEED.get(t, 4.0)),
                      length=round(slope_len), vertical=round(float(z[-1] - z[0])),
                      bottomZ=round(float(z[0]), 1), topZ=round(float(z[-1]), 1),
                      points=[[round(e, 1), round(n, 1), round(float(h), 1)] for (e, n), h in zip(lv, z)],
                      osm=[s.get('id') for s in p.get('sources', [])]))
NOTES = {'Les Esserts-Les Planards': 'Télémixte lower section (Les Esserts–Planards): scheduled for December 2026 according to the guide; drawn as mapped in OpenStreetMap.',
         'TMX Savoleyres': 'Télémixte upper section (Planards–Savoleyres): operating since December 2025; replaces the historical Savoleyres gondola.'}
for l in lifts: l['note'] = NOTES.get(l['name'])
print('lifts', len(lifts), flush=True)

# ---- stations: lift ends within 200 m (single linkage) ----------------------------------------------------------------
ends = [(li, end) for li in range(len(lifts)) for end in ('bottom', 'top')]
def endpos(li, end): p = lifts[li]['points'][0 if end == 'bottom' else -1]; return p[0], p[1], p[2]
parent = list(range(len(ends)))
def find(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
for i in range(len(ends)):
    for j in range(i + 1, len(ends)):
        a, b = endpos(*ends[i]), endpos(*ends[j])
        if math.hypot(a[0] - b[0], a[1] - b[1]) < 200 and abs(a[2] - b[2]) < 60: parent[find(i)] = find(j)
groups = {}
for i, e in enumerate(ends): groups.setdefault(find(i), []).append(e)
# Station names used on the resort's own maps, tied to the lift end they belong to (bottom/top by elevation).
KNOWN = {('Châble - Verbier', 'bottom'): 'Le Châble', ('Médran 2', 'bottom'): 'Verbier – Médran', ('Médran 2', 'top'): 'Les Ruinettes',
         ('Funispace', 'top'): 'Les Attelas', ('Mont-Gelé', 'top'): 'Mont-Gelé', ('Chaux 2', 'bottom'): 'La Chaux', ('Mont-Fort', 'bottom'): 'Col des Gentianes',
         ('Mont-Fort', 'top'): 'Mont-Fort', ('Tortin - Col des Gentianes', 'bottom'): 'Tortin', ('Tortin-Chassoure', 'top'): 'Chassoure',
         ('Lac des Vaux 2', 'bottom'): 'Lac des Vaux', ('Tzoumaz', 'top'): 'Savoleyres', ('Tzoumaz', 'bottom'): 'La Tzoumaz',
         ('Les Esserts-Les Planards', 'bottom'): 'Les Esserts', ('Les Esserts-Les Planards', 'top'): 'Les Planards',
         ('Châble - Mayens de Bruson', 'top'): 'Mayens de Bruson', ('Pasay', 'top'): 'La Pasay', ('Siviez', 'bottom'): 'Siviez', ('Siviez', 'top'): 'Plan-du-Fou',
         ('Tracouet', 'bottom'): 'Haute-Nendaz', ('Tracouet', 'top'): 'Tracouet', ('Veysonnaz', 'bottom'): 'Veysonnaz', ('Chaux 2', 'top'): 'Chaux 2 top', ('Mayentzet', 'bottom'): 'Mayentzet', ('Attelas', 'bottom'): 'Les Ruinettes – Attelas chair'}
NAMES_DIR = os.path.join(CACHE, 'names'); os.makedirs(NAMES_DIR, exist_ok=True)
PLACE_KINDS = ['Ort', 'Ortsteil', 'Weiler', 'Haltestelle Bahn', 'Pass', 'Hauptgipfel', 'Gipfel', 'Alpiner Gipfel', 'Huegel', 'Lokalname swisstopo', 'Flurname swisstopo', 'Gebiet']
def swissnames(e, n):
    path = os.path.join(NAMES_DIR, f'{round(e)}_{round(n)}.json')
    if not os.path.exists(path):
        q = urllib.parse.urlencode(dict(geometry=f'{e},{n}', geometryType='esriGeometryPoint', layers='all:ch.swisstopo.swissnames3d', tolerance=40,
                                        mapExtent=f'{e - 5000},{n - 5000},{e + 5000},{n + 5000}', imageDisplay='1000,1000,96', sr=2056, returnGeometry='true'))
        try: data = json.load(urllib.request.urlopen('https://api3.geo.admin.ch/rest/services/api/MapServer/identify?' + q, timeout=60))
        except Exception as ex: data = {'results': [], 'error': str(ex)}
        json.dump(data, open(path, 'w'))
    best = None
    for r in json.load(open(path)).get('results', []):
        a = r['attributes']; pts = r.get('geometry', {}).get('points')
        if not pts or a.get('objektart') not in PLACE_KINDS: continue
        dist = math.hypot(pts[0][0] - e, pts[0][1] - n)
        score = dist + PLACE_KINDS.index(a['objektart']) * 25
        if best is None or score < best[0]: best = (score, a['name'], a['objektart'], round(dist))
    return best
import re
def bav_stop(e, n):
    """Official public-transport stop register (BAV, includes lift stations) nearest to (e, n) within ~250 m."""
    path = os.path.join(NAMES_DIR, f'bav_{round(e)}_{round(n)}.json')
    if not os.path.exists(path):
        q = urllib.parse.urlencode(dict(geometry=f'{e},{n}', geometryType='esriGeometryPoint', layers='all:ch.bav.haltestellen-oev', tolerance=25,
                                        mapExtent=f'{e - 5000},{n - 5000},{e + 5000},{n + 5000}', imageDisplay='1000,1000,96', sr=2056, returnGeometry='true'))
        try: data = json.load(urllib.request.urlopen('https://api3.geo.admin.ch/rest/services/api/MapServer/identify?' + q, timeout=60))
        except Exception as ex: data = {'results': [], 'error': str(ex)}
        json.dump(data, open(path, 'w'))
    best = None
    for r in json.load(open(path)).get('results', []):
        a = r['attributes']; pts = r.get('geometry', {}).get('points')
        if not pts or a.get('verkehrsmittel_de') in ('Bus', 'Zug', None): continue
        d = math.hypot(pts[0][0] - e, pts[0][1] - n)
        if best is None or d < best[0]: best = (d, a['name'], a.get('verkehrsmittel_fr'))
    if not best: return None
    base = re.sub(r'\s*\(.*?\)', '', best[1]).replace(' VS', '').strip()
    return base, best[1], round(best[0]), best[2]
stations = []
for members in groups.values():
    pos = np.array([endpos(*m) for m in members]); e, n = float(pos[:, 0].mean()), float(pos[:, 1].mean())
    name = next((KNOWN[(lifts[li]['name'], end)] for li, end in members if (lifts[li]['name'], end) in KNOWN), None)
    source = 'common station name'
    if not name:
        bs = min((x for x in (bav_stop(*endpos(li, end)[:2]) for li, end in members) if x), key=lambda x: x[2], default=None)
        if bs: name, source = bs[0], f'BAV stop register: {bs[1]} ({bs[3]}, {bs[2]} m)'
    if not name:
        sn = swissnames(e, n)
        if sn: name, source = sn[1], f'swissNAMES3D ({sn[2]}, {sn[3]} m)'
        else: name, source = f"{lifts[members[0][0]]['name']} {members[0][1]}", 'lift end'
    stations.append(dict(id=f's{len(stations):02d}', name=name, nameSource=source, e=round(e, 1), n=round(n, 1), z=round(float(pos[:, 2].mean()), 1),
                         liftsUp=sorted(lifts[li]['id'] for li, end in members if end == 'bottom'),
                         liftsArrive=sorted(lifts[li]['id'] for li, end in members if end == 'top'),
                         ends=[[endpos(li, end)[0], endpos(li, end)[1], end] for li, end in members]))
seen = {}
for s in stations:                                                                  # disambiguate repeated names
    seen[s['name']] = seen.get(s['name'], 0) + 1
for s in stations:
    if seen[s['name']] > 1: s['name'] = f"{s['name']} ({', '.join(sorted({l['name'] for l in lifts if l['id'] in s['liftsUp'] + s['liftsArrive']}))[:40]})"
for l in lifts:
    l['from'] = next(s['id'] for s in stations if l['id'] in s['liftsUp']); l['to'] = next(s['id'] for s in stations if l['id'] in s['liftsArrive'])
print('stations', len(stations), flush=True)

# ---- snow surface: groomed pistes smoothed more than off-piste --------------------------------------------------------------
w_raster = np.zeros((H, W), np.float32)
for pi in pistes:
    half = HALF[pi['klass']]
    if half <= 0: continue
    pts = np.array(resample([tuple(q) for q in pi['pts']], 2.0))
    cols = np.round((pts[:, 0] - E0) / 2).astype(int); rows = np.round((N1 - pts[:, 1]) / 2).astype(int)
    r = int(half / 2)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r: continue
            rr = np.clip(rows + dy, 0, H - 1); cc = np.clip(cols + dx, 0, W - 1); w_raster[rr, cc] = 1
w_raster = np.clip(gauss(w_raster, 3.0) * 1.6, 0, 1)                               # ~12 m soft edge
S = gauss(M, 1.5) * (1 - w_raster) + gauss(M, 4.5) * w_raster                     # snow cover: 3 m / 9 m blur
del w_raster
print('snow surface done', flush=True)

# ---- tiles (1 km, 2 m) near pistes and lifts ----------------------------------------------------------------------------------
near = np.zeros(((H * 2) // 100 + 1, (W * 2) // 100 + 1), bool)                   # 100 m cells
def mark(e, n):
    near[min(near.shape[0] - 1, max(0, int((N1 - n) / 100))), min(near.shape[1] - 1, max(0, int((e - E0) / 100)))] = True
for pi in pistes:
    for e, n in pi['pts']: mark(e, n)
for l in lifts:
    for e, n in resample([(p[0], p[1]) for p in l['points']], 20.0): mark(e, n)
k = 8                                                                                # dilate 800 m
nr = near.copy()
for dy in range(-k, k + 1):
    for dx in range(-k, k + 1):
        if dx * dx + dy * dy <= k * k: nr |= np.roll(np.roll(near, dy, 0), dx, 1)
tile_list = []
for tn in range(N0 // 1000, N1 // 1000):
    for te in range(E0 // 1000, E1 // 1000):
        r0 = (N1 - (tn + 1) * 1000) // 100; c0 = (te * 1000 - E0) // 100
        if nr[r0:r0 + 10, c0:c0 + 10].any(): tile_list.append((te, tn))
print('tiles', len(tile_list), flush=True)

# ---- trees from SWISSIMAGE (zoom 16, ~1.7 m pixels): dark green conifer canopy below 2,350 m ----------------------------------
IMG = os.path.join(CACHE, 'swissimage16'); os.makedirs(IMG, exist_ok=True)
Z = 16
def merc(lat, lon):
    n2 = 2 ** Z; x = (lon + 180) / 360 * n2; lr = np.radians(lat)
    return x, (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n2
def unmerc(x, y):
    n2 = 2 ** Z; lon = x / n2 * 360 - 180; lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * y / n2)))); return lat, lon
def fetch_img(key):
    tx, ty = key; path = os.path.join(IMG, f'{Z}_{tx}_{ty}.jpeg')
    if not os.path.exists(path):
        try: urllib.request.urlretrieve(f'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{Z}/{tx}/{ty}.jpeg', path)
        except Exception: return key, None
    try: return key, path
    except Exception: return key, None
need = set()
for te, tn in tile_list:
    if float(S[(N1 - (tn + 1) * 1000) // 2:(N1 - tn * 1000) // 2, (te * 1000 - E0) // 2:((te + 1) * 1000 - E0) // 2].min()) > 2350: continue
    for de in (0, 500, 1000):
        for dn in (0, 500, 1000):
            lat, lon = lv95_to_wgs(te * 1000 + de, tn * 1000 + dn); x, y = merc(lat, lon); need.add((int(x), int(y)))
with cf.ThreadPoolExecutor(8) as ex: img_paths = dict(ex.map(fetch_img, sorted(need)))
print('imagery tiles', len(img_paths), 'missing', sum(v is None for v in img_paths.values()), flush=True)
trees_by_tile = {}
rng = np.random.default_rng(4141)
for (tx, ty), path in img_paths.items():
    if path is None: continue
    im = np.asarray(Image.open(path).convert('RGB'), dtype=np.int16)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    hit = ((g < 105) & (r < 95) & (g >= r + 4) & (g >= b - 2)).astype(np.float32)
    blk = hit[:255, :255].reshape(85, 3, 85, 3).mean(axis=(1, 3))                  # 3x3 px blocks (~5 m)
    iy, ix = np.nonzero(blk > .55)
    keep = rng.random(len(iy)) < .45
    iy, ix = iy[keep], ix[keep]
    if not len(iy): continue
    px = tx + (ix * 3 + 1.5 + rng.uniform(-1, 1, len(ix))) / 256; py = ty + (iy * 3 + 1.5 + rng.uniform(-1, 1, len(iy))) / 256
    lat, lon = unmerc(px, py)
    e, n = wgs_to_lv95(lat, lon)
    ok = (e > E0) & (e < E1) & (n > N0) & (n < N1)
    e, n = e[ok], n[ok]
    z = sample(M, e, n); ok = z < 2350; e, n = e[ok], n[ok]
    hgt = rng.uniform(9, 21, len(e))
    for a, b2, h in zip(e, n, hgt): trees_by_tile.setdefault((int(a // 1000), int(b2 // 1000)), []).append((a, b2, h))
print('trees', sum(len(v) for v in trees_by_tile.values()), flush=True)

def delta_rows(q):
    d = q.astype(np.int32).copy(); d[:, 1:] = q[:, 1:].astype(np.int32) - q[:, :-1].astype(np.int32)
    return np.clip(d, -32768, 32767).astype('<i2')
tiles_meta = []
for te, tn in tile_list:
    r0 = (N1 - (tn + 1) * 1000) // 2; c0 = (te * 1000 - E0) // 2
    a = S[r0:r0 + 500, c0:c0 + 500]
    base = float(math.floor(a.min()) - 5)
    q = np.round((a - base) * 10).astype(np.int32)                                   # decimetres
    tr = [t for t in trees_by_tile.get((te, tn), []) if te * 1000 <= t[0] < te * 1000 + 1000 and tn * 1000 <= t[1] < tn * 1000 + 1000]
    tq = np.array([[round((t[0] - te * 1000) * 2), round((t[1] - tn * 1000) * 2), round(t[2] * 10)] for t in tr], dtype='<i2').reshape(-1)
    raw = delta_rows(q).tobytes() + struct.pack('<I', len(tr)) + tq.tobytes()
    open(os.path.join(OUT, 'tiles', f'{te}_{tn}.bin'), 'wb').write(zlib.compress(raw, 9))
    tiles_meta.append([te, tn, round(base, 1), len(tr)])

# ---- overview (10 m) and horizon (40 m SRTM) ---------------------------------------------------------------------------------
ov = gauss(S, 2.0)[2::5, 2::5]                                                        # cell centres at 5, 15, ... m
ovbase = float(math.floor(ov.min()) - 5)
oq = np.round((ov - ovbase) * 10).astype(np.int32)
open(os.path.join(OUT, 'overview.bin'), 'wb').write(zlib.compress(delta_rows(oq).tobytes(), 9))
overview = dict(e0=E0 + 5, n1=N1 - 5, cell=10, nx=ov.shape[1], ny=ov.shape[0], base=ovbase, scale=10)
hgt = np.fromfile(os.path.join(CACHE, 'dem/N46E007.hgt'), '>i2').reshape(3601, 3601).astype(np.float32)
hgt[hgt < -1000] = np.nan; hgt = np.where(np.isnan(hgt), np.nanmean(hgt), hgt)
HE0, HE1, HN0, HN1, HC = E0 - 14000, E1 + 14000, 1093000, N1 + 12000, 40
hx = np.arange(HE0, HE1, HC) + HC / 2; hy = np.arange(HN1, HN0, -HC) - HC / 2
HX, HY = np.meshgrid(hx, hy); lat, lon = lv95_to_wgs(HX, HY)
hz = sample(hgt, lon, lat, cell=1 / 3600, e0=7.0, n1=47.0)
hz = np.where(lat < 46.0, np.nan, hz); hz = np.where(np.isnan(hz), np.nanmin(hz), hz)
hq = np.round(hz).astype(np.int32)
hbase = int(hq.min()) - 5
open(os.path.join(OUT, 'horizon.bin'), 'wb').write(zlib.compress(delta_rows(hq - hbase).tobytes(), 9))
horizon = dict(e0=float(hx[0]), n1=float(hy[0]), cell=HC, nx=len(hx), ny=len(hy), base=hbase, scale=1)
print('overview', ov.shape, 'horizon', hz.shape, flush=True)

# ---- piste graph and station-to-station routes ---------------------------------------------------------------------------------
GRID = 50.0
pt_index = {}
for pi in pistes:
    for k2, (e, n) in enumerate(pi['pts']): pt_index.setdefault((int(e // GRID), int(n // GRID)), []).append((pi['i'], k2))
def nearest_on_pistes(e, n, radius, exclude=None):
    best = {}
    for gx in range(int((e - radius) // GRID), int((e + radius) // GRID) + 1):
        for gy in range(int((n - radius) // GRID), int((n + radius) // GRID) + 1):
            for si, k2 in pt_index.get((gx, gy), []):
                if si == exclude: continue
                p = pistes[si]['pts'][k2]; d = math.hypot(p[0] - e, p[1] - n)
                if d < radius and (si not in best or d < best[si][0]): best[si] = (d, k2)
    return best
splits = {pi['i']: {0, len(pi['pts']) - 1} for pi in pistes}
for pi in pistes:                                                                    # junctions: an end touching another piste
    for k2 in (0, len(pi['pts']) - 1):
        for si, (d, kk) in nearest_on_pistes(*pi['pts'][k2], 30, exclude=pi['i']).items(): splits[si].add(kk)
attach = {}                                                                          # station -> {'start': [(piste, idx)], 'end': [...]}
for s in stations:
    st = {'start': set(), 'end': set()}
    for e, n, end in s['ends']:
        for si, (d, kk) in nearest_on_pistes(e, n, 90).items():
            splits[si].add(kk)
            if end == 'top': st['start'].add((si, kk))
            else: st['end'].add((si, kk))
    attach[s['id']] = st
node_of, node_pos = {}, []
def node_at(si, kk):
    key = (si, kk)
    if key in node_of: return node_of[key]
    e, n = pistes[si]['pts'][kk]
    for ni, (pe, pn) in enumerate(node_pos):
        if math.hypot(pe - e, pn - n) < 30: node_of[key] = ni; return ni
    node_pos.append((e, n)); node_of[key] = len(node_pos) - 1; return node_of[key]
edges = {}
for pi in pistes:
    idx = sorted(splits[pi['i']])
    for a, b in zip(idx, idx[1:]):
        z = pi['z'][a:b + 1]; climb = float(np.maximum(0, np.diff(z)).sum())
        if climb > 30: continue
        u, v = node_at(pi['i'], a), node_at(pi['i'], b)
        if u == v: continue
        edges.setdefault(u, []).append(dict(v=v, piste=pi['i'], a=a, b=b, cost=(b - a) * 5.0, rank=RANK[pi['klass']]))
start_nodes = {sid: {node_at(si, kk) for si, kk in st['start']} for sid, st in attach.items()}
end_nodes = {sid: {node_at(si, kk) for si, kk in st['end']} for sid, st in attach.items() if any(l['from'] == sid for l in lifts)}
routes = []
route_keys = set()
for s in stations:
    if not start_nodes[s['id']]: continue
    for level in (1, 2, 3, 4):
        dist = {u: 0.0 for u in start_nodes[s['id']]}; prev = {}; pq = [(0.0, u) for u in start_nodes[s['id']]]
        found = {}
        while pq:
            d0, u = heapq.heappop(pq)
            if d0 > dist.get(u, 1e18) or d0 > 9000: continue
            for sid, ns in end_nodes.items():
                if sid != s['id'] and u in ns and sid not in found and d0 > 100: found[sid] = u
            for ed in edges.get(u, []):
                if ed['rank'] > level: continue
                nd = d0 + ed['cost']
                if nd < dist.get(ed['v'], 1e18): dist[ed['v']] = nd; prev[ed['v']] = (u, ed); heapq.heappush(pq, (nd, ed['v']))
        for sid, u in found.items():
            path = []
            while u in prev: pu, ed = prev[u]; path.append(ed); u = pu
            path.reverse()
            if not path: continue
            key = (s['id'], sid, tuple((ed['piste'], ed['a'], ed['b']) for ed in path))
            if key in route_keys: continue
            route_keys.add(key)
            routes.append(dict(fromS=s['id'], toS=sid, path=path, rank=max(ed['rank'] for ed in path)))
print('routes', len(routes), flush=True)

# ---- course frames -------------------------------------------------------------------------------------------------------------
def make_course(line):
    line = resample(line, 2.0)
    E = np.array([p[0] for p in line]); N = np.array([p[1] for p in line])
    a0 = math.atan2(N[-1] - N[0], E[-1] - E[0])
    def frame_for(a):
        ue, un = math.cos(a), math.sin(a); dp = (E - E[0]) * ue + (N - N[0]) * un
        return float(max(0.0, max(np.maximum.accumulate(dp) - dp))) + .02 * abs(a - a0) * 180 / math.pi + (0 if dp[-1] > 0 else 1e9), ue, un
    _, ue, un = min((frame_for(a0 + math.radians(k)) for k in range(-80, 81)), key=lambda c: c[0])
    re, rn = un, -ue
    dproj = (E - E[0]) * ue + (N - N[0]) * un; xproj = (E - E[0]) * re + (N - N[0]) * rn
    backtrack = float(max(0.0, max(np.maximum.accumulate(dproj) - dproj)))
    curvilinear = backtrack > 25
    path = None
    sarc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(E), np.diff(N)))])
    if curvilinear:
        ue, un = E[-1] - E[0], N[-1] - N[0]; Ls = math.hypot(ue, un); ue /= Ls; un /= Ls
        te = np.gradient(E); tn = np.gradient(N)
        kk = np.ones(21) / 21; te = np.convolve(np.pad(te, 10, mode='edge'), kk, 'valid'); tn = np.convolve(np.pad(tn, 10, mode='edge'), kk, 'valid')
        tl = np.hypot(te, tn); te /= tl; tn /= tl
        dproj = sarc; xproj = np.zeros_like(sarc)
        path = dict(step=2.0, e=[round(float(v - E[0]), 1) for v in E], n=[round(float(v - N[0]), 1) for v in N],
                    te=[round(float(v), 4) for v in te], tn=[round(float(v), 4) for v in tn], s=[round(float(v), 1) for v in sarc])
    ds = np.arange(0, math.floor(float(np.max(dproj))) + 1, 1.0)
    order = np.maximum.accumulate(dproj)
    cx = np.interp(ds, order + np.arange(len(order)) * 1e-6, xproj)
    kk = np.ones(7) / 7; cx = np.convolve(np.pad(cx, 3, mode='edge'), kk, 'valid')
    hs = sample(S, E, N)
    return dict(E=E, N=N, sarc=sarc, dproj=dproj, cx=cx, length=float(ds[-1]), backtrack=backtrack, curvilinear=curvilinear,
                frame=dict(mode='curvilinear' if curvilinear else 'rotated', e0=float(E[0]), n0=float(N[0]), ue=ue, un=un), path=path, hs=hs)

def zones_for(course, pieces):
    """pieces: [(piste index, arclength from, arclength to)] along the course line."""
    out = []
    for si, s0, s1 in pieces:
        pi = pistes[si] if si is not None else None
        d0 = float(np.interp(s0, course['sarc'], course['dproj'])); d1 = float(np.interp(s1, course['sarc'], course['dproj']))
        out.append(dict(d0=round(min(d0, d1), 1), d1=round(max(d0, d1), 1), name=pi['name'] if pi else None, grooming=pi['grooming'] if pi else 'groomed',
                        difficulty=pi['difficulty'] if pi else None, osm=pi['osm'] if pi else []))
    return out

route_files, summaries, report = [], [], []
def emit(rid, name, desc, klass, line, pieces, fromS, toS, featured=False, park=None):
    c = make_course(line)
    if c['length'] < 120: return None
    hs = c['hs']
    climb = float(np.maximum(0, np.diff(hs[::5])).sum())
    half = HALF[klass]
    zones = zones_for(c, pieces)
    doc = dict(id=rid, name=name, description=desc, klass=klass, length=round(c['length'], 1), halfWidth=half,
               startElevation=round(float(hs[0]), 1), endElevation=round(float(hs[-1]), 1), backtrack=round(c['backtrack'], 1),
               frame=c['frame'], path=c['path'], centre=[round(float(v), 2) for v in c['cx']], zones=zones, park=park,
               fromStation=fromS, toStation=toS, featured=featured,
               sources=['swissALTI3D 2 m 2024 (c) swisstopo', 'SWISSIMAGE (c) swisstopo (tree positions)', 'OpenSkiData / OpenStreetMap contributors, ODbL (run and lift lines)'])
    json.dump(doc, open(os.path.join(OUT, 'routes', f'{rid}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    simple = resample([(float(e), float(n)) for e, n in zip(c['E'], c['N'])], 20.0)
    summ = dict(id=rid, name=name, description=desc, klass=klass, length=round(c['length']), drop=round(float(hs[0] - hs[-1])),
                startElevation=round(float(hs[0]), 1), endElevation=round(float(hs[-1]), 1), fromStation=fromS, toStation=toS, featured=featured,
                pistes=sorted({pistes[p[0]]['i'] for p in pieces if p[0] is not None}), climb=round(climb),
                line=[[round(e), round(n)] for e, n in simple])
    summaries.append(summ)
    report.append(dict(id=rid, name=name, length=round(c['length']), drop=round(float(hs[0] - hs[-1])), climb=round(climb), mode=c['frame']['mode'], from_=fromS, to=toS))
    return summ

st_name = {s['id']: s['name'] for s in stations}
for ri, r in enumerate(routes):
    line, pieces, s = [], [], 0.0
    for ed in r['path']:
        seg = [tuple(p) for p in pistes[ed['piste']]['pts'][ed['a']:ed['b'] + 1]]
        if line and math.hypot(seg[0][0] - line[-1][0], seg[0][1] - line[-1][1]) < 1: seg = seg[1:]
        if not seg: continue
        L = sum(math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1]) for i in range(len(seg) - 1)) + (math.hypot(seg[0][0] - line[-1][0], seg[0][1] - line[-1][1]) if line else 0)
        pieces.append((ed['piste'], s, s + L)); s += L; line += seg
    if len(line) < 3: continue
    names = []
    for ed in r['path']:
        nm = pistes[ed['piste']]['name']
        if nm and nm not in names: names.append(nm)
    klass = {1: 'blue', 2: 'red', 3: 'black', 4: 'itinerary'}[r['rank']]
    title = f"{st_name[r['fromS']]} → {st_name[r['toS']]}"
    desc = ('via ' + ', '.join(names[:3])) if names else 'unnamed mapped pistes'
    emit(f'r{ri:03d}', title.upper(), desc, klass, line, pieces, r['fromS'], r['toS'])

# featured runs (menu): named OpenStreetMap runs chained, the snow park on its polygon axis
def nearest_station(e, n, end, radius):
    best = None
    for s in stations:
        for se, sn, kind in s['ends']:
            if kind != end: continue
            d = math.hypot(se - e, sn - n)
            if d < radius and (best is None or d < best[0]): best = (d, s['id'])
    return best[1] if best else None
def chain(names):
    want = {norm(x) for x in names}
    segs = [p for p in pistes if norm(p['name']) in want]
    start = max(segs, key=lambda p: p['z'][0]); used = {start['i']}; line = [tuple(q) for q in start['pts']]; pieces = [(start['i'], 0.0, (len(start['pts']) - 1) * 5.0)]
    while True:
        end = line[-1]; best = None
        for p in segs:
            if p['i'] in used: continue
            dd = math.hypot(p['pts'][0][0] - end[0], p['pts'][0][1] - end[1])
            if dd < 40 and p['z'][-1] < float(sample(S, [end[0]], [end[1]])[0]) + 5 and (best is None or dd < best[0]): best = (dd, p)
        if not best: break
        p = best[1]; used.add(p['i']); s0 = pieces[-1][2]; pieces.append((p['i'], s0, s0 + (len(p['pts']) - 1) * 5.0)); line += [tuple(q) for q in p['pts'][1:]]
    return line, pieces
FEATURED = [
    ('attelas', 'ATTELAS', ['Attelas'], 'Red piste from Les Attelas toward Ruinettes / Mayentzet.', None),
    ('hattey-clambin', 'HATTEY → CLAMBIN', ['Hattey', 'Piste de Clambin, Hattey', 'Piste de Clambin, Clambin', 'Clambin'], 'Hattey red into the Clambin forest itinerary, down to the Médran side of Verbier.', 'red'),
    ('la-chaux-park', 'LA CHAUX SNOWPARK', None, 'Verbier Snowpark in its mapped footprint: S, M and L lines side by side.', 'park'),
    ('la-chaux-skicross', 'LA CHAUX SKI CROSS', ['Ski Cross'], 'The mapped ski-cross line: start gate, banked turns, whoops and jumps.', 'skicross'),
    ('mont-fort', 'MONT-FORT', ['Mont-Fort'], 'Black from the 3,330 m summit station; mogul section near the top.', None),
    ('chassoure-tortin', 'CHASSOURE → TORTIN', ['Chassoure-Tortin', 'Chassoure - Tortin', 'Châssoure - Tortin'], 'Yellow itinerary: ungroomed, north-facing, moguls and powder.', None),
    ('fis', 'FIS', ['FIS'], 'Black: the FIS piste from Les Ruinettes toward Verbier.', None),
    ('mont-gele-chaux', 'MONT-GELÉ → LA CHAUX', ['Mt-Gelé - La Chaux'], 'Itinerary off the Mont-Gelé cable car: open, ungroomed south face.', None),
]
meta = []
for rid, name, names, desc, force in FEATURED:
    park = None
    if rid == 'la-chaux-park':
        pts = np.array(park_poly[:-1]); c = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - c); ax = vt[0]
        if sample(S, [c[0] + ax[0] * 100], [c[1] + ax[1] * 100])[0] > sample(S, [c[0] - ax[0] * 100], [c[1] - ax[1] * 100])[0]: ax = -ax
        half = max(abs((pts - c) @ ax)) + 70
        line = [(c[0] - ax[0] * half, c[1] - ax[1] * half), (c[0] + ax[0] * half, c[1] + ax[1] * half)]
        pieces = [(None, 0.0, 2 * half)]; park = dict(world=[[round(float(p[0]), 1), round(float(p[1]), 1)] for p in pts])
    else:
        line, pieces = chain(names)
    klass = force or pistes[pieces[0][0]]['klass']
    fromS = nearest_station(line[0][0], line[0][1], 'top', 450); toS = nearest_station(line[-1][0], line[-1][1], 'bottom', 450)
    summ = emit(rid, name, desc, klass, line, pieces, fromS, toS, featured=True, park=park)
    meta.append({k: summ[k] for k in ('id', 'name', 'description', 'klass', 'length', 'startElevation', 'endElevation', 'fromStation', 'toStation')})

# ---- write ---------------------------------------------------------------------------------------------------------------------
for s in stations:
    s['routesFrom'] = [r['id'] for r in summaries if r['fromStation'] == s['id']]
    s['routesTo'] = [r['id'] for r in summaries if r['toStation'] == s['id']]
    s.pop('ends')
map_pistes = [dict(i=p['i'], name=p['name'], ref=p['ref'], klass=p['klass'], grooming=p['grooming'],
                   line=[[round(float(e)), round(float(n))] for e, n in resample([tuple(q) for q in p['pts']], 15.0)]) for p in pistes]
resort = dict(version=1, built='2026-11-15', crs='EPSG:2056 (LV95)',
              box=dict(e0=E0, n0=N0, e1=E1, n1=N1), tileSize=1000, tileCell=2, tiles=tiles_meta, overview=overview, horizon=horizon,
              stations=stations, lifts=lifts, pistes=map_pistes, routes=summaries,
              park=dict(world=[[round(e, 1), round(n, 1)] for e, n in park_poly]) if park_poly else None,
              sources=['swissALTI3D 2 m 2024 (c) swisstopo', 'SWISSIMAGE (c) swisstopo (tree positions)', 'swissNAMES3D (c) swisstopo (station names where not commonly named)',
                       'OpenSkiData / OpenStreetMap contributors, ODbL (piste and lift lines, lift data)', 'SRTM 1" NASA/USGS (horizon outside the survey box)',
                       'Verbier 4 Vallees game development guide 2026 (lift registry)'])
json.dump(resort, open(os.path.join(OUT, 'resort.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(ROOT, 'lib/verbier/runs-meta.ts'), 'w') as f:
    f.write('// GENERATED by tools/verbier/build_resort.py. Featured runs for the menu; geometry is in public/resort/.\n')
    f.write('export const RUNS_META = ' + json.dumps(meta, ensure_ascii=False) + ' as const;\n')
json.dump(dict(stations=[(s['id'], s['name'], s['nameSource'], s['z'], len(s['liftsUp']), len(s['routesFrom'])) for s in stations],
               lifts=[(l['id'], l['name'], l['type'], l['vertical'], l['length'], l['guide']['name'] if l['guide'] else None) for l in lifts],
               routes=report, tiles=len(tiles_meta)), open(os.path.join(ROOT, 'docs/verbier/build-report.json'), 'w'), indent=1, ensure_ascii=False)
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print(f'stations {len(stations)} lifts {len(lifts)} routes {len(summaries)} tiles {len(tiles_meta)} total {total / 1e6:.1f} MB')
