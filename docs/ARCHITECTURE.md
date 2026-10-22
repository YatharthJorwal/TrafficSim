# Architecture

## Layers and allowed imports
```
 ui  ->  render  ->  runtime  ->  control  ->  sim
                        |                       ^
                        +-----------------------+
 analytics (M5) reads runtime/sim output only
```
- `src/sim`      pure TS traffic engine. Imports nothing from other layers.
- `src/control`  signal phases, state machine, controllers. Imports `sim` types only. Does not import the engine.
- `src/runtime`  `SimulationRunner`: the only place engine, machine and controller meet.
- `src/analytics` (M5) metrics, experiment runner, export.  `src/render` (M3) R3F scene.  `src/ui` dashboard.
- Nothing below `ui` may import React or Three.js.

## Simulation engine (`src/sim`)
- `network.ts` fixed geometry: 12 routes (approach x movement) as sampled polylines with arc length, stop line,
  box entry/exit; conflict matrix with kinds `none | crossing | merging` derived from geometry.
- `schedule.ts` full arrival schedule generated up front from config + seed, one PRNG stream per approach.
- `engine.ts` fixed-step loop: release arrivals -> insert from entry backlog -> build indices (per-approach lanes,
  exit groups, queue heads, box occupants) -> compute accelerations -> integrate -> events/removal -> diagnostics.
- Following: IDM + jerk limit. Leaders come from the shared approach lane and, in the exit lane, by exit coordinate.
- Right of way: box occupants win; otherwise queue heads ordered by (estimated arrival + 3.5 s if left-turning, id).
  Merging movements negotiate only when arrivals are within 2 s, otherwise exit-lane following handles them.
- Signals are *inputs* (`setSignals`). The engine never decides them.
- Outputs: `snapshot()` (read-only), `stats`, `completed` per-vehicle records, `stateKey()` for determinism tests.

## Control (`src/control`)
- `SignalStateMachine` is the only owner of signal state. Stages: green -> yellow -> all-red -> green(next).
  Enforces min green, yellow, all-red, max-green watchdog, rejects unknown phases, asserts no conflicting non-red
  approaches every step (throws `SafetyViolation`).
- `SignalController.decide(input) -> PhaseRequest | null`. Controllers see status and (from M3) measurements.
- `FixedTimeController` + `planFromCycle`. Adaptive controller arrives in M4 behind the same interface.
- Approach-level signals in v1: N/S share a phase, E/W share a phase (see DECISIONS D4).

## Runtime tick order (`SimulationRunner.tick`)
1. controller decides from `machine.status` (+ measurements) and calls `machine.request`
2. engine receives `machine.colors` (valid for [t, t+dt))
3. `engine.step()`
4. `machine.step(dt)` (may start a transition)
`setDebugOverride` bypasses 1 and 4 for inspection only and is flagged in snapshots.

## Planned
- Detectors (M3): zones per approach computing *observed* values (approaching, queue, waits, arrivals, departures) and
  *estimated* values (windowed demand) into `Measurements`, passed to the controller via `RunnerOptions.measurements`.
- Experiments (M5): paired runs sharing one schedule, metrics from `completed` + stats + detector series, CSV/JSON export.
- Rendering (M3): R3F scene reads `runner.snapshot()` each frame and interpolates between fixed steps; the simulation
  runs outside React state (ref or Web Worker) so renders never trigger engine work.
- AI (M8): adapter outside the tick; recommendation -> validate against machine rules -> apply as a normal request, with timeout and fallback.
