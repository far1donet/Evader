"""Buildings for the resort, from swisstopo VECTOR25 footprints (ch.swisstopo.vec25-gebaeude, generalised for 1:25,000)
and the federal register of buildings and dwellings (GWR, ch.bfs.gebaeude_wohnungs_register: floors and use), both
fetched by fetch_extras.py.

Each footprint becomes its minimum-area rectangle (VECTOR25 footprints are mostly rectangles already), scaled so the area
matches. Floors come from the GWR entries inside the footprint (the highest); without one, a typical value for its size.
Footprints within 35 m of a lift end are left out: the lift scenery draws its own station there.

Output: public/resort/buildings.json = {e0, n0, source, fields, b: flat list of
  [east dm, north dm, length dm, width dm, angle deg x10, floors, kind, gwr flag]}
kind: 0 house / chalet, 1 apartment block or hotel, 2 large non-residential, 3 hut / barn / garage, 4 church,
5 transport building. gwr flag: 1 when the floors come from the register.
Run: python3 tools/verbier/build_buildings.py <cache dir>
"""
import glob, json, math, os, sys
CACHE = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
resort = json.load(open(os.path.join(ROOT, 'public/resort/resort.json')))
E0, N0 = resort['box']['e0'], resort['box']['n0']
ends = [p for l in resort['lifts'] for p in (l['points'][0], l['points'][-1])]

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def min_rect(pts):
    h = hull(pts); best = None
    for i in range(len(h)):
        a, b = h[i], h[(i + 1) % len(h)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0]); c, s = math.cos(ang), math.sin(ang)
        us = [p[0] * c + p[1] * s for p in h]; vs = [-p[0] * s + p[1] * c for p in h]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            uc, vc = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (area, uc * c - vc * s, uc * s + vc * c, max(us) - min(us), max(vs) - min(vs), ang)
    return best

def inside(poly, e, n):
    k = False
    for (ae, an), (be, bn) in zip(poly, poly[1:] + poly[:1]):
        if (an > n) != (bn > n) and e < ae + (n - an) * (be - ae) / (bn - an): k = not k
    return k

KIND = {1110: 0, 1121: 0, 1122: 1, 1130: 1, 1211: 1, 1212: 1, 1220: 2, 1230: 2, 1231: 2, 1241: 5, 1242: 3, 1251: 2, 1252: 3,
        1261: 2, 1262: 2, 1263: 2, 1264: 2, 1265: 2, 1271: 3, 1272: 4, 1273: 3, 1274: 3, 1275: 3, 1276: 3, 1277: 3, 1278: 3}
out, seen, nreg = [], set(), 0
for f in sorted(glob.glob(os.path.join(CACHE, 'extras', 'buildings', '*.json'))):
    d = json.load(open(f))
    gwr = [(g['geometry']['coordinates'][0], g['geometry']['coordinates'][1], g) for g in d['gwr'] if g.get('geometry')]
    for fp in d['footprints']:
        for poly in fp['geometry']['coordinates']:
            ring = [(p[0], p[1]) for p in poly[0]][:-1]
            if len(ring) < 3: continue
            key = (round(ring[0][0]), round(ring[0][1]))
            if key in seen: continue          # footprints crossing a tile edge come twice
            seen.add(key)
            area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2
            if area < 12: continue
            ra, ce, cn, L, W, ang = min_rect(ring)
            if not (E0 < ce < resort['box']['e1'] and N0 < cn < resort['box']['n1']): continue
            if any(math.hypot(ce - p[0], cn - p[1]) < 35 for p in ends): continue
            k = math.sqrt(min(1, area / ra)); L, W = L * k, W * k
            if W > L: L, W, ang = W, L, ang + math.pi / 2
            regs = [g for e, n, g in gwr if abs(e - ce) < L and abs(n - cn) < L and inside(ring, e, n)]
            floors = max([g['gastw'] for g in regs if g.get('gastw')] or [0])
            classes = [g['gklas'] for g in regs if g.get('gklas')]
            kind = KIND.get(max(classes, key=classes.count), 0) if classes else (3 if area < 45 else 0 if area < 400 else 2)
            reg = 1 if floors else 0; nreg += reg
            if not floors: floors = 1 if kind == 3 else 2 if area < 250 else 3
            ang = (math.degrees(ang) + 360) % 180
            out += [round((ce - E0) * 10), round((cn - N0) * 10), round(L * 10), round(W * 10), round(ang * 10), min(int(floors), 15), kind, reg]
json.dump(dict(e0=E0, n0=N0, source='swisstopo VECTOR25 building footprints (generalised 1:25,000) + GWR floors and use (BFS)',
               fields=['east dm', 'north dm', 'length dm', 'width dm', 'angle deg x10', 'floors', 'kind', 'floors from GWR'], b=out),
          open(os.path.join(ROOT, 'public/resort/buildings.json'), 'w'), separators=(',', ':'))
print('buildings', len(out) // 8, 'with GWR floors', nreg)
