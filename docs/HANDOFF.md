# Handoff

Last updated: end of milestone 5 (experiments and metrics), plus GitHub Pages preparation. Before that: M4 (adaptive controller, left-turn pockets), M3.2 (ring road).

## State
- M1-M5 done. 218 tests pass (160 before M5, 58 new). `npm run typecheck` and `npm run build` pass.
- `npm run dev` opens the 3D app (controller selector, demand, seed, circulating or arrivals mode, live detector panel).
- `npm run experiment` runs the paired experiment; results are in `docs/RESULTS.md`, `docs/SENSITIVITY.md` and `docs/results/runs.csv`.
- GitHub Pages is prepared but NOT live: `.github/workflows/deploy.yml` and a relative Vite base exist locally. The owner still has to push to `main`
  and set Settings -> Pages -> Source: GitHub Actions. Expected link: https://yatharthjorwal.github.io/TrafficSim/ (unverified until it is deployed).
  This session could only read the repository, so nothing was pushed or committed.
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
- Confirm the metric definitions in docs/SPEC.md as implemented (especially mean wait over all generated vehicles and "unserved at end" with no drain period).
- Push to `main` and enable Pages (see State) to get the live link; then check the 3D scene in a real browser.
- Whether M6 should run experiments inside the browser (needs a Web Worker, about 8 minutes for the full set today) or only display results produced by `npm run experiment`.

## Things to know about M5 (experiments and metrics)
- Everything lives in `src/experiments` (see ARCHITECTURE). Metrics follow SPEC exactly; **mean wait is over all generated vehicles**, including the
  entry backlog and vehicles still queued at the end. The old exited-only mean (the M4 preview) is kept in the report but labelled survivor-biased: on
  Uneven it said 62 s where the honest number for the same plan is 229 s.
- Experiments use `arrivals` mode only, build one schedule per (profile, seed), and check every controller saw it (checksum). Evaluation seeds are 1..n.
- Three fixed baselines, because a weak baseline flatters adaptive: the default 60 s plan, a Webster plan, and the best plan found by a search on separate tuning
  seeds (9001, 9002). The first Webster version was weak (60/50 s greens for 450 vs 100 veh/h) and made adaptive look about 200 veh/h better than it is on Uneven;
  that was found by comparing against the M4 preview and fixed (D40, D41).
- Verdicts are mechanical: "better" or "worse" only when the 95 % CI of the paired difference excludes zero (8 seeds).
- The adaptive defaults were not changed because of any result.

## Where the adaptive controller stands (`docs/RESULTS.md`: 8 seeds, 1800 s, identical schedules, mean wait over all generated vehicles)
| profile | default 60 s fixed | best fixed (searched) | adaptive | adaptive vs best fixed |
|---|---|---|---|---|
| light (480 veh/h) | 8.3 s | 4.8 s | 3.8 s | better on mean and longest wait, same throughput |
| balanced (1000) | 24.6 s | 19.6 s | 20.3 s | no clear difference |
| uneven (1100, N/S heavy) | 229 s | 43 s | 50 s | **no better; clears about 15 veh/h fewer (worse, 7 of 8 seeds)** |
| heavy (1600) | 253 s | 245 s | 251 s | no clear difference |
| shifting (1100, road changes at half time) | 170 s | 126 s | 57 s | **clearly better: -69 s mean wait, +154 veh/h, 8 of 8 seeds** |
Reading: adaptive clearly beats a mismatched fixed plan and wins outright when demand changes during the run. It does not beat a fixed plan that is tuned to
steady demand (Uneven: slightly behind), and it ties at balanced and heavy load. In light traffic it halves the wait. That is the expected shape. The one
profile built to favour adaptivity (shifting) is where it wins; do not describe it as better "in general".
Sensitivity (`docs/SENSITIVITY.md`, 4 seeds): most parameter changes make no clear difference. Longer minimum greens (20 s) hurt on Light, Uneven and Shifting.
maxWait 45 helped on Heavy. Nothing was retuned.
Safety: red entries, guard hits and overlaps were 0 in all 160 runs. The max-green watchdog fired in 17 of 40 adaptive runs (it ends a green the adaptive
controller deliberately rested while nobody else was waiting); fixed plans never reached it.

## Known issues / limitations
- Left turns use pockets (option A). Opposing left-turners are mutually exclusive (their paths cross in this compact box), so at an extreme 100 % lefts
  capacity is about 20 % lower than before; at the default 20 % lefts it is 8-9 % higher. Capacity is about 1000-1100 veh/h total.
- Rare dilemma-zone red entries are counted in `redLightEntries` (about 1 in 100 stress runs; 0 in all tests).
- Detector zone is 80 m by default. A queue longer than the zone is under-counted and flagged (`zoneOverflow`, shown as "≥"). In overloaded profiles the max queue is
  capped at about 13 vehicles for every controller, so use mean queue and waits there.
- The searched baseline is chosen on two tuning seeds, so its choice is somewhat noisy; Webster and the searched plan coincided on Light and Uneven.
- Profiles are calibrated to a capacity of about 1000-1100 veh/h measured under the default plan; adaptive capacity differs slightly.
- Vehicles scale in and out over 12 m at the arm ends; there are no entry/exit portals.
- The engine runs on the main thread (about 1800x real time headless). A Web Worker is deferred until it is needed.
- Scenery is procedural low-poly (generated in code). A Blender/GLB pipeline is optional and not started.

## Next steps (M6: dashboard)
1. Per-approach demand controls and a controller comparison view that can show `docs/results/runs.csv` or run a short experiment in the browser.
2. Metric cards and comparison charts (cleared/h, mean wait, queue, utilisation) with the spread, not only means.
3. Reproducibility panel (seed, config, schedule checksum, versions) and CSV/JSON export (the runner already produces both).
4. Time-series charts from detector data. If experiments move into the browser, run them in a Web Worker.
Stop at the end of M6 for approval.

## How to verify a fresh checkout
```
npm install
npm test
npm run typecheck
npm run build
npm run dev
```
