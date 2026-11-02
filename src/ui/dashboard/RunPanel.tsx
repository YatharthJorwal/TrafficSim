import { useRef, useState } from 'react';
import { APPROACHES, type Approach } from '../../sim/types';
import { BROWSER_CONTROLLERS, LIMITS, PROFILES, controllerLabel, validateSettings, type BrowserControllerId } from '../../experiments';
import type { WorkerState } from './useExperimentWorker';
import { formToSettings, formFromSettings, presetForm, settingsFromJson, withRate, withTurnMix, type RunForm } from './model';

const NAMES: Record<Approach, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };
const DURATIONS = [300, 600, 900, 1800];
const SEEDS = [2, 3, 4, 6, 8];

interface Props {
  form: RunForm;
  onChange: (f: RunForm) => void;
  onRun: () => void;
  onCancel: () => void;
  state: WorkerState;
}

/** Demand per approach, turn mix, horizon, seeds and controllers for an in-browser paired run. */
export function RunPanel({ form, onChange, onRun, onCancel, state }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const running = state.status === 'running';
  const editable = form.preset === 'custom';
  const rates = form.profile.segments[0].rates;
  const mix = form.profile.turnMix;
  const mixTotal = mix.left + mix.straight + mix.right;
  const issues = validateSettings(formToSettings(form));
  const runs = form.seeds * form.controllers.length;
  const roughSeconds = Math.max(1, Math.ceil((runs * form.duration * 1.5) / 1800));

  const toggle = (id: BrowserControllerId) =>
    onChange({ ...form, controllers: form.controllers.includes(id) ? form.controllers.filter((c) => c !== id) : BROWSER_CONTROLLERS.filter((c) => c === id || form.controllers.includes(c)) });

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const parsed = settingsFromJson(await f.text());
    if (parsed.settings) {
      setImportError(null);
      onChange(formFromSettings(parsed.settings));
    } else setImportError(parsed.error ?? 'Could not read that file.');
    if (file.current) file.current.value = '';
  };

  return (
    <section className="panel runpanel">
      <h3>Run your own comparison</h3>
      <p className="muted small">
        Every controller runs on the identical arrival schedule for each seed, in the background, using the same engine and metrics as the published results.
      </p>

      <div className="form-row">
        <label>Demand
          <select value={form.preset} disabled={running} onChange={(e) => onChange(presetForm(form, e.target.value))}>
            {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="custom">Custom</option>
            {form.preset === 'imported' && <option value="imported">Imported</option>}
          </select>
        </label>
        {APPROACHES.map((a) => (
          <label key={a} title={`${NAMES[a]} approach, vehicles per hour`}>{a}
            <input type="number" min={0} max={LIMITS.maxRate} step={50} value={rates[a]} disabled={!editable || running} onChange={(e) => onChange(withRate(form, a, Math.max(0, Number(e.target.value) || 0)))} />
          </label>
        ))}
        <span className="muted small">veh/h per approach</span>
      </div>
      {form.profile.segments.length > 1 && <p className="muted small">{form.profile.description}.</p>}

      <div className="form-row">
        <span className="muted small">Turn mix %</span>
        {(['left', 'straight', 'right'] as const).map((k) => (
          <label key={k}>{k}
            <input type="number" min={0} max={100} step={5} value={Math.round(mix[k] * 100)} disabled={!editable || running} onChange={(e) => onChange(withTurnMix(form, { ...mix, [k]: Math.max(0, Number(e.target.value) || 0) / 100 }))} />
          </label>
        ))}
        {Math.abs(mixTotal - 1) > 0.005 && editable && <span className="muted small">adds up to {Math.round(mixTotal * 100)}%, so it is scaled to 100%</span>}
      </div>

      <div className="form-row">
        <label>Simulated time
          <select value={form.duration} disabled={running} onChange={(e) => onChange({ ...form, duration: Number(e.target.value) })}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d / 60} min</option>)}
          </select>
        </label>
        <label>Seeds
          <select value={form.seeds} disabled={running} onChange={(e) => onChange({ ...form, seeds: Number(e.target.value) })}>
            {SEEDS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {BROWSER_CONTROLLERS.map((id) => (
          <label key={id} className="check">
            <input type="checkbox" checked={form.controllers.includes(id)} disabled={running} onChange={() => toggle(id)} />
            {controllerLabel(id)}
          </label>
        ))}
      </div>

      <div className="form-row">
        {running ? (
          <button type="button" onClick={onCancel}>Cancel</button>
        ) : (
          <button type="button" className="primary" onClick={onRun} disabled={issues.length > 0}>Run {runs} simulations</button>
        )}
        <span className="muted small">{running ? `${state.done} of ${state.total} done` : `roughly ${roughSeconds} s`}</span>
        <label className="file">Import settings
          <input ref={file} type="file" accept="application/json,.json" disabled={running} onChange={(e) => void importFile(e.target.files?.[0])} />
        </label>
      </div>
      {running && <progress max={state.total || 1} value={state.done} aria-label="Experiment progress" />}
      {form.duration < 600 && <p className="muted small">Short runs are dominated by the empty-road start; use 10 minutes or more for steadier numbers.</p>}
      {issues.length > 0 && <p className="warn">{issues.join('. ')}.</p>}
      {importError && <p className="warn">{importError}</p>}
      {state.status === 'error' && <p className="warn">{state.error}</p>}
      {state.status === 'cancelled' && <p className="muted small">Cancelled. The previous results are still shown.</p>}
    </section>
  );
}
