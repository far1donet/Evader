# EVADER Alpine Extreme 0.5 — Project Reality

A locally hosted browser snowboarding game (Next.js 16, React 19, TypeScript 5.9, Three.js 0.186). Version 0.5 adds
**Reality physics (beta)**: the rider and board are simulated as rigid bodies on snow at 960 Hz, and speed, turns, pops,
spins and landings come only from gravity, snow contact forces and the rider's own (strength-limited) body. The original
v0.4 model is still available as **Classic**.

> Status, honestly: Reality physics is playable and covered by automated tests, but it is a beta. Read
> [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) before judging it. Nothing here has been run on a real GPU yet: the only
> browser runs were in a cloud container with a software renderer (about 13–22 FPS), so frame rate and visual quality on
> your PC are still unmeasured.

## What's new in 1.4

- **Cinematic image for strong PCs:** on by default for High and above. It adds:
  - height haze with aerial perspective and sun glow;
  - ground-truth ambient occlusion;
  - highlight bloom;
  - a high-key filmic tone and grade;
  - 4× MSAA.
- **A new sky:** crisp cumulus.
- **Snow without moiré:** wind drifts made of noise rather than rows of sine waves.
- **Fuller trees:** snow-loaded spruces.

Details and limits: [docs/WHATS-NEW-1.4.md](docs/WHATS-NEW-1.4.md).

## What's new in 1.3

- **Free ride holds together:**
  - no terrain steps at tile edges;
  - the ground never shifts under you while tiles stream;
  - no blow-ups;
  - no memory growth over long sessions.
- **Free ride is free:** walk or hike anywhere (hold W below 9 km/h), and drop in at any spot you tap on the map.
- **New lift models:** chairs, gondola cabins, trams, towers and stations, rebuilt from scratch.
- **New village buildings:** textured chalets with windows, shutters, balconies and snowy roofs.

Details, measurements and limits: [docs/WHATS-NEW-1.3.md](docs/WHATS-NEW-1.3.md).

## What's new in 1.2

- **Learn to ride:** an interactive tutorial with six steps.
- **The world is no longer empty:**
  - 10,758 real buildings;
  - solid lift towers;
  - other riders on the pistes;
  - procedural sound.
- **More accurate:**
  - real pylons for 25 lifts;
  - piste widths measured from the forest;
  - forest-tinted far slopes.
- **Riding and animation:**
  - skating with the rear foot out;
  - tumbling falls;
  - a Verbier passport with goals.
- **Performance and offline:**
  - automatic resolution and a benchmark (`?bench`);
  - offline download of the whole resort.
- **Upkeep:** parallel tests and CI.

What changed and what is still open: [docs/WHATS-NEW-1.2.md](docs/WHATS-NEW-1.2.md).

## Play on Windows

1. Install **Node.js 24 LTS** (22.6 or newer also works) from nodejs.org.
2. Extract the archive. Open the `evader` folder.
3. Double-click **`START_LOCAL.bat`**. It runs `npm ci`, makes an optimized production build and starts the server.
4. When the window says *Ready*, open **http://localhost:3000**. Keep the window open; Ctrl+C stops it.

Later launches: `npm start` in that folder (rebuild with `npm run build` after changing code). Another port:
`npm start -- --port 3001`.

### On a phone (Android or iPhone)

The phone build is a static, installable web app with touch controls: an analog thumb-stick on the left (sideways =
lean onto an edge to turn, up/down = nose/tail pressure) and POP, GRAB, spin ⟲/⟳, STOP and TUCK on the right. Play in
landscape. On first launch a phone gets the Balanced preset at 85 % resolution (change it in Settings).

- **Hosted link:** the private claude.ai artifact made from this build opens on any phone where you are signed in.
- **Your own hosting:** `npm run build:phone` writes a fully static site to `out/` with relative paths. Upload that
  folder to any static host (GitHub Pages, Netlify, a NAS). Open it in Chrome (Android: menu › *Add to Home screen* /
  *Install app*) or Safari (iPhone: Share › *Add to Home Screen*). Installed this way it opens fullscreen in landscape
  and, after one online visit, plays offline.
- **Test on your phone over Wi-Fi:** run `npm run build && npm start -- --hostname 0.0.0.0` on your PC and open
  `http://<your-PC's-IP>:3000` on the phone (same network).

`node tools/phone-check.mjs` (needs Playwright) serves `out/` and drives it as a landscape phone with touch input.

### In VS Code

Open the folder (`File > Open Folder…`). The `.vscode` folder adds tasks (`Terminal > Run Task…`):
**EVADER: dev server**, **EVADER: tests**, **EVADER: typecheck**, **EVADER: production build**, and a launch
configuration that opens the game in Chrome/Edge with the debugger attached (`Run and Debug > Launch EVADER in Edge`).

### With git

The project is a git repository (branch `main`). If you received `evader.bundle`, clone it with
`git clone evader.bundle evader`. To publish it to your own GitHub repository:

```bash
git remote add origin https://github.com/<you>/<repo>.git
```

```bash
git push -u origin main
```

### macOS / Linux / manual

```bash
npm ci
```

```bash
npm run build && npm start
```

Use `npm run dev` for hot reload while editing (slower; use the production build for performance comparisons).

## Verbier – 4 Vallées resort map

Choose **Verbier resort map** in the menu to open the resort in **2D** (a shaded piste map) or **3D** (the real
mountains). You start at Verbier – Médran.

From any station you can:
1. **Take a lift.** Lifts follow their mapped lines and use their real ride times. The map plays the ride sped up.
2. **Ride down to another station.** There are 280 routes, each following mapped pistes to where a lift goes up.

When a run ends, you arrive at that lift station and choose where to go next. There is no finish line and no trip back
to the main menu. You can also tap any lift, run or station on the map and travel there.

At walking pace, tuck (**W**, or tilt the phone forward) to skate out of stations and across flats.

**Free ride** the whole 4 Vallées from **Free ride Verbier** in the menu, or **Free ride from here** at any station:
- Ride anywhere on the real terrain: pistes, itineraries, off-piste powder, forest.
- The HUD shows the piste you are on, or how far you are off-piste.
- Stop at any lift to ride it up and keep going from the top.

See [docs/verbier/FREERIDE.md](docs/verbier/FREERIDE.md).

**Lifts are ridden in the 3D world**, in the right vehicle:
- **Chairlifts:** you sit down, the bar comes down, and the board rests on the footrest.
- **Gondolas:** you step in from the platform.
- **Télémixte:** chairs and cabins share the rope; you take a chair.
- **Cable cars:** you stand in the cabin.
- **T-bars and platters:** you are towed on the snow.

Every lift runs at its real speed from its mapped ride time. You can play rides at ×1, ×4 or ×16, skip them, and change the camera. Tap any station, lift or run on the map, and EVADER plans the lifts and runs to get there and plays every step. See [docs/verbier/LIFTS.md](docs/verbier/LIFTS.md).

| Data | Source |
| --- | --- |
| Terrain | swissALTI3D 2 m (2024) © swisstopo, covering Bruson to Thyon |
| Pistes and lifts | OpenStreetMap contributors (ODbL), via OpenSkiData |
| Station names | Swiss public-transport stop register and swissNAMES3D |
| Trees | SWISSIMAGE © swisstopo |
| Distant horizon | SRTM |

The eight featured runs are still in the menu.

Rebuild the data with the scripts in `tools/verbier/`. See [docs/verbier/STATUS.md](docs/verbier/STATUS.md) for what
is exact, what is estimated, and what is missing.

## Realism pass 0.8

Riding was studied frame by frame in a reference recording and applied to EVADER:
- **Carving:** deeper flex and angulation from lateral g; the arms lead and the inside hand drags in the hardest turns.
- **Powder:** the rider sits back toward the tail.
- **Board:** it visibly flexes on presses and landings.
- **Snow:** dust plumes and skid walls that hang in the air; powder trenches; groomed corduroy with sparkle.
- **Light and camera:** high-key blue-shadow lighting, a valley sea of cloud on the Verbier terrain, and a lower chase camera.

See [docs/REALISM-PASS-0.8.md](docs/REALISM-PASS-0.8.md).

## Clothes in the wind

The rider wears a baggy cut:
- wide trousers stacked over the boots;
- a roomy jacket and wide sleeves.

The fabric moves with the air, which comes from the rider's own motion plus a light breeze. Loose parts (the trouser legs below the knee, the jacket's hem and back, the sleeve ends) are blown downwind. They flutter in ripples that run along the fabric, faster and wider with speed. This works when carving, in the air, on lifts and in replays.

It is done in the vertex shader (`lib/cloth-wind.ts`), so it adds no physics cost, and it does not change the rig, the poses or the grabs.

## What Reality physics does

| System | Implementation | File |
| --- | --- | --- |
| Board | 6-DOF rigid body, quaternion orientation, angular momentum as state, 960 Hz fixed step | `lib/sim/rigid-body.ts`, `lib/sim/snowboard-sim.ts` |
| Snow contact | 26 compliant contact stations along both edges; bearing, compaction damping, friction cone, sidecut edge grip, plowing; groove following of the trailing half while carving | `lib/sim/snowboard-sim.ts` |
| Snow materials | 11 materials (powder, settled, wind-packed, groomed, hardpack, ice, wet, slush, crust, park takeoff, park landing) chosen from each course's snow depth, kicker zones, wind-scoured bands and weather | `lib/sim/snow.ts`, `lib/sim/course-terrain.ts` |
| Rider | Point mass on a telescoping, strength-limited leg (Hill force–velocity push-off), body yaw and pitch inertia coupled through the hips/legs, anatomical twist range | `lib/sim/snowboard-sim.ts` |
| Boards | Six categories with typical catalogue dimensions (length, waist, sidecut radius, stance, setback, mass, edge bite) | `lib/sim/boards.ts` |
| Controls | Input expresses intent (edge, pressure, crouch, shoulder wind); a rider controller turns it into actuator commands with reflexes whose strength depends on the selected assist level | `lib/sim/rider-controller.ts`, `lib/input.ts` |
| Freestyle | Ollie/nollie from leg extension and end pressure; spins only from a wind-up released against the snow; rotation measured from the board's real angular velocity; grabs count only when the knees are up far enough for the hand to reach; landings classified from contact mechanics; crashes from mechanical criteria | `lib/sim/freestyle.ts` |
| Rails / boxes | Solid surfaces with plastic/steel friction — no magnetic attachment | `lib/sim/course-terrain.ts` |
| Rider model | Rig rescaled to a 1.72 m (helmet top) adult on a real 152–160 cm board with the board's stance width; 13 anatomical grab targets reached by IK without stretching | `lib/rider-rig.ts` |
| Replays | Record the simulated board orientation (quaternion) and posture every 1/60 s; versioned `reality-1` | `lib/snow-game.ts` |
| Diagnostics | FPS, 1 % lows, frame-time graph, draw calls, triangles, physics cost, contacts, slip, edge, leg force, balance load, and what the browser reports about GPU / WebGL2 / WebGPU / CPU threads / memory | `lib/diagnostics.ts` |

Nothing assigns position, velocity or heading during a ride. The only teleports are the run start, the manual line reset
(`R`) and standing up after a fall; all three are visible to the player.

## Controls (Reality)

| Keyboard | Action |
| --- | --- |
| A / D (or ← / →) | Lean onto the heel / toe edge to turn |
| W (or ↑) | Tuck: less air drag, no thrust |
| S (or ↓) | Speed check / stop (heelside; hold F for toeside) |
| F / Z | Pressure forward / back (presses; nollie set-up; level the board in the air) |
| Space | Hold to crouch, release to pop (ollie; nollie with F held) |
| Q / E held while crouched | Wind the shoulders; the pop unwinds them into a spin |
| X / V | Throw back / forward at takeoff |
| Shift | Grab — counts only once the hand reaches the board |
| 1–9, 0, -, =, ] | Indy, mute, melon, stalefish, nose, tail, method, japan, crail, roast beef, chicken salad, seatbelt, truck driver |
| R / C / Esc | Reset line / camera / pause |

Gamepad (standard layout): left stick X edge, left stick Y fore-aft pressure, right stick X shoulders (hold during the
crouch to wind a spin), right stick Y flip throw, RT or A crouch/pop, LT speed check, LB/RB grab, D-pad ←/→ choose grab,
D-pad ↑ camera, Y tuck, View reset, Menu pause. Dead zone, response curve, sensitivity and fore-aft inversion are in
Settings › Controls. Touch controls from v0.4 still work.

## Settings

- **Riding:** physics model (Reality beta / Classic), assist level (Authentic / Balanced / Beginner — assists strengthen the
  rider's reflexes and loosen crash limits; they never turn physics off), stance (regular / goofy), snowboard (six types).
- **Graphics:** Low, Balanced, High, Ultra, Extreme and a new **Cinematic** preset (8192² shadow map, 0.5 m terrain rows,
  3,600 trees); render resolution 75–200 %; weather; FOV; diagnostics overlay. Graphics never change the physics.

## Tests

```bash
npm test
```

Runs four suites: the original v0.4 game tests (`tests/physics.mjs`, `tests/motion.mjs`), the physics core
(`tests/sim.mjs`) and the new Reality suite (`tests/reality.mjs`). Also:

```bash
npm run check
```

```bash
npm run build && npm start
```

```bash
npm run test:browser
```

`test:browser` needs Playwright, which is not a project dependency (`npm i --no-save playwright` and
`npx playwright install chromium`), and a running `npm start`. It drives the production build in headless Chromium with a software renderer and writes screenshots to
`docs/screenshots/`. It checks that the game starts, simulates and renders without errors; it does not measure GPU
performance. Exploration and sweep scripts used during tuning are in `tools/`.

## More documentation

- [docs/REALITY_AUDIT_AND_PLAN.md](docs/REALITY_AUDIT_AND_PLAN.md) — audit, architecture, subsystem status, plan.
- [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md) — what changed in 0.5, measured results, performance.
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) — limitations and known bugs.
- `THIRD_PARTY_NOTICES.txt` — dependencies. All assets are procedural and original; no external models, textures or sounds.

Mountain names and courses are fictional. Physical parameters are engineering estimates, not calibrated measurements.
