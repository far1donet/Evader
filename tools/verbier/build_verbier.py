"""Build the Verbier terrain data for EVADER from the SRTM 1-arc-second DEM tile N46E007.

Input : N46E007.hgt (SRTM GL1, void-filled, from the AWS Terrain Tiles open dataset; NASA/USGS, public domain).
Output: lib/verbier/dem-data.ts      cropped DEM (Int16 metres, base64) + metadata
        lib/verbier/routes-data.ts   DEM-snapped anchors and DEM-generated run lines (local metres)
        docs/verbier/terrain-report.json   validation numbers (anchor errors, route statistics)

Accuracy rules (from the Verbier 4 Vallees guide): anchor coordinates are approximate positions snapped to the DEM so that
their elevation matches the published value; run lines are generated on the real slopes between anchors and are NOT the
surveyed piste centre-lines. Both are labelled as such in the output.
Run: python3 tools/verbier/build_verbier.py <path to N46E007.hgt>
"""
import base64, json, math, struct, sys, os

HGT = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
raw = open(HGT, 'rb').read()
N = int(math.isqrt(len(raw) // 2))           # 3601
STEP = 1.0 / (N - 1)                          # degrees per sample
# Crop: Le Chable / Verbier / Mont Fort / Tortin / La Tzoumaz
LON0, LON1, LAT0, LAT1 = 7.19, 7.35, 46.06, 46.15
c0, c1 = round((LON0 - 7) / STEP), round((LON1 - 7) / STEP)
r0, r1 = round((47 - LAT1) / STEP), round((47 - LAT0) / STEP)   # row 0 = north
W, H = c1 - c0 + 1, r1 - r0 + 1
grid = [[struct.unpack_from('>h', raw, 2 * (r * N + c))[0] for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)]
lonW, latN = 7 + c0 * STEP, 47 - r0 * STEP
LATC = (LAT0 + LAT1) / 2
MX = math.cos(math.radians(LATC)) * 111320.0    # metres per degree east
MY = 110574.0                                     # metres per degree north
# Local frame: origin at the crop's south-west corner. E east, Nn north (metres).
def to_local(lat, lon): return ((lon - lonW) * MX, (lat - (latN - (H - 1) * STEP)) * MY)
def to_latlon(e, n): return ((latN - (H - 1) * STEP) + n / MY, lonW + e / MX)
DX, DY = STEP * MX, STEP * MY
def h_at(e, n):
    """Bilinear DEM height at local metres."""
    fx = e / DX; fy = (H - 1) - n / DY
    fx = min(max(fx, 0), W - 1.001); fy = min(max(fy, 0), H - 1.001)
    x, y = int(fx), int(fy); tx, ty = fx - x, fy - y
    a, b, c, d = grid[y][x], grid[y][x + 1], grid[y + 1][x], grid[y + 1][x + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
def grad(e, n, s=15.0): return ((h_at(e + s, n) - h_at(e - s, n)) / (2 * s), (h_at(e, n + s) - h_at(e, n - s)) / (2 * s))

# ---- anchors: approximate positions (general knowledge), snapped to the DEM --------------------------------------------
ANCHORS = [  # id, name, published elevation (guide), kind, approximate lat, lon
    ('mont-fort', 'Mont Fort', 3330, 'peak', 46.0836, 7.3094),
    ('bec-des-rosses', 'Bec des Rosses', 3223, 'peak', 46.0890, 7.2950),
    ('mont-gele', 'Mont Gelé', 3023, 'peak', 46.1006, 7.2853),
    ('col-des-gentianes', 'Col des Gentianes lift area', 2950, 'station', 46.0889, 7.3047),
    ('col-de-chassoure', 'Col de Chassoure', 2743, 'station', 46.1094, 7.2920),
    ('les-attelas', 'Les Attelas', 2734, 'station', 46.0978, 7.2700),
    ('lac-des-vaux', 'Lac des Vaux', 2550, 'station', 46.1086, 7.2717),
    ('fontanet', 'Fontanet', 2484, 'station', 46.1047, 7.2600),
    ('savoleyres', 'Savoleyres', 2344, 'station', 46.1197, 7.2069),
    ('la-chaux', 'La Chaux', 2260, 'station', 46.0850, 7.2672),
    ('les-ruinettes', 'Les Ruinettes', 2200, 'station', 46.0908, 7.2481),
    ('tortin', 'Tortin', 2045, 'station', 46.1203, 7.3247),
    ('siviez', 'Siviez', 1730, 'station', 46.1306, 7.3311),
    ('medran', 'Médran', 1530, 'station', 46.0997, 7.2286),
    ('verbier', 'Verbier', 1500, 'village', 46.0964, 7.2281),
    ('la-tzoumaz', 'La Tzoumaz', 1500, 'village', 46.1447, 7.2378),
    ('le-chable', 'Le Châble', 821, 'village', 46.0800, 7.2100),
]
anchors = {}
for aid, name, pub, kind, lat, lon in ANCHORS:
    e0, n0 = to_local(lat, lon)
    radius = {'bec-des-rosses': 2000, 'col-de-chassoure': 1800, 'siviez': 1800}.get(aid, 1200 if kind == 'peak' else 700)
    best, bestScore = None, 1e18
    for dn in range(-radius, radius + 1, 15):
        for de in range(-radius, radius + 1, 15):
            if de * de + dn * dn > radius * radius: continue
            e, n = e0 + de, n0 + dn
            h = h_at(e, n)
            dist = math.hypot(de, dn)
            score = -h + .02 * dist if kind == 'peak' and aid != 'bec-des-rosses' else abs(h - pub) + .04 * dist
            if score < bestScore: bestScore, best = score, (e, n, h, dist)
    e, n, h, dist = best
    la, lo = to_latlon(e, n)
    anchors[aid] = dict(id=aid, name=name, kind=kind, publishedElevation=pub, demElevation=round(h, 1),
                        error=round(h - pub, 1), e=round(e, 1), n=round(n, 1), lat=round(la, 5), lon=round(lo, 5),
                        snapDistance=round(dist),
                        # A 1-arc-second DEM smooths sharp summits by tens of metres; stations and areas should match closely.
                        resolved=abs(h - pub) <= (60 if kind == 'peak' else 25),
                        # Matching an elevation far from the expected spot proves little: many points share a contour.
                        confidence=('high' if dist <= 500 else 'low') if abs(h - pub) <= (60 if kind == 'peak' else 25) else 'none',
                        status=('approximate position snapped to the DEM' if abs(h - pub) <= (60 if kind == 'peak' else 25)
                                else 'UNRESOLVED: no point near the approximate position matches the published elevation; position not trusted'))

# ---- routes: generated on the real slope between anchors ---------------------------------------------------------------
def descend(start, target, via=(), pull=1.0, fall=.9):
    """Walk downhill from start toward target (through optional via points), 5 m steps, mixing the direction to the
    current goal with the fall line. Then smooth and resample. Returns list of (e, n)."""
    goals = list(via) + [target]
    e, n = start; pts = [(e, n)]
    for g in goals:
        for _ in range(4000):
            te, tn = g[0] - e, g[1] - n; dist = math.hypot(te, tn)
            if dist < 25: break
            gx, gy = grad(e, n); gl = math.hypot(gx, gy)
            de, dn = te / dist * pull, tn / dist * pull
            if gl > 1e-6: de -= gx / gl * fall * min(1, gl / .3); dn -= gy / gl * fall * min(1, gl / .3)
            l = math.hypot(de, dn); e += de / l * 5; n += dn / l * 5; pts.append((e, n))
        pts.append(g); e, n = g
    for _ in range(6):   # smooth (moving average, 11 samples) keeping the ends
        sm = [pts[0]]
        for i in range(1, len(pts) - 1):
            a, b = max(0, i - 5), min(len(pts), i + 6)
            sm.append((sum(p[0] for p in pts[a:b]) / (b - a), sum(p[1] for p in pts[a:b]) / (b - a)))
        sm.append(pts[-1]); pts = sm
    out = [pts[0]]; acc = 0.0   # resample every 5 m
    for i in range(1, len(pts)):
        a, b = out[-1], pts[i]; seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while seg >= 5:
            t = 5 / seg; a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); out.append(a); seg = math.hypot(b[0] - a[0], b[1] - a[1])
    return out
import heapq
def cell_of(e, n): return (min(max(round(e / DX), 0), W - 1), min(max(round((H - 1) - n / DY), 0), H - 1))
def cell_en(cx, cy): return (cx * DX, ((H - 1) - cy) * DY)
def least_cost(start, target):
    """Dijkstra on the DEM grid (8-connected). Cost: distance, x90 per unit of climb, a strong penalty above 40 deg (cliffs,
    couloirs a run would not cross) and a small one below 5 deg (flat traverses), so the line follows rideable fall-line terrain."""
    s0, t0 = cell_of(*start), cell_of(*target)
    dist = {s0: 0.0}; prev = {}; pq = [(0.0, s0)]
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    while pq:
        d, c = heapq.heappop(pq)
        if c == t0: break
        if d > dist.get(c, 1e18): continue
        cx, cy = c; h0 = grid[cy][cx]
        for ox, oy in nb:
            nx, ny = cx + ox, cy + oy
            if not (0 <= nx < W and 0 <= ny < H): continue
            L = math.hypot(ox * DX, oy * DY); dh = grid[ny][nx] - h0
            slope = math.degrees(math.atan(abs(dh) / L))
            cost = L * (1 + 90 * max(0.0, dh) / L)
            if slope > 40: cost += L * ((slope - 40) / 4) ** 2 * 6
            if slope < 5 and dh <= 0: cost += L * .35
            nd = d + cost
            if nd < dist.get((nx, ny), 1e18): dist[(nx, ny)] = nd; prev[(nx, ny)] = c; heapq.heappush(pq, (nd, (nx, ny)))
    path, c = [], t0
    while c != s0: path.append(cell_en(*c)); c = prev[c]
    path.append(cell_en(*s0)); path.reverse()
    path[0], path[-1] = start, target
    return path
def smooth_resample(pts, passes=3, half=2):
    for _ in range(passes):
        sm = [pts[0]]
        for i in range(1, len(pts) - 1):
            a, b = max(0, i - half), min(len(pts), i + half + 1)
            sm.append((sum(p[0] for p in pts[a:b]) / (b - a), sum(p[1] for p in pts[a:b]) / (b - a)))
        sm.append(pts[-1]); pts = sm
    out = [pts[0]]
    for i in range(1, len(pts)):
        a, b = out[-1], pts[i]; seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while seg >= 5:
            t = 5 / seg; a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); out.append(a); seg = math.hypot(b[0] - a[0], b[1] - a[1])
    return out
A = lambda k: (anchors[k]['e'], anchors[k]['n'])
def ll(lat, lon): return to_local(lat, lon)
ROUTES = [
    # id, name, class, from, to, via (approximate), notes
    ('attelas-ruinettes', 'ATTELAS → RUINETTES', 'red', 'les-attelas', 'les-ruinettes', [], 'Attelas red, alpine descent toward Mayentzet / Ruinettes.'),
    ('ruinettes-medran', 'RUINETTES → MÉDRAN', 'red', 'les-ruinettes', 'medran', [], 'Hattey / Clambin side: forest and hamlet into Verbier.'),
    ('la-chaux-park', 'LA CHAUX SNOWPARK', 'park', 'la-chaux', None, [], 'Snowpark around 2,250 m at La Chaux. Feature placement is not published; layout here is a game design.'),
    ('mont-fort', 'MONT FORT → GENTIANES', 'black', 'mont-fort', 'col-des-gentianes', [], 'First ~250 m reported near 35 deg with major moguls, then broader terrain.'),
    ('chassoure-tortin', 'CHASSOURE → TORTIN', 'itinerary', 'col-de-chassoure', 'tortin', [], 'North-facing ungroomed steep moguls / powder. Published 4,300 m, 950 m vertical, max 33 deg.'),
]
routes = []
for rid, name, klass, a, b, via, notes in ROUTES:
    start = A(a)
    if b is None:   # park: the straight 700 m heading from La Chaux whose slope suits a park (about 13 deg, never uphill)
        best = None
        for hd in range(0, 360, 3):
            ue, un = math.sin(math.radians(hd)), math.cos(math.radians(hd))
            hs_ = [h_at(start[0] + ue * k * 5, start[1] + un * k * 5) for k in range(141)]
            seg = [math.degrees(math.atan((hs_[k] - hs_[k + 4]) / 20)) for k in range(0, 137)]
            if min(seg) < 2 or max(seg) > 24: continue
            mean = math.degrees(math.atan((hs_[0] - hs_[-1]) / 700))
            score = (mean - 13) ** 2 + .05 * sum((x - mean) ** 2 for x in seg) / len(seg)
            if best is None or score < best[0]: best = (score, hd)
        hd = best[1] if best else 0
        path = smooth_resample([(start[0] + math.sin(math.radians(hd)) * k * 5, start[1] + math.cos(math.radians(hd)) * k * 5) for k in range(141)], 0)
    else:
        path = smooth_resample(least_cost(start, A(b)))
    hs = [h_at(e, n) for e, n in path]
    if b is not None:
        # End where the line first reaches the destination's published elevation: past that, the generated line wanders
        # across the basin toward the snapped point and would climb (not rideable).
        goal = anchors[b]['publishedElevation'] + 5
        cut = next((i for i, h in enumerate(hs) if h <= goal), len(hs) - 1)
        path, hs = path[:cut + 1], hs[:cut + 1]
    length = 5 * (len(path) - 1)
    slopes = [math.degrees(math.atan((hs[i] - hs[i + 4]) / 20)) for i in range(len(hs) - 4)]
    if (a and not anchors[a]['resolved']) or (b and not anchors[b]['resolved']): notes += ' Start or end anchor UNRESOLVED.'
    elif (a and anchors[a]['confidence'] == 'low') or (b and anchors[b]['confidence'] == 'low'): notes += ' Start or end anchor position is LOW CONFIDENCE.'
    ups = [(i * 5, round(hs[i + 1] - hs[i], 1)) for i in range(len(hs) - 1) if hs[i + 1] - hs[i] > .5]
    climb = sum(max(0, hs[i + 1] - hs[i]) for i in range(len(hs) - 1))
    routes.append(dict(id=rid, name=name, klass=klass, start=a, end=b, notes=notes, length=length,
                       startElevation=round(hs[0], 1), endElevation=round(hs[-1], 1), vertical=round(hs[0] - hs[-1], 1),
                       maxSlope=round(max(slopes), 1), meanSlope=round(math.degrees(math.atan((hs[0] - hs[-1]) / max(1, length))), 1),
                       uphill=round(climb, 1), longestClimb=round(max([0] + [hs[j] - min(hs[:j + 1]) for j in range(len(hs))]), 1), status='generated on the DEM between approximate anchors; not the surveyed piste centre-line',
                       path=[[round(p[0], 1), round(p[1], 1)] for p in path]))

# ---- write outputs ------------------------------------------------------------------------------------------------------
flat = struct.pack('<%dh' % (W * H), *[v for row in grid for v in row])
meta = dict(source='SRTM GL1 1-arc-second (NASA/USGS, public domain) via AWS Terrain Tiles (skadi N46E007), void-filled',
            width=W, height=H, lonWest=lonW, latNorth=latN, stepDeg=STEP, metresPerDegEast=MX, metresPerDegNorth=MY,
            dx=DX, dy=DY, originLat=latN - (H - 1) * STEP, originLon=lonW, minElevation=min(min(r) for r in grid),
            maxElevation=max(max(r) for r in grid))
os.makedirs(os.path.join(ROOT, 'lib/verbier'), exist_ok=True)
with open(os.path.join(ROOT, 'lib/verbier/dem-data.ts'), 'w') as f:
    f.write('// GENERATED by tools/verbier/build_verbier.py. Do not edit by hand.\n')
    f.write('// Rows run north to south; columns west to east; values are metres above sea level (Int16, little-endian).\n')
    f.write('export const DEM_META = ' + json.dumps(meta) + ' as const;\n')
    f.write('export const DEM_BASE64 = "' + base64.b64encode(flat).decode() + '";\n')
with open(os.path.join(ROOT, 'lib/verbier/routes-data.ts'), 'w') as f:
    f.write('// GENERATED by tools/verbier/build_verbier.py. Do not edit by hand.\n')
    f.write('// Local metres: e = east, n = north from the DEM crop origin. Anchor positions are approximate (snapped to the DEM);\n')
    f.write('// run lines are generated on the DEM and are not surveyed piste centre-lines.\n')
    f.write('export const ANCHORS = ' + json.dumps(list(anchors.values())) + ' as const;\n')
    f.write('export const ROUTES = ' + json.dumps(routes) + ';\n')
os.makedirs(os.path.join(ROOT, 'docs/verbier'), exist_ok=True)
json.dump(dict(dem={k: v for k, v in meta.items()}, anchors=list(anchors.values()),
               routes=[{k: v for k, v in r.items() if k != 'path'} for r in routes]),
          open(os.path.join(ROOT, 'docs/verbier/terrain-report.json'), 'w'), indent=1, ensure_ascii=False)
print('DEM %dx%d, %.1f x %.1f m cells, %d..%d m' % (W, H, DX, DY, meta['minElevation'], meta['maxElevation']))
for a in anchors.values(): print('%-28s pub %5d  dem %7.1f  err %+6.1f  moved %4d m' % (a['name'], a['publishedElevation'], a['demElevation'], a['error'], a['snapDistance']))
for r in routes: print('%-24s %5d m  %6.1f -> %6.1f  vert %6.1f  max %4.1f deg  mean %4.1f deg  uphill %5.1f  biggest rise %5.1f' % (r['name'], r['length'], r['startElevation'], r['endElevation'], r['vertical'], r['maxSlope'], r['meanSlope'], r['uphill'], r['longestClimb']))
