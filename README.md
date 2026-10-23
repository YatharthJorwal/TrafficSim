# Adaptive Urban Traffic Flow Simulation Platform

Browser-based simulation of one four-way intersection comparing fixed-time and adaptive signal control.

**Status: milestone 3 of 8 done - engine, signal control, virtual detectors and a live 3D view.**
The adaptive controller, experiments, comparison dashboard, Blender assets and AI extension come in later milestones.
Start with `CLAUDE.md` and `docs/HANDOFF.md`; the plan is in `docs/TODO.md`.

## Run

```bash
npm install
npm test               # 82 tests
npm run sim:headless -- 1 300 1800 60   # seed, veh/h/approach, seconds, cycle seconds
npm run dev            # 3D app with live detector panel
npm run apply -- <bundle.zip>   # apply a delivered bundle (see docs/BUNDLES.md)
```

## Layout

```
src/sim/       pure TypeScript engine (no React / Three.js imports)
  types.ts       shared types          config.ts    defaults + validation (ConfigError)
  rng.ts         seeded PRNG           schedule.ts  arrival schedule from config + seed
  network.ts     lanes, routes, conflict matrix     engine.ts  fixed-step simulation
  collision.ts   body-overlap diagnostic            debugSignals.ts  engine test fixture
src/detectors/ virtual detector zones, observed and estimated measurements
src/control/   phases, SignalStateMachine, controllers (fixed-time now, adaptive in M4)
src/runtime/   SimulationRunner, FixedStepLoop, interpolation
src/render/    React Three Fiber scene (reads the loop, never writes sim state)
src/ui/        toolbar and live panel
scripts/       headless runner
tools/         apply-bundle.mjs
docs/          SPEC, ARCHITECTURE, RULES, DECISIONS, HANDOFF, TODO, BUNDLES
```

## Model summary

- World: metres, +x east, +y north, right-hand traffic, one lane per direction per arm, arms 100 m long,
  intersection box 10 m x 10 m, stop lines 6 m from centre. Twelve routes (4 approaches x left/straight/right).
- Time: fixed step (default 0.05 s). `time = steps * dt`, so results do not depend on frame rate.
- Determinism: the full arrival schedule (times, turns, per-vehicle speed factor in +-10 %) is generated
  up front from the seed, one independent stream per approach. The simulation itself uses no randomness.
  The same schedule can be shared by several engines (`EngineOptions.schedule`).
- Following: Intelligent Driver Model (IDM) with a jerk limit on acceleration; speed reduced for turns.
- Signals are inputs: `engine.setSignals()`. Red always holds; yellow holds if the vehicle can stop at 3 m/s^2.
- Signal state is owned by `SignalStateMachine` (green, yellow, all-red, min green, max-green watchdog). Controllers only request phases.
- Right of way (inside the box): conflicts are derived from route geometry as *crossing* or *merging*.
  Vehicles committed to the box have priority; otherwise queue heads are ordered by estimated arrival
  (left-turners count as 3.5 s later, i.e. permissive-left gap acceptance). Merges use car-following in the exit lane.
- Counting: *generated* = scheduled arrivals whose time has passed; *inserted* = placed on the road
  (the difference is the entry backlog); *entered intersection* = front bumper crossed the stop line;
  *exited* = reached the end of the exit arm. Each is tracked per approach.
- Safety diagnostics (all expected to be 0): `redLightEntries`, `safetyClamps` (anti-overlap guard), `overlapPairSteps`.

## Known limitations

- Opposing left-turn paths overlap in this compact box, so they are mutually exclusive. There is no
  left-turn pocket and no end-of-green "sneaker" behaviour, so a left-turner at the head of a shared lane can
  block its queue for a whole green when the opposing flow is saturated. This lowers capacity noticeably
  (about 1000 veh/h total with 20 % lefts under the test cycle). Demand profiles will be calibrated to it in milestone 5.
- Rare dilemma-zone red entries (a vehicle that committed to a yellow but slowed for a turn) are counted, not hidden.
- Vehicles are identical in size; there are no pedestrians, bikes or lane changes.
