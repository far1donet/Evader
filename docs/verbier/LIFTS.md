# Lifts in EVADER 0.9: riding the real chairlifts, gondolas and cable cars

## What you do

1. **Finish a run.** You arrive at the station where it ends, and the map opens there.
2. **Choose your lift.**
   - Under **Lifts from here**, pick a lift and press **Get on the …**.
   - Or tap any station, lift or run on the map. EVADER plans how to get there (which lifts and, if needed, which runs) and plays every step: you ride each lift and each run in turn. **Jump there instead** is still available.
3. **The ride happens in the 3D world**, in the right vehicle:

| Lift type | What happens |
| --- | --- |
| **Chairlift** (2–8 seats, from the mapped seat count) | You wait on the loading line and the chair comes from behind. You sit down and the safety bar comes down with its footrest; the board rests on the footrest. The chair swings when it accelerates and passes towers. At the top the bar goes up and you stand and slide down the unloading ramp. Other skiers sit on the chairs ahead. |
| **Gondola** | You wait on the platform beside the track. The cabin slows to a crawl through the station; you step in and sit on the bench. |
| **Télémixte** (Chaux-Express, TMX Savoleyres, La Matze, Prarion) | Chairs and cabins on the same rope, one cabin every four vehicles. You take a chair. |
| **Cable car / aerial tramway** (Mont-Fort, Jumbo, Tortin–Gentianes, Mont-Gelé, Funispace) | The cabin waits in the station hall. You board and stand; it accelerates and decelerates gently. The other cabin passes you in the opposite direction. |
| **Surface lift** (platter, T-bar, drag lift, rope tow) | You stay on the snow, holding the hanger, and are towed up the track. You let go at the top. |

4. **Controls on the lift:**
   - **×1 / ×4 / ×16:** playback speed of the ride. Real time is ×1; the default is ×4. Getting on and off always plays at real speed.
   - **Skip:** jump to just before the top, from any phase.
   - **Camera** (or **C**): chase, beside the vehicle, or the rider's own view.
   - **Map:** step off at the bottom station.

## What is real

**From OpenStreetMap / OpenSkiData** (all 66 operating lifts of the 4 Vallées, via `public/resort/resort.json`):
- the line of each lift and its pylons (530 mapped);
- its type and seats;
- its ride time and capacity, where mapped.

**Pylons from the aviation-obstacle register (since 1.2).** 25 lifts, the taller ones, are registered with the Swiss Federal Office of Civil Aviation (BAZL, `ch.bazl.luftfahrthindernis`). The register gives every span from pylon to pylon, with its top elevation. For these lifts the 251 registered pylons replace the OpenStreetMap nodes, at their real positions and heights: Mont-Gelé has none (a single span), and Jumbo's first pylon stands about 60 m above the ground. A registered line never gets invented towers; if a span would come too low, its rope is tensioned (less sag) instead. Built by `tools/verbier/build_pylons.py`.

**Speed** is the line length divided by the mapped ride time, so a ride at ×1 lasts as long as the real one:
- Médran 2: 6 min;
- Attelas: 5 min 30 s;
- Mont-Fort: 4 min 15 s;
- Jumbo: 6 min 15 s.

**Vehicle spacing** is speed × 3600 × seats ÷ capacity, the real headway. Missing values use typical ones per lift type.

**Terrain** is swissALTI3D 2 m under every line, with the same snow surface as the runs.

## Estimated, and labelled as such (`lib/verbier/lift-profile.ts`)

- **Per-type dimensions** (typical values): tower heights, distance between the uphill and downhill cables, seat height under the grip, cabin sizes, and loaded cable sag (2.2 %; 3.2 % for cable cars).
- **Added towers** (40 in all, down from 61 with the registered pylons): where the mapped pylons alone would let the vehicle come closer to the ground than a minimum clearance, a tower is added on the crest. These are flagged `mapped: false`.
- **Vehicle and station designs** are generic: no manufacturer's model or resort livery.
- **Boarding speeds:** detachable chairs and gondolas slow to about 1.0 and 0.35 m/s in stations; fixed-grip chairs load at up to 2.2 m/s; cable cars stop.

## Journeys (`lib/verbier/journey.ts`)

The planner finds the fastest path across the real network:
- a lift costs its ride time plus about 90 s of queueing and boarding;
- a run costs its length at about 8 m/s, weighted toward easier pistes.

For example, Verbier – Médran → Mont-Fort becomes: Médran 2 → Chaux-Express → ride down to La Chaux → Jumbo → Mont-Fort. Some stations cannot be reached by lifts and pistes from a given place; Le Châble, for instance, is only served by gondolas going up from it. In those cases only **Jump there** is offered.

## Tests (`tests/verbier.mjs`)

**Every one of the 66 lifts:**
- is ridden end to end, through the phases wait > board > depart > ride > arrive > alight > done;
- keeps its mapped ride time;
- keeps vehicle clearance above the ground;
- ends with the rider at the top station's height. The exception is the 68 m Haute-Nendaz funicular, which runs in a cutting.

**Journeys:**
- Médran → Mont-Fort is a connected chain of steps, each starting where the previous one ended.
- A request that the network cannot serve is refused.

## Not done

- Lift queues. Other skiers ride the pistes in free ride (1.2), but nobody waits at the stations.
- Real station architecture.
- Cabin interiors seen from inside.
- The rider keeps the board strapped on inside gondolas and cable cars; there are no external board racks.
- Lifts run at constant speed. Real detachable lifts slow each vehicle individually in the stations; here the whole line slows while you board.
