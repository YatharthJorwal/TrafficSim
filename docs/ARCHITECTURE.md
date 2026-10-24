# Architecture

## Layers and allowed imports
```
 ui  ->  render  ->  runtime  ->  control  ->  detectors  ->  sim
                        |                                 ^
                        +---------------------------------+
 analytics (M5) reads runtime / detectors / sim output only
```
- `src/sim`      pure TS traffic engine. Imports nothing from other layers.
- `src/detectors` virtual detector zones. Reads `VehicleObservation`s; never touches the engine. Defines `Measurements`.
- `src/control`  signal phases, state machine, controllers. Imports `sim` and `detectors` types only. Does not import the engine.
- `src/runtime`  `SimulationRunner` (the only place engine, detectors, machine and controller meet), `FixedStepLoop`, `interpolateVehicles`.
- `src/ambient`  cosmetic life (pedestrians) and the shared street layout constants. Reads `sim`; nothing else imports it except `render`.
- `src/render`   R3F scene (reads the loop; never writes simulation state). `scenery/` and `models/` are pure geometry generators.  `src/ui` toolbar and live panel.
- `src/analytics` (M5) metrics, experiment runner, export.
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
1. controller decides from `machine.status` and `detectors.measurements`, and calls `machine.request`
2. engine receives `machine.colors` (valid for [t, t+dt))
3. `engine.step()`
4. `detectors.update(time, dt, engine.observe())`
5. `machine.step(dt)` (may start a transition)
`setDebugOverride` bypasses 1 and 4 for inspection only and is flagged in snapshots.

## Detectors (`src/detectors`)
- One zone per approach: from the stop line back `zoneLength` (default 80 m). Sampled once per step.
- Observed (counted): `inZone`, `approaching`, `queueLength` (stopped chain from the stop line), `queueLengthM`,
  `zoneOverflow`, `avgWait` / `maxWait` (time stopped inside the zone), `arrivals` / `departures` in a sliding window.
- Estimated (derived): `demandVehPerHour` = window arrivals scaled to veh/h; 0 until 10 s of data.
- Events: `arrival` when a vehicle enters the zone, `departure` when its front crosses the stop line. Totals and peaks are kept for metrics.
- Detectors see only presence and speed, never routes or intentions, and never change the simulation (tested).

## Rendering and the loop
- `FixedStepLoop.advance(realSeconds)` converts frame time into whole fixed steps (accumulator, clamped), keeps the last two
  vehicle states, and exposes `alpha`. `SimDriver` calls it from R3F's frame loop at priority -1.
- Components read `loop.prev/curr/alpha`, `engine.signals` and `detectors.measurements` inside `useFrame` and mutate
  three.js objects directly. React state is only used by `Hud`, which polls 4x per second in its own component, so the scene
  never re-renders because of the HUD, and rendering never triggers engine work.
- Sim (x east, y north) maps to three.js `(x, up, -y)`. Vehicles are two instanced meshes; signal heads and stop lines glow in the engine's signal colour.

## Scenery, vehicles, pedestrians (M3.1)
- `render/scenery/city.ts`, `terrain.ts`: deterministic generators (seeded, no `Math.random`) returning merged vertex-coloured geometry
  plus tree and lamp positions. Tested in node: nothing intrudes on the roadway, windows sit on buildings, corner lots stay low.
- `render/models/vehicleModels.ts`: four low-poly vehicle types built from an extruded side profile plus glass, wheels, lamps.
  Bodies are instance-tinted; brake and indicator lights are separate instanced meshes switched per vehicle.
- `interpolateVehicles` also derives `braking`, `indicator` and `fade` from consecutive observations (render-only).
- `ambient/crowd.ts`: pedestrians walk a fixed sidewalk graph, crossing arms at crosswalks 7.2 m out. They start crossing only inside a
  short window after the parallel road turns green and only if no car could reach the crosswalk before they are across (cars do not
  yield in the simulation). The crowd is stepped by `FixedStepLoop.onStep`, so it follows simulation time, pause and speed.
- Debug hooks: `window.__trafficSim` (the loop) and `window.__r3f` (R3F store) exist for tooling; nothing in the app reads them.

## Planned
- Experiments (M5): paired runs sharing one schedule, metrics from `completed` + stats + detector totals, CSV/JSON export.
- AI (M8): adapter outside the tick; recommendation -> validate against machine rules -> apply as a normal request, with timeout and fallback.
