# Handoff

Last updated: end of milestone 3.

## State
- M1 engine core and M2 signal control: done and pushed. M3 detectors + 3D scene: done in this bundle.
- 82 tests pass. `npm run typecheck` and `npm run build` pass.
- `npm run dev` opens the 3D app: toolbar (play/pause/reset/speed, signal mode, cycle, demand, seed, detector toggle),
  3D viewport with Overview / Intersection / Top-down camera buttons, and a live side panel (clock, counters, signal
  state, detector measurements split into Observed / Estimated, safety counters).
- Headless: `npm run sim:headless -- 1 300 1800 60`.

## IMPORTANT: what was and was not verified visually
The 3D scene could not be opened in a browser by the author of this milestone (no browser in the build sandbox).
It is covered by typecheck, a production build, and 8 headless scene-graph tests (objects exist, instance count and
positions match the interpolated sim state, vehicles point along their direction of travel, signal lights and stop lines
match the engine's signal state, signal heads face their traffic, queue overlays match detector measurements, pause stops the sim).
Looks, scale, colours, lighting and camera framing are therefore **unverified by eye**. First thing next session: the
owner reports what looks wrong (camera framing, buildings, vehicle size, lights too dim/bright, anything odd), and we fix it.

## What exists
- `src/sim`        engine, network, schedule, config, rng, `observe()` read-only vehicle view.
- `src/detectors`  `DetectorSystem`: per-approach zones, observed and estimated measurements, event log, peaks.
- `src/control`    phases, `SignalStateMachine`, `FixedTimeController`, `planFromCycle`.
- `src/runtime`    `SimulationRunner` (engine + detectors + machine + controller), `FixedStepLoop` (accumulator, interpolation buffers), `interpolateVehicles`.
- `src/render`     R3F scene: Environment, Vehicles (instanced), SignalHeads, DetectorZones, CameraRig, SimDriver, Viewport.
- `src/ui`         App (toolbar + layout), Hud (live panel), simFactory.
- `tools/apply-bundle.mjs`  applies bundles (`npm run apply -- <zip>`).

## Decisions waiting on the owner
- **Left turns (blocks M4 realism):** A = keep the shared lane and add end-of-green "sneakers" (needs an in-box waiting pocket);
  B = dedicated left-turn lane with protected left phases. Still not chosen. M4 needs this before the adaptive controller is tuned.

## Known issues / limitations
- Opposing left-turn paths overlap in this compact box, so they are mutually exclusive. With a shared lane, a
  left-turner at the head can block its queue for a whole green when the opposing flow is saturated. Capacity is about
  1000 veh/h total with 20 % lefts under a 60 s cycle.
- Rare dilemma-zone red entries are counted in `redLightEntries` (about 1 in 100 stress runs; 0 in all tests).
- Detector zone is 80 m by default. A queue longer than the zone is under-counted and flagged (`zoneOverflow`, shown as "≥").
- Vehicles spawn at 100 m and fade in through fog; there are no entry/exit portals yet.
- The engine runs on the main thread (about 1800x real time headless). A Web Worker is deferred until it is needed.
- Environment is placeholder scenery (boxes). Blender assets come in M7.

## Next steps (M4)
1. Get the left-turn decision (A or B) and implement it first, since it changes capacity and phases.
2. Rule-based `AdaptiveController` behind `SignalController`, using `Measurements`: queue, approaching count, accumulated
   wait, min/max green, max permissible wait, phase compatibility. Requests only; the machine stays the safety gate.
3. Tests: never unsafe, no starvation, max-wait respected, deterministic, falls back sensibly when measurements are zero.
4. Add the adaptive controller to the UI selector.

## How to verify a fresh checkout
```
npm install
npm test
npm run typecheck
npm run dev
```
