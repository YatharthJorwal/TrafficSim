# Engineering rules

## Determinism
1. No `Math.random`, `Date.now` or `performance.now` inside `src/sim`, `src/control`, `src/runtime`. All randomness comes from `rng.ts` via the schedule.
2. Fixed timestep only. Time is `steps * dt`; rendering frame rate must never change results.
3. Same seed + config (+ controller + plan) must give identical `stateKey()` and signal log. Keep tests for this.

## Layering
4. `sim` and `control` never import React, Three.js, DOM or each other's internals beyond the types listed in ARCHITECTURE.md.
5. The renderer and UI read snapshots. They are never the source of truth for positions, counts or metrics.
6. Do not put the whole implementation in one React component. Keep simulation work out of React state updates.

## Safety
7. Only `SignalStateMachine` changes real signal colours. A controller, including any AI component, only requests a phase.
8. Never weaken min green, yellow, all-red, conflict checks or the watchdog to make a controller look better.
9. Every AI recommendation must be validated against the same deterministic rules and fall back to the rule-based controller on failure, timeout or invalid output.
10. `setDebugOverride` is for inspection only. Experiments must never use it.

## Metrics and honesty
11. Metrics follow `docs/SPEC.md` definitions exactly. Distinguish generated, inserted, entered and exited.
12. Distinguish observed detector values from estimates in names, types and UI labels.
13. Compare controllers on identical schedules. Report losses and ties as clearly as wins. Do not tune the baseline against the adaptive controller.

## Testing
14. Every new behaviour gets a test. Safety properties (no overlap, no conflicting greens, no red entry, counts add up) are asserted, not assumed.
15. `npm test` and `npm run typecheck` must pass before a bundle is delivered. State what actually ran.
16. Invalid configuration throws a typed error (`ConfigError`, `ControlConfigError`) with readable messages.

## Code and process
17. Strict TypeScript, explicit types for vehicles, routes, detectors, phases, controllers and results. No `any` in `src/`.
18. Prefer lightweight dependencies. No backend unless it gives a concrete benefit.
19. Work one milestone at a time with an approval gate. Deliver changes as bundles (docs/BUNDLES.md).
20. Update HANDOFF, TODO, CHANGELOG (and DECISIONS where relevant) with every bundle. Document assumptions and known limitations.
