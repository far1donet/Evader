# EVADER Alpine Extreme — Project Reality: audit, plan and status

Status date: 2026-11-13. Written against EVADER 0.4 (Next.js 16, React 19, TypeScript 5.9, Three.js 0.186).

**Status (0.5).** The physics core in `lib/sim/` now drives the game when Settings › Riding › Physics model is
**Reality (beta)** (the default for new profiles). The original v0.4 model remains selectable as **Classic**, and every
v0.4 mode, course and test still works. What was verified, and how, is in `docs/IMPLEMENTATION_REPORT.md`; what is still
wrong is in `docs/KNOWN_ISSUES.md`. Nothing has been run on a real GPU; the browser checks used a software renderer.

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

## 3. Subsystem classification (after 0.5)

Legend — **Verified**: implemented and covered by automated tests. **Partial**: implemented, works in tests, with
documented gaps. **Legacy**: v0.4 code reused unchanged. **Not implemented**. **Needs assets/tools**: cannot be done
well without external assets, a GPU or measurements.

| # | Subsystem | State | Notes |
| --- | --- | --- | --- |
| 1 | Physics world, fixed-step scheduler | Verified | 960 Hz sim inside the 120 Hz game tick; deterministic; render-rate independent |
| 2 | Snowboard rigid body | Verified | `rigid-body.ts`, angular-momentum state |
| 3 | Rider biomechanics | Partial | Point mass + strength-limited leg + body yaw/pitch inertia; no articulated torso/arms in the physics |
| 4 | Joint constraints, skeletal posing | Partial | Rig IK with fixed limb lengths; anatomical twist range in the sim; joint limits not exhaustive |
| 5 | Contact detection and resolution | Verified (snow), Partial (rails) | 26 compliant stations; rails solid but no rider balance strategy; trees/rocks are radius checks |
| 6 | Snow deformation and material | Partial | 11 materials drive mechanics; no stored deformation; tracks/spray are v0.4 visuals |
| 7 | Terrain streaming / world | Legacy | v0.4 analytic heightfield and LOD tiles; no streaming or new geography |
| 8 | Procedural animation | Partial | Rig posed from simulated board orientation, leg load, twist, air state; v0.4 pose code otherwise |
| 9 | Character rendering | Partial | Real scale (1.72 m) and proportions from v0.4; not a scanned/sculpted human (needs assets) |
| 10 | Snowboard and equipment rendering | Partial | Real lengths/waists/stance per board; binding angles fixed |
| 11 | Weather and atmosphere | Partial | Weather sets fresh snow and a steady wind in the physics; visuals are v0.4 |
| 12 | Audio | Legacy | Synthesised v0.4 audio; not contact-driven |
| 13 | Player input | Verified | Intent model, gamepad dead zone/curve/sensitivity/inversion, keyboard, touch |
| 14 | Tricks and scoring | Partial | Spins, grabs, presses, rails, landing classes, crashes; inversions rarely generated |
| 15 | Cameras and replay | Partial | v0.4 cameras; replays record the simulated orientation (versioned) |
| 16 | World interaction | Partial | Trees/rocks crash the rider; no branch/snow-fall interaction |
| 17 | UI and progression | Partial | New settings; progression from v0.4 |
| 18 | Performance diagnostics | Verified (in software GL) | Overlay with FPS, 1 % lows, graph, draws, triangles, physics cost, hardware report |
| 19 | Debug visualisation | Partial | Numeric overlay only; no force/contact drawing yet |
| 20 | Automated validation | Verified | 4 Node suites + headless browser smoke test |
| — | Board flex / torsion | Not implemented | |
| — | Ragdoll falls | Not implemented | Point slide + rolled pose |
| — | WebGPU, TAA, SSAO, volumetrics, new vegetation/geology | Not implemented | Needs a GPU to develop and validate |
| — | Calibration against real riding data | Needs measurements | All parameters are estimates |

### Frontside / backside convention

Board frame: +x nose, +y deck normal, +z toe edge for a regular rider (toe side is to the right of travel when riding
nose-first). A rotation is **frontside** when the chest (toe direction) turns toward the direction of travel first:
with facing f = toe·ẑ and travel t = travel·x̂, (ŷ × f)·t = toe·travel, so frontside ⇔ ω_y · toe · travel > 0.
`FreestyleTracker.describe()` uses exactly this. Backflip/frontflip: rotation about the travel axis toward the heels / toes.
Wildcat/tamedog: rotation about the lateral axis, backward / forward.

## 4. Phased plan and status

| Phase | Scope | Status after 0.5 |
| --- | --- | --- |
| 1 Audit | Baseline, classification | Done |
| 2 Physics foundation | Rigid body, integrator, tests | Done |
| 3 Snowboard mechanics | Contact, sidecut, grip, skid, braking | Done except flex; braking slow (known issue) |
| 4 Rider character | Real scale, equipment sizes, joint ranges | Partial (scale, boards, stance, grabs; no new mesh) |
| 5 Animation | Pose from physical state | Partial (orientation, load, twist, air); no motion-matched clips |
| 6 Freestyle | Ollies, spins, grabs, landings, rails | Partial (see known issues for kickers and inversions) |
| 7 Snow | Deformation, tracks, spray | Not started beyond materials |
| 8 World | Terrain, vegetation, geology | Not started |
| 9 Rendering | Materials, lighting, post | Cinematic preset only; needs a GPU |
| 10 Park | Kickers, rails | Uses v0.4 geometry; physics on it is partial |
| 11 Camera, audio, UI | | Settings, controls, diagnostics; camera/audio v0.4 |
| 12 QA | Tests, profiling | Node suites + headless browser; no GPU profiling |

Next steps, in priority order (directive § 30):

1. **Articulated rider in the physics** — pelvis/torso yaw joint so the board can rotate ~90° under the body (fixes slow
   stops), lean independent of edge angle (fixes the pitch/roll momentum leak and makes balance a real control problem).
2. **Kicker reliability** — study the concave-transition yaw instability (`tools/k4.mjs` measures the snow yaw torque) and
   runout slides; add a lip pop that counters forward rotation.
3. **Board flex** — reduced-order bending/torsion from `flexEI` / `torsionGJ`; carve radius from flex instead of `R·cos`.
4. **Snow memory** — chunk-local deformation heightfield shared by contact and rendering (grooves, compaction, tracks).
5. **On your PC** — measure each preset with the diagnostics overlay; then decide on WebGPU and post-processing work.

## 5. Engine migration (directive § 3)

Evidence from this pass: the physics runs at ≈0.2 ms per 120 Hz tick in a browser JavaScript engine, so CPU budget is
not the constraint for the riding simulation. The current gaps (articulated rider, flex, snow memory, kicker stability)
are modelling problems that a native engine would not solve by itself: neither Unreal's Chaos nor any generic rigid-body
engine provides snowboard-to-snow contact, and the custom contact model would have to be ported. Rendering fidelity is
the area where a native engine (Unreal Engine 5: Lumen, Nanite, virtual shadow maps, MetaHuman, motion matching) would
give a large jump, at the cost of rewriting the game, rebuilding all content and losing the zero-install browser
workflow. Recommendation: stay on Next.js/Three.js while the simulation matures; revisit after measuring the Extreme and
Cinematic presets on your GPU. If the rendering targets are then out of reach, port the `lib/sim` model (plain TypeScript
with no browser dependencies) to C++ inside UE5. No migration was started.

## 6. How to run the checks

```sh
npm test            # v0.4 suites + tests/sim.mjs + tests/reality.mjs
npm run check       # TypeScript
npm run build       # production build
npm run test:browser  # headless Chromium smoke test (needs `npm start` running)
```
