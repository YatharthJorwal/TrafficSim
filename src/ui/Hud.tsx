import { useEffect, useState } from 'react';
import type { Measurements } from '../detectors';
import type { FixedStepLoop } from '../runtime';
import { APPROACHES, type Approach, type SignalColor } from '../sim/types';

const NAMES: Record<Approach, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };

interface HudData {
  circulating: boolean;
  fleet: number;
  time: number;
  onRoad: number;
  generated: number;
  entered: number;
  exited: number;
  redEntries: number;
  overlaps: number;
  guard: number;
  signalLine: string;
  controllerNote: string;
  overridden: boolean;
  colors: Record<Approach, SignalColor>;
  m: Readonly<Measurements>;
  backlog: Record<Approach, number>;
}

function read(loop: FixedStepLoop): HudData {
  const r = loop.runner;
  const e = r.engine;
  const s = e.stats;
  const snap = r.machine.status;
  const overridden = r.snapshot().overridden;
  return {
    circulating: e.isCirculating,
    fleet: e.fleetSize,
    time: e.time,
    onRoad: e.vehiclesOnNetwork,
    generated: s.generated,
    entered: s.enteredIntersection,
    exited: s.exited,
    redEntries: s.redLightEntries,
    overlaps: s.overlapPairSteps,
    guard: s.safetyClamps,
    overridden,
    signalLine: `${r.controller.name} | phase ${snap.phase} | ${snap.stage} ${snap.elapsed.toFixed(1)}s${snap.nextPhase ? ` -> ${snap.nextPhase}` : ''}`,
    controllerNote: r.controller.describe?.() ?? '',
    colors: { ...e.signals },
    m: r.detectors.measurements,
    backlog: { N: e.backlogCount('N'), E: e.backlogCount('E'), S: e.backlogCount('S'), W: e.backlogCount('W') },
  };
}

const f1 = (n: number) => n.toFixed(1);

/** Live panel. Polls the loop a few times per second in its own state so the 3D scene never re-renders. */
export function Hud({ loop }: { loop: FixedStepLoop }) {
  const [d, setD] = useState<HudData>(() => read(loop));
  useEffect(() => {
    setD(read(loop));
    const id = setInterval(() => setD(read(loop)), 250);
    return () => clearInterval(id);
  }, [loop]);

  return (
    <div className="side">
      <section>
        <h3>Simulation</h3>
        <div className="kv">
          <span>Clock</span><b>{`${Math.floor(d.time / 60)}:${String(Math.floor(d.time % 60)).padStart(2, '0')}`}</b>
          <span>Vehicles on road</span><b>{d.onRoad}</b>
          {d.circulating ? (
            <>
              <span>Fleet (vehicles)</span><b>{d.fleet}</b>
              <span>Junction crossings</span><b>{d.entered}</b>
              <span>Arm exits (legs completed)</span><b>{d.exited}</b>
            </>
          ) : (
            <>
              <span>Generated</span><b>{d.generated}</b>
              <span>Entered intersection</span><b>{d.entered}</b>
              <span>Exited network</span><b>{d.exited}</b>
            </>
          )}
        </div>
      </section>

      <section>
        <h3>Signals</h3>
        <p className={d.overridden ? 'warn' : 'muted'}>
          {d.overridden ? 'DEBUG OVERRIDE: controller and safety layer bypassed' : d.signalLine}
        </p>
        {!d.overridden && d.controllerNote && <p className="muted small">{d.controllerNote}</p>}
        <div className="lights">
          {APPROACHES.map((a) => (
            <span key={a} className="light">
              <i className={`dot ${d.colors[a]}`} />{a}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h3>Detector measurements</h3>
        <p className="muted small">
          <b>Observed</b> values are counted by the zone detectors. <b>Estimated</b> values are derived and can be off.
          These are the inputs a controller receives.
        </p>
        <table className="mt">
          <thead>
            <tr><th></th>{APPROACHES.map((a) => <th key={a} title={NAMES[a]}>{a}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="grp"><td colSpan={5}>Observed</td></tr>
            <Row label="In zone" vals={APPROACHES.map((a) => String(d.m[a].observed.inZone))} />
            <Row label="Approaching" vals={APPROACHES.map((a) => String(d.m[a].observed.approaching))} />
            <Row label="Queue (veh)" vals={APPROACHES.map((a) => `${d.m[a].observed.zoneOverflow ? '≥' : ''}${d.m[a].observed.queueLength}`)} />
            <Row label="Queue (m)" vals={APPROACHES.map((a) => f1(d.m[a].observed.queueLengthM))} />
            <Row label="Avg wait (s)" vals={APPROACHES.map((a) => f1(d.m[a].observed.avgWait))} />
            <Row label="Max wait (s)" vals={APPROACHES.map((a) => f1(d.m[a].observed.maxWait))} />
            <Row label="Arrivals / window" vals={APPROACHES.map((a) => String(d.m[a].observed.arrivals))} />
            <Row label="Departures / window" vals={APPROACHES.map((a) => String(d.m[a].observed.departures))} />
            <tr className="grp est"><td colSpan={5}>Estimated</td></tr>
            <Row est label="Demand (veh/h)" vals={APPROACHES.map((a) => d.m[a].estimated.demandVehPerHour.toFixed(0))} />
            <tr className="grp"><td colSpan={5}>Not seen by detectors</td></tr>
            <Row label="Entry backlog" vals={APPROACHES.map((a) => String(d.backlog[a]))} />
          </tbody>
        </table>
        <p className="muted small">≥ means the queue reached the end of the detector zone and is under-counted.</p>
      </section>

      <section>
        <h3>Safety counters</h3>
        <div className="kv">
          <span>Red-light entries</span><b>{d.redEntries}</b>
          <span>Body overlaps</span><b>{d.overlaps}</b>
          <span>Anti-overlap guard hits</span><b>{d.guard}</b>
        </div>
      </section>
    </div>
  );
}

function Row({ label, vals, est }: { label: string; vals: string[]; est?: boolean }) {
  return (
    <tr className={est ? 'est' : undefined}>
      <td>{label}</td>
      {vals.map((v, i) => <td key={i} className="num">{v}</td>)}
    </tr>
  );
}
