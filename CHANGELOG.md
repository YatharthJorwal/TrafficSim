# Changelog

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
