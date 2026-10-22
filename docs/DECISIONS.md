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
