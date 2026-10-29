# Handoff

Last updated: end of milestone 4 (adaptive controller + left-turn pockets), after M3.2 (ring road, persistent vehicles).

## State
- M1 engine core and M2 signal control: done and pushed. M3 detectors + 3D scene: done in this bundle.
- 160 tests pass. `npm run typecheck` and `npm run build` pass.
- `npm run dev` opens the 3D app: toolbar (play/pause/reset/speed, signal mode, cycle, demand, seed, detector toggle),
  3D viewport with Overview / Intersection / Top-down camera buttons, and a live side panel (clock, counters, signal
  state, detector measurements split into Observed / Estimated, safety counters).
- Headless: `npm run sim:headless -- 1 300 1800 60`.

## Visual verification
M3.1 was reviewed in a real headless Chromium (software WebGL) with screenshots of every camera, shadows on and off, plus the
headless scene-graph tests. Not verified: frame rate on a real GPU. If it feels slow, untick **Shadows** first, then **Pedestrians**.
Owner review is still the final word: report anything that looks off (colours, scale, camera framing) and it goes in the TODO fix list.

## Things to know about M3.2 (ring road and persistent vehicles)
- **Two traffic modes.** `circulating` is the UI default: a fixed fleet (Vehicles selector, up to 48) spawns at the four arm entries, drives out
  through an arm, round the one-way clockwise ring road and back in, forever. `arrivals` is the old open-boundary mode with Poisson arrivals.
  **Experiments (M5) must use `arrivals`** so both controllers see identical arrival schedules.
- Raising the fleet adds vehicles live at the four entries. Lowering it, changing mode or pressing Reset rebuilds the simulation.
- Safe fleet limit is 48 (clean over many seeds and signal timings; 52+ jams and overlaps). The engine has gridlock protection: gap-acceptance
  merging, no entering the box without room beyond it, and ring traffic skipping an arm whose queue has spilled back.
- In `circulating` mode `stats.exited` counts arm exits (legs), `stats.inserted` is the fleet, and `completed` has one record per leg.
- When the adaptive controller lands, run it through the circulating-mode sweeps too (fleet 20/40/48, several signal timings): short or
  extreme greens change how the ring and the arms interact.

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
- None blocking. M5 will need confirmation of the metric definitions in docs/SPEC.md.

## Where the adaptive controller stands (honest preview, `npm run sim:compare -- 1800 4`, identical schedules, means over 4 seeds)
| profile | controller | cleared/h | unserved | mean wait (exited) | worst wait |
|---|---|---|---|---|---|
| light (120/approach) | fixed 60 s | 441 | 5 | 7.6 s | 33 s |
| | adaptive | 443 | 4 | 3.5 s | 21 s |
| balanced (250) | fixed | 960 | 20 | 21.2 s | 118 s |
| | adaptive | 962 | 19 | 20.6 s | 113 s |
| uneven (N/S 450, E/W 100) | fixed 50/50 | 782 | 132 | 62.3 s | 185 s |
| | fixed, split tuned to demand | 995 | 26 | 22.8 s | 193 s |
| | adaptive | 970 | 38 | 27.7 s | 104 s |
| heavy (400) | fixed | 1077 | 248 | 91.6 s | 218 s |
| | adaptive | 1076 | 249 | 90.0 s | 180 s |
Reading: adaptive clearly beats a *mismatched* fixed plan and halves the wait when traffic is light, ties at balanced and heavy demand, and is slightly
**behind** a fixed plan tuned to the exact steady demand (but with a far better worst-case wait). That is the expected result: with steady, known demand a
tuned fixed plan is hard to beat. Caveats: "mean wait" here is over vehicles that exited only (survivor bias; M5 fixes this), 4 seeds, no parameter tuning yet.
The case where adaptive should win outright is demand that changes over time; M5 should include such a profile.

## Known issues / limitations
- Left turns use pockets (option A). Opposing left-turners are mutually exclusive (their paths cross in this compact box), so at an extreme 100 % lefts
  capacity is about 20 % lower than before; at the default 20 % lefts it is 8-9 % higher. Capacity is about 1000-1100 veh/h total.
- Rare dilemma-zone red entries are counted in `redLightEntries` (about 1 in 100 stress runs; 0 in all tests).
- Detector zone is 80 m by default. A queue longer than the zone is under-counted and flagged (`zoneOverflow`, shown as "≥").
- Vehicles scale in and out over 12 m at the arm ends; there are no entry/exit portals.
- The engine runs on the main thread (about 1800x real time headless). A Web Worker is deferred until it is needed.
- Scenery is procedural low-poly (generated in code). A Blender/GLB pipeline is optional and not started.

## Next steps (M5: experiments and metrics)
1. Confirm the metric definitions in docs/SPEC.md (cleared/hour, mean wait over *all* generated vehicles including backlog, max queue, utilisation).
2. Experiment runner: paired runs on shared schedules, demand profiles (light, balanced, uneven, heavy, plus a shifting profile), several seeds, spread reporting.
3. Baselines: default fixed plan and a demand-tuned fixed plan. Adaptive parameter sensitivity.
4. Tests with hand-computed metric cases. Promote `scripts/compare.ts` into the framework and delete the preview.

## How to verify a fresh checkout
```
npm install
npm test
npm run typecheck
npm run dev
```
