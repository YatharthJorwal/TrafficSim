# Changelog

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
