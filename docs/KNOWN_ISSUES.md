# Known issues and limitations

## Simulation envelope

Sweep on a 12 degree groomed plane, all-mountain board, 2 s, worst angle between the board's long axis and its direction of travel
(measured after 0.5 s). The edge value is the commanded edge angle in radians.

| Start speed | edge 0.3 | edge 0.5 | edge 0.7 | edge 0.9 |
| --- | --- | --- | --- | --- |
| 6 m/s | < 1 deg | < 1 deg | < 1 deg | ~1 deg |
| 8 m/s | ~11 deg | < 1 deg | **spins out (~180 deg)** | ~5 deg |
| 10 m/s | **spins out (~130 deg)** | ~3 deg | ~4 deg | ~6 deg |
| 12 m/s | **spins out (~145 deg)** | ~3 deg | ~5 deg | **spins out (~140 deg)** |

Only the 6 m/s row and the 10 m/s edge 0.5-0.9 cells are guarded by tests. The other cells are known failures and the result is sensitive to
small parameter changes, so treat the whole high-speed region as unreliable until the rider's yaw control is modelled properly.

Why it happens: when the commanded edge angle is too small for the speed, the board's sidecut turns it faster than the rider can turn
the centre of mass, the tail washes out, and nothing in the model holds the board's yaw. Rider yaw inertia and a passive twist spring were added
and removed most of it; a real rider also steers actively with the hips and shoulders, which is not modelled.

## Not modelled yet

- **Rider balance.** The rider's lean is held by a stiff constraint on the board-normal axis. `balanceLoad` reports when a real rider's
  ankles could not hold that lean (values above 1) but nothing falls over because of it. An experimental balance reflex exists behind
  `cmd.balance` and is unstable; it is off by default.
- **Board flex and torsion.** Not modelled. The tilted-edge contact uses the imposed radius `sidecutRadius * cos(edge angle)` instead of a
  flex-derived curve.
- **Roll-in hop.** At the default maximum edge sweep rate of 3.5 rad/s, rolling from flat to edge 0.9 at 6 m/s on groomed snow makes the board
  leave the snow for about 77 ms and then land on its edge. At 2 rad/s and slower it stays on the snow (measured: 0 ms airborne).
- **Articulated rider.** The rider is a point mass on a telescoping leg; there is no torso, arms, head, IK or ragdoll in the new core.
- **Ollie, pop, grabs, air rotation control, rails and park features** in the new core.
- **Normal-damper budget.** `damperCap = 2` and `damperShareExp = 1` in `snowboard-sim.ts` are numerical-stability settings, not physical
  constants. Measured before the rider yaw coupling was added: with the cap at 0.5 the board bounced after the edge catch and spun out at 6 m/s, edge 0.9; a cap of 1 still did; caps of 2 and 4 carved
  cleanly. Rest stays exactly stable with sharing on (any cap tried); with sharing off, rest chatters at 480 Hz.
- **Peak landing force** hits the 4,200 N leg limit on a 1 m drop, so landings from that height end on the leg end-stop.

## Calibration and testing

- Snow friction, bearing, yield, damping, edge bite and plow values are estimates from typical ranges, **not** fitted to measurements.
- Board and rider values (stiffness, strength, yaw inertia, twist stiffness 400 N m/rad) are estimates.
- Nothing was run on a GPU or in a browser here. Rendering, frame rate and visual quality are untested.
- Nothing was measured on your PC; no specifications of your hardware are assumed anywhere in the code.
- `next build` was not run in this workspace.

## Legacy game

- The playable game still uses the v0.4 scalar-heading model, assisted landings and rail catches. Integration with `lib/sim` has not been done.
