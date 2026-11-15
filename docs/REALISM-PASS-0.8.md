# Realism pass (EVADER 0.8): what was studied and what changed

## Reference

I studied a 12-minute gameplay recording of a commercial snowboarding game (426×240, 30 fps):
- one frame every 10 s for an overview;
- 6 fps sequences of a powder descent, a cliff jump with a double cork, groomed carving into a nose press and a hard skid stop, and a rail-to-jump line.

The recording was used only as a reference for **how real riding and snow behave and look**. EVADER does not take that game's characters, brands, art, levels, missions or interface.

## What was observed → what changed

| # | Observation | Change in EVADER | Where |
| --- | --- | --- | --- |
| 1 | **Carving at 45–60 km/h** (2:20, 8:20, 9:00–9:03). The knees bend deeply as the edge angle rises. The hips drop toward the snow on the inside of the turn while the chest stays nearer level than the board (angulation, not a straight lean of the whole body). | Physics: the controller flexes the legs further with edge angle and speed (lower centre of mass). Rig: crouch also driven by lateral g (speed × yaw rate, from the simulation). Hips shift further to the inside, and the chest counter-tilts to the outside. | `lib/sim/rider-controller.ts`, `lib/rider-rig.ts` |
| 2 | **Arms while carving.** The front hand leads forward over the nose at waist–chest height. The rear hand stays low by the back knee. In the hardest carves the inside hand reaches down to the snow. | Rig choreography, weighted by lateral g. The inside hand reaches toward the snow above about 0.8 g at speed. | `lib/rider-rig.ts` |
| 3 | **Head.** The rider looks into the coming turn. | Head yaw follows the turn's inside. | `lib/rider-rig.ts` |
| 4 | **Powder** (8:00–8:04). The rider sits back, weight on the tail so the nose planes up, rides deeper in the legs, and the lower legs disappear into the snow dust. | Physics: the snow's softness is read from the bearing stiffness of the material under the board. In soft snow the controller moves pressure about 5.5 cm toward the tail and flexes deeper (tested against groomed). Rig: the pelvis and chest sit back. | `lib/sim/rider-controller.ts`, `lib/rider-rig.ts`, `tests/reality.mjs` |
| 5 | **Board flex** on presses (9:00–9:03 nose press) and hard landings. | The board mesh bends: the unweighted end rises up to about 8.5 cm on a press, and both ends rise on a landing. | `lib/rider-rig.ts` (`flexBoard`) |
| 6 | **Spray.** Large clouds of snow dust that hang in the air for 1–2.5 s. In powder a rooster tail rises to about rider height. A hard skid stop throws a wall of snow (9:36–9:38). Thrown snow stays where it was thrown; it doesn't travel with the rider. Spray glows when seen toward the sun. | Snow-dust clouds 0.2–1.5 m that grow and hang 0.7–2.5 s, with less gravity and larger budgets. Skid walls throw snow sideways and up. Forward velocity cut to 5–22% of rider speed. The shader adds forward scattering toward the sun and blue self-shadowing underneath. Emission now reaches full strength by 12 m/s; before, it scaled to 24 m/s and was faint at normal speeds. | `lib/powder-spray.ts` |
| 7 | **Powder trenches.** The track is wider than the board, shaded blue inside, with bright raised lips. | Wider trench in powder, blue-shaded core, raised bright lips. | `lib/board-tracks.ts` |
| 8 | **Groomed corduroy** (9:50). Fine ridges along the fall line, groomer-pass seams, and snow sparkling in the sun. | About 4.5 cm tiller ridges in 4.2 m groomer passes with seam ridges, faded before they can alias. View-dependent ice-crystal glints that twinkle as the camera moves. | `lib/alpine.ts` (`snowMaterial`) |
| 9 | **Light.** High-key sunlight; shadows filled by the blue sky; a strong sun glow; deep blue sky with scattered cloud. | Sun intensity 2.7 → 3.1; blue sky fill (hemisphere light 0xaecbff); exposure 1.02 → 1.15; softer shadow edges; a broader sun halo; fewer clouds and a deeper zenith blue on clear days; clearer air at altitude. | `lib/snow-game.ts`, `lib/alpine.ts` |
| 10 | **Sea of cloud** filling the valleys below the peaks (4:30, 8:00). | On the real Verbier terrain in clear weather: a soft cloud layer with its top at 1,250 m (a winter temperature inversion), below the lowest lift station. It is atmosphere only; nothing collides with it. | `lib/verbier/cloud-sea.ts` |
| 11 | **Camera.** A low, close chase camera at about shoulder height. | Chase height 2.22 → 2.0 m, distance 5.4 → 5.0 m. | `lib/snow-game.ts` |

## Not taken

- **Things that would copy that game:** its characters and voices, brand-name gear, missions, menus, HUD and unlock screens, its fictional maps (factory town, dam spillway), urban rails and winches, snowmobiles.
- **Effects that need more than this renderer has:** volumetric clouds and true deformable-snow trenches (the trench is shading on the surface, not a cut in the terrain mesh), cloth simulation, and motion-captured animation. EVADER's rider is posed procedurally from the physics, with springs and IK.

## Verification

- `npm test` passes, including:
  - a new **powder-stance** test: powder gives −5.5 cm of tail pressure and a 0.42 crouch, against 0 cm and 0.30 on groomed snow;
  - the existing **carving** test (controller stays within 15° of travel), the **ollie** test and the **landing** tests;
  - the **flat-ground** test: no propulsion without input.
- The spray test now allows thrown snow to hang up to 2.5 s; an airborne rider still emits nothing new.
- Screenshots after the change, from scripted rides on the real terrain, are in `docs/screenshots/realism/`:
  - a carve and a heelside skid on Attelas;
  - powder on Chassoure → Tortin.
