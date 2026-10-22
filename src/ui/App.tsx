import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, cycleLengthOf, planFromCycle } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_GREEN, ALL_RED } from '../sim/debugSignals';
import { GEOMETRY } from '../sim/network';
import type { SignalColor } from '../sim/types';
import { SimulationRunner } from '../runtime';

/**
 * Debug view: a top-down 2D canvas that only *reads* runner snapshots.
 * It is replaced by the React Three Fiber scene and dashboard in later milestones.
 */

type Mode = 'controller' | 'green' | 'red';
const COLORS: Record<SignalColor, string> = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };

function makeRunner(seed: number, rate: number, cycle: number) {
  const config = createConfig({ seed, duration: 3600 });
  config.demand = uniformDemand(rate);
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle);
  return new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan), { diagnostics: true });
}

function draw(canvas: HTMLCanvasElement, runner: SimulationRunner) {
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

  const k = Math.min(w, h) / 90;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(k, -k);

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

  const snap = runner.snapshot();
  const sl = GEOMETRY.stopLineDist;
  const stopLines: ['N' | 'E' | 'S' | 'W', number, number, number, number][] = [
    ['N', -roadHalf, sl, 0, sl], ['S', 0, -sl, roadHalf, -sl],
    ['E', sl, 0, sl, roadHalf], ['W', -sl, -roadHalf, -sl, 0],
  ];
  for (const [a, x1, y1, x2, y2] of stopLines) {
    ctx.strokeStyle = COLORS[snap.signals[a]];
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
  const runnerRef = useRef<SimulationRunner>(makeRunner(1, 300, 60));
  const runningRef = useRef(true);
  const speedRef = useRef(1);

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<Mode>('controller');
  const [rate, setRate] = useState(300);
  const [seed, setSeed] = useState(1);
  const [cycle, setCycle] = useState(60);
  const [text, setText] = useState('');
  const [signalText, setSignalText] = useState('');

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => {
    runnerRef.current = makeRunner(seed, rate, cycle);
    applyMode(runnerRef.current, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, rate, cycle]);
  useEffect(() => { applyMode(runnerRef.current, mode); }, [mode]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastText = 0;
    const loop = (now: number) => {
      const runner = runnerRef.current;
      const dt = runner.engine.config.dt;
      acc += Math.min(0.1, (now - last) / 1000) * speedRef.current;
      last = now;
      if (runningRef.current) {
        let guard = 0;
        while (acc >= dt && guard++ < 400) {
          runner.tick();
          acc -= dt;
        }
      } else acc = 0;
      if (canvasRef.current) draw(canvasRef.current, runner);
      if (now - lastText > 250) {
        lastText = now;
        const e = runner.engine;
        const s = e.stats;
        setText(
          `t=${e.time.toFixed(0)}s  on road ${e.vehiclesOnNetwork}  generated ${s.generated}  entered ${s.enteredIntersection}  exited ${s.exited}  ` +
          `| red entries ${s.redLightEntries}  overlaps ${s.overlapPairSteps}  guard ${s.safetyClamps}`,
        );
        const sig = runner.snapshot();
        setSignalText(
          sig.overridden
            ? 'DEBUG OVERRIDE: controller and safety layer bypassed'
            : `${sig.controller}: phase ${sig.signal.phase} ${sig.signal.stage} ${sig.signal.elapsed.toFixed(1)}s` +
              (sig.signal.nextPhase ? ` -> ${sig.signal.nextPhase}` : ''),
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const planInfo = (() => {
    const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle);
    return `green ${plan.greens.NS}s / ${plan.greens.EW}s, yellow ${DEFAULT_TIMING.yellow}s, all-red ${DEFAULT_TIMING.allRed}s (cycle ${cycleLengthOf(plan, DEFAULT_TIMING).toFixed(0)}s)`;
  })();

  return (
    <div className="app">
      <div className="bar">
        <strong>Traffic engine debug view</strong>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Play'}</button>
        <button onClick={() => { runnerRef.current.reset(); applyMode(runnerRef.current, mode); }}>Reset</button>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 5, 10, 20].map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
        <label>Signals
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="controller">Fixed-time controller</option>
            <option value="green">Debug: all green</option>
            <option value="red">Debug: all red</option>
          </select>
        </label>
        <label>Cycle
          <select value={cycle} onChange={(e) => setCycle(Number(e.target.value))}>
            {[40, 60, 90, 120].map((c) => <option key={c} value={c}>{c}s</option>)}
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
      </div>
      <div className="bar">
        <span className="stats">{signalText}</span>
        <span className="stats">{planInfo}</span>
      </div>
      <div className="bar"><span className="stats">{text}</span></div>
      <div className="view"><canvas ref={canvasRef} /></div>
    </div>
  );
}

function applyMode(runner: SimulationRunner, mode: Mode) {
  runner.setDebugOverride(mode === 'green' ? ALL_GREEN : mode === 'red' ? ALL_RED : null);
}
