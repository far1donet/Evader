"""Forest cover grid for the far terrain: tree canopy positions (from SWISSIMAGE, stored in the shipped 2 m tiles) counted
into a 50 m grid over the survey box, as a 0-255 cover fraction (a cell full of canopy = 255). Tiles that are not shipped
have no tree data and are marked 254 'unknown', so the game falls back to an elevation estimate there.
Output: public/resort/forest.bin (zlib, 380 x 380 bytes, north row first). Run: python3 tools/verbier/build_forest.py
"""
import json, os, struct, zlib
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R = json.load(open(os.path.join(ROOT, 'public/resort/resort.json')))
box, CELL, TC = R['box'], 50, 500
nx, ny = (box['e1'] - box['e0']) // CELL, (box['n1'] - box['n0']) // CELL
count = [0] * (nx * ny); known = [False] * (nx * ny)
for te, tn, _, ntrees in R['tiles']:
    raw = zlib.decompress(open(os.path.join(ROOT, f'public/resort/tiles/{te}_{tn}.bin'), 'rb').read())
    off = TC * TC * 2; n = struct.unpack_from('<I', raw, off)[0]
    for i in range(n):
        x, y, h = struct.unpack_from('<hhh', raw, off + 4 + i * 6)   # 0.5 m units within the tile, height dm
        e, nn = te * 1000 + x / 2, tn * 1000 + y / 2
        c, r = int((e - box['e0']) // CELL), int((box['n1'] - nn) // CELL)
        if 0 <= c < nx and 0 <= r < ny: count[r * nx + c] += 1
    for r0 in range((box['n1'] - (tn + 1) * 1000) // CELL, (box['n1'] - tn * 1000) // CELL):
        for c0 in range((te * 1000 - box['e0']) // CELL, ((te + 1) * 1000 - box['e0']) // CELL):
            if 0 <= r0 < ny and 0 <= c0 < nx: known[r0 * nx + c0] = True
# full cover = the densest forest cells (99th percentile, about 45-50 detected crowns per 50 m cell, ~50 m2 per crown)
FULL = 2500 / 50
out = bytes(min(253, round(255 * min(1, count[i] / FULL))) if known[i] else 254 for i in range(nx * ny))
open(os.path.join(ROOT, 'public/resort/forest.bin'), 'wb').write(zlib.compress(out, 9))
cov = [count[i] / FULL for i in range(nx * ny) if known[i]]
print('forest grid', nx, 'x', ny, 'known cells', sum(known), 'mean cover', round(sum(min(1, c) for c in cov) / len(cov), 3))
