# Known issues, limitations and bugs (0.5)

Everything below was observed in this workspace with the automated tests and the scripts in `tools/`. Nothing has been
measured on a real GPU or on your PC.

## Reality physics — riding

| Issue | Detail | Where to look |
| --- | --- | --- |
| **Stops are slow and wide** | Holding S from 12 m/s on an 8° slope stops after about 7–10 s, having turned 20–40 m across the hill. A real hockey stop takes 2–3 s. The rider's body and board share one yaw degree of freedom, so the board can only rotate about half the hip/shoulder twist range under the body; the rest must come from the snow. A real rider rotates the board ~90° under a counter-rotated torso. Needs an articulated hip/torso joint. | `tools/brake.mjs`, `RiderController` braking block |
| ~~Full-lock carves at ≥ 16 m/s wash out~~ (resolved by 1.2) | Full lock at 16–22 m/s on 6–25° slopes now holds within 4° of travel for 6 s; `tests/reality.mjs` covers 16, 20 and 22 m/s. | `tests/reality.mjs` |
| **Partial edges at speed** | A partly engaged edge (≈0.1–0.28 rad) above ~11 m/s spins out in the core model; the controller passes through that band at speed (flat glide or a committed edge). | `edgeForSteer`, `tools/edgemap3.mjs` |
| **High-speed kicker approaches** | On Northline's medium kicker, straight approaches above about 16 m/s can still wash out in the concave transition, and landings on the runout at 10–18 m/s frequently end in a slide that is declared SPUN OUT. Lower-speed straight airs land on the table and are classified HEAVY / HAND DRAG (undershooting, physically consistent). Clean, repeatable kicker lines are not yet reliable. | `tools/kicker.mjs` |
| **Flat-ground spins** | A wound-up flat ollie rotates about 115–125° (measured), so a clean flat 180 is not achievable; the tutorial's spin step asks for 90°. | `lib/tutorial.ts` |
| **Spins on steep pitches** | Prepared flat-ground spins reach about 130° on a gentle (3°) slope. On the 15° course pitches the shoulders' wind-up can make the board slide before the pop; takeoffs then rotate less and often land under-rotated (edge catch). A flat 180 lands slightly short, as in real riding, but a clean flat 360 is not achievable. | `tests/reality.mjs`, `tools/keyseq.mjs` |
| **Inversions** | Flips and corks are recognised and named from measured rotation, but generating inverted rotation at takeoff (rodeo/cork set-ups) is not modelled beyond a fore-aft COM throw, so they practically do not occur. | `lib/sim/freestyle.ts` |
| **Angular momentum in pitch/roll** | Yaw momentum is conserved in flight (0.03 % drift in the test). In pitch/roll there is still a leak of a few N·m·s per second of flight, mostly from the ankle roll actuator: the rider's leg axis is fixed to the board in roll, so rolling the board drags the centre of mass. Fix: let the rider's lean (angulation) be independent of the board's edge angle. | `tools/angmom.mjs`, `tools/angmom2.mjs` |
| **Landing peak forces** | With the ankle-moment reaction enabled, a 1 m flat drop reaches the leg end stop (≈9.6 kN peak in `tests/sim.mjs`). Landing classification uses leg force and leg bottoming, so flat drops tend to read HEAVY. | `legMomentReaction` in `snowboard-sim.ts` |
| **Crashes are not a ragdoll** | A crash freezes the simulation and slides the body as a single point with Coulomb friction (μ 0.45). Since 1.2 the body tumbles visually while it slides fast (log-roll, or a somersault after a nose dive) with arms thrown out, and settles on its back or front; it is animation, not physics. Then the rider stands up pointing down the fall line. | `lib/reality-ride.ts`, `lib/snow-game.ts` |
| **Board flex and torsion** | Still not modelled (values exist in `BoardSpec`). Sidecut uses `R·cos(edge)`. | |
| **Snow deformation** | Contact does not deform or remember the snow surface. Groove following is a per-step rule (trailing half of the edge gets extra hold while the board tracks), not a stored groove. Tracks and spray still come from the v0.4 visual systems. | |
| **Rail balance** | Rails and boxes are solid low-friction surfaces, but the rider has no balance strategy on them, so long slides tend to slip off. Rail tricks are recognised (50-50 vs boardslide) only from board orientation. | `lib/sim/course-terrain.ts` |
| **Calibration** | All snow, rider and board parameters are estimates (marked in the code). `yawInertia` was lowered from 4 to 2.6 kg·m² and `maxUpperTorque` set to 210 N·m in this pass to match typical human ranges; neither is measured. | `lib/sim/boards.ts`, `lib/sim/snow.ts` |

## Rider and equipment

- Crail grab reaches within 7.7 cm and seatbelt within 12 cm of the board; the arm IK refuses to stretch, so the hand stops
  short. The other 11 grabs reach within 5 cm.
- The rig is the v0.4 procedural rider scaled by 0.9 (1.72 m to the helmet top, about 1.75 m in boots). It is not a
  scanned or sculpted human; face, hands and clothing are procedural. Cloth secondary motion is the v0.4 approximation.
- Binding angles are fixed (+9° / −17°), not taken from the board spec.
- In Classic mode the board is drawn at the selected real size, but Classic physics still uses its own v0.4 model.

## Rendering, audio and platform

- Never run on a real GPU here. The only browser runs used SwiftShader in a container (13–22 FPS at 1280×720 Balanced),
  which says nothing about performance on your PC. Use the diagnostics overlay (Settings › Graphics) on your machine.
- The Cinematic preset uses an 8192² shadow map (~256 MB) and very dense terrain; it may be slow on any hardware.
- No WebGPU renderer, no ray tracing, no TAA/SSAO/volumetrics beyond v0.4 (MSAA, tone mapping, fog, shadow maps).
- Audio is still the v0.4 synthesised noise and tones; it does not follow contact forces yet.
- Diagnostics report CPU-side frame time; GPU time is not measured (no timer queries).

## Replays

- Reality replays interpolate recorded state; they do not re-simulate, so changing physics never corrupts them. Replays
  record `physics: 'reality-1'` or `'classic-0.4'`. Classic replays recorded on v0.4 still play.

## Classic mode

Unchanged from v0.4 apart from the real-size board drawing: scalar heading model, assisted landings and automatic rail
catches as documented in `docs/REALITY_AUDIT_AND_PLAN.md`.
