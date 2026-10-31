import { describe, expect, it } from 'vitest';
import { createConfig, uniformDemand } from './config';
import { SimulationEngine } from './engine';
import { APPROACHES } from './types';

const RED = { N: 'red', E: 'red', S: 'red', W: 'red' } as const;
const NS_GREEN = { N: 'green', E: 'red', S: 'green', W: 'red' } as const;

function busyEngine(seed = 4) {
  const config = createConfig({ seed, duration: 600 });
  config.demand = uniformDemand(600);
  return new SimulationEngine(config);
}

describe('engine.ledger()', () => {
  it('has exactly one entry per generated vehicle and the statuses add up to the engine counters', () => {
    const e = busyEngine();
    e.setSignals(NS_GREEN);
    e.run(200);
    const ledger = e.ledger();
    const count = (s: string) => ledger.filter((x) => x.status === s).length;
    expect(ledger.length).toBe(e.stats.generated);
    expect(count('exited')).toBe(e.stats.exited);
    expect(count('onRoad')).toBe(e.vehiclesOnNetwork);
    expect(count('backlog')).toBe(APPROACHES.reduce((n, a) => n + e.backlogCount(a), 0));
    expect(count('exited') + count('onRoad')).toBe(e.stats.inserted);
    expect(new Set(ledger.map((x) => x.id)).size).toBe(ledger.length);
  });

  it('a vehicle still in the entry backlog has waited exactly (now - generatedAt)', () => {
    const e = busyEngine();
    e.setSignals(RED); // nothing is ever served, so the entry queue backs up
    e.run(300);
    const backlog = e.ledger().filter((x) => x.status === 'backlog');
    expect(backlog.length).toBeGreaterThan(0);
    for (const v of backlog) {
      expect(v.backlogWait).toBeCloseTo(e.time - v.generatedAt, 9);
      expect(v.queueWait).toBe(0);
      expect(v.stoppedTime).toBe(0);
    }
  });

  it('exited entries agree with the completed records, including the backlog wait', () => {
    const e = busyEngine();
    e.setSignals(NS_GREEN);
    e.run(200);
    const byId = new Map(e.ledger().map((x) => [x.id, x]));
    expect(e.completed.length).toBeGreaterThan(5);
    for (const r of e.completed) {
      const l = byId.get(r.id)!;
      expect(l.status).toBe('exited');
      expect(l.queueWait).toBe(r.waitingTime);
      expect(l.backlogWait).toBeCloseTo(r.insertedAt - r.generatedAt, 9);
    }
  });

  it('is read-only: asking for it changes nothing about the simulation', () => {
    const a = busyEngine();
    const b = busyEngine();
    a.setSignals(NS_GREEN);
    b.setSignals(NS_GREEN);
    a.run(100);
    b.run(100);
    a.ledger();
    a.ledger();
    a.run(200);
    b.run(200);
    expect(a.stateKey()).toBe(b.stateKey());
  });

  it('refuses circulating mode, where vehicles never finish', () => {
    const e = new SimulationEngine(createConfig({ mode: 'circulating', fleet: 8 }));
    expect(() => e.ledger()).toThrow(/arrivals mode/);
  });
});
