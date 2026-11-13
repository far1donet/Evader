# Development tools

Exploration and sweep scripts used while tuning Reality physics. Run from the project root with
`node --experimental-strip-types tools/<script>.mjs`. They print measurements; they are not tests (see `tests/`).

| Script | Measures |
| --- | --- |
| `bench.mjs` | Controller carving sweep on a plane (speed x steer x assist) |
| `edgemap*.mjs` | Worst slip angle over speed x edge angle (spin-out map) |
| `pop.mjs` | Ollie / nollie clearance, airtime, prepared spins |
| `brake.mjs`, `braketrace.mjs` | Speed check: time and distance to stop, phase trace |
| `kicker.mjs`, `k2-4.mjs`, `kicktrace.mjs`, `profile.mjs` | Kicker flights, ramp traces, snow yaw torque, terrain profile |
| `angmom.mjs`, `angmom2.mjs` | Angular momentum drift in flight and its sources |
| `gamebot.mjs`, `botrun.mjs`, `bottrace.mjs`, `flights.mjs`, `keyseq*.mjs` | Headless game runs with bots or key sequences |
| `pivot*.mjs`, `spintrace.mjs`, `trace.mjs` | Yaw/pivot investigations |
| `rigcheck.mjs`, `measure-rig.mjs` | Rider scale, board size, grab reach |
| `explore.mjs` | Full-course ride with step cost and terrain evaluations |
| `browser-check.mjs` | Headless Chromium smoke test (`npm run test:browser`, needs Playwright and `npm start`) |
