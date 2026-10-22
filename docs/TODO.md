# TODO

## M1 - Engine core (done)
- [x] Types, seeded RNG, config validation
- [x] Route geometry, conflict matrix
- [x] Arrival schedule (per-approach streams)
- [x] Engine: IDM, stop-line compliance, right of way, counting, diagnostics
- [x] Tests, headless script, 2D debug view

## M2 - Signal control foundation (done)
- [x] Phase definitions and validation
- [x] `SignalStateMachine` (min green, yellow, all-red, watchdog, invariant)
- [x] `SignalController` interface and `FixedTimeController`
- [x] `SimulationRunner` and tick order
- [x] Tests incl. hostile-controller safety test
- [x] Project docs and bundle tooling

## M3 - Detectors and 3D scene
- [ ] Detector zones: approaching, queue, avg/max wait, arrivals/departures, windowed demand estimate
- [ ] Observed vs estimated kept separate in types and UI
- [ ] Detector tests (counts, queue chain definition, events)
- [ ] R3F scene with placeholder meshes, signal heads, overview and close-up cameras
- [ ] Simulation loop outside React state; interpolation between steps
- [ ] Detector overlay and live measurements panel
- [ ] Decide left-turn approach (A or B) if it affects detector zones

## M4 - Adaptive controller and safety validation
- [ ] Rule-based adaptive controller (queue, approaching, waiting time, min/max green, max wait)
- [ ] Phase-compatibility checks, request validation tests
- [ ] Left-turn handling per owner decision (sneakers or protected lefts)
- [ ] Tests: no starvation, max-wait respected, never unsafe

## M5 - Experiments and metrics
- [ ] Metric calculators per SPEC (cleared/hour, mean wait, max queue, utilisation, time stopped)
- [ ] Demand profiles (light, balanced, uneven, heavy) calibrated to real capacity
- [ ] Paired runs on shared schedules, multiple seeds, spread reporting
- [ ] Metric tests with hand-computed cases

## M6 - Dashboard
- [ ] Controls, per-road counters, clock, metric cards, comparison charts
- [ ] Reproducibility panel (seed, config hash, versions), CSV/JSON export

## M7 - Blender assets and polish
- [ ] Environment and vehicle GLBs, optimisation, restrained visual design

## M8 - Optional local AI
- [ ] Structured I/O contract, validator, timeout/fallback, logging, evaluation vs baseline

## Backlog / ideas
- [ ] Dedicated left-turn lanes and protected phases (option B)
- [ ] Web Worker for the engine
- [ ] Vehicle size variation, time-varying demand
