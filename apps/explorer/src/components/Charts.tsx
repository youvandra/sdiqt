import type { FleetDay } from "../lib/fleet.ts";
import { num } from "../lib/format.ts";

const W = 1080;
const H = 220;
const PAD = { top: 16, right: 0, bottom: 28, left: 40 };

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Highest value the y axis shows. One day far above the rest (a rollup that
 * posted its whole history at once) would flatten every other bar, so such a
 * day is drawn clipped with its value printed on it.
 */
function axisMax(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const [top = 0, second = 0] = sorted;
  const cap = top > 4 * second && second > 0 ? Math.ceil(second * 1.6) : top;
  return Math.max(4, niceCeil(cap));
}
function niceCeil(n: number): number {
  if (n <= 10) return Math.ceil(n / 2) * 2;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (step / 2)) * (step / 2);
}

/** Batches per day across every watched rollup, the reference rollup stacked on top. */
export function ActivityChart({ days, reference }: { days: FleetDay[]; reference: string }) {
  if (days.length === 0) return null;
  const max = axisMax(days.map((d) => d.reference + d.others));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const bar = Math.max(4, Math.min(28, slot * 0.62));
  const y = (v: number) => PAD.top + plotH - (Math.min(v, max) / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const ticks = [0, max / 2, max];

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Batches per day across all rollups, ${dayLabel(days[0]?.day ?? 0)} to today`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="chart-grid"
              data-base={t === 0}
            />
            <text x={PAD.left - 10} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {num(Math.round(t))}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - bar) / 2;
          const total = d.reference + d.others;
          const clipped = total > max;
          const othersTop = y(d.others);
          const refTop = y(d.others + d.reference);
          return (
            <g key={d.day} className="chart-day">
              <title>
                {`${dayLabel(d.day)}: ${num(total)} batches, ${num(d.reference)} on ${reference}`}
              </title>
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                className="chart-hit"
              />
              {d.others > 0 && (
                <rect
                  x={x}
                  y={othersTop}
                  width={bar}
                  height={y(0) - othersTop}
                  rx={2}
                  className="chart-bar"
                  data-series="others"
                />
              )}
              {d.reference > 0 && !clipped && (
                <rect
                  x={x}
                  y={refTop}
                  width={bar}
                  height={othersTop - refTop}
                  rx={2}
                  className="chart-bar"
                  data-series="reference"
                />
              )}
              {clipped && (
                <>
                  <rect
                    x={x - 2}
                    y={PAD.top + 10}
                    width={bar + 4}
                    height={4}
                    className="chart-break"
                  />
                  <text
                    x={x + bar / 2}
                    y={PAD.top + 30}
                    className="chart-value"
                    textAnchor="middle"
                  >
                    {num(total)}
                  </text>
                </>
              )}
              {i % labelEvery === 0 && (
                <text x={x + bar / 2} y={H - 8} className="chart-tick" textAnchor="middle">
                  {dayLabel(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        <span className="legend-group">
          <span className="legend-key" data-series="reference" /> {reference}
        </span>
        <span className="legend-group">
          <span className="legend-key" data-series="others" /> Other teams' rollups
        </span>
        <span className="legend-group">Batches per day, UTC</span>
      </figcaption>
    </figure>
  );
}

/** Batches per day, last 14 days, as 14 small bars. */
export function Sparkline({ counts, label }: { counts: number[]; label: string }) {
  const max = Math.max(1, ...counts);
  const w = 84;
  const h = 24;
  const slot = w / counts.length;
  return (
    <svg
      className="spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
    >
      {counts.map((c, i) => {
        const bh = c === 0 ? 1 : Math.max(3, (c / max) * h);
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per fixed day slot
            key={i}
            x={i * slot + 1}
            y={h - bh}
            width={slot - 2}
            height={bh}
            rx={1}
            data-empty={c === 0}
          />
        );
      })}
    </svg>
  );
}
