// Triangles and draw calls of the free-ride world around a station (Node, no GPU). Run: node --experimental-strip-types tools/dev/tricount.mjs [station] [quality]
import * as T from 'three';
import { resortSync, loadTilesAround, FreeTerrain, setFreeTerrain } from '../../lib/verbier/terrain.ts';
import { SurfaceMap, FreeView } from '../../lib/verbier/free-world.ts';
import { height, snowDepth, FREE_COURSE } from '../../lib/snow-game.ts';
const r = resortSync(), sm = new SurfaceMap(r), st = r.stations.find(s => s.name === (process.argv[2] ?? 'Verbier – Médran')), q = process.argv[3] ?? 'high';
await loadTilesAround(st.e, st.n, 1600);
const run = new FreeTerrain(Math.round(st.e), Math.round(st.n), (e, n) => sm.at(e, n)); setFreeTerrain(run);
const t0 = performance.now();
const view = new FreeView(run, sm, r, q, (x, d) => height(x, d, FREE_COURSE), (x, d) => snowDepth(x, d, FREE_COURSE)); view.prime(0, 0);
const ms = performance.now() - t0, by = {};
view.group.traverse(o => {
    if (!(o instanceof T.Mesh) || !o.geometry.attributes.position) return;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o instanceof T.InstancedMesh ? o.count : 1);
    let k = o.parent?.name?.startsWith('lift') ? 'lifts' : o.parent?.name === 'buildings' || o.name === 'buildings' ? 'buildings' : o.name || o.parent?.name || 'other';
    if (o instanceof T.InstancedMesh) k += ' (instanced)';
    by[k] ??= { tris: 0, calls: 0 }; by[k].tris += tris; by[k].calls++;
});
console.log(st.name, q, `built in ${ms.toFixed(0)} ms`); for (const [k, v] of Object.entries(by).sort((a, b) => b[1].tris - a[1].tris)) console.log(k.padEnd(28), Math.round(v.tris).toLocaleString().padStart(12), 'tris', String(v.calls).padStart(5), 'draws');
