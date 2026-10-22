import { useEffect, useRef, useState } from 'react';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_GREEN, ALL_RED, simpleCycle } from '../sim/debugSignals';
import { SimulationEngine } from '../sim/engine';
import { GEOMETRY } from '../sim/network';
import type { SignalColor, SignalStates } from '../sim/types';

/**
 * Milestone 1 debug view: a top-down 2D canvas that only *reads* engine snapshots.
 * It is replaced by the React Three Fiber scene and dashboard in later milestones.
 */

type SignalMode = 'cycle' | 'green' | 'red';
const COLORS: Record<SignalColor, string> = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };

function makeEngine(seed: number, rate: number) {
  const config = createConfig({ seed, duration: 3600 });
  config.demand = uniformDemand(rate);
  return new SimulationEngine(config, { diagnostics: true });
}

function draw(canvas: HTMLCanvasElement, engine: SimulationEngine) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const viewM = 90; // metres shown across the shorter side
  const k = Math.min(w, h) / viewM;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(k, -k); // y up

  const roadHalf = GEOMETRY.laneOffset * 2;
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(-100, -roadHalf, 200, roadHalf * 2);
  ctx.fillRect(-roadHalf, -100, roadHalf * 2, 200);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 0.15;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(-100, 0); ctx.lineTo(100, 0);
  ctx.moveTo(0, -100); ctx.lineTo(0, 100);
  ctx.stroke();
  ctx.setLineDash([]);

  const snap = engine.snapshot();
  const sl = GEOMETRY.stopLineDist;
  const stopLines: [string, number, number, number, number][] = [
    ['N', -roadHalf, sl, 0, sl], ['S', 0, -sl, roadHalf, -sl],
    ['E', sl, 0, sl, roadHalf], ['W', -sl, -roadHalf, -sl, 0],
  ];
  for (const [a, x1, y1, x2, y2] of stopLines) {
    ctx.strokeStyle = COLORS[snap.signals[a as 'N']];
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  for (const v of snap.vehicles) {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.heading);
    ctx.fillStyle = v.held ? '#f97316' : v.speed < 0.5 ? '#f59e0b' : '#38bdf8';
    ctx.fillRect(-v.length / 2, -v.width / 2, v.length, v.width);
    ctx.restore();
  }
  ctx.restore();
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SimulationEngine>(makeEngine(1, 300));
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const modeRef = useRef<SignalMode>('cycle');

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<SignalMode>('cycle');
  const [rate, setRate] = useState(300);
  const [seed, setSeed] = useState(1);
  const [text, setText] = useState('');

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { engineRef.current = makeEngine(seed, rate); }, [seed, rate]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastText = 0;
    const loop = (now: number) => {
      const engine = engineRef.current;
      const dt = engine.config.dt;
      acc += Math.min(0.1, (now - last) / 1000) * speedRef.current;
      last = now;
      if (runningRef.current) {
        let guard = 0;
        while (acc >= dt && guard++ < 400) {
          const m = modeRef.current;
          const sig: SignalStates = m === 'green' ? ALL_GREEN : m === 'red' ? ALL_RED : simpleCycle(engine.time);
          engine.setSignals(sig);
          engine.step();
          acc -= dt;
        }
      } else acc = 0;
      if (canvasRef.current) draw(canvasRef.current, engine);
      if (now - lastText > 250) {
        lastText = now;
        const s = engine.stats;
        setText(
          `t=${engine.time.toFixed(0)}s  on road ${engine.vehiclesOnNetwork}  generated ${s.generated}  entered ${s.enteredIntersection}  exited ${s.exited}  ` +
          `| red entries ${s.redLightEntries}  overlaps ${s.overlapPairSteps}  guard ${s.safetyClamps}`,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="app">
      <div className="bar">
        <strong>Engine debug view (milestone 1)</strong>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Play'}</button>
        <button onClick={() => engineRef.current.reset()}>Reset</button>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 5, 10, 20].map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
        <label>Signals
          <select value={mode} onChange={(e) => setMode(e.target.value as SignalMode)}>
            <option value="cycle">Test cycle (2-phase)</option>
            <option value="green">All green (right-of-way only)</option>
            <option value="red">All red</option>
          </select>
        </label>
        <label>Demand
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[100, 200, 300, 450, 600].map((r) => <option key={r} value={r}>{r} veh/h/approach</option>)}
          </select>
        </label>
        <label>Seed
          <input type="number" value={seed} style={{ width: 60 }} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
        </label>
        <span className="stats">{text}</span>
      </div>
      <div className="view"><canvas ref={canvasRef} /></div>
    </div>
  );
}
