import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startSplash } from './boot/splash';
import './index.css';

const splash = startSplash();
splash.complete('shell');

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function start(): Promise<void> {
  // The interface and the 3D engine are separate chunks that load in parallel; each stage completes when its code is in.
  const [{ default: App }, viewport] = await Promise.all([
    import('./ui/App').then((m) => (splash.complete('ui'), m)),
    import('./render/Viewport').then((m) => (splash.complete('3d'), m)),
  ]);
  await nextFrame(); // let the splash repaint before the heavy synchronous work
  viewport.prewarmScene();
  splash.complete('city');
  await nextFrame();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App onBootStage={splash.complete} />
    </StrictMode>,
  );
}

start().catch((err: unknown) => {
  console.error(err);
  splash.fail('Could not load the simulation. Check your connection and reload.');
});
