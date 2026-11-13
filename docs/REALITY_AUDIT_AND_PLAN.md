# EVADER Alpine Extreme — Project Reality: audit, plan and status

Status date: 2026-11-13. Written against EVADER 0.4 (Next.js 16, React 19, TypeScript 5.9, Three.js 0.186).

**Read this first.** The playable game in `app/`, `components/` and `lib/snow-game.ts` is still the original v0.4 game.
What has been added so far is a new, tested **physics core** in `lib/sim/`. It is not yet connected to the game loop, the
camera, the rider rig, the park or the UI, so playing the game today feels exactly like v0.4. The core is a verified library
with a test suite, not a finished simulator. Nothing here has been run on a GPU, in a browser, or on your PC.

## 1. Baseline findings (v0.4)

The existing game is a 2.5-D downhill game, not a rigid-body simulation.

| Area | What the code does | File |
| --- | --- | --- |
| Position | Lateral offset `x`, distance along the course `d`, a scalar `speed`. No 3-D velocity vector. | `lib/snow-game.ts` |
| Heading | A scalar `heading` that is integrated and clamped to +/-1.1 rad. Turning is `edge * grip + alignment`. | `lib/snow-game.ts` ~L905-911 |
| Speed | `groundAcceleration()` projects gravity on a scalar slope and subtracts friction, drag, plowing and a term `abs(edge) * 0.28` that is not derived from contact mechanics. | `lib/alpine.ts` L12-20 |
| Edge angle | `edgeAngle` is a damped visual value computed from the turn force; it does not feed contact forces. | `lib/snow-game.ts` ~L912 |
| Air | Spin and flip use scripted rotation steps with angular braking and automatic landing alignment. | `lib/snow-game.ts` ~L986-1030 |
| Assists | `autoLand`, `assist`, `landingWindow()` forgiveness, bounded launch correction, reachable automatic landings, line reset. | `lib/snow-game.ts` L686-770 |
| Rails | Rail profiles with swept catches and boardslides. | `lib/park-rails.ts` |
| Timestep | Fixed 120 Hz with an accumulator and up to 12 substeps. | `lib/snow-game.ts` L806-811 |

The legacy behaviours above that the directive forbids in an authentic mode are the clamped scalar heading, the
non-physical `abs(edge) * 0.28` drag term, the assisted/automatic landing alignment, and the line-reset speed of 10 m/s.
They are all still present because the legacy game loop has not been replaced yet.

The original tests (`tests/physics.mjs`, `tests/motion.mjs`) still pass unchanged.

## 2. What exists now: `lib/sim/` (verified by `tests/sim.mjs`)

| File | Contents |
| --- | --- |
| `math3.ts` | Vector and quaternion helpers. |
| `rigid-body.ts` | Six-degree-of-freedom body. World-frame angular momentum is the state, so torque-free momentum is conserved exactly and a posture change (inertia change) changes spin rate while momentum is untouched. Midpoint orientation integrator, exact constant-acceleration translation. |
| `snow.ts` | Eleven snow materials (fresh powder, settled powder, wind-packed, groomed, hardpack, icy, wet, slush, crust, park takeoff, park landing). Every number is an **uncalibrated estimate**. |
| `boards.ts` | Six board specs (length, waist, tip width, sidecut radius, setback, mass, flex values) and a rider spec (mass, leg stiffness, strength, drag areas, yaw inertia). Station generator along each edge. |
| `terrain.ts` | Terrain interface (height, material), plane and function terrains, surface normal. |
| `snowboard-sim.ts` | Board + rider two-body simulator at a fixed 960 Hz step. Thirteen contact stations per edge, each with a progressive compliant normal force, compression/rebound damping, kinetic friction along the edge, sidecut-tilted lateral grip limited by a friction cone with a Stribeck-style fall to sliding friction, plowing of displaced snow, and aerodynamic drag on the rider. The rider is a mass on a telescoping leg with spring, damper, muscle feed-forward and end stops; an ankle roll actuator tilts the board toward a commanded edge angle at a limited rate and strength; a passive hip/ankle twist spring couples rider yaw inertia to the board. |

No heading, orientation or speed is assigned. The board's orientation comes only from torque on its angular momentum. Tucking
only reduces air drag. There is no thrust term.

### Verified (run `npm test`, 1.5 s for `tests/sim.mjs`)

| Check | Result |
| --- | --- |
| Free flight under gravity | exact; horizontal motion unchanged |
| Torque-free tumbling, 100 s | angular momentum drift < 1e-12, energy drift < 1e-5 |
| Posture change | halving inertia doubles spin rate, momentum unchanged |
| Rider standing still | sinks 6.9 mm into groomed snow, jitter 0.000 mm, legs carry body weight |
| Acceleration on slopes | matches `g(sin(theta) - mu cos(theta))` to < 0.5 % (groomed 10 deg and 20 deg, hardpack, icy) |
| Terminal speed with drag | within 1 % of the analytic value using total mass |
| Flat ground | decelerates monotonically, stops in 19.0 s, never speeds up; tucking carries 10.3 m farther |
| Carving at 6 m/s | radius within 0.9-1.3 x `sidecut radius * cos(edge)` for edge 0.5, 0.7, 0.9 rad; toe and heel edges mirror within 2 %; more edge gives a tighter turn |
| Carving at 10 m/s | radius is more than 1.5 x the sidecut radius; the turn is limited by the lean force (`a_lat` within 0.12 g of `tan(edge)`) |
| Ice | lateral acceleration under half of groomed snow |
| Energy | a forced-edge run loses more energy than a straight run |
| Landing from 1 m | penetration 10.3 mm, settles; peak leg force reaches the 4,200 N leg limit (5.7 x body weight) |
| Determinism | identical step counts give bit-identical state |
| Spin-out guard | board stays within 5 deg of its travel at 6 m/s, edge 0.3-0.9, and within 15 deg at 10 m/s, edge 0.5-0.9 |

These tests compare the model to analytic references and to its own conservation properties. They are **not** calibration
against real snowboarding measurements, so nothing here may be described as scientifically validated.

## 3. Subsystem classification

| Subsystem | State | Notes |
| --- | --- | --- |
| Rigid-body core | Done, verified | `lib/sim/rigid-body.ts` |
| Board-to-snow contact, edges, sidecut, skid | Done, verified inside the envelope in `KNOWN_ISSUES.md` | |
| Rider as mass on a leg, ankle roll, passive twist | Done, simplified | Lean is a stiff constraint, not a free balance |
| Snow material table | Done, **uncalibrated** | |
| Aerodynamics | Done, simple | Constant air density 0.95 kg/m^3 |
| Board flex, torsion | Not implemented | Values exist in `BoardSpec` but are unused |
| Ollie / pop mechanics | Not implemented | Leg force can load the board; no tail-snap model |
| Air rotation, grabs, landing in the new core | Not implemented | Rigid-body core supports it; no rider body rotation yet |
| Articulated rider with IK and ragdoll in the new core | Not implemented | Legacy rig (`rider-rig.ts`) reusable for rendering |
| Snow deformation and persistent tracks | Legacy only | `board-tracks.ts`, `powder-spray.ts` reusable |
| Terrain and course generation | Legacy | Reusable; `SimTerrain` adapter still to write |
| Rendering, forest, sky | Legacy | Needs a real GPU browser to evaluate |
| Park (kickers, rails) | Legacy, scripted | Rails catch automatically; needs contact rewrite |
| Camera, replay, audio, UI | Legacy | Not touched |
| Gamepad-first controls | Not implemented | Keyboard and basic gamepad remain from v0.4 |
| Hardware detection and diagnostics screen | Not implemented | No specs of your PC are assumed |
| Integration of `lib/sim` into `snow-game.ts` | Not started | The largest remaining risk |

## 4. Phased plan

| Phase | Directive scope | Status |
| --- | --- | --- |
| 1 Audit | Baseline, classification, scripted-behaviour list | Done (this file) |
| 2 Physics foundation | Rigid body, integrator, tests | Done |
| 3 Snowboard mechanics | Contact stations, sidecut, edge grip, skid, flex | Contact, sidecut and skid done; flex not done |
| 4 Rider character | Articulated body, IK, balance | Not started (point mass + leg + twist only) |
| 5 Animation | Pose from physical state | Not started |
| 6 Freestyle | Ollie, spins, grabs, landings, rails | Not started |
| 7 Snow | Deformation, tracks, spray | Legacy only |
| 8 World | Terrain, weather | Legacy only |
| 9 Rendering | Materials, lighting, post | Legacy only; never tested on a GPU here |
| 10 Park | Kickers, rails, halfpipe | Legacy only |
| 11 Camera, audio, UI | | Legacy only |
| 12 QA | Soak, determinism, diagnostics | Determinism and the physics suite only |

Recommended next steps, in order:

1. **Integrate the core.** Write a `SimTerrain` adapter over the game's `height()` and snow materials, drive `SnowboardSim` from the input layer
   (gamepad axes and keys mapped to `RiderCommand`), and feed its state to the existing camera and rider rig. Keep the legacy loop selectable so
   no mode is removed.
2. **Fix the remaining spin-out region** (see `KNOWN_ISSUES.md`) by giving the rider a free torso yaw and a trained yaw reflex.
3. **Ollie and flex**, then air rotation with the rider's inertia changing with posture.
4. **Real-browser checks on your PC**: frame rate, GPU load, visual quality. These cannot be done in this cloud workspace.

## 5. How to run the checks

```sh
npm test            # original tests + tests/sim.mjs
npx tsc --noEmit    # type check (passes)
```

`next build` and the browser game were not run in this workspace. `node_modules` here lacks Windows binaries and there is no network
access, so a production build and a visual check have to be done on your PC with `START_LOCAL.bat`.

## 6. Link to your PC and VS Code

You asked me to use your PC and VS Code when needed. In this session the link to your computer did not connect (the connection returned an
error), so I could not read or change anything there. All work was done in the cloud workspace. When the link is available, the finished
files can be placed straight into your project folder; until then, use the archive that was delivered with this report.
