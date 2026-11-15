# Verbier – 4 Vallées: what is in the game (EVADER 0.6)

Status date: 15 November 2026.

Sources:
- *Verbier 4 Vallées — Complete Ski & Snowboard Game Development Guide* (reference date 14 November 2026), kept as text in `tools/verbier/guide-2026-11-14.txt`;
- the Swiss federal geodata and OpenStreetMap data below.

**About "geographically accurate".** Section 10 of the guide lets a release use this label only when piste and lift geometry has been checked against georeferenced data. Version 0.6 meets that for the eight runs it ships:
- the terrain is swisstopo's 2 m survey model;
- the run and lift lines are the mapped OpenStreetMap lines;
- named places were checked against the federal gazetteer.

What is still estimated or designed is listed below and labelled in the code.

## Data used

| Data | Source | How it is used |
| --- | --- | --- |
| Terrain | **swissALTI3D 2 m, 2024** © swisstopo (140 × 1 km tiles, E 2581–2595 km, N 1099–1109 km, no gaps) | 2 m grid within ~150 m of each run (bicubic) and a 16 m grid out to the horizon. It is smoothed for snow cover: σ 3 m off-piste and σ 9 m on groomed piste. Rock bands and summits are kept. |
| Run lines, grooming, difficulty | **OpenStreetMap contributors (ODbL), via OpenSkiData** | Real centre lines of the mapped segments. Grooming from OSM `piste:grooming` (classic / mogul / backcountry). |
| Lifts | Same | Mapped lift lines, stations at the ends and pylons at the mapped nodes. Cables have an estimated sag. Lifts are scenery only. |
| Snowpark footprint | OSM `snow_park` polygon at La Chaux | The park's axis and extent. The S/M/L lanes sit inside it. |
| Trees | **SWISSIMAGE** aerial photos © swisstopo (WMTS, zoom 17) | Dark-green canopy pixels below 2,350 m give real tree positions. Heights are estimated. |
| Place heights | **swisstopo gazetteer** (api3.geo.admin.ch) | 14 of 17 named anchors are located and fall within 18 m of their published elevation (most within 6 m). |
| Names, classes, published figures | The guide | 107 pistes, 35 lifts, 8 itineraries and 9 fun zones (`lib/verbier/registry.ts`). |

The tools are in `tools/verbier/`:
- `fetch_swissalti3d.py` builds the terrain mosaic;
- `filter_openskidata.py` filters the run and lift lines;
- `build_runs.py` builds the run files (`public/terrain/*.bin`, loaded on demand, 7.6 MB in total);
- `build_anchors.py` locates the named anchors;
- `build_registry.py` builds the guide registry.

## The eight runs

| Run | Length | Vertical | Max slope | Frame |
| --- | --- | --- | --- | --- |
| Attelas (red) | 2,346 m | 2,712 → 2,226 m | 28° | unrolled (hairpins) |
| Hattey → Clambin (red into forest itinerary) | 2,287 m | 2,132 → 1,656 m | 35° | unrolled |
| La Chaux Snowpark | 511 m | 2,360 → 2,274 m | 22° | exact plan |
| La Chaux Ski Cross | 583 m | 2,393 → 2,299 m | 18° | exact plan |
| Mont-Fort (black, moguls on top) | 1,466 m | 3,289 → 2,818 m | 39° | exact plan |
| Chassoure → Tortin (itinerary) | 3,801 m | 2,745 → 2,045 m | 39° | unrolled |
| FIS | 2,161 m | 2,543 → 1,752 m | 30° | exact plan |
| Mont-Gelé → La Chaux (itinerary) | 1,326 m | 2,928 → 2,439 m | 46° | exact plan |

There are two kinds of frame:
- **Exact plan**: the map is only rotated, so every bend of the real run appears as it is on the map.
- **Unrolled**: used for runs whose mapped line doubles back (hairpins). Distance is measured along the real line and the offset across it. Heights along and beside the line are real, but the bends are drawn straightened.

## Designed, not surveyed (labelled in code)

- **Snowpark features.** The published structure is used: S line with 5 table-tops; 3 kickers with 9–13 m tables; jibs. Their positions inside the mapped footprint and their exact profiles are a design, because positions are not published.
- **Ski cross.** The track follows the real mapped line, with these designed elements:
  - Banked turns sized from the line's real curvature (banked for about 12 m/s).
  - Whoops on the straights.
  - Two table jumps.
  - Netting at ±8.5 m.
  - A 6 m built start ramp. The mapped start area is nearly flat for its first 45 m, and real ski-cross starts are built up with snow.
- **Lift tower heights, station sizes and cable sag** are typical values.
- **Moguls** are irregular procedural fields, placed where OSM maps mogul or ungroomed sections.

## Not done

- Lifts are not rideable.
- There are no buildings or villages: the OpenStreetMap Overpass service was unreachable from the build machine.
- There are no AI skiers, groomers or queues.
- Bruson, Nendaz, Veysonnaz, Thyon, Siviez and La Tzoumaz are outside the terrain area. The Siviez and La Tzoumaz anchors are therefore unresolved.
- The Gentianes anchor is unresolved: the gazetteer point is the lift building, 50 m below the published label.
- There is no Bec des Rosses face.
- The Funslope and the stadiums are listed in the registry but not built.
- On the three unrolled runs, the hairpin bends are straightened.

## Quality gates (`tests/verbier.mjs`)

**Registry**
- 107 pistes, 35 lifts and the class counts match the guide.
- No geometry is invented.
- The historical and modern Savoleyres links never appear together.

**Anchors and terrain**
- 14 of 17 anchors fall within 25 m of their published elevation.
- 6 anchors were mapped through a run's frame and checked against the shipped 2 m grid; they agree within 4 m.
- On every run, the header elevations match the grid.
- No run climbs more than 8 m along its line.
- The Mont-Fort upper face reaches 39°; the guide says close to 35°.
- Trees appear only below the treeline.

**Run character**
- Attelas is groomed, with no moguls on its corridor.
- Chassoure → Tortin is ungroomed, with moguls.

**Snowpark and ski cross**
- The kicker tables are within the published 9–13 m.
- Every park feature is solid collision geometry.
- The ski cross has banked turns and jumps.

**Riding**
- Reality physics rides all eight runs down the real slopes, with a pure-pursuit bot steering along the mapped line.
