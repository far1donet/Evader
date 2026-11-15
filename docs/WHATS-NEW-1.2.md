# EVADER 1.2: finishing the improvement list

Version 1.2 works through the nine areas from the 1.1 review. This page says what changed and what is still open.

## 1. Device testing and frame rate

- **Frame pacing.** Free-ride streaming (terrain chunks, trees, lifts, buildings) works within a per-frame time budget, about 4 ms. Background jobs advance in small steps and at least one step per frame, so nothing stalls a frame on a fast device and nothing starves on a slow one.
- **Automatic resolution** (Settings › Graphics, on by default):
  - frames averaging over 26 ms lower the render resolution, down to 55 %;
  - frames under 15 ms raise it again.
- **Benchmark** (Settings › Graphics, or open the game with `?bench`):
  - a 40 s automatic free ride from Les Attelas;
  - it reports average FPS, 1 % low, worst frame, resolution and GPU name;
  - **Copy the results** copies them to send back.
- **Free-ride start** loads 1 km of 2 m terrain around you instead of 1.6 km; the rest streams in while you ride.

**Not done:** EVADER has still only run on the software renderer here. Real-device numbers need someone to run the benchmark on their hardware.

## 2. Riding feel and the tutorial

- **High-speed washout.** The full-lock washout listed in KNOWN_ISSUES no longer reproduces. Full lock at 16–22 m/s on 6–25° slopes holds within 4° of travel for 6 s. The carving test now covers full lock at 16, 20 and 22 m/s.
- **Learn to ride** (menu) runs an interactive tutorial in free ride at Les Ruinettes. There are six steps, each completed by doing it:
  1. carve on both edges;
  2. stop from above 20 km/h;
  3. skate;
  4. ollie;
  5. spin;
  6. take a lift.
- `tests/reality.mjs` completes all six steps with the real physics.
- **Spin step limit.** The step asks for 90° of rotation, not a full 180. Flat-ground spins top out at about 115–125° in this physics model (see KNOWN_ISSUES).

## 3. Animation

- **Skating.** The rear boot comes out of its binding and pushes on the toe side of the board. It stays on the snow for 62 % of the cycle, then lifts and swings forward. Meanwhile the rider stands taller with their weight over the front foot. The binding stays on the board.
- **Falls.**
  - The rider tumbles: a log-roll about the slide direction, or a somersault after a nose dive.
  - The body turns about its own centre, so it stays on the snow, and comes to rest on its back or front.
  - Arms are thrown out and flail with the tumble, and the torso arches.
  - This is still not a physical ragdoll.

## 4. A world that is not empty

- **Buildings: 10,758 real ones.**
  - Footprints come from swisstopo VECTOR25. These are generalised for 1:25,000, so they are rectangles of the right size and orientation.
  - Floors and use come from the federal building register (GWR), for 5,595 of them; the rest get typical values for their size.
  - Houses and chalets have masonry ground floors with larch above; apartment blocks and hotels are plaster with a timber top floor; there are also concrete halls, dark barns and white churches.
  - Gable roofs carry snow.
  - In free ride, buildings are drawn up to 0.9, 1.6 or 2.5 km away depending on quality, and they are solid ("WALL STRIKE"). On runs, they stand beside the piste.
- **Lift towers are solid** in free ride ("TOWER STRIKE"). Station buildings are still not solid, so you can always reach the boarding area.
- **Other people.** 10, 22 or 36 skiers and snowboarders (by quality) ride the mapped pistes around you in linked turns, in two draw calls. Who is where is invented: there is no live data.
- **Sound.** All of it is procedural (Web Audio):
  - snow under the board, darker in powder;
  - edge scrape when skidding or carving hard;
  - wind rising with speed;
  - cloth flapping;
  - lift rope hum, and a clunk at every tower.

## 5. Visuals

- **Forested slopes on the far terrain** are now dark, where the aerial imagery found canopy (`public/resort/forest.bin`: a 50 m grid built from the 800,000 detected trees).
  - Outside the tiles with tree data, cover is estimated from elevation (dense below 1,750 m, none above 2,150 m).
  - Light noise breaks up the far snow.
- **Shadows reach further** on higher presets: ±100 m (Balanced) up to ±300 m (Cinematic).
- **Board tracks** shade like grooves: the trench walls face the middle of the track and powder lips face outward.

## 6. Accuracy

- **Real pylons for 25 lifts.** The tall lifts are in the Swiss aviation-obstacle register (BAZL, `ch.bazl.luftfahrthindernis`), which gives each pylon's position and top elevation. They replace the OpenStreetMap nodes for those lifts.
  - Mont-Gelé correctly has no pylon at all.
  - Jumbo's first pylon stands about 60 m above the ground.
  - A registered line never gets invented towers. If a span would come too low, its rope is tensioned instead.
  - Only one small cable car still needs two labelled extra towers.
- **Piste widths from the forest.** Where 110 of the 377 mapped pistes run through trees, the cleared corridor gives the groomed width (the median of samples every 20 m). The others keep their class width.
- **Better station names.** 17 of the 22 stations named only after a lift end now carry the nearest swissNAMES3D local name, for example "Ransou (Rouge bottom)". Five have no named place within 400 m.

## 7. Free-ride goals

The **Verbier passport** (Career panel) counts stations visited, lifts ridden, vertical metres ridden down and top speed, on this device. It has nine goals, from "Learn to ride" to "Every lift".

## 8. Download size and offline play

**Settings › Graphics › Download Verbier for offline play** saves all 40 MB of resort data into its own cache: terrain, runs, buildings and forest. That cache survives app updates, and the installed app then rides anywhere without a connection. While you play online, resort files are also stored in that cache rather than twice.

## 9. Code upkeep

- `npm test` runs the five suites in parallel (`tools/test-all.mjs`). `npm run test:serial` is the old chain.
- `.github/workflows/test.yml` type-checks and tests every push to a branch and every pull request. The Pages workflow still tests before it publishes.
- New data builders, each documented in its header:
  - `tools/verbier/fetch_extras.py`
  - `build_pylons.py`
  - `build_buildings.py`
  - `build_forest.py`
  - `build_widths.py`
  - `name_stations.py`

- The two largest files, `lib/snow-game.ts` and `app/page.tsx`, are formatted with Prettier in a commit of their own, so the feature diff stays readable. `.prettierrc.json` holds the house style; run `npm run format` to reformat them.
