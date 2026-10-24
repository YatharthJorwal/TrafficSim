# Handoff

Last updated: end of milestone 3 + visual polish (M3.1).

## State
- M1 engine core and M2 signal control: done and pushed. M3 detectors + 3D scene: done in this bundle.
- 115 tests pass. `npm run typecheck` and `npm run build` pass.
- `npm run dev` opens the 3D app: toolbar (play/pause/reset/speed, signal mode, cycle, demand, seed, detector toggle),
  3D viewport with Overview / Intersection / Top-down camera buttons, and a live side panel (clock, counters, signal
  state, detector measurements split into Observed / Estimated, safety counters).
- Headless: `npm run sim:headless -- 1 300 1800 60`.

## Visual verification
M3.1 was reviewed in a real headless Chromium (software WebGL) with screenshots of every camera, shadows on and off, plus the
headless scene-graph tests. Not verified: frame rate on a real GPU. If it feels slow, untick **Shadows** first, then **Pedestrians**.
Owner review is still the final word: report anything that looks off (colours, scale, camera framing) and it goes in the TODO fix list.

## Things to know about M3.1
- The stop line is now 9.5 m from the centre (was 6 m) to make room for crosswalks. Engine results shift slightly (about 4 % lower capacity).
- Pedestrians are cosmetic. They cross only on the right phase and only when no car could arrive first, so crossings thin out in
  heavy traffic (about 12 per 15 min at 150 veh/h, a handful at 300+). They stroll the pavements the rest of the time.
- `window.__trafficSim` and `window.__r3f` are debug hooks for screenshot tooling. Nothing reads them.

## What exists
- `src/sim`        engine, network, schedule, config, rng, `observe()` read-only vehicle view.
- `src/detectors`  `DetectorSystem`: per-approach zones, observed and estimated measurements, event log, peaks.
- `src/control`    phases, `SignalStateMachine`, `FixedTimeController`, `planFromCycle`.
- `src/runtime`    `SimulationRunner` (engine + detectors + machine + controller), `FixedStepLoop` (accumulator, interpolation buffers), `interpolateVehicles`.
- `src/ambient`    `PedestrianCrowd` (cosmetic), shared street layout constants.
- `src/render`     R3F scene: Environment (Terrain, Roads, city, Trees, Lamps), Vehicles (4 types, instanced), Pedestrians, SignalHeads, PedSignals, DetectorZones, Sky, CameraRig, SimDriver, Viewport; `scenery/` and `models/` generators.
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
- Vehicles scale in and out over 12 m at the arm ends; there are no entry/exit portals.
- The engine runs on the main thread (about 1800x real time headless). A Web Worker is deferred until it is needed.
- Scenery is procedural low-poly (generated in code). A Blender/GLB pipeline is optional and not started.

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
