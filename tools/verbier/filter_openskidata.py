"""Filter an OpenSkiData geojson stream (one feature per line) to the Verbier / 4 Vallees area.
Data: OpenStreetMap contributors (ODbL), via OpenSkiData (https://openskidata.org/).
Usage:
  mkdir -p <cache>/osd
  curl -s https://tiles.openskimap.org/geojson/runs.geojson  | python3 tools/verbier/filter_openskidata.py <cache>/osd/runs-4v.geojson
  curl -s https://tiles.openskimap.org/geojson/lifts.geojson | python3 tools/verbier/filter_openskidata.py <cache>/osd/lifts-4v.geojson
"""
import sys, json
LON0, LON1, LAT0, LAT1 = 7.15, 7.45, 46.04, 46.22
out, n = [], 0
for line in sys.stdin:
    n += 1
    line = line.strip().rstrip(',')
    if not line.startswith('{"type":"Feature"'): continue
    if '7.' not in line or '46.' not in line: continue
    f = json.loads(line)
    g = f['geometry']; c = g['coordinates']
    flat = c if g['type'] == 'Point' else c if g['type'] == 'LineString' else [p for ring in c for p in ring] if g['type'] in ('Polygon', 'MultiLineString') else [p for poly in c for ring in poly for p in ring]
    if g['type'] == 'Point': flat = [c]
    if any(LON0 <= p[0] <= LON1 and LAT0 <= p[1] <= LAT1 for p in flat): out.append(f)
json.dump({'type': 'FeatureCollection', 'features': out}, open(sys.argv[1], 'w'))
print(sys.argv[1], len(out), 'of', n, file=sys.stderr)
