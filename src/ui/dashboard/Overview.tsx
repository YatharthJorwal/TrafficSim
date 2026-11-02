import { controllerLabel, metricByKey, pairRows, profileLabel, rowControllers, rowProfiles, rowsFor, strongestFixed, summarizeRows, verdict, type RunRow } from '../../experiments';
import { formatNumber, formatSigned } from '../charts/scale';

const WORDS = { better: 'Adaptive better', worse: 'Adaptive worse', 'no clear difference': 'No clear difference' } as const;
const ICON = { better: '✓', worse: '✕', 'no clear difference': '–' } as const;

/**
 * Adaptive against the strongest fixed-time plan on every profile at once, so a loss is as visible as a win.
 * The strongest fixed plan is the fixed controller with the lowest mean wait on that profile.
 */
export function Overview({ rows, candidateId, onPick }: { rows: readonly RunRow[]; candidateId: string; onPick: (profileId: string) => void }) {
  if (!rowControllers(rows).includes(candidateId)) return null;
  const m = metricByKey('meanWait');
  return (
    <section className="panel">
      <h3>All profiles at a glance</h3>
      <p className="muted small">Mean wait over all generated vehicles, adaptive against the fixed plan that did best on each profile. Select a row to look closer.</p>
      <div className="table-scroll">
        <table className="mt overview">
          <thead>
            <tr><th>Profile</th><th>Strongest fixed plan</th><th>Fixed (s)</th><th>Adaptive (s)</th><th>Difference (s)</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {rowProfiles(rows).map((p) => {
              const fixedId = strongestFixed(rows, p);
              if (!fixedId || rowsFor(rows, p, candidateId).length === 0) return null;
              const paired = pairRows(rows, p, fixedId, candidateId, 'meanWait');
              const v = verdict(paired, m.lowerIsBetter);
              const d = paired.difference;
              return (
                <tr key={p} className="pick" tabIndex={0} onClick={() => onPick(p)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(p)}>
                  <td>{profileLabel(p)}</td>
                  <td>{controllerLabel(fixedId)}</td>
                  <td className="num">{formatNumber(summarizeRows(rows, p, fixedId, 'meanWait').mean, 1)}</td>
                  <td className="num">{formatNumber(summarizeRows(rows, p, candidateId, 'meanWait').mean, 1)}</td>
                  <td className="num">{formatSigned(d.mean, 1)}{d.ci95 !== null && ` ± ${formatNumber(d.ci95, 1)}`}</td>
                  <td><span className={`chip ${v === 'better' ? 'good' : v === 'worse' ? 'bad' : 'neutral'}`}><span aria-hidden="true">{ICON[v]}</span> {WORDS[v]}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
