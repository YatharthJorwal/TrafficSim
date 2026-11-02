import { useMemo, useRef, useState } from 'react';
import { formatNumber, linear, nearestIndex, niceCeil, niceTicks, thin } from './scale';

export interface LinePoint {
  x: number;
  y: number;
  /** Optional range (for example lowest and highest seed), drawn as a faint band. */
  lo?: number;
  hi?: number;
}

export interface LineSeries {
  id: string;
  label: string;
  /** CSS colour, normally a `var(--series-n)` token. */
  color: string;
  points: readonly LinePoint[];
}

/** A row of on/off spans under the plot, for example "N/S green". Identity comes from the row, not a colour. */
export interface Strip {
  label: string;
  spans: readonly (readonly [number, number])[];
}

interface Props {
  title: string;
  series: readonly LineSeries[];
  xLabel: string;
  yLabel: string;
  xFormat?: (x: number) => string;
  yDigits?: number;
  /** Width of the drawing in SVG units. Smaller values give larger text in a narrow panel. */
  width?: number;
  height?: number;
  strips?: readonly Strip[];
  empty?: string;
  tableLimit?: number;
  note?: string;
}

const T = 24;
const AXIS = 24;
const STRIP = 12;
const STRIP_GAP = 4;

/** Lines with an optional range band, a hover crosshair that lists every series, a legend and a table view. */
export function LineChart({ title, series, xLabel, yLabel, xFormat = (x) => formatNumber(x, 0), yDigits = 1, width = 720, height = 220, strips = [], empty = 'No data yet.', tableLimit = 60, note }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const L = width < 480 ? 34 : 46;
  const R = width < 480 ? 22 : 70;
  const stripsH = strips.length ? strips.length * (STRIP + STRIP_GAP) + 2 : 0;
  const H = T + height + AXIS + stripsH;
  const plotBottom = T + height;

  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b), [series]);
  const hasData = xs.length > 0;
  const xMin = xs[0] ?? 0;
  const xMax = xs[xs.length - 1] ?? 1;
  const top = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.hi ?? p.y)));
  const yTicks = niceTicks(0, niceCeil(top * 1.05 || 1), 4);
  const yMax = yTicks[yTicks.length - 1] || 1;
  const sx = linear(xMin, xMax, L, width - R);
  const sy = linear(0, yMax, plotBottom, T);
  const xTicks = niceTicks(xMin, xMax, width < 480 ? 4 : 6);
  const fmtY = (v: number) => formatNumber(v, yDigits);

  const move = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    setHoverX(((clientX - box.left) / box.width) * width);
  };

  const hoverIdx = hoverX === null || !hasData ? -1 : nearestIndex(xs, xMin + ((hoverX - L) / (width - R - L || 1)) * (xMax - xMin));
  const hx = hoverIdx >= 0 ? xs[hoverIdx] : null;
  const valueAt = (s: LineSeries, x: number) => s.points[nearestIndex(s.points.map((p) => p.x), x)];

  const line = (s: LineSeries) => s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const band = (s: LineSeries) => {
    const withRange = s.points.filter((p) => p.lo !== undefined && p.hi !== undefined);
    if (withRange.length < 2) return '';
    const up = withRange.map((p) => `${sx(p.x).toFixed(1)},${sy(p.hi!).toFixed(1)}`);
    const down = [...withRange].reverse().map((p) => `${sx(p.x).toFixed(1)},${sy(p.lo!).toFixed(1)}`);
    return `M${up.join(' L')} L${down.join(' L')} Z`;
  };

  // Direct end labels only where they do not collide; the legend and the tooltip carry the rest.
  const labelled = new Set<string>();
  const placed: number[] = [];
  [...series]
    .filter((s) => s.points.length)
    .sort((a, b) => a.points[a.points.length - 1].y - b.points[b.points.length - 1].y)
    .forEach((s) => {
      const y = sy(s.points[s.points.length - 1].y);
      if (series.length <= 4 && placed.every((p) => Math.abs(p - y) >= 13)) {
        placed.push(y);
        labelled.add(s.id);
      }
    });

  const tableXs = thin(xs, tableLimit);
  const tipLeft = hx === null ? 0 : (sx(hx) / width) * (wrap.current?.getBoundingClientRect().width ?? width);
  const flip = hx !== null && sx(hx) > width * 0.55;

  return (
    <figure className="chart" ref={wrap}>
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <button type="button" className="chart-toggle" onClick={() => setTable((t) => !t)} aria-pressed={table} disabled={!hasData}>
          {table ? 'Chart' : 'Table'}
        </button>
      </figcaption>

      {!hasData ? (
        <p className="muted small chart-empty">{empty}</p>
      ) : table ? (
        <div className="chart-table-wrap">
          <table className="mt chart-table">
            <thead>
              <tr><th>{xLabel}</th>{series.map((s) => <th key={s.id}>{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {tableXs.map((x) => (
                <tr key={x}>
                  <td>{xFormat(x)}</td>
                  {series.map((s) => <td key={s.id} className="num">{fmtY(valueAt(s, x)?.y ?? NaN)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`${title}: ${series.map((s) => `${s.label} ends at ${fmtY(s.points[s.points.length - 1]?.y ?? NaN)} ${yLabel}`).join('; ')}`}
          onPointerMove={(e) => move(e.clientX)}
          onPointerLeave={() => setHoverX(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={L} x2={width - R} y1={sy(t)} y2={sy(t)} className="grid" />
              <text x={L - 6} y={sy(t) + 4} textAnchor="end">{fmtY(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={plotBottom + 16} textAnchor="middle">{xFormat(t)}</text>
          ))}
          <text x={4} y={T - 12} className="axis-title" textAnchor="start">{yLabel}</text>

          {series.map((s) => (
            <g key={s.id}>
              {band(s) && <path d={band(s)} style={{ fill: s.color }} className="band" />}
              <path d={line(s)} style={{ stroke: s.color }} className="series-line" />
            </g>
          ))}
          {series.map((s) => {
            const last = s.points[s.points.length - 1];
            if (!last) return null;
            return (
              <g key={`${s.id}-end`}>
                <circle cx={sx(last.x)} cy={sy(last.y)} r={4} style={{ fill: s.color }} className="dot" />
                {labelled.has(s.id) && width >= 480 && <text x={sx(last.x) + 9} y={sy(last.y) + 4} className="end-label">{s.label.replace(/ \(.*\)$/, '')}</text>}
              </g>
            );
          })}

          {strips.map((st, i) => {
            const y = plotBottom + AXIS + i * (STRIP + STRIP_GAP);
            return (
              <g key={st.label}>
                <text x={L - 6} y={y + STRIP - 2} textAnchor="end">{st.label}</text>
                <line x1={L} x2={width - R} y1={y + STRIP / 2} y2={y + STRIP / 2} className="grid" />
                {st.spans.map(([a, b], k) => (
                  <rect key={k} x={sx(a)} y={y} width={Math.max(1.5, sx(b) - sx(a))} height={STRIP} rx={2} className="strip" />
                ))}
              </g>
            );
          })}

          {hx !== null && (
            <g className="cross">
              <line x1={sx(hx)} x2={sx(hx)} y1={T} y2={plotBottom} />
              {series.map((s) => {
                const p = valueAt(s, hx);
                return p ? <circle key={s.id} cx={sx(hx)} cy={sy(p.y)} r={4} style={{ fill: s.color }} className="dot" /> : null;
              })}
            </g>
          )}
        </svg>
      )}

      {series.length >= 2 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.id}><i className="key-line" style={{ background: s.color }} />{s.label}</li>
          ))}
        </ul>
      )}
      <p className="muted small">{note ?? xLabel}</p>

      {!table && hx !== null && (
        <div className={`tip${flip ? ' flip' : ''}`} style={{ left: tipLeft, top: 28 }} role="status">
          <span>{xFormat(hx)}</span>
          {series.map((s) => (
            <span key={s.id} className="row">
              <i className="key-line" style={{ background: s.color }} />
              <b>{fmtY(valueAt(s, hx)?.y ?? NaN)}</b> {s.label}
              {valueAt(s, hx)?.lo !== undefined && <em> ({fmtY(valueAt(s, hx)!.lo!)} to {fmtY(valueAt(s, hx)!.hi!)})</em>}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
