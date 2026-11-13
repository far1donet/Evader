# EVADER 0.5 — implementation report

Date: 2026-11-13. Base: EVADER 0.4 plus the Reality phase 1–3 physics core (`lib/sim/`, not connected to the game).

## 1. What changed

### Physics core (`lib/sim/`)
- **Course adapter** (`course-terrain.ts`): exposes each course's heightfield, snow depth, kicker zones, wind-scoured
  hardpack bands and weather (fresh snow) as snow materials; rails and boxes are solid contact surfaces with a
  plastic/steel material (low friction, almost no edge hold). One fused contact query (height + normal + material).
- **Simulator** (`snowboard-sim.ts`):
  - internal torques only: leg pivot and shoulder twist act between body and board, so rotation can only come from the
    snow or from momentum already present;
  - body yaw inertia changes with posture (grab, tuck) while its angular momentum is kept;
  - anatomical hip/shoulder twist range with a passive end stop;
  - body pitch inertia (11 kg·m²) coupled to the board, so hips/knees can level the board in the air;
  - Hill force–velocity push-off for pops (force falls as the legs extend faster);
  - groove following: the trailing half of an engaged edge gets extra lateral hold while the board tracks;
  - ankle moment reaction of the leg's transverse hold (pitch/yaw), aerodynamic drag on air-relative velocity (wind);
  - edge sweep rate limited to 2.2 rad/s (removes the documented roll-in hop).
- **Rider controller** (`rider-controller.ts`): intent → actuator commands; yaw reflex; speed-aware edge mapping;
  three-assist levels; ollie/nollie loading; spin wind-up held near the end of range and unwound through the pop from an
  engaged edge; fall-line speed check (relaxed legs, then a latched trailing-edge dig); big-slide recovery by the trailing
  edge; air: board levelling (player lean, plus an explicit assist in Balanced/Beginner), landing preparation.
- **Freestyle observer** (`freestyle.ts`): takeoff detection, rotation integrated from angular velocity about takeoff
  axes, inversion counting, FS/BS/switch naming, 13 grabs with reach requirements, landing classes (STOMPED, CLEAN,
  UNSTABLE, HEAVY, SCRAPED, HAND DRAG, BUTT CHECK, UNDER-/OVER-ROTATED), crash kinds (EDGE CATCH, HARD LANDING, INVERTED
  LANDING, NOSE DIVE, LOST BALANCE, SPUN OUT, RAIL SLIP, TREE/ROCK STRIKE), rail and press/butter recognition, scoring.

### Game (`lib/`, `app/`)
- `lib/reality-ride.ts`: one simulated ride (8 sim steps per 120 Hz tick), post-crash body slide and stand-up.
- `lib/snow-game.ts`: physics model setting (Reality / Classic), intent from keyboard + gamepad + touch, event handling
  (scores, toasts, combos), shared bookkeeping (gates, tracks, replay frames, HUD, finish), rig drawn from the simulated
  board quaternion with tick interpolation, replay frames carry the quaternion and posture (`physics: 'reality-1'`).
- `lib/input.ts`: radial dead zone, response curve, sensitivity, fore-aft inversion for the standard gamepad layout.
- `lib/diagnostics.ts`: performance and hardware overlay.
- `lib/rider-rig.ts`: real-scale mode (`setBoard`) — rider scaled ×0.9, board rebuilt at the spec's length/waist,
  bindings at the spec's stance width, 13 grab targets with hand selection and torso posture.
- `lib/alpine.ts`: Cinematic preset.
- `app/page.tsx`, `app/globals.css`: settings for physics model, assist, stance, board, Cinematic preset, diagnostics,
  gamepad tuning; updated control references; board info in the garage; `?debug` hook for automated browser checks.

## 2. Measured results (this model, not real-world calibration)

| Check | Result |
| --- | --- |
| Loaded ollie on a 3° groomed slope at 8 m/s | 0.46 m board clearance, 0.49 s airtime |
| Unloaded tap | 0.05 m |
| Crouch held 2 s vs 0.4 s | 0.47 m vs 0.46 m (no stored "charge") |
| Prepared flat-ground spin (gentle slope) | 132° (mirrored ±132°), 142° with a grab |
| Shoulder input in the air only | −36°: a counter-twist bounded by the inertia share of the twist range; no net rotation |
| Yaw momentum in flight under shoulder torque + posture change | 0.03 % drift over 1 s |
| Flat ground, steering + shoulders + tuck + pressure for 8 s | slows from 8 to 3 m/s, never propelled |
| Speed check from 12 m/s, 8° | stops at 9.9 s (free run would be 14.4 m/s at 6 s) — too slow, see known issues |
| Controller carving, 6–16 m/s, steer 0–0.6 | board within 15° of travel |
| 0.8 m drop at 8 m/s aligned / 70° sideways | STOMPED / EDGE CATCH |
| All three mountains, 40 s each with a simple bot | finite, descends under gravity alone, every frame has a unit quaternion |
| Determinism | identical inputs → identical state (bit-identical) |
| Rig, all six boards | board length = spec ±1 cm, stance = spec ±5 mm, rider 1.72 m to the helmet top, feet in bindings |
| Grabs | 11 of 13 within 5 cm of the board, crail 7.7 cm, seatbelt 12 cm; arm segment lengths never change |
| Physics cost (Node, this container) | ≈18 µs per 960 Hz step, ≈0.2 ms per 120 Hz game tick (≈2 % of one core) |

## 3. Test and build status

| Command | Result |
| --- | --- |
| `npm test` | passes — `physics.mjs` and `motion.mjs` (v0.4, unchanged), `sim.mjs` (core), `reality.mjs` (new, 10 groups) |
| `npm run check` (`tsc --noEmit`) | passes |
| `npm run build` | passes (static export of `/`) |
| `npm run test:browser` | passes in headless Chromium with SwiftShader: game starts, Reality physics runs, quaternions recorded, diagnostics populated, **no console errors**. Screenshots in `docs/screenshots/`. |

## 4. Performance

Only CPU-side physics cost could be measured here. The browser runs used a software renderer (SwiftShader) in a 4-thread
container: 13–22 FPS at 1280×720 on the Balanced preset, 271–276 draw calls, 0.60 M triangles. These numbers say nothing
about a desktop GPU. On your PC, turn on Settings › Graphics › diagnostics and read FPS, 1 % lows, frame-time graph,
draw calls, triangles and physics ms per tick for each preset.

## 5. Not done in this pass

See `docs/REALITY_AUDIT_AND_PLAN.md` § 3 for the full matrix. The largest gaps: articulated rider (hips/torso/arms in the
physics), board flex, deformable snow with stored grooves and tracks, ragdoll falls, reliable big-kicker lines, rail
balance, contact-driven audio, and every rendering upgrade (WebGPU, TAA, SSAO, volumetrics, new vegetation and geology).
