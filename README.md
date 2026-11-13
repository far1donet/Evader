# EVADER 0.4 — Alpine local edition

An upgrade of your supplied EVADER project, designed for local browser play. No account, API key, database or paid asset is required. Internet is needed for the first dependency installation. The source package intentionally excludes node_modules and .next; these are regenerated for your own operating system.

## Play on Windows

1. Install Node.js 24 or newer.
2. Extract the complete ZIP. Open the Evader_Source_Code folder.
3. Double-click START_LOCAL.bat. It installs dependencies and makes an optimized production build.
4. Once the terminal says Ready, open http://localhost:3000. Keep the terminal open.

For subsequent launches, open a terminal in the project and run `npm start`. Rebuild with `npm run build` after changing code. Ctrl+C stops the server. To use port 3001: `npm start -- --port 3001` and open http://localhost:3001.

macOS/Linux or manual setup:

```sh
npm ci
npm run build
npm start
```

For editing with automatic reload use `npm run dev`. Use the production build for performance comparisons.

## Graphics for your extreme desktop

New profiles start at Extreme, 100% render resolution, landing assist off. Existing profiles keep saved settings; choose Settings > Graphics > Extreme manually if upgrading an existing installation.

| Preset | Terrain grid spacing | Trees | Shadow map |
| --- | --- | --- | --- |
| Low | 3 m | 300 | Off |
| Balanced | 2 m | 600 | 2048 |
| High | 1.5 m | 1,000 | 2048 |
| Ultra | 1 m | 1,800 | 4096 |
| Extreme | 0.75 m | 2,600 | 4096 |

Extreme includes denser surrounding mountain geometry. Snow has procedural grain, drifting variation and fine groom lines; the environment includes reflective gear materials, snow-covered forest instances, layered ridgelines and smoother rock meshes. No external texture downloads are needed at runtime.

The bottom-left readout shows measured FPS and actual framebuffer resolution. Render resolution can be adjusted from 75% to 150%; 150% renders 2.25 times as many pixels as 100%. Start at 100% and increase if there is frame-rate headroom. Browser refresh rate, hardware acceleration and GPU determine achievable FPS. Physics stays at 120 Hz independently of the display. This is not a guarantee of 120 FPS or ray tracing. No exact GPU, CPU or RAM specifications were provided, so the preset is based on your selected tier, not a benchmark of your PC.

## Movement and terrain changes

- Earth gravity: 9.81 m/s², analytically integrated at a fixed timestep.
- Downhill acceleration follows local slope and course elevation drop.
- Snow friction, approximate aerodynamic drag and edge losses; tucking reduces drag instead of generating thrust.
- Braking can stop the board. No forced minimum riding speed.
- Airborne horizontal speed and travel heading remain unchanged by carve/tuck/brake inputs.
- Curved kicker approach, continuous tabletop, long landing and runout; tapered shoulders remove the old vertical side walls.
- Ramp takeoff follows the local lip tangent without a hidden jump boost. Loaded ollies supply a separate impulse relative to the slope.
- Landing impact is measured against the local surface normal; sufficiently hard impacts cause a bail and clean impacts compress the rider and lose speed.
- Rocks now have collision proxies; obstacle locations remain stable across graphics presets. Extra decorative trees sit beyond the rideable boundary.
- Camera is kept above the terrain. The 190 cm board has a 34 cm waist, raised tips, bindings and fixed boot contacts.

## Controls

| Input | Action |
| --- | --- |
| A / D or arrows | Carve |
| W / S | Tuck / brake |
| Hold Space, release | Load and pop |
| Q / E | Spin |
| X / V | Backflip / frontflip |
| 1 / 2 / 3 | Select Indy / Mute / Melon |
| Shift | Grab |
| R | Reset line |
| C | Change camera |
| Escape | Pause |

Original gamepad/touch controls, three courses, four modes, park builder, color customization, local saves and replay tools remain available. Old recordings can play, but terrain has changed; record a new run for a replay that matches the new course surface.

## Important simulation limits

This is an improved procedural browser prototype, not a photorealistic AAA game or a validated biomechanics simulation. The character is an articulated procedural model, not a scanned human. Snow is not a deformable volume, the board is not an elastic finite-element simulation, collision proxies are simplified, and crashes are animated rather than a full ragdoll. Ground motion is a constrained heightfield model, not a six-degree-of-freedom rigid body. Airborne trick controls still use assisted angular acceleration/braking; they do not conserve full-body angular momentum. Terrain collision samples the analytic heightfield; the rendered surface approximates it with preset-dependent triangles. Landing thresholds and snow coefficients are gameplay tuning assumptions, not athlete measurements. Mountain names and courses are fictional.

## Verification

```sh
npm run check
npm test
npm run build
```

Tests cover course completion, replay interpolation, scoring, rider IK/contact, springs, angular integration, ballistic gravity, airborne trajectory controls, braking to a stop and hard landing bails. Automated checks and the production build were run during this upgrade. Browser visual testing was blocked by the execution environment, so GPU performance and final rendered appearance need checking on your PC.

The full-flip test starts with a defined takeoff angular velocity; it does not assert that every ordinary ollie can support a full flip.

Main files: app/page.tsx (menus), lib/snow-game.ts (simulation/world), lib/alpine.ts (graphics presets/material and forces), lib/rider-rig.ts (character), lib/trick-motion.ts (trick controls), tests/ (regressions).

Third-party notices remain in THIRD_PARTY_NOTICES.txt. No multiplayer, online ranking, cloud saves or real resort data are included.

## Physics core (Project Reality, work in progress)

`lib/sim/` holds a new six-degree-of-freedom board-and-rider simulation (fixed 960 Hz step, per-station snow contact, sidecut edge grip, skid,
rider leg and ankle model). It is verified by `tests/sim.mjs`, which `npm test` runs. **The playable game does not use it yet**; it still runs the
v0.4 loop. See `docs/REALITY_AUDIT_AND_PLAN.md` for the audit, what is verified, the phase plan and the next steps, and `docs/KNOWN_ISSUES.md` for the
speed envelope where the new board still spins out. All snow and rider parameters are uncalibrated estimates.
