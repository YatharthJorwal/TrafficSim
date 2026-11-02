import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROFILES, customProfile, profileById } from '../experiments';
import { MAX_FLEET } from '../sim/config';
import { APPROACHES, type Approach, type TrafficMode } from '../sim/types';
import { CAMERA_PRESETS, type CameraPresetName, type CameraRequest } from '../render/CameraRig';
import { Hud } from './Hud';
import { applySignalMode, describePlan, makeLoop, type ControllerKind, type SignalMode } from './simFactory';

// The 3D engine and the dashboard are separate chunks: the splash screen waits for the first, and the second only
// downloads when someone opens the Compare tab.
const Viewport = lazy(() => import('../render/Viewport').then((m) => ({ default: m.Viewport })));
const Dashboard = lazy(() => import('./dashboard/Dashboard'));

const SPEEDS = [1, 2, 5, 10, 20, 50];
type Tab = 'live' | 'compare';

export default function App({ onBootStage }: { onBootStage?: (stageId: string) => void }) {
  const [tab, setTab] = useState<Tab>('live');
  const [seed, setSeed] = useState(1);
  const [preset, setPreset] = useState<string>('custom');
  const [rates, setRates] = useState<Record<Approach, number>>({ N: 300, E: 300, S: 300, W: 300 });
  const [trafficMode, setTrafficMode] = useState<TrafficMode>('circulating');
  const [fleet, setFleet] = useState(30);
  const [rebuild, setRebuild] = useState(0);
  const [cycle, setCycle] = useState(60);
  const [mode, setMode] = useState<SignalMode>('controller');
  const [controllerKind, setControllerKind] = useState<ControllerKind>('adaptive');
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(true);
  const [showDetectors, setShowDetectors] = useState(true);
  const [showPedestrians, setShowPedestrians] = useState(true);
  const [shadows, setShadows] = useState(true);
  const [camera, setCamera] = useState<CameraRequest>({ name: 'overview', nonce: 0 });

  const profile = useMemo(() => (preset === 'custom' ? customProfile(rates) : profileById(preset)), [preset, rates]);
  const shownRates = preset === 'custom' ? rates : profile.segments[0].rates;

  // A new loop (runner + engine + detectors) only when the scenario itself changes. The fleet size is read
  // through a ref: raising it adds vehicles to the running simulation instead of restarting it.
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const loop = useMemo(
    () => makeLoop({ seed, rate: 300, profile, cycle, mode: trafficMode, fleet: fleetRef.current, controller: controllerKind }),
    [seed, profile, cycle, trafficMode, controllerKind, rebuild],
  );

  useEffect(() => {
    onBootStage?.('sim'); // the simulation exists: its first build is done
  }, [onBootStage]);
  const firstFrame = useCallback(() => onBootStage?.('frame'), [onBootStage]);

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
  const live = tab === 'live';

  return (
    <div className="app">
      <div className="topbar">
        <strong>Adaptive traffic simulation</strong>
        <nav className="tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={live} className={live ? 'on' : ''} onClick={() => setTab('live')}>Live 3D</button>
          <button type="button" role="tab" aria-selected={!live} className={!live ? 'on' : ''} onClick={() => setTab('compare')}>Compare</button>
        </nav>
      </div>

      <div className={`live${live ? '' : ' hidden'}`}>
        <div className="toolbar">
          <button onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Play'}</button>
          <button onClick={() => setRebuild((n) => n + 1)}>Reset</button>
          <label>Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
          </label>
          <label>Controller
            <select value={controllerKind} onChange={(e) => setControllerKind(e.target.value as ControllerKind)}>
              <option value="adaptive">Adaptive (detector-driven)</option>
              <option value="fixed">Fixed-time</option>
            </select>
          </label>
          <label>Signals
            <select value={mode} onChange={(e) => setMode(e.target.value as SignalMode)}>
              <option value="controller">Controller output</option>
              <option value="green">Debug: all green</option>
              <option value="red">Debug: all red</option>
            </select>
          </label>
          {controllerKind === 'fixed' && (
            <label>Cycle
              <select value={cycle} onChange={(e) => setCycle(Number(e.target.value))}>
                {[40, 60, 90, 120].map((c) => <option key={c} value={c}>{c} s</option>)}
              </select>
            </label>
          )}
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
            <>
              <label title="Changing the demand restarts the simulation">Demand
                <select value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== 'custom') setRates({ ...profileById(e.target.value).segments[0].rates }); }}>
                  {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {APPROACHES.map((a) => (
                <label key={a} title={`${a} approach, vehicles per hour`}>{a}
                  <input
                    type="number"
                    min={0}
                    max={1500}
                    step={50}
                    value={shownRates[a]}
                    disabled={preset !== 'custom'}
                    onChange={(e) => setRates({ ...rates, [a]: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </label>
              ))}
              {preset === 'shifting' && <span className="muted small">flips at 30 min of simulated time</span>}
            </>
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
          <span className="muted small plan">{describePlan(cycle, controllerKind)}</span>
        </div>
        <div className="main">
          <div className="viewport">
            <Suspense fallback={null}>
              <Viewport loop={loop} showDetectors={showDetectors} showPedestrians={showPedestrians} shadows={shadows} camera={camera} active={live} onFirstFrame={firstFrame} />
            </Suspense>
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

      {!live && (
        <div className="pane">
          <Suspense fallback={<p className="muted pane-loading">Loading the dashboard…</p>}>
            <Dashboard />
          </Suspense>
        </div>
      )}
    </div>
  );
}
