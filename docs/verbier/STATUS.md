# Verbier – 4 Vallées: what is in the game (EVADER 0.9)

Status date: 15 November 2026.

Sources:
- *Verbier 4 Vallées — Complete Ski & Snowboard Game Development Guide* (reference date 14 November 2026), kept in `tools/verbier/guide-2026-11-14.txt`.
- The federal geodata and OpenStreetMap data listed below.

## The resort map

Open **Verbier resort map** from the menu.
- **Views:** 2D (shaded piste map) or 3D (the real mountains with the piste map draped on them).
- **Starting point:** Verbier – Médran.
- **Lifts:** take any lift from your station and ride it in the 3D world: seated on the chair, in the gondola cabin or the cable car, or towed on a surface lift. Each lift runs at its real speed; you can play the ride at ×1, ×4 or ×16. See [LIFTS.md](LIFTS.md).
- **Pistes:** ride down to another station along mapped pistes. Every run ends where a lift goes up.
- **Arrival:** at the end of a run you arrive at that station and choose your next lift or run. There is no finish line.
- **Journeys:** tap any lift, run or station. EVADER plans the lifts and runs to get there and plays every step; you can also jump straight there.

| | Count | Source |
| --- | --- | --- |
| Lifts | 66 operating lifts of the 4 Vallées (Bruson, Verbier, Savoleyres–La Tzoumaz, Mont-Fort, Siviez, Nendaz, Veysonnaz, Thyon); magic carpets left out | OpenStreetMap via OpenSkiData: line, type, capacity, seats and ride duration where mapped (otherwise estimated from length and a typical speed, and labelled "est."). 30 match the guide's lift registry by name. |
| Stations | 74 (lift ends within 200 m merged) | Names, in order of preference: common station names (Le Châble, Médran, Les Ruinettes, Les Attelas…); the Swiss public-transport stop register (BAV, includes lift stops); swissNAMES3D; the lift name as a last resort ("Rouge bottom"). Each station records the source of its name. |
| Station-to-station runs | 280 | Computed on the mapped piste graph. Pistes are oriented downhill on the terrain and split at junctions and stations. For each start station, destination and difficulty ceiling (blue / red / black / itinerary), the shortest line is kept. |
| Featured runs | 8 | As in 0.6: Attelas, Hattey → Clambin, the snowpark, the ski cross, Mont-Fort, Chassoure → Tortin, FIS, Mont-Gelé → La Chaux. |

From Verbier – Médran, 58 of the 74 stations can be reached using lifts and pistes alone (tested).

The remaining 16 are separate parts of the network, such as Champsec–Sarreyer and the beginner lifts. They can be reached by fast travel.

Two lifts carry notes from the guide:
- The Télémixte upper section (TMX Savoleyres) has operated since December 2025.
- The lower section, Les Esserts–Les Planards, is scheduled for December 2026. OpenStreetMap already draws it.

The abandoned Savoleyres gondola is excluded.

## Data used

| Data | Source | How it is used |
| --- | --- | --- |
| Terrain | **swissALTI3D 2 m, 2024** © swisstopo. 361 tiles of 1 km² (E 2579–2598, N 1098–1117 km), with no gaps. | Snow surface: σ 3 m blur off-piste and σ 9 m on groomed pistes (groomers fill hollows). It is shipped as 198 compressed 2 m tiles within 800 m of a piste or lift, and loaded per run. A 10 m overview covers the whole area, for the far terrain and the maps. |
| Horizon | SRTM 1″ (NASA/USGS, public domain) | 40 m grid out to 14 km beyond the survey box, blended in over its last 400 m. |
| Pistes, lifts, snowpark | OpenStreetMap contributors (ODbL), via OpenSkiData | Lines, difficulty, grooming, lift data. |
| Station names | BAV public-transport stop register; swissNAMES3D © swisstopo | See above. |
| Trees | **SWISSIMAGE** © swisstopo (zoom 16, about 1.7 m pixels) | About 800,000 tree positions from dark-green canopy below 2,350 m. Heights are estimated. |
| Place heights | swisstopo gazetteer | 16 of 17 named anchors fall within tolerance of their published elevation: 25 m for stations and summits, 40 m for villages. |

All data is rebuilt with `tools/verbier/`:
- `fetch_swissalti3d.py` fetches the terrain;
- `filter_openskidata.py` filters the pistes and lifts;
- `build_resort.py` builds the tiles, overview, horizon, stations, lifts, routes and trees in `public/resort/`;
- `build_anchors.py` locates the named anchors;
- `build_registry.py` builds the guide registry.

The shipped data is about 40 MB in total. A run loads roughly 1–5 MB.

## Course frames

**Rotated (226 routes).** The map is only rotated, so every bend of the real piste appears as on the map.

**Curvilinear (62 routes with hairpins).**
- Distance is measured along the real line.
- Within 30 m of the line, the frame follows it exactly.
- Further out, it follows progressively smoother copies of the line (windows of 120 m to 4 km). Offsets on the inside of a bend therefore never cross, so the far terrain cannot fold into walls.
- Heights there are real; their positions are approximate.
- The worst step along such a route is now about 2 m/m, the same as real cliffs on rotated routes.

## Physics change: skating

At walking pace, tucking (W, or tilting the phone forward) makes the rider push with the free back foot:
- a force of about 1.1 m/s² along the board;
- full strength up to 3 m/s, fading out completely by 5 m/s.

This is how real riders leave station platforms and cross flats. With no input, the rider still gets no propulsion (tested).

## Designed, not surveyed

- **Snowpark lanes and ski-cross features.** Positions and profiles within the published structure are designed. The ski cross has a 6 m built start ramp.
- **Lift visuals.** Tower heights, station boxes and cable sag are typical values. Ride times without a mapped duration are estimated.
- **Moguls** are procedural, placed where OSM maps mogul or ungroomed sections.
- **Speed-ups.** Lift rides are shown sped up (6–18 s on screen) with the real time displayed. "Go to station" is fast travel.

## Not done

- There are no lift queues and no real station architecture (see [LIFTS.md](LIFTS.md)).
- No buildings or villages: the OpenStreetMap Overpass service was unreachable from the build machine.
- No AI skiers, groomers or queues.
- Gentianes is still unresolved: the gazetteer point is the lift building, 50 m below the published label.
- No Bec des Rosses face.
- The Funslope and the stadiums are in the registry only.

## Quality gates

**`tests/verbier.mjs`**
- **Registry:** guide counts match; no geometry is invented.
- **Savoleyres link:** the historical and modern versions never coexist.
- **Anchors:** 16 of 17 are within tolerance. 12 were cross-checked against the shipped 2 m tiles and agree within 4 m.
- **Resort network:**
  - 18 named real lifts are present.
  - 13 named stations are present.
  - Médran 2 climbs 668 m (real: 1,520 m to 2,200 m).
  - Funispace climbs 526 m.
  - Every lift goes up.
  - Every station-to-station run goes down and ends within 450 m of a station where a lift goes up.
  - Mont-Fort, Tortin, Savoleyres, La Chaux, Les Attelas and Siviez are reachable from Verbier – Médran.
- **Featured runs:** header elevations match the grid; no long climbs.
- **Mont-Fort face:** 39°.
- **Trees:** only below the treeline.
- **Snowpark:** kicker tables are within the published 9–13 m.
- **Riding:** Reality physics rides all 8 featured runs and 5 sampled network runs down the real slopes.

**`tests/reality.mjs`**
- Flat ground with no input: no propulsion.
- Skating reaches walking pace and never exceeds 5 m/s.
