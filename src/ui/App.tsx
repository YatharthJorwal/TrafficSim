import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_FLEET } from '../sim/config';
import type { TrafficMode } from '../sim/types';
import { CAMERA_PRESETS, type CameraPresetName, type CameraRequest } from '../render/CameraRig';
import { Viewport } from '../render/Viewport';
import { Hud } from './Hud';
import { applySignalMode, describePlan, makeLoop, type SignalMode } from './simFactory';

const SPEEDS = [1, 2, 5, 10, 20, 50];

export default function App() {
  const [seed, setSeed] = useState(1);
  const [rate, setRate] = useState(300);
  const [trafficMode, setTrafficMode] = useState<TrafficMode>('circulating');
  const [fleet, setFleet] = useState(30);
  const [rebuild, setRebuild] = useState(0);
  const [cycle, setCycle] = useState(60);
  const [mode, setMode] = useState<SignalMode>('controller');
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(true);
  const [showDetectors, setShowDetectors] = useState(true);
  const [showPedestrians, setShowPedestrians] = useState(true);
  const [shadows, setShadows] = useState(true);
  const [camera, setCamera] = useState<CameraRequest>({ name: 'overview', nonce: 0 });

  // A new loop (runner + engine + detectors) only when the scenario itself changes. The fleet size is read
  // through a ref: raising it adds vehicles to the running simulation instead of restarting it.
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const loop = useMemo(
    () => makeLoop({ seed, rate, cycle, mode: trafficMode, fleet: fleetRef.current }),
    [seed, rate, cycle, trafficMode, rebuild],
  );

  useEffect(() => {
    const engine = loop.runner.engine;
    if (!engine.isCirculating) return;
    if (fleet > engine.fleetSize) engine.addVehicles(fleet - engine.fleetSize);
    else if (fleet < engine.fleetSize) setRebuild((n) => n + 1); // fewer vehicles: start over with the new number
  }, [loop, fleet]);

  useEffect(() => {
    // Debug hook (used by screenshot tooling to fast-forward). Nothing in the app reads it.
    (window as unknown as { __trafficSim?: unknown }).__trafficSim = loop;
  }, [loop]);

  useEffect(() => {
    loop.speed = speed;
    loop.running = running;
    applySignalMode(loop, mode);
  }, [loop, speed, running, mode]);

  const pick = (name: CameraPresetName) => setCamera((c) => ({ name, nonce: c.nonce + 1 }));

  return (
    <div className="app">
      <div className="toolbar">
        <strong>Adaptive traffic simulation</strong>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Play'}</button>
        <button onClick={() => setRebuild((n) => n + 1)}>Reset</button>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
        <label>Signals
          <select value={mode} onChange={(e) => setMode(e.target.value as SignalMode)}>
            <option value="controller">Fixed-time controller</option>
            <option value="green">Debug: all green</option>
            <option value="red">Debug: all red</option>
          </select>
        </label>
        <label>Cycle
          <select value={cycle} onChange={(e) => setCycle(Number(e.target.value))}>
            {[40, 60, 90, 120].map((c) => <option key={c} value={c}>{c} s</option>)}
          </select>
        </label>
        <label>Traffic
          <select value={trafficMode} onChange={(e) => setTrafficMode(e.target.value as TrafficMode)}>
            <option value="circulating">Circulating fleet</option>
            <option value="arrivals">Arrivals (experiment mode)</option>
          </select>
        </label>
        {trafficMode === 'circulating' ? (
          <label>Vehicles
            <select value={fleet} onChange={(e) => setFleet(Number(e.target.value))}>
              {[8, 16, 24, 30, 40, MAX_FLEET].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ) : (
          <label>Demand
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {[100, 200, 300, 450, 600].map((r) => <option key={r} value={r}>{r} veh/h/approach</option>)}
            </select>
          </label>
        )}
        <label>Seed
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={showDetectors} onChange={(e) => setShowDetectors(e.target.checked)} />
          Detector zones
        </label>
        <label className="check">
          <input type="checkbox" checked={showPedestrians} onChange={(e) => setShowPedestrians(e.target.checked)} />
          Pedestrians
        </label>
        <label className="check">
          <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} />
          Shadows
        </label>
        <span className="muted small plan">{describePlan(cycle)}</span>
      </div>
      <div className="main">
        <div className="viewport">
          <Viewport loop={loop} showDetectors={showDetectors} showPedestrians={showPedestrians} shadows={shadows} camera={camera} />
          <div className="cams">
            {(Object.keys(CAMERA_PRESETS) as CameraPresetName[]).map((n) => (
              <button key={n} className={camera.name === n ? 'on' : ''} onClick={() => pick(n)}>
                {CAMERA_PRESETS[n].label}
              </button>
            ))}
          </div>
        </div>
        <Hud loop={loop} />
      </div>
    </div>
  );
}
