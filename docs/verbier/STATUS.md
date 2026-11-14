# Verbier – 4 Vallées: what is in the game (EVADER 0.6)

Source: *Verbier 4 Vallées — Complete Ski & Snowboard Game Development Guide* (reference date 14 November 2026),
kept as text in `tools/verbier/guide-2026-11-14.txt`. Status date: 14 November 2026.

**Not "geographically accurate".** By the guide's own definition (section 10), a release may only be called geographically
accurate when piste and lift geometry is validated against georeferenced data. That data (swisstopo, OpenSkiData/OSM) was
not reachable from the build environment, so the runs are real-terrain approximations, labelled as such everywhere.

## Data actually used

| Data | Source | Notes |
| --- | --- | --- |
| Elevation | SRTM GL1 1-arc-second, tile N46E007 (NASA/USGS, public domain) via AWS Terrain Tiles | 21 × 31 m cells, crop 7.19–7.35 °E, 46.06–46.15 °N. Smooths sharp summits by tens of metres. Not swissALTI3D. |
| Names, classes, published figures | The guide | Transcribed by `tools/verbier/build_registry.py`, which asserts the guide's counts. |
| Anchor positions | Approximate positions (general knowledge), snapped to the DEM by `tools/verbier/build_verbier.py` | Each has a DEM error and a confidence flag; see `docs/verbier/terrain-report.json`. |
| Run lines | Generated on the DEM between anchors (least-cost search avoiding climbs and cliffs) | **Not** the surveyed piste centre-lines. Drawn straightened in the game (elevations and gradients real; bends not shown). |

## Guide sections

| § | Topic | Status | What exists |
| --- | --- | --- | --- |
| 01 | Scale and accuracy rules | Done | Metre-based terrain; registry with source, date, status; unknown geometry stays `null`. |
| 02 | Geography and sectors | Partial | Real DEM for Verbier / Médran, Attelas, La Chaux, Mont Gelé, Mont Fort, Gentianes, Chassoure, Tortin, Savoleyres, La Tzoumaz, Le Châble. Bruson, Nendaz, Veysonnaz, Thyon are outside the crop. Mont Blanc / Grand Combin backdrops not added. |
| 03 | Lifts and the Télémixte | Registry only | 35 lifts with machine types; Télémixte as dated objects (historical system vs upper section Dec 2025 vs lower section Dec 2026) with a rule and test that they never coexist. **No rideable lifts, cables, towers or queues**: lift geometry was not available. |
| 04 | Pistes and classes | Partial | 107 records; class drives behaviour (groomed corridor width, moguls on black/itinerary, ungroomed itineraries). Five runs are rideable. |
| 05 | Freeride itineraries | Partial | 8 itineraries with published figures (inconsistencies kept); Chassoure–Tortin rideable as an ungroomed mogul/powder line. Bec des Rosses registered as an expert zone; cliffs not modelled (needs survey data). |
| 06 | Snowpark and fun zones | Partial | La Chaux Snowpark rideable: 5 table-tops, then kickers with 9, 11 and 13 m tables (published 9–13 m), 4 jibs, all real collision geometry. Lines run as one progression, not side-by-side S/M/L (positions not published). Skicross, Funslope, stadiums, Race Experience, Meïno's playground: registry only. |
| 07 | Snow, weather, vegetation | Partial | Surface by altitude, aspect and steepness (groomed, hardpack in moguls, ice above 40°, sun crust on south faces, wind-packed above 2,700 m, deeper powder on cold north faces); treeline ~2,150 m; rock on steep faces; altitude temperature lapse (6.5 °C/km) on the HUD; clearer air at altitude. No villages, buildings, grooming cycles or solar-position model. |
| 08 | GIS pipeline | Partial | Steps 1–3 with SRTM (download, local metres, clip, physics = render surface). Steps 4–7 need piste/lift vectors and imagery (blocked). |
| 09 | Game systems | Partial | Terrain, snow materials, snowboard physics, freestyle (existing Reality physics). Living mountain (AI skiers, groomers), lifts, world-state cycles: not done. |
| 10 | Roadmap | Phase 1–3 partly | Phase 1 terrain and runs without lifts; Phase 2 park without skicross; Phase 3 Mont Fort and Chassoure–Tortin. Phases 4–6 not started. |
| 11 | Sources and rights | Done | No logos, piste-map artwork or branding. SRTM is public domain. Sources listed in `lib/verbier/registry.ts`. |

## Quality gates (tests/verbier.mjs)

- 107 pistes, 35 lifts, class counts match the guide; no invented geometry.
- Runtime DEM sampling equals the build; course heights equal the DEM where nothing is added.
- 17/17 anchors within tolerance of their published elevation (stations ±25 m, summits ±60 m); 5 flagged low confidence
  because the matching point lies more than 500 m from the expected spot (Mont Fort, Bec des Rosses, Mont Gelé,
  Col de Chassoure, Siviez).
- All five runs rideable (no climbs over 4 m). Mont Fort's first 250 m average 33° (guide: near 35°). Attelas 523 m vertical
  (guide: roughly 500 m).
- Park kicker tables within the published 9–13 m; every feature is collision geometry.
- Historical and modern Savoleyres links never appear in the same dated scene.
- Reality physics rides all five runs down the real slopes.

## To go further

1. Network access to `data.geo.admin.ch` (swissALTI3D 2 m / 0.5 m) and `overpass-api.de` or OpenSkiData would allow real
   piste centre-lines and lift lines (guide § 08 steps 4–7), and true plan-view curvature instead of straightened runs.
2. Lifts as machines (boarding, travel, dismount) once their surveyed lines exist.
3. Bruson, Savoleyres / La Tzoumaz runs, the skicross and the Funslope.
