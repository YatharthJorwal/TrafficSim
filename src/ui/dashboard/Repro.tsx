import { controllerLabel, rowControllers, rowSeeds, rowsFor, type ReproInfo, type RunRow } from '../../experiments';

interface Props {
  source: 'published' | 'browser';
  rows: readonly RunRow[];
  profileId: string;
  profileText: string;
  repro: ReproInfo | null;
  appVersion: string;
}

const PUBLISHED_COMMAND = 'npm run experiment -- --duration 1800 --seeds 8 --md docs/RESULTS.md --csv docs/results/runs.csv';

/** Everything needed to inspect and repeat the numbers on screen: seeds, schedule fingerprints, controller settings, versions. */
export function Repro({ source, rows, profileId, profileText, repro, appVersion }: Props) {
  const scoped = rows.filter((r) => r.profileId === profileId);
  const seeds = rowSeeds(scoped);
  const duration = scoped[0]?.duration;
  const schedule = (seed: number) => scoped.find((r) => r.seed === seed)?.schedule ?? '';
  const sharedOk = seeds.every((s) => new Set(scoped.filter((r) => r.seed === s).map((r) => r.schedule)).size === 1);

  return (
    <section className="panel">
      <h3>Reproducibility</h3>
      <div className="kv repro">
        <span>Source</span><b>{source === 'published' ? 'Published results (docs/results/runs.csv)' : 'Run in this browser'}</b>
        <span>Demand</span><b>{profileText}</b>
        <span>Simulated time per run</span><b>{duration ? `${duration} s` : 'n/a'}</b>
        <span>Seeds</span><b>{seeds.length ? `${seeds[0]} to ${seeds[seeds.length - 1]} (${seeds.length})` : 'n/a'}</b>
        <span>Same schedule for every controller</span><b>{sharedOk ? 'yes (fingerprints match)' : 'NO: fingerprints differ'}</b>
        <span>App version</span><b>{appVersion}</b>
        {repro && (
          <>
            <span>Timestep</span><b>{repro.engine.dt} s (fixed)</b>
            <span>Signal timing</span><b>yellow {repro.engine.signalTiming.yellow} s, all-red {repro.engine.signalTiming.allRed} s, green {repro.engine.signalTiming.minGreen}-{repro.engine.signalTiming.maxGreen} s</b>
            <span>Webster saturation flow</span><b>{repro.engine.saturationFlow} veh per green hour</b>
          </>
        )}
      </div>

      <details>
        <summary>Arrival schedule fingerprints</summary>
        <p className="muted small">A fingerprint is a short checksum of every arrival time, turn and speed factor. Two runs with the same fingerprint saw exactly the same traffic.</p>
        <table className="mt">
          <thead><tr><th>Seed</th><th>Vehicles : checksum</th></tr></thead>
          <tbody>{seeds.map((s) => <tr key={s}><td className="num">{s}</td><td><code>{schedule(s)}</code></td></tr>)}</tbody>
        </table>
      </details>

      <details>
        <summary>Controller settings</summary>
        {repro ? (
          <table className="mt">
            <thead><tr><th>Controller</th><th>Settings</th></tr></thead>
            <tbody>
              {repro.controllers.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    {c.description}
                    {c.adaptiveConfig && <div className="muted small">{Object.entries(c.adaptiveConfig).map(([k, v]) => `${k} ${v}`).join(', ')}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">
            Controllers: {rowControllers(rows).map((id) => `${controllerLabel(id)} (${rowsFor(rows, profileId, id).length} runs)`).join(', ')}. The Webster and searched
            plans are computed per profile by the experiment command; the plan used is listed in docs/RESULTS.md and docs/DECISIONS.md.
          </p>
        )}
      </details>

      <p className="muted small">
        {source === 'published'
          ? <>Repeat with <code>{PUBLISHED_COMMAND}</code>. The same seeds always give the same numbers.</>
          : <>Download the settings below, then use <b>Import settings</b> to run exactly the same experiment again. The same seeds always give the same numbers.</>}
      </p>
    </section>
  );
}
