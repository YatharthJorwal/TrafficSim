import { describe, expect, it } from 'vitest';
import { BOOT_STAGES, BootProgress, type BootStage } from './progress';

function run(p: BootProgress, from: number, to: number, step = 16): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(p.tick(t).percent);
  return out;
}

describe('boot progress', () => {
  it('has stage weights that add up to 100', () => {
    expect(BOOT_STAGES.reduce((n, s) => n + s.weight, 0)).toBe(100);
    expect(() => new BootProgress(0, [{ id: 'a', label: 'a', weight: 50 }])).toThrow(/add up to 100/);
  });

  it('never goes backwards and never reaches 100 before every stage has finished', () => {
    const p = new BootProgress(0);
    const seen = run(p, 0, 30000); // 30 s with nothing finished
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(Math.max(...seen)).toBeLessThan(6); // the first stage is only worth 4 %
    for (const s of BOOT_STAGES.slice(0, -1)) p.complete(s.id, 30000);
    const late = run(p, 30000, 90000);
    expect(Math.max(...late)).toBeLessThanOrEqual(99);
    expect(p.tick(90000).finished).toBe(false);
  });

  it('reaches exactly 100 only after the last stage completes', () => {
    const p = new BootProgress(0);
    let t = 0;
    for (const s of BOOT_STAGES) {
      t += 400;
      p.complete(s.id, t);
      run(p, t, t + 200);
    }
    const end = run(p, t + 200, t + 3000);
    expect(end[end.length - 1]).toBe(100);
    expect(p.tick(t + 3100)).toMatchObject({ percent: 100, finished: true, label: 'Ready' });
  });

  it('labels the first unfinished stage', () => {
    const p = new BootProgress(0);
    expect(p.tick(10).label).toBe(BOOT_STAGES[0].label);
    p.complete('shell', 20);
    p.complete('ui', 30);
    expect(p.tick(40).label).toBe(BOOT_STAGES[2].label);
  });

  it('counts only finished work as completed, and ignores a repeated completion', () => {
    const p = new BootProgress(0);
    p.complete('shell', 1);
    p.complete('shell', 2);
    expect(p.completed).toBe(4);
    p.complete('ui', 3);
    expect(p.completed).toBe(18);
  });

  it('rejects an unknown stage id so a typo cannot stall the bar', () => {
    expect(() => new BootProgress(0).complete('nope', 1)).toThrow(/unknown boot stage/);
  });

  it('creeps inside a stage but stays below the next boundary', () => {
    const stages: BootStage[] = [
      { id: 'a', label: 'A', weight: 40 },
      { id: 'b', label: 'B', weight: 60 },
    ];
    const p = new BootProgress(0, stages, 1000, 0.85);
    expect(p.target(0)).toBe(0);
    expect(p.target(1000)).toBeGreaterThan(10);
    expect(p.target(1e9)).toBeLessThan(40);
    p.complete('a', 5);
    expect(p.target(5)).toBe(40);
    expect(p.target(1e9)).toBeLessThan(100);
  });
});
