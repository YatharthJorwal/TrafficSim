import { formatNumber, formatSigned } from '../charts/scale';
import type { CardModel } from './model';

const VERDICT_TEXT = { better: 'Adaptive is better', worse: 'Adaptive is worse', 'no clear difference': 'No clear difference' } as const;
const VERDICT_ICON = { better: '✓', worse: '✕', 'no clear difference': '–' } as const;

/**
 * Metric cards: the candidate's value, the baseline's, the paired difference with its 95 % interval, and a verdict that is
 * only "better" or "worse" when that interval excludes zero. Verdicts carry an icon and words, never colour alone.
 */
export function Cards({ cards, baselineLabel }: { cards: readonly CardModel[]; baselineLabel: string }) {
  return (
    <div className="cards">
      {cards.map((c) => {
        const d = c.paired.difference;
        const needsSeeds = d.ci95 === null;
        const seeds = c.paired.better + c.paired.tied + c.paired.worse;
        return (
          <article className="card" key={c.key}>
            <div className="card-label">{c.label}</div>
            <div className="card-value">{formatNumber(c.candidate.mean, c.digits)}<small> {c.unit}</small></div>
            <div className="card-sub">{formatNumber(c.baseline.mean, c.digits)} {c.unit} for {baselineLabel}</div>
            <div className="card-delta" title="Adaptive minus baseline, paired by seed, with the 95 % confidence half-width of the mean difference">
              {formatSigned(d.mean, c.digits)}{d.ci95 !== null && ` ± ${formatNumber(d.ci95, c.digits)}`} {c.unit}
            </div>
            <div className={`chip ${c.verdict === 'better' ? 'good' : c.verdict === 'worse' ? 'bad' : 'neutral'}`}>
              <span aria-hidden="true">{VERDICT_ICON[c.verdict]}</span> {VERDICT_TEXT[c.verdict]}
            </div>
            <div className="muted small">
              {needsSeeds ? 'Needs at least 2 seeds for a verdict.' : `${c.paired.better} better · ${c.paired.tied} tied · ${c.paired.worse} worse, of ${seeds} seeds`}
            </div>
          </article>
        );
      })}
    </div>
  );
}
