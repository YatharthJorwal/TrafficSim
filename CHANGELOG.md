# Changelog

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
