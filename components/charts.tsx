'use client';

/**
 * Charts for the Performance page.
 *
 * Deliberate choices, per the data's job:
 *  - Headline numbers are stat tiles with a sparkline, not one-bar charts.
 *  - The trend is a SINGLE series, so there is no legend — the title names what
 *    is plotted — and the hue is one sequential blue rather than a categorical
 *    set. Never two y-scales.
 *  - The all-metrics comparison is a horizontal bar list (long metric names),
 *    one hue, magnitude ordered.
 *
 * Mark specs: 2px lines, ~10% area wash, >=8px end markers with a 2px surface
 * ring, <=24px bars with a 4px rounded data end and a square baseline, hairline
 * recessive gridlines. Values use text tokens, never the data colour.
 */

import { useId, useMemo, useState } from 'react';

import type { MetricSeries } from '@/lib/types';

const BRAND = 'var(--color-brand-600)';
const BRAND_SOFT = 'var(--color-brand-500)';

function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/* ------------------------------- sparkline ------------------------------- */

export function Sparkline({ points, label }: { points: { date: string; value: number }[]; label: string }) {
  const gradientId = useId();
  if (points.length < 2) return null;

  const width = 120;
  const height = 32;
  const max = Math.max(...points.map((p) => p.value), 1);

  const coords = points.map((point, index) => ({
    x: (index / (points.length - 1)) * width,
    y: height - (point.value / max) * (height - 4) - 2,
  }));

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = coords[coords.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} trend`}
      className="h-8 w-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BRAND_SOFT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={BRAND_SOFT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={BRAND}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* End marker: >=8px, ringed in the surface colour so it stays legible. */}
      <circle cx={last.x} cy={last.y} r={4} fill={BRAND} stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------ trend chart ------------------------------ */

export function TrendChart({ series }: { series: MetricSeries }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const points = series.daily;
  const max = useMemo(() => niceCeiling(Math.max(...points.map((p) => p.value), 1)), [points]);

  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Not enough days in this range to draw a trend.
      </p>
    );
  }

  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (i: number) => padLeft + (i / (points.length - 1)) * plotW;
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${padTop + plotH} L${padLeft},${padTop + plotH} Z`;

  const ticks = [0, max / 2, max];
  const active = hover != null ? points[hover] : null;

  function locate(clientX: number, target: SVGSVGElement) {
    const box = target.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.min(Math.max(index, 0), points.length - 1));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`${series.label} over time. Total ${formatNumber(series.total)}.`}
        onMouseMove={(e) => locate(e.clientX, e.currentTarget)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => e.touches[0] && locate(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => e.touches[0] && locate(e.touches[0].clientX, e.currentTarget)}
        onTouchEnd={() => setHover(null)}
      >
        {/* Recessive hairline gridlines, solid, one step off the surface. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={padLeft - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-ink-400 text-[11px]"
            >
              {formatNumber(Math.round(tick))}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND_SOFT} stopOpacity="0.16" />
            <stop offset="100%" stopColor={BRAND_SOFT} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={BRAND}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* First and last day only — axis labels stay sparse by design. */}
        <text x={padLeft} y={height - 8} className="fill-ink-400 text-[11px]">
          {formatDay(points[0]!.date)}
        </text>
        <text x={width - padRight} y={height - 8} textAnchor="end" className="fill-ink-400 text-[11px]">
          {formatDay(points[points.length - 1]!.date)}
        </text>

        {hover != null && active ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />
            <circle
              cx={x(hover)}
              cy={y(active.value)}
              r={5}
              fill={BRAND}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>

      {hover != null && active ? (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-pop"
          style={{
            left: `${((x(hover) - padLeft) / plotW) * 100 * (plotW / width) + (padLeft / width) * 100}%`,
          }}
        >
          <p className="text-[11px] text-ink-500">{formatDay(active.date)}</p>
          <p className="tnum text-sm font-semibold text-ink-950">{formatNumber(active.value)}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------- metric breakdown --------------------------- */

/**
 * Magnitude comparison across metrics. Horizontal because the metric names are
 * long, single-hue because the job is magnitude (not identity), and ordered so
 * the ranking is readable without any labels on the axis.
 */
export function MetricBars({ series }: { series: MetricSeries[] }) {
  const ordered = [...series].sort((a, b) => b.total - a.total);
  const max = Math.max(...ordered.map((s) => s.total), 1);

  return (
    <ul className="space-y-3">
      {ordered.map((entry) => {
        const pct = (entry.total / max) * 100;
        return (
          <li key={entry.metric}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[0.8125rem] text-ink-600">{entry.label}</span>
              <span className="tnum shrink-0 text-[0.8125rem] font-semibold text-ink-900">
                {formatNumber(entry.total)}
              </span>
            </div>
            {/* Track is one step off the surface; the bar is the only ink. */}
            <div className="h-2.5 w-full overflow-hidden rounded-l-[2px] rounded-r bg-subtle">
              <div
                className="h-full rounded-r"
                style={{
                  width: `${Math.max(pct, entry.total > 0 ? 2 : 0)}%`,
                  backgroundColor: BRAND,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------- table view ------------------------------ */

/** Accessible fallback: every plotted value, readable and copyable. */
export function MetricTable({ series }: { series: MetricSeries[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Total for each metric in the selected range</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-2 pr-3 text-[0.8125rem] font-medium text-ink-500">
              Metric
            </th>
            <th scope="col" className="py-2 text-right text-[0.8125rem] font-medium text-ink-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => (
            <tr key={entry.metric} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-3 text-ink-700">{entry.label}</td>
              <td className="tnum py-2.5 text-right font-medium text-ink-950">
                {formatNumber(entry.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
