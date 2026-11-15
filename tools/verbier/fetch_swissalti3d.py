"""Download swissALTI3D 2 m tiles (newest year per 1 km tile) for the 4 Vallees domain and mosaic them.
Data: (c) swisstopo, free geodata (attribution required). Output: <cache>/alti2m.npy (float32, rows north->south) + .json.
Run: python3 tools/verbier/fetch_swissalti3d.py <cache dir>"""
import json, os, sys, urllib.request, numpy as np, tifffile
CACHE = sys.argv[1]; os.makedirs(CACHE, exist_ok=True)
E0, E1, N0, N1 = 2579, 2598, 1098, 1117          # km, LV95: the whole 4 Vallees lift network (Bruson to Thyon)
STAC = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items'
def lv95_to_wgs(e, n):
    y, x = (e - 2600000) / 1e6, (n - 1200000) / 1e6
    lon = 2.6779094 + 4.728982 * y + .791484 * y * x + .1306 * y * x * x - .0436 * y ** 3
    lat = 16.9023892 + 3.238272 * x - .270978 * y * y - .002528 * x * x - .0447 * y * y * x - .014 * x ** 3
    return lat * 100 / 36, lon * 100 / 36
la0, lo0 = lv95_to_wgs(E0 * 1000, N0 * 1000); la1, lo1 = lv95_to_wgs(E1 * 1000, N1 * 1000)
best = {}
url = f'{STAC}?bbox={lo0},{la0},{lo1},{la1}&limit=100'
while url:
    d = json.load(urllib.request.urlopen(url, timeout=120))
    for f in d['features']:
        tile = f['id'].split('_')[-1]; year = f['id'].split('_')[-2]
        href = next(a['href'] for k, a in f['assets'].items() if k.endswith('_2_2056_5728.tif'))
        if tile not in best or year > best[tile][0]: best[tile] = (year, href)
    url = next((l['href'] for l in d.get('links', []) if l.get('rel') == 'next'), None)
W, H = (E1 - E0) * 500, (N1 - N0) * 500
mosaic = np.full((H, W), np.nan, np.float32); years = {}
for tile, (year, href) in sorted(best.items()):
    te, tn = map(int, tile.split('-'))
    if not (E0 <= te < E1 and N0 <= tn < N1): continue
    path = os.path.join(CACHE, os.path.basename(href))
    if not os.path.exists(path): urllib.request.urlretrieve(href, path)
    a = tifffile.imread(path).astype(np.float32)          # 500 x 500, row 0 = north edge
    r = (N1 - tn - 1) * 500; c = (te - E0) * 500
    mosaic[r:r + 500, c:c + 500] = a[:500, :500]; years[tile] = year
missing = int(np.isnan(mosaic).sum())
np.save(os.path.join(CACHE, 'alti2m.npy'), mosaic)
json.dump(dict(e0=E0 * 1000, n1=N1 * 1000, cell=2.0, width=W, height=H, tiles=len(years), years=sorted(set(years.values())), missing=missing,
               source='swissALTI3D 2 m (c) swisstopo'), open(os.path.join(CACHE, 'alti2m.json'), 'w'))
print('tiles', len(years), 'years', sorted(set(years.values())), 'missing cells', missing, 'range', float(np.nanmin(mosaic)), float(np.nanmax(mosaic)))
