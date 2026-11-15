"""Attach real pylons to the lifts in public/resort/resort.json, from the Swiss aviation-obstacle register (BAZL,
ch.bazl.luftfahrthindernis, fetched by fetch_extras.py). Every cable car / chairlift / ski lift is registered there as a
line of spans; each span runs pylon to pylon and carries the top elevation of its ends. For each lift the registration
whose vertices lie on the mapped line (within 15 m) and cover most of it is taken; its inner vertices become the lift's
pylons: [e, n, top elevation m, height above ground m]. Lifts with no matching registration keep the mapped nodes.
Run: python3 tools/verbier/build_pylons.py <cache dir>
"""
import json, math, os, sys
CACHE = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RP = os.path.join(ROOT, 'public/resort/resort.json')
resort = json.load(open(RP))
bazl = json.load(open(os.path.join(CACHE, 'extras', 'bazl-pylons.json')))

def project(pts, e, n):
    """(distance to polyline, arclength of the nearest point)"""
    best, s0, bs = 1e18, 0.0, 0.0
    for (ae, an, *_), (be, bn, *_) in zip(pts, pts[1:]):
        dx, dy = be - ae, bn - an; L = math.hypot(dx, dy) or 1e-9
        t = max(0.0, min(1.0, ((e - ae) * dx + (n - an) * dy) / (L * L)))
        d = math.hypot(ae + dx * t - e, an + dy * t - n)
        if d < best: best, bs = d, s0 + t * L
        s0 += L
    return best, bs

total = matched = 0
for l in resort['lifts']:
    pts = l['points']; L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    regs = {}
    for o in bazl.get(l['id'], []):
        if o['obstacletype'] != 'CABLE_CAR' or not o.get('geometry'): continue
        regs.setdefault(o['registrationnumber'].rsplit('_', 1)[0], []).append(o)
    best = None
    for reg, spans in regs.items():
        verts = {}
        for o in spans:
            g = o['geometry']; c = [g['coordinates']] if g['type'] == 'Point' else g['coordinates'] if g['type'] == 'LineString' else [v for line in g['coordinates'] for v in line]
            for v in c: verts[(round(v[0], 1), round(v[1], 1))] = (v[0], v[1], v[2] if len(v) > 2 else o['topelevationamsl'], o['maxheightagl'])
        vs = list(verts.values()); proj = [project(pts, v[0], v[1]) for v in vs]
        on = [(p, v) for p, v in zip(proj, vs) if p[0] < 15]
        if len(on) < .8 * len(vs) or not on: continue
        cover = (max(p[1] for p, _ in on) - min(p[1] for p, _ in on)) / L
        score = cover - sum(p[0] for p, _ in on) / len(on) / 100
        if cover > .6 and (best is None or score > best[0]): best = (score, reg, on, cover)
    l.pop('pylons', None); l.pop('pylonSource', None)
    total += 1
    if not best: continue
    _, reg, on, cover = best
    inner = sorted(((p[1], v) for p, v in on if 25 < p[1] < L - 25), key=lambda q: q[0])
    out = []
    for s, (e, n, top, agl) in inner:
        if out and s - out[-1][0] < 8: continue
        out.append((s, [round(e, 1), round(n, 1), round(top, 1), round(agl or 0, 1)]))
    l['pylons'] = [p for _, p in out]
    l['pylonSource'] = f'BAZL obstacle register {reg}'
    matched += 1
    print(f"{l['id']} {l['name']:<28} {l['type']:<11} mapped nodes {len(pts) - 2:>2}  BAZL pylons {len(out):>2}  cover {cover:.2f}")
resort['sources'] = [s for s in resort['sources'] if 'BAZL' not in s] + ['BAZL aviation obstacle register (ch.bazl.luftfahrthindernis): lift pylons']
json.dump(resort, open(RP, 'w'), separators=(',', ':'))
print('lifts with real pylons:', matched, 'of', total)
