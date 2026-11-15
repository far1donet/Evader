"""Fetch extra real data for the resort (cached under <cache>/extras):
  - cable-car pylons from the Swiss aviation-obstacle register (BAZL, ch.bazl.luftfahrthindernis): position, height above
    ground, top elevation, along every lift line;
  - building footprints from swisstopo VECTOR25 (ch.swisstopo.vec25-gebaeude) and building points with floor counts from
    the federal register of buildings (GWR, ch.bfs.gebaeude_wohnungs_register), for every shipped terrain tile.
Run: python3 tools/verbier/fetch_extras.py <cache dir>
"""
import json, os, sys, time, urllib.parse, urllib.request
CACHE = sys.argv[1]; OUT = os.path.join(CACHE, 'extras'); os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
resort = json.load(open(os.path.join(ROOT, 'public/resort/resort.json')))
API = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?'

def identify(layer, e0, n0, e1, n1, geometry=True):
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode(dict(geometry=f'{e0},{n0},{e1},{n1}', geometryType='esriGeometryEnvelope', layers=f'all:{layer}', tolerance=0,
                                        mapExtent=f'{e0},{n0},{e1},{n1}', imageDisplay='1000,1000,96', sr=2056, returnGeometry='true' if geometry else 'false',
                                        geometryFormat='geojson', limit=200, offset=offset))
        for attempt in range(4):
            try: data = json.load(urllib.request.urlopen(API + q, timeout=90)); break
            except Exception as ex:
                if attempt == 3: raise
                time.sleep(2 ** attempt)
        res = data.get('results', [])
        out += res
        if len(res) < 200: return out
        offset += 200

# pylons along each lift (bbox of the line + 60 m)
path = os.path.join(OUT, 'bazl-pylons.json')
if not os.path.exists(path):
    pylons = {}
    for l in resort['lifts']:
        es = [p[0] for p in l['points']]; ns = [p[1] for p in l['points']]
        res = identify('ch.bazl.luftfahrthindernis', min(es) - 60, min(ns) - 60, max(es) + 60, max(ns) + 60)
        pylons[l['id']] = [dict(geometry=r.get('geometry'), **{k: r['properties'].get(k) for k in ('obstacletype', 'maxheightagl', 'topelevationamsl', 'registrationnumber', 'effectivedate')}) for r in res]
        print('lift', l['name'], len(res), flush=True)
    json.dump(pylons, open(path, 'w'))

# buildings per shipped tile
bdir = os.path.join(OUT, 'buildings'); os.makedirs(bdir, exist_ok=True)
for te, tn, _, _ in resort['tiles']:
    p = os.path.join(bdir, f'{te}_{tn}.json')
    if os.path.exists(p): continue
    e0, n0 = te * 1000, tn * 1000
    foot = identify('ch.swisstopo.vec25-gebaeude', e0, n0, e0 + 1000, n0 + 1000)
    gwr = identify('ch.bfs.gebaeude_wohnungs_register', e0, n0, e0 + 1000, n0 + 1000) if foot else []
    json.dump(dict(footprints=[dict(geometry=f['geometry'], area=f['properties'].get('area')) for f in foot],
                   gwr=[dict(geometry=g['geometry'], **{k: g['properties'].get(k) for k in ('gastw', 'gklas', 'gkat', 'gbez', 'garea', 'gbauj')}) for g in gwr]), open(p, 'w'))
    print('tile', te, tn, 'footprints', len(foot), 'gwr', len(gwr), flush=True)
print('done')
