/**
 * Loading progress for the splash screen. Pure logic, no DOM, so it can be tested with explicit times.
 *
 * The percentage is built from real start-up stages, each worth a share of the bar. A stage only counts once its work
 * has actually finished (the code is downloaded, the city is built, the first frame is on screen). While a stage is
 * still running, the shown value creeps toward (never reaching) the next boundary so the bar does not look frozen on
 * a slow connection. It never goes backwards, and it only shows 100 % after every stage has finished.
 */

export interface BootStage {
  id: string;
  /** Shown while this is the first unfinished stage. */
  label: string;
  /** Share of the bar (the weights add up to 100). */
  weight: number;
}

export const BOOT_STAGES: readonly BootStage[] = [
  { id: 'shell', label: 'Starting up', weight: 4 },
  { id: 'ui', label: 'Loading the interface', weight: 14 },
  { id: '3d', label: 'Loading the 3D engine', weight: 34 },
  { id: 'city', label: 'Building the city', weight: 16 },
  { id: 'sim', label: 'Preparing the simulation', weight: 10 },
  { id: 'frame', label: 'Rendering the first frame', weight: 22 },
];

export interface BootReading {
  /** Whole percent to display, 0 to 100. */
  percent: number;
  label: string;
  finished: boolean;
}

export class BootProgress {
  private readonly done = new Set<string>();
  private lastChange: number;
  private shown = 0;
  private lastTick: number;

  /**
   * @param tauMs  how quickly the in-stage creep slows down (larger = slower)
   * @param creep  the most of the next stage's share the creep may claim before the stage really finishes
   */
  constructor(now = 0, private readonly stages: readonly BootStage[] = BOOT_STAGES, private readonly tauMs = 2500, private readonly creep = 0.85) {
    const total = stages.reduce((n, s) => n + s.weight, 0);
    if (Math.abs(total - 100) > 1e-9) throw new Error(`boot stage weights must add up to 100, got ${total}`);
    this.lastChange = now;
    this.lastTick = now;
  }

  /** Mark a stage finished. Unknown ids throw, so a typo cannot silently stall the bar. */
  complete(id: string, now: number): void {
    if (!this.stages.some((s) => s.id === id)) throw new Error(`unknown boot stage "${id}"`);
    if (this.done.has(id)) return;
    this.done.add(id);
    this.lastChange = now;
  }

  get finished(): boolean {
    return this.stages.every((s) => this.done.has(s.id));
  }

  /** Share of the bar that real, finished work accounts for. */
  get completed(): number {
    return this.stages.filter((s) => this.done.has(s.id)).reduce((n, s) => n + s.weight, 0);
  }

  private get active(): BootStage | undefined {
    return this.stages.find((s) => !this.done.has(s.id));
  }

  /** The value the display is heading for at time `now`. */
  target(now: number): number {
    const next = this.active;
    if (!next) return 100;
    const elapsed = Math.max(0, now - this.lastChange);
    return this.completed + this.creep * next.weight * (1 - Math.exp(-elapsed / this.tauMs));
  }

  /** Advance the display and read it. Call once per animation frame with a non-decreasing time. */
  tick(now: number): BootReading {
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const goal = this.target(now);
    // smooth approach, never backwards
    this.shown = Math.max(this.shown, this.shown + (goal - this.shown) * (1 - Math.exp(-dt / 180)));
    if (this.finished && this.shown > 99.5) this.shown = 100;
    const percent = this.finished ? Math.floor(this.shown + 1e-9) : Math.min(99, Math.floor(this.shown + 1e-9));
    return { percent, label: this.finished ? 'Ready' : this.active!.label, finished: this.finished && percent === 100 };
  }
}
