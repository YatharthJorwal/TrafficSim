# TODO

## M1 - Engine core (done)
- [x] Types, seeded RNG, config validation
- [x] Route geometry, conflict matrix
- [x] Arrival schedule (per-approach streams)
- [x] Engine: IDM, stop-line compliance, right of way, counting, diagnostics
- [x] Tests, headless script, debug view

## M2 - Signal control foundation (done)
- [x] Phase definitions and validation
- [x] `SignalStateMachine` (min green, yellow, all-red, watchdog, invariant)
- [x] `SignalController` interface and `FixedTimeController`
- [x] `SimulationRunner` and tick order
- [x] Tests incl. hostile-controller safety test
- [x] Project docs and bundle tooling

## M3 - Detectors and 3D scene (done, scene not yet seen by eye)
- [x] Detector zones: approaching, queue, avg/max wait, arrivals/departures, windowed demand estimate
- [x] Observed vs estimated kept separate in types and UI
- [x] Detector tests (counts, queue chain definition, events, engine cross-checks)
- [x] R3F scene: environment, instanced vehicles, signal heads, stop lines, overview / close-up / top-down cameras
- [x] Simulation loop outside React state (`FixedStepLoop`) with interpolation between steps
- [x] Detector overlay in 3D and live measurements panel
- [x] Headless scene-graph tests
- [ ] Owner visual review of the scene (fix list goes here)

## M3.1 - Visual polish (done)
- [x] Sky, clouds, terrain, trees, city blocks with windows/awnings/rooftops, park, pavements, lamps
- [x] Road markings and zebra crosswalks; pedestrian signals
- [x] Four vehicle types with brake lights and indicators; fade in/out at arm ends
- [x] Cosmetic pedestrians with phase-aware crossing and car-gap checks
- [x] Street camera, shadows toggle, pedestrians toggle
- [x] Tests (geometry, models, crowd safety, scene graph) and screenshots reviewed in a headless browser
- [ ] Owner visual review (fix list goes here)

## M3.2 - Ring road and persistent vehicles (done)
- [x] Ring road, slip roads, wall, chevrons, lamps; arms end at the ring
- [x] City blocks out to the ring, two parks
- [x] Circulating mode with a configurable fleet and live additions
- [x] Merge gap acceptance, no box blocking, arm skipping, per-vehicle route streams
- [x] Tests across seeds and signal timings
- [ ] Owner review (fix list goes here)

## M4 - Adaptive controller and safety validation
- [ ] Left-turn handling per owner decision (A sneakers / B protected lefts)
- [ ] Rule-based adaptive controller (queue, approaching, waiting time, min/max green, max wait)
- [ ] Phase-compatibility checks, request validation tests
- [ ] Tests: no starvation, max-wait respected, never unsafe
- [ ] Controller selector in the UI

## M5 - Experiments and metrics
- [ ] Metric calculators per SPEC (cleared/hour, mean wait, max queue, utilisation, time stopped)
- [ ] Demand profiles (light, balanced, uneven, heavy) calibrated to real capacity
- [ ] Paired runs on shared schedules, multiple seeds, spread reporting
- [ ] Metric tests with hand-computed cases

## M6 - Dashboard
- [ ] Per-approach demand controls, metric cards, comparison charts
- [ ] Reproducibility panel (seed, config hash, versions), CSV/JSON export
- [ ] Time-series charts from detector data

## M7 - Blender assets and polish
- [ ] Optional: Blender/GLB replacements for the procedural models (only if wanted)
- [ ] Entry/exit portals (currently vehicles scale in/out)

## M8 - Optional local AI
- [ ] Structured I/O contract, validator, timeout/fallback, logging, evaluation vs baseline

## Backlog / ideas
- [ ] Dedicated left-turn lanes and protected phases (option B)
- [ ] Raise the fleet limit (two ring lanes or a larger ring)
- [ ] Run the adaptive controller through the circulating-mode safety sweeps (fleet 20/40/48, several signal timings)
- [ ] Web Worker for the engine
- [ ] Vehicle size variation, time-varying demand
- [ ] Longer detector zone option in the UI
- [ ] Make cars yield to pedestrians in the sim (would change results; needs a decision)
- [ ] Check pedestrian crossing time against the adaptive controller's min green (crowd assumes crossing finishes by 11.7 s)
