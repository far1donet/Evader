# Free ride (EVADER 1.0): the whole Verbier 4 Vallées domain

## Playing

You can start free ride two ways:
- choose **Free ride Verbier** in the menu;
- press **Free ride from here** at any station on the resort map.

There is no set line and no finish. Ride anywhere on the real terrain: down groomed pistes, onto itineraries, off-piste into powder, through the forest.

**The HUD** shows where you are:
- on a piste, with its class and name, for example "Red · Mix";
- or off-piste, with the nearest piste and how far away it is;
- and the station you are at.

**To take a lift**, stop at its loading area (under about 14 km/h). The HUD offers each lift that loads there. Its ride plays in the 3D world, and free ride continues from the top station.

**Map** ends the free ride at the nearest station. **R** puts you back on your feet, facing down the fall line.

## How it works (`lib/verbier/free-world.ts`, `FreeTerrain` in `lib/verbier/terrain.ts`)

### World frame

The world frame is north-up: x = metres east of the starting point, d = metres north. Physics, rendering and snow all sample the same functions.

### Terrain

- **Near the rider:** the swissALTI3D 2 m snow surface from the shipped tiles. Tiles load 1.6 km ahead as you move.
- **Elsewhere:** the 10 m overview inside the survey box, and SRTM outside it.

### Rendering

- **Near window:** 64 m chunks around the rider, at 2 m (High and above) or 4 m (Balanced, Low). The window is 7–11 chunks across, depending on quality. Chunks build nearest-first, two per frame, and rebuild when a 2 m tile arrives.
- **Coarse mesh:** a 48–64 m mesh to about 6 km, sunk under the near window.
- **Horizon:** SRTM out to 24 km.
- **Trees:** the nearest trees from the aerial imagery. The budget is twice the quality setting's tree count. Trees within 150 m are solid.
- **Lifts:** within 2.2 km, the same scenery as the lift rides.
- **Piste marker poles:** within 700 m, every 30 m, in Swiss piste colours.

### Snow everywhere

Snow is set by a surface map built from every mapped piste (OpenStreetMap), in 4 m cells per 1 km tile, made on demand:

| Surface | Where | Snow |
| --- | --- | --- |
| Groomed corridor | Blue 22 m, red 18 m, black 15 m half-width | Groomed snow; corduroy in the shader |
| Mogul section | Mapped mogul pistes | Bumps 0.55 m; hardpack |
| Itinerary | Within 14 m of an itinerary line | Ungroomed, with moguls |
| Off-piste | Everywhere else | Powder depth from altitude, aspect and steepness; sun crust on south faces, wind-packed snow high up, ice above 40° (as on the runs) |

## Tested (`tests/verbier.mjs`)

**Surface map:**
- the Attelas piste is inside its groomed corridor;
- 90 m away from it is off-piste;
- itinerary lines are flagged as ungroomed.

**Free ride from four stations** (Les Attelas, Col des Gentianes, Savoleyres, Tracouet):
- the free terrain equals the shipped 2 m tiles;
- the game's height equals the free terrain;
- a rider dropped there rides down the real slope;
- the ride never ends on its own.

## Moving around (1.3)

- **Walking:** below 9 km/h, hold W (phone: tilt forward) to walk or skate the board in any direction, uphill too. A and D turn. Let go to ride on.
- **Drop in anywhere:** tap a spot on the resort map, then **Free ride from this spot**.
- **Solid things:** below 16 km/h, trees, walls and towers stop you instead of knocking you over.
- **Streaming:** tiles that arrive while you ride are applied only once you are 120 m clear of them. Their edges fade into the 10 m overview, so there is never a step.

## Limits

- Cliffs are only as sharp as the 2 m survey and the snow smoothing allow.
- There are no avalanche, closed-area or out-of-bounds rules; you can ride anything in the survey box.
- Lift towers and buildings are solid (since 1.2); lift station buildings are not, so the boarding area is always reachable.
- Outside the survey box (Bruson's lowest slopes, beyond Thyon), the ground is the coarse overview or SRTM.
- On a phone, set Balanced or Low quality for a steady frame rate.
