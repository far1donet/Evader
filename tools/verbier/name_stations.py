"""Better names for the stations that only had a lift-end name ("Rouge bottom"): the nearest local place name from
swissNAMES3D (ch.swisstopo.swissnames3d: field and local names, quarters, alps) within 400 m, keeping the lift end in
brackets, e.g. "Les Marais (Rouge bottom)". Route names that contain the old station names are updated too.
Run: python3 tools/verbier/name_stations.py
"""
import glob, json, math, os, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RP = os.path.join(ROOT, 'public/resort/resort.json')
R = json.load(open(RP))
API = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?'
PREF = {'Flurname swisstopo': 0, 'Lokalname swisstopo': 0, 'Alp': 1, 'Quartierteil': 2, 'Ortsteil': 2, 'Gebiet': 3, 'Huegel': 3, 'Hügel': 3, 'Pass': 3}
def centre(g):
    c = g['coordinates']
    if g['type'] == 'Point': return c[:2]
    if g['type'] == 'MultiPoint': return c[0][:2]
    ring = c[0][0] if g['type'] == 'MultiPolygon' else c[0]
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]
renamed = {}
for s in R['stations']:
    if s['nameSource'] != 'lift end': continue
    e, n = s['e'], s['n']
    q = urllib.parse.urlencode(dict(geometry=f'{e-400},{n-400},{e+400},{n+400}', geometryType='esriGeometryEnvelope', layers='all:ch.swisstopo.swissnames3d',
                                    tolerance=0, mapExtent=f'{e-400},{n-400},{e+400},{n+400}', imageDisplay='800,800,96', sr=2056, returnGeometry='true', geometryFormat='geojson', limit=100))
    res = json.load(urllib.request.urlopen(API + q, timeout=90))['results']
    best = None
    for x in res:
        kind, name = x['properties'].get('objektart'), x['properties'].get('name')
        if kind not in PREF or not name or not x.get('geometry'): continue
        ce, cn = centre(x['geometry']); d = math.hypot(ce - e, cn - n)
        if d > 400: continue
        key = (PREF[kind], d)
        if best is None or key < best[0]: best = (key, name, kind, d)
    if not best: print(s['id'], s['name'], '-> (no place name within 400 m)'); continue
    _, place, kind, d = best
    new = f"{place} ({s['name']})"
    renamed[s['name']] = new
    print(s['id'], s['name'], '->', new, f'[{kind}, {d:.0f} m]')
    s['name'] = new; s['nameSource'] = f'swissNAMES3D ({kind}, {d:.0f} m) + lift end'
for r in R['routes']:
    for old, new in renamed.items(): r['name'] = r['name'].replace(old.upper(), new.upper())
json.dump(R, open(RP, 'w'), separators=(',', ':'))
for f in glob.glob(os.path.join(ROOT, 'public/resort/routes/*.json')):
    d = json.load(open(f)); n0 = d['name']
    for old, new in renamed.items(): d['name'] = d['name'].replace(old.upper(), new.upper())
    if d['name'] != n0: json.dump(d, open(f, 'w'), separators=(',', ':'))
print('renamed', len(renamed))
