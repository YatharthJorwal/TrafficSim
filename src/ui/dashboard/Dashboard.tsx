import { useMemo, useState } from 'react';
import publishedCsv from '../../../docs/results/runs.csv?raw';
import {
  METRICS,
  controllerLabel,
  metricByKey,
  profileLabel,
  rowControllers,
  rowProfiles,
  rowSeeds,
  rowsFromCsv,
  rowsToCsv,
  strongestFixed,
} from '../../experiments';
import type { ControllerSeries } from '../../experiments';
import { BarChart } from '../charts/BarChart';
import { LineChart, type LineSeries } from '../charts/LineChart';
import { formatClock } from '../charts/scale';
import { Cards } from './Cards';
import { Overview } from './Overview';
import { Repro } from './Repro';
import { RunPanel } from './RunPanel';
import { barData, buildCards, buildExportReport, controllerColor, defaultForm, describeProfile, formToSettings, type RunForm } from './model';
import { download } from './download';
import { useExperimentWorker } from './useExperimentWorker';

const CANDIDATE = 'adaptive';
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
type Source = 'published' | 'browser';

/** Series for one measure, one line per controller, in the order the controllers ran. */
function lines(series: Record<string, ControllerSeries>, pick: 'queue' | 'unserved'): LineSeries[] {
  return Object.entries(series).map(([id, s]) => ({
    id,
    label: controllerLabel(id),
    color: controllerColor(id),
    points: s[pick].map((p) => ({ x: p.t, y: p.mean, lo: p.min, hi: p.max })),
  }));
}

export default function Dashboard() {
  const published = useMemo(() => rowsFromCsv(publishedCsv), []);
  const [source, setSource] = useState<Source>('published');
  const [form, setForm] = useState<RunForm>(defaultForm);
  const { state, run, cancel } = useExperimentWorker();
  const [profilePick, setProfilePick] = useState<string>('');
  const [baselinePick, setBaselinePick] = useState<string>('auto');
  const [metricKey, setMetricKey] = useState<string>('meanWait');

  const output = state.output;
  const rows = source === 'published' ? published : output?.rows ?? [];
  const profiles = rowProfiles(rows);
  const profileId = profiles.includes(profilePick) ? profilePick : profiles[0] ?? '';
  const controllers = rowControllers(rows);
  const fixedIds = controllers.filter((c) => c.startsWith('fixed'));
  const baselineId = baselinePick !== 'auto' && fixedIds.includes(baselinePick) ? baselinePick : strongestFixed(rows, profileId);
  const metric = metricByKey(metricKey);
  const seeds = rowSeeds(rows.filter((r) => r.profileId === profileId));
  const duration = rows.find((r) => r.profileId === profileId)?.duration;
  const cards = baselineId ? buildCards(rows, profileId, CANDIDATE, baselineId) : [];
  const profileText = source === 'browser' && output ? describeProfile(output.settings.profile) : profileLabel(profileId);

  const exportJson = () =>
    download(
      source === 'published' ? 'traffic-sim-published-results.json' : 'traffic-sim-run.json',
      'application/json',
      JSON.stringify(
        buildExportReport({
          appVersion: APP_VERSION,
          exportedAt: new Date().toISOString(),
          source,
          rows,
          repro: source === 'browser' ? output?.info : undefined,
          command: source === 'published' ? 'npm run experiment -- --duration 1800 --seeds 8' : undefined,
        }),
        null,
        2,
      ),
    );

  const settingsJson = () => download('traffic-sim-settings.json', 'application/json', JSON.stringify(output?.settings ?? formToSettings(form), null, 2));

  return (
    <div className="dash">
      <div className="filters" role="group" aria-label="Filters">
        <div className="seg" role="tablist" aria-label="Results source">
          <button type="button" role="tab" aria-selected={source === 'published'} className={source === 'published' ? 'on' : ''} onClick={() => setSource('published')}>Published results</button>
          <button type="button" role="tab" aria-selected={source === 'browser'} className={source === 'browser' ? 'on' : ''} onClick={() => setSource('browser')}>Run in browser</button>
        </div>
        <label>Demand profile
          <select value={profileId} onChange={(e) => setProfilePick(e.target.value)} disabled={profiles.length <= 1}>
            {profiles.map((p) => <option key={p} value={p}>{profileLabel(p)}</option>)}
          </select>
        </label>
        <label>Compare adaptive with
          <select value={baselineId ?? ''} onChange={(e) => setBaselinePick(e.target.value)} disabled={fixedIds.length === 0}>
            {fixedIds.map((id) => <option key={id} value={id}>{controllerLabel(id)}{id === strongestFixed(rows, profileId) ? ' (strongest)' : ''}</option>)}
          </select>
        </label>
        <label>Chart metric
          <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <span className="muted small filter-note">
          {rows.length ? `${seeds.length} seeds × ${duration} s per run` : ''}
        </span>
      </div>

      {source === 'browser' && <RunPanel form={form} onChange={setForm} onRun={() => run(formToSettings(form))} onCancel={cancel} state={state} />}

      {rows.length === 0 ? (
        <section className="panel"><p className="muted">No results yet. Choose a demand profile and press Run to compare the controllers on identical traffic.</p></section>
      ) : (
        <>
          <section className="panel">
            <h3>{baselineId ? `Adaptive against ${controllerLabel(baselineId)}` : 'Results'}</h3>
            <p className="muted small">{profileText}. Every wait counts all generated vehicles, including any still queued or waiting to enter when the run ends.</p>
            {cards.length > 0 ? <Cards cards={cards} baselineLabel={controllerLabel(baselineId!)} /> : <p className="muted small">Include the adaptive controller and at least one fixed-time controller to see the comparison cards.</p>}
          </section>

          <section className="panel">
            <BarChart
              title={`${metric.label} by controller`}
              unit={metric.unit}
              digits={metric.key === 'avgQueue' ? 2 : 1}
              data={barData(rows, profileId, metricKey)}
              note={`Bar = mean over ${seeds.length} seeds. Whisker = ± one standard deviation. Dots = individual seeds. ${metric.lowerIsBetter ? 'Lower is better.' : 'Higher is better.'}`}
            />
          </section>

          {source === 'browser' && output && (
            <section className="panel">
              <h3>Over time</h3>
              <div className="two">
                <LineChart
                  title="Vehicles waiting to be served"
                  yLabel="vehicles"
                  xLabel="Simulated time (m:ss). Line = mean over seeds, band = lowest to highest seed. Generated minus exited, including the entry backlog."
                  xFormat={formatClock}
                  series={lines(output.series, 'unserved')}
                  width={440}
                  height={210}
                  yDigits={0}
                  empty="Run the comparison to see this."
                />
                <LineChart
                  title="Detector queue"
                  yLabel="vehicles"
                  xLabel="Simulated time (m:ss). Total queue seen by the four detectors; each zone holds about 13 vehicles, so it levels off when overloaded."
                  xFormat={formatClock}
                  series={lines(output.series, 'queue')}
                  width={440}
                  height={210}
                  yDigits={1}
                  empty="Run the comparison to see this."
                />
              </div>
            </section>
          )}
          {source === 'published' && <p className="muted small hint">Time-series charts are drawn for runs made in your browser. Switch to <b>Run in browser</b> to see queues build and clear.</p>}

          <Overview rows={rows} candidateId={CANDIDATE} onPick={setProfilePick} />

          <Repro source={source} rows={rows} profileId={profileId} profileText={profileText} repro={source === 'browser' ? output?.info ?? null : null} appVersion={APP_VERSION} />

          <section className="panel">
            <h3>Export</h3>
            <div className="form-row">
              <button type="button" onClick={() => download(source === 'published' ? 'traffic-sim-published-runs.csv' : 'traffic-sim-runs.csv', 'text/csv', rowsToCsv(rows))}>Runs (CSV)</button>
              <button type="button" onClick={exportJson}>Full report (JSON)</button>
              {source === 'browser' && <button type="button" onClick={settingsJson}>Settings (JSON)</button>}
              <span className="muted small">{rows.length} runs, one row each. The JSON also holds the summary and the reproducibility details.</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
