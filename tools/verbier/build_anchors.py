"""Locate the guide's 17 elevation anchors with the swisstopo place-name search (gazetteer, LV95) and read their
elevation from the swissALTI3D 2 m mosaic. Output: lib/verbier/anchors-data.ts.  Run: python3 tools/verbier/build_anchors.py <cache>"""
import json, os, sys, urllib.parse, urllib.request, numpy as np
CACHE = sys.argv[1]; ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
M = np.load(os.path.join(CACHE, 'alti/alti2m.npy')); MM = json.load(open(os.path.join(CACHE, 'alti/alti2m.json')))
def dem(e, n):
    c, r = (e - MM['e0']) / 2, (MM['n1'] - n) / 2
    return float(M[int(r), int(c)]) if 0 <= r < M.shape[0] and 0 <= c < M.shape[1] else None
# id, guide name, published elevation, search text, preferred feature kinds (gazetteer category words)
A = [('mont-fort', 'Mont Fort', 3330, 'Mont Fort', ['Hauptgipfel', 'Gipfel']),
     ('bec-des-rosses', 'Bec des Rosses', 3223, 'Bec des Rosses', ['Gipfel', 'Hauptgipfel']),
     ('mont-gele', 'Mont Gelé', 3023, 'Mont Gelé', ['Gipfel', 'Hauptgipfel']),
     ('col-des-gentianes', 'Col des Gentianes lift area', 2950, 'Col-des-Gentianes', ['Bahnen', 'Pass']),
     ('col-de-chassoure', 'Col de Chassoure', 2743, 'Col de Chassoure', ['Pass']),
     ('les-attelas', 'Les Attelas', 2734, 'Les Attelas', ['Bahnen', 'Gipfel']),
     ('lac-des-vaux', 'Lac des Vaux', 2550, 'Lac des Vaux', ['See', 'Bahnen', 'Lokalname']),
     ('fontanet', 'Fontanet', 2484, 'Fontanet', ['Bahnen', 'Lokalname', 'Gipfel', 'Flurname']),
     ('savoleyres', 'Savoleyres', 2344, 'Savoleyres', ['Bahnen', 'Lokalname', 'Gipfel']),
     ('la-chaux', 'La Chaux', 2260, 'La Chaux', ['Lokalname', 'Bahnen', 'Alp', 'Flurname']),
     ('les-ruinettes', 'Les Ruinettes', 2200, 'Les Ruinettes', ['Bahnen', 'Lokalname']),
     ('tortin', 'Tortin', 2045, 'Tortin', ['Bahnen', 'Lokalname', 'Alp']),
     ('siviez', 'Siviez', 1730, 'Siviez Nendaz', ['Ort', 'Ortsteil', 'Bahnen', 'Lokalname']),
     ('medran', 'Médran', 1530, 'Verbier Médran', ['Bahnen', 'Lokalname', 'Haltestellen']),
     ('verbier', 'Verbier', 1500, 'Verbier', ['Ort', 'Ortschaft', 'Ortsteil']),
     ('la-tzoumaz', 'La Tzoumaz', 1500, 'La Tzoumaz', ['Ort', 'Ortschaft', 'Ortsteil']),
     ('le-chable', 'Le Châble', 821, 'Le Châble VS', ['Ort', 'Ortschaft', 'Ortsteil'])]
out = []
for aid, name, pub, q, kinds in A:
    url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?' + urllib.parse.urlencode(dict(searchText=q, type='locations', sr=2056, limit=15))
    res = json.load(urllib.request.urlopen(url, timeout=60))['results']
    cands = []
    for r in res:
        a = r['attrs']; label = a['label'].replace('<b>', '').replace('</b>', '').replace('<i>', '').replace('</i>', '')
        if '(VS)' not in label and 'Bagnes' not in label and 'Nendaz' not in label and 'Riddes' not in label: continue
        e, n = a['y'], a['x']; h = dem(e, n)
        rank = next((i for i, k in enumerate(kinds) if k.lower() in label.lower()), len(kinds))
        cands.append((rank, abs((h or 0) - pub), label, e, n, h, a.get('origin')))
    if not cands: out.append(dict(id=aid, name=name, publishedElevation=pub, resolved=False, status='not found in the gazetteer')); continue
    cands.sort(key=lambda c: (c[0], c[1]))
    if cands[0][1] > 40:   # preferred feature type is off: take the same-named Valais feature closest to the published elevation
        cands.sort(key=lambda c: c[1])
    rank, err, label, e, n, h, origin = cands[0]
    ok = h is not None and abs(h - pub) <= 40
    out.append(dict(id=aid, name=name, publishedElevation=pub, e=round(e, 1), n=round(n, 1), crs='EPSG:2056 (LV95)',
                    demElevation=round(h, 1) if h is not None else None, error=round(h - pub, 1) if h is not None else None,
                    gazetteer=label, origin=origin, resolved=ok,
                    status='swisstopo gazetteer position; elevation from swissALTI3D 2 m' if ok else 'gazetteer position found but its DEM elevation differs from the published label by more than 40 m'))
    print(f"{name:28} pub {pub:5}  dem {h if h is None else round(h,1)!s:>7}  err {('%+.1f' % (h - pub)) if h is not None else '-':>7}  {label[:60]}")
# Fallback: lift stations mapped in OpenStreetMap (OpenSkiData) for anchors the gazetteer does not resolve.
def wgs_to_lv95(lat, lon):
    p, l = (lat * 3600 - 169028.66) / 10000, (lon * 3600 - 26782.5) / 10000
    return (2600072.37 + 211455.93 * l - 10938.51 * l * p - .36 * l * p * p - 44.54 * l ** 3,
            1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3)
LIFT_STATIONS = {'medran': ('Médran 2', 0), 'la-chaux': ('Chaux 2', 0), 'les-ruinettes': ('Médran 2', -1)}
lifts = json.load(open(os.path.join(CACHE, 'osd/lifts-4v.geojson')))['features']
for a in out:
    if a['id'] not in LIFT_STATIONS or (a['resolved'] and a['id'] != 'les-ruinettes'): continue
    lname, end = LIFT_STATIONS[a['id']]
    f = next((f for f in lifts if f['properties'].get('name') == lname), None)
    if not f: continue
    lon, lat = f['geometry']['coordinates'][end][:2]; e, n = wgs_to_lv95(lat, lon); h = dem(e, n)
    if h is None or abs(h - a['publishedElevation']) > 40 or (a['resolved'] and abs(h - a['publishedElevation']) >= abs(a['error'])): continue
    a.update(e=round(e, 1), n=round(n, 1), demElevation=round(h, 1), error=round(h - a['publishedElevation'], 1), resolved=True,
             gazetteer=None, origin='openstreetmap', status=f'{lname} {"bottom" if end == 0 else "top"} station mapped in OpenStreetMap (OpenSkiData); elevation from swissALTI3D 2 m')
    print(f"{a['name']:28} -> {lname} station  dem {h:.1f}  err {h - a['publishedElevation']:+.1f}")
with open(os.path.join(ROOT, 'lib/verbier/anchors-data.ts'), 'w', encoding='utf-8') as f:
    f.write('// GENERATED by tools/verbier/build_anchors.py: swisstopo gazetteer positions (LV95) + swissALTI3D elevations.\n')
    f.write('export const ANCHORS = ' + json.dumps(out, ensure_ascii=False) + ' as const;\n')
