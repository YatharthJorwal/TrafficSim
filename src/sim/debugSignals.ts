import type { SignalStates } from './types';

/**
 * TEMPORARY stand-in for the control layer (replaced by src/control in milestone 2).
 * A plain two-phase cycle used by tests, the headless script and the debug view.
 */
export function simpleCycle(t: number, green = 25, yellow = 3, allRed = 2): SignalStates {
  const phase = green + yellow + allRed;
  const cycle = 2 * phase;
  const x = ((t % cycle) + cycle) % cycle;
  const inPhase = x % phase;
  const nsTurn = x < phase;
  let color: 'green' | 'yellow' | 'red' = 'red';
  if (inPhase < green) color = 'green';
  else if (inPhase < green + yellow) color = 'yellow';
  return nsTurn
    ? { N: color, S: color, E: 'red', W: 'red' }
    : { E: color, W: color, N: 'red', S: 'red' };
}

export const ALL_RED: SignalStates = { N: 'red', E: 'red', S: 'red', W: 'red' };
export const ALL_GREEN: SignalStates = { N: 'green', E: 'green', S: 'green', W: 'green' };
