# Handoff

Last updated: end of milestone 2.

## State
- M1 engine core: done, pushed. M2 signal control foundation: done in this bundle.
- 50 tests pass (23 engine, 20 control, 7 runner). `npm run typecheck` and `npm run build` pass.
- `npm run dev` shows a 2D debug view driven by `SimulationRunner` with the fixed-time controller
  (signals / cycle / demand / seed / speed controls, plus debug all-green / all-red overrides).
- Headless: `npm run sim:headless -- 1 300 1800 60` (seed, veh/h/approach, seconds, cycle).

## What exists
- `src/sim`      engine, network, schedule, config, rng, collision diagnostic, `debugSignals.ts` (engine test fixture only).
- `src/control`  phases, timing validation, `SignalStateMachine`, `FixedTimeController`, `planFromCycle`.
- `src/runtime`  `SimulationRunner`.
- `src/ui`       debug view (placeholder for the 3D scene and dashboard).
- `tools/apply-bundle.mjs`  applies bundles (`npm run apply -- <zip>`).

## Decisions waiting on the owner
- **Left turns (blocks M4 realism):** A = keep the shared lane and add end-of-green "sneakers"; B = dedicated left-turn
  lane with protected left phases. Not yet chosen. M3 does not depend on it.

## Known issues / limitations
- Opposing left-turn paths overlap in this compact box, so they are mutually exclusive. With a shared lane, a
  left-turner at the head can block its queue for a whole green when the opposing flow is saturated. Capacity is about
  1000 veh/h total with 20 % lefts under a 60 s cycle (seed 1, 300 veh/h/approach leaves backlog on E and W after 30 min).
- Rare dilemma-zone red entries (a vehicle committed to a yellow that slows for a turn) are counted in `redLightEntries`
  (about 1 in 100 stress runs; 0 in all tests).
- The yellow "sneaker" idea was tried and reverted: a left-turner pulling away from standstill cannot stop in time when the
  light turns red (jerk limit), producing red entries. A proper solution needs a waiting pocket inside the box (option A work).
- Detector types exist (`Measurements`) but no detector implementation yet.

## Next steps (M3)
1. Detector zones per approach producing observed values and demand estimates into `Measurements`; wire via `RunnerOptions.measurements`.
2. React Three Fiber scene: simple road/box/vehicle meshes, signal heads, overview + close-up cameras, reading `runner.snapshot()`.
3. Run the simulation outside React state; interpolate between fixed steps.
4. Detector overlay in the scene and a live measurements panel.
5. Tests for detector counts, queue definition, arrival/departure events.

## How to verify a fresh checkout
```
npm install
npm test
npm run typecheck
npm run dev
```
