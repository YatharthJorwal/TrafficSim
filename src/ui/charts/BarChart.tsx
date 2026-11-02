import { useRef, useState } from 'react';
import { formatNumber, linear, niceCeil, niceTicks } from './scale';

/** One bar: a controller (or any entity) with its mean, spread and every individual seed's value. */
export interface BarDatum {
  id: string;
  label: string;
  /** CSS colour, normally a `var(--series-n)` token. Colour follows the entity, never its rank. */
  color: string;
  mean: number;
  sd: number;
  /** Individual seed values, shown as dots over the bar. */
  values: number[];
  seeds: number[];
}

interface Props {
  title: string;
  unit: string;
  data: readonly BarDatum[];
  digits?: number;
  /** Short note under the chart (what the bar, whisker and dots mean). */
  note?: string;
}

const W = 720;
const ROW = 46;
const BAR = 20;
const L = 196;
const R = 92;
const T = 8;
const B = 30;
const RADIUS = 4;

/** Bar whose data end (right) is rounded by 4 px and whose baseline end (left) is square. */
function barPath(x0: number, x1: number, y: number, h: number): string {
  const w = x1 - x0;
  if (w <= 0.5) return '';
  const r = Math.min(RADIUS, w, h / 2);
  return `M${x0},${y} H${x1 - r} a${r},${r} 0 0 1 ${r},${r} V${y + h - r} a${r},${r} 0 0 1 -${r},${r} H${x0} Z`;
}

/** Horizontal bars with a mean ± standard-deviation whisker and one dot per seed. Hover or focus a row for the numbers. */
export function BarChart({ title, unit, data, digits = 1, note }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [table, setTable] = useState(false);

  const H = T + data.length * ROW + B;
  const top = Math.max(0, ...data.flatMap((d) => [d.mean + d.sd, ...d.values]));
  const ticks = niceTicks(0, niceCeil(top * 1.02), 5);
  const max = ticks[ticks.length - 1] || 1;
  const x = linear(0, max, L, W - R);
  const fmt = (v: number) => formatNumber(v, digits);
  const active = data.find((d) => d.id === tip?.id);

  const place = (id: string, clientX: number | null, rowIndex: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const y = T + rowIndex * ROW + ROW / 2;
    setTip({
      id,
      x: clientX === null ? (x(data[rowIndex].mean) / W) * box.width : clientX - box.left,
      y: (y / H) * box.height,
    });
  };

  return (
    <figure className="chart" ref={wrap}>
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <button type="button" className="chart-toggle" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'Chart' : 'Table'}
        </button>
      </figcaption>

      {table ? (
        <table className="mt chart-table">
          <thead>
            <tr><th>Controller</th><th>Mean</th><th>Std dev</th><th>Lowest</th><th>Highest</th><th>Seeds</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td>{d.label}</td>
                <td className="num">{fmt(d.mean)}</td>
                <td className="num">{fmt(d.sd)}</td>
                <td className="num">{fmt(Math.min(...d.values))}</td>
                <td className="num">{fmt(Math.max(...d.values))}</td>
                <td className="num">{d.values.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${fmt(d.mean)} ${unit}`).join('; ')}`} onPointerLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="grid" />
              <text x={x(t)} y={H - B + 16} textAnchor="middle">{fmt(t)}</text>
            </g>
          ))}
          <text x={W - R} y={H - 2} textAnchor="end" className="axis-title">{unit}</text>
          {data.map((d, i) => {
            const cy = T + i * ROW + ROW / 2;
            const y0 = cy - BAR / 2;
            const lo = Math.max(0, d.mean - d.sd);
            const hi = d.mean + d.sd;
            const tipX = Math.max(x(d.mean), x(hi), ...d.values.map(x)) + 10;
            return (
              <g
                key={d.id}
                tabIndex={0}
                role="group"
                aria-label={`${d.label}: mean ${fmt(d.mean)} ${unit}, standard deviation ${fmt(d.sd)}, ${d.values.length} seeds`}
                className={`bar-row${tip?.id === d.id ? ' hot' : ''}`}
                onPointerMove={(e) => place(d.id, e.clientX, i)}
                onFocus={() => place(d.id, null, i)}
                onBlur={() => setTip(null)}
              >
                <rect x={0} y={cy - ROW / 2} width={W} height={ROW} className="hit" />
                <rect x={8} y={cy - 5} width={10} height={10} rx={2} style={{ fill: d.color }} />
                <text x={26} y={cy + 4}>{d.label}</text>
                <path d={barPath(x(0), x(d.mean), y0, BAR)} style={{ fill: d.color }} className="bar" />
                {d.sd > 0 && (
                  <g className="whisker">
                    <line x1={x(lo)} x2={x(hi)} y1={cy} y2={cy} />
                    <line x1={x(lo)} x2={x(lo)} y1={cy - 6} y2={cy + 6} />
                    <line x1={x(hi)} x2={x(hi)} y1={cy - 6} y2={cy + 6} />
                  </g>
                )}
                {d.values.map((v, k) => (
                  <circle key={k} cx={x(v)} cy={cy + ((k % 3) - 1) * 5} r={4} style={{ stroke: d.color }} className="seed-dot" />
                ))}
                <text x={tipX} y={cy + 4} className="val">{fmt(d.mean)}</text>
              </g>
            );
          })}
        </svg>
      )}

      <ul className="legend">
        {data.map((d) => (
          <li key={d.id}><i style={{ background: d.color }} />{d.label}</li>
        ))}
      </ul>
      {note && <p className="muted small">{note}</p>}

      {!table && tip && active && (
        <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
          <b>{fmt(active.mean)} {unit}</b>
          <span>{active.label}</span>
          <span>± {fmt(active.sd)} std dev over {active.values.length} seeds</span>
          <span>lowest {fmt(Math.min(...active.values))}, highest {fmt(Math.max(...active.values))}</span>
        </div>
      )}
    </figure>
  );
}
