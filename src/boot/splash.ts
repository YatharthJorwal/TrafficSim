import { BootProgress } from './progress';

export interface Splash {
  /** Report that a start-up stage has really finished. */
  complete(stageId: string): void;
  /** Replace the progress with an error message and a reload button. */
  fail(message: string): void;
}

const noop: Splash = { complete: () => undefined, fail: () => undefined };

/**
 * Drives the splash screen that index.html ships (`#boot`). It is plain DOM on purpose: it must work before React and
 * the 3D engine have loaded. If the markup is missing it does nothing.
 */
export function startSplash(doc: Document = document): Splash {
  const root = doc.getElementById('boot');
  const fill = doc.getElementById('boot-fill');
  const pct = doc.getElementById('boot-pct');
  const label = doc.getElementById('boot-label');
  const bar = doc.getElementById('boot-bar');
  if (!root || !fill || !pct || !label) return noop;

  const progress = new BootProgress(performance.now());
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    const r = progress.tick(now);
    fill.style.transform = `scaleX(${r.percent / 100})`;
    pct.textContent = `${r.percent}%`;
    label.textContent = r.label;
    bar?.setAttribute('aria-valuenow', String(r.percent));
    if (r.finished) {
      stopped = true;
      root.classList.add('done');
      // fade out, then remove; the timeout covers reduced-motion users where no transition runs
      const remove = () => root.remove();
      root.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 700);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    complete: (id) => progress.complete(id, performance.now()),
    fail: (message) => {
      stopped = true;
      root.classList.add('failed');
      label.textContent = message;
      pct.textContent = '';
      if (!root.querySelector('button')) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Reload';
        b.addEventListener('click', () => location.reload());
        root.querySelector('.boot-card')?.appendChild(b);
      }
    },
  };
}
