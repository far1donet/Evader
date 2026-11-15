"""Piste widths from the forest: where a mapped piste runs through trees, the cleared corridor in the SWISSIMAGE tree
positions (stored in the shipped 2 m tiles) shows how wide it really is. Every 20 m along each piste, the nearest tree
crown on each side within 70 m is found; where both sides are wooded, the gap minus a crown (2 m each side) is a width
sample. A piste with at least 6 such samples gets `half` = half the median width (clamped 7-45 m) and `halfSource` =
'forest gap (n samples)'; open pistes above the treeline keep the typical width for their class.
Run: python3 tools/verbier/build_widths.py
"""
import json, math, os, struct, zlib
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RP = os.path.join(ROOT, 'public/resort/resort.json')
R = json.load(open(RP))
G = 20
grid = defaultdict(list)
for te, tn, _, ntrees in R['tiles']:
    if not ntrees: continue
    raw = zlib.decompress(open(os.path.join(ROOT, f'public/resort/tiles/{te}_{tn}.bin'), 'rb').read())
    off = 500 * 500 * 2; n = struct.unpack_from('<I', raw, off)[0]
    for i in range(n):
        x, y, _ = struct.unpack_from('<hhh', raw, off + 4 + i * 6)
        e, nn = te * 1000 + x / 2, tn * 1000 + y / 2
        grid[(int(e // G), int(nn // G))].append((e, nn))
def side_dist(e, n, ux, uy, sign):
    """distance across the piste (perpendicular, on one side) to the nearest tree within a 16 m band along the line"""
    best = None
    for gx in range(int((e - 75) // G), int((e + 75) // G) + 1):
        for gy in range(int((n - 75) // G), int((n + 75) // G) + 1):
            for (te, tn) in grid.get((gx, gy), ()):
                dx, dy = te - e, tn - n
                along, across = dx * ux + dy * uy, (-dx * uy + dy * ux) * sign
                if abs(along) < 8 and 0 < across < 70 and (best is None or across < best): best = across
    return best
changed = 0
for p in R['pistes']:
    p.pop('half', None); p.pop('halfSource', None)
    if p['klass'] in ('itinerary', 'park', 'skicross'): continue
    line, widths, acc = p['line'], [], 0.0
    for (ae, an), (be, bn) in zip(line, line[1:]):
        L = math.hypot(be - ae, bn - an)
        if L < 1e-6: continue
        ux, uy = (be - ae) / L, (bn - an) / L
        while acc < L:
            e, n = ae + ux * acc, an + uy * acc
            a, b = side_dist(e, n, ux, uy, 1), side_dist(e, n, ux, uy, -1)
            if a is not None and b is not None: widths.append(a + b - 4)
            acc += 20
        acc -= L
    if len(widths) >= 6:
        widths.sort(); w = widths[len(widths) // 2]
        p['half'] = round(max(7, min(45, w / 2)), 1); p['halfSource'] = f'forest gap ({len(widths)} samples)'; changed += 1
json.dump(R, open(RP, 'w'), separators=(',', ':'))
hs = [p['half'] for p in R['pistes'] if 'half' in p]
print('pistes with a measured width:', changed, 'of', len(R['pistes']), ' median half-width', sorted(hs)[len(hs) // 2] if hs else '-')
