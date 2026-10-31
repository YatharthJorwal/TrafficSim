# Changelog

## M5 - experiments and metrics (and GitHub Pages preparation)
- **`src/experiments`**: paired experiment framework. Demand profiles (light, balanced, uneven, heavy, plus **shifting**, where the dominant road changes at
  half time), a schedule builder (constant profiles reproduce `generateSchedule` exactly), baselines, runner, statistics, Markdown/CSV reports.
- **Metrics per SPEC:** cleared per hour, mean / 95th percentile / longest wait over **all generated vehicles** (entry backlog and unfinished vehicles included),
  max and mean detector queue, per-phase green utilisation, time stopped. New read-only `engine.ledger()` supplies the per-vehicle waits; the old exited-only mean is
  still reported, labelled survivor-biased.
- **Baselines:** default 60 s plan, Webster plan (saturation flow measured in this simulator: `--calibrate`), and the best plan searched on separate tuning seeds.
  An earlier Webster allocation starved the busy road (found by comparing with the M4 preview) and was corrected before any result was recorded.
- **Statistics:** mean, sd, 95 % CI (Student t), paired differences per seed, better/tied/worse counts, and a verdict only when the interval excludes zero.
- `npm run experiment` (options in `scripts/experiment.ts`), `--sensitivity` sweep of the adaptive parameters. `scripts/compare.ts` and `sim:compare` removed.
- Results: `docs/RESULTS.md`, `docs/SENSITIVITY.md`, `docs/results/runs.csv`. Headline: adaptive wins clearly on shifting demand and in light traffic, ties at balanced and
  heavy load, and does not beat a fixed plan tuned to steady uneven demand.
- **GitHub Pages:** relative Vite base, `.github/workflows/deploy.yml` (test, build, deploy on push to `main`), README link. Needs the push and Settings -> Pages -> GitHub Actions.
- Tests: 218 (58 new: hand-computed metric cases, schedules, Webster plans, tuning, paired runs, safety under every controller, saturation-flow guard).

## M4 - adaptive controller and left-turn pockets
- **Left-turn pockets (option A):** a left-turner may pull 2.5 m into the box, clear of the oncoming through lane, and wait there for a gap. At the
  end of green the oncoming cars that can stop do so and the waiting left-turner clears the box ("sneakers"). One left-turner per oncoming pair
  at a time; the waiting car has no priority over oncoming traffic; followers wait until it has swung clear (new per-route-pair divergence points).
  About 8-9 % more capacity at 20 % lefts; at an extreme 100 % lefts capacity is about 20 % lower (one at a time).
- **`AdaptiveController`:** transparent rule-based controller behind the existing `SignalController` interface. Reads detector measurements
  (observed values only) and requests phases; the state machine stays the safety gate. Rules: max wait, no demand, max green, gap-out, pressure ratio.
  Greens last 12-50 s (12 s keeps the pedestrian crossing window intact). Every switch is logged with its reason and shown in the panel.
- UI: Controller selector (Adaptive is the default), Cycle shown for fixed-time only.
- `npm run sim:compare`: quick fixed vs adaptive preview on identical schedules (replaced by `npm run experiment` in M5).
- Tests: 160 (17 new adaptive tests: rule by rule on synthetic measurements, plus limits, safety, fairness, determinism, circulating mode).

## M3.2 - ring road and persistent vehicles
- A square one-way ring road (clockwise, rounded corners) encloses the city; every arm now ends in a T-junction with it
  (right-turn slip roads in and out). Perimeter wall, direction chevrons, lamps and a tree line outside.
- City blocks grown to fill the space out to the ring (about 40 buildings, 2 parks, 2000+ windows); heights fall away from the centre.
- New **circulating** traffic mode (default in the UI): a fixed fleet spawns at the four arm entries, leaves through an arm, drives
  round the ring and re-enters. Nothing ever disappears, so there is no poof. The Poisson **arrivals** mode is unchanged and is
  still the mode experiments use.
- Fleet is configurable (1-48). Raising it adds vehicles live at the four entries; lowering it restarts with the new number.
- Engine: route legs (main <-> ring connectors), ring-lane leaders, merge gap acceptance, "don't block the box", skipping an arm whose
  entry queue has spilled back to the ring, per-vehicle route streams (identical for every controller), `addVehicles`, generic overlap
  diagnostic over the whole network.
- Rendering: persistent vehicles never fade out, smooth hand-over between routes, right-turn indicators on the slip roads.
- Tests: 143 (28 new): ring geometry and scenery, fleet schedule, persistence, safety on the ring over many seeds and signal timings,
  determinism and fairness, live additions, UI factory.

## M3.1 - visual polish and ambient life
- Scene rebuilt as a procedural low-poly city: sky with drifting clouds, faceted terrain with hills, trees, four city blocks of
  towers / mid-rises / shops (windows, awnings, rooftop plant, antennas) and a park, pavements and curbs, lamps, double-yellow
  centre lines, edge lines and zebra crosswalks. Real-time shadows (toggle).
- Four vehicle types (sedan, hatchback, SUV, van) with glass, wheels and trim, tinted bodies, brake lights and blinking indicators.
  Vehicles grow in and shrink out at the arm ends instead of popping.
- Cosmetic pedestrians (`src/ambient`): low-poly walkers on a sidewalk graph that cross only on the right phase and when no car
  could arrive, plus pedestrian signal heads at every crosswalk.
- New Street camera, Overview reframed; Pedestrians and Shadows toggles.
- ENGINE: the stop line moved from 6 m to 9.5 m so a crosswalk fits between it and the box (capacity about 4 % lower).
- `FixedStepLoop`: `onStep` / `onReset` listeners, `fastForward`; runner shares one observation per tick (`lastObservations`).
- 115 tests (33 new): scenery geometry, vehicle models, crowd safety (never crosses on the wrong phase, never overlaps a car in 900 s),
  interpolation extras, richer headless scene-graph tests. Visuals reviewed in a real headless browser (software GL).

## M3 - detectors and 3D scene
- Added `src/detectors`: per-approach zones with observed measurements, derived demand estimate, arrival/departure events, totals and peaks.
- Engine `observe()`; runner now owns a `DetectorSystem` and feeds `Measurements` to controllers every tick.
- Added `FixedStepLoop` and `interpolateVehicles` (frame-rate independent stepping, smooth rendering between steps).
- Added `src/render`: R3F scene with environment, instanced vehicles, signal heads, glowing stop lines, detector overlay, camera presets.
- New UI: toolbar, camera buttons and live side panel (signals, observed vs estimated measurements, counters, safety counters).
- 82 tests (32 new): detectors, loop/interpolation, headless 3D scene graph.

## M2 - signal control foundation
- Added `src/control`: phase definitions, timing validation, `SignalStateMachine` (min green, yellow, all-red,
  max-green watchdog, conflict invariant), `FixedTimeController`, `planFromCycle`.
- Added `src/runtime`: `SimulationRunner` wiring engine + machine + controller in a fixed tick order, with a flagged debug override.
- Debug view now runs the real fixed-time controller and shows phase / stage / timing.
- Added bundle tooling (`npm run apply`) and project docs (CLAUDE.md, docs/*).
- 50 tests (23 engine, 20 control, 7 runner).

## M1 - simulation engine core
- Deterministic fixed-step engine, seeded arrival schedule, IDM car-following, route geometry and conflict matrix,
  right-of-way logic, stop-line compliance, counting, diagnostics, headless runner, 2D debug view. 23 tests.
