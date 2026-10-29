# Decision log

| ID | Decision | Why | Status |
|----|----------|-----|--------|
| D1 | Generate the whole arrival schedule up front, one PRNG stream per approach | Same input for every controller; changing one approach never perturbs another | accepted |
| D2 | Intelligent Driver Model plus jerk limit for car-following | Smooth, well understood, stable queues | accepted |
| D3 | Conflicts derived from route geometry (`crossing` / `merging`) | No hand-maintained matrix; stays correct if geometry changes | accepted |
| D4 | Signals are per approach, with two phases (NS, EW) in v1 | Simple and safe; geometry stays data-driven so protected phases can be added | accepted |
| D5 | One shared lane per approach in v1 | Smallest geometry that supports left/straight/right | open: revisit with A/B left-turn choice |
| D6 | Permissive left: left-turners treated as arriving 3.5 s later than they are | Gap acceptance without extra state | accepted |
| D7 | Only `SignalStateMachine` owns signals; controllers request phases | Safety independent of any controller or AI | accepted |
| D8 | Max-green watchdog inside the machine | A buggy controller cannot starve a road | accepted |
| D9 | Held vehicles aim 0.5 m short of the stop line | Numerical creep must not cross the line | accepted |
| D10 | Red entries are counted, not suppressed | Honest reporting of dilemma-zone cases | accepted |
| D11 | Deliver changes as bundles applied with `npm run apply` | Owner preference; git can undo any bundle | accepted |
| D12 | Yellow "sneaker" for stopped left-turners | Tried; caused red entries (cannot stop under jerk limit) | rejected |
| D13 | Detectors see only presence and speed inside a zone; waiting time = time stopped in the zone | Behaves like a real camera/loop; controllers cannot cheat with routes or intentions | accepted |
| D14 | Zone length 80 m with an explicit overflow flag | A longer queue is under-counted; say so instead of hiding it | accepted |
| D15 | `Measurements` types live in `src/detectors`; `control` re-exports them | Keeps the dependency direction control -> detectors -> sim | accepted |
| D16 | Simulation advances from the R3F frame loop through a plain-TS `FixedStepLoop` | Testable without React; frame rate cannot change results | accepted |
| D17 | Engine stays on the main thread for now | About 1800x real time; a Worker adds complexity without need | accepted, revisit in M5 if experiments feel slow |
| D18 | 3D scene verified with a headless scene-graph test renderer | No browser in the build sandbox; geometry/state links are asserted, looks are reviewed by the owner | accepted |
| D19 | Stop line moved from 6 m to 9.5 m (crosswalk 5.7-8.7 m) | The old 1 m gap between line and box left no room for a crosswalk | accepted; capacity about 4 % lower |
| D20 | Scenery and vehicles are procedural geometry in code, not Blender GLBs, for now | Deterministic, testable in node, no binary assets; a GLB pipeline can replace them later | accepted |
| D21 | Pedestrians are a cosmetic `ambient` layer that only reads the sim | Cannot affect any result; removable at any time | accepted |
| D22 | Pedestrians cross only on the parallel green, within 0.4-3.0 s of it starting, and only if no car could arrive first | Cars do not yield in the sim, so peds avoid conflicts instead; crossing is done by 11.7 s, inside minGreen + yellow + all-red | accepted |
| D23 | Vehicles scale in and out over 12 m at the arm ends | Hides the spawn/despawn point without changing the sim | accepted |
| D24 | Two traffic modes: `circulating` (persistent fleet, UI default) and `arrivals` (open boundary, experiments) | A closed loop never makes vehicles vanish, but its demand depends on the controller, which breaks the identical-arrivals rule | accepted |
| D25 | One-way clockwise ring with right turns only | No crossing conflicts at the junctions; only merges, handled by gap acceptance | accepted |
| D26 | Connectors share the ring path, so a vehicle can change target mid-ring | Lets ring traffic skip a full arm without jumping | accepted |
| D27 | Fleet capped at 48 | 52+ starts to jam and overlap in the closed network; 48 is clean over many seeds and signal timings | accepted; revisit with a bigger ring or two lanes |
| D28 | Ring vehicles skip an arm whose entry queue has spilled back, and nobody enters the box without room beyond it | Prevents the ring-to-arm-to-box gridlock that appeared at 60+ vehicles | accepted |
| D29 | Fleet changes: raising adds vehicles live, lowering restarts | Removing vehicles live would make them vanish, which is exactly what this mode avoids | accepted |
| D30 | Reset in the UI rebuilds the simulation with the current settings | Keeps the fleet and mode in sync with the controls | accepted |

