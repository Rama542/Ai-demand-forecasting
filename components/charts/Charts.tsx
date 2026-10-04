"use client";

import * as React from "react";
import { compact, date, num } from "@/lib/format";

export interface SeriesPoint {
  time: number;
  value: number;
}

/* ---- Scales ------------------------------------------------------------- */

function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - Math.abs(min || 1) * 0.05, max + Math.abs(max || 1) * 0.05];
  return [min, max];
}

/** Deterministic tick positions inside [min, max]. */
function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) {
    out.push(Number(value.toFixed(10)));
  }
  return out;
}

/** Pick ~4 evenly spaced dates as x labels. */
function timeTicks(points: SeriesPoint[], count = 4): SeriesPoint[] {
  if (points.length <= count) return points;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < count; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (count - 1))]);
  }
  return out;
}

/* ---- Shared frame ------------------------------------------------------- */

interface FrameProps {
  points: SeriesPoint[];
  height: number;
  reference?: { value: number; label: string; tone?: "bull" | "bear" | "accent" } | null;
}

export interface AreaChartProps extends Omit<FrameProps, never> {
  color?: string;
  showAxis?: boolean;
  formatValue?: (value: number) => string;
}

function useFrame({ points, height }: Pick<FrameProps, "points" | "height">) {
  const width = 900;
  const padding = { top: 12, right: 56, bottom: 22, left: 8 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = React.useMemo(() => points.map((p) => p.value), [points]);
  const [min, max] = React.useMemo(() => extent(values), [values]);

  const x = React.useCallback(
    (index: number) =>
      padding.left +
      (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW),
    [points.length, innerW],
  );

  const y = React.useCallback(
    (value: number) => padding.top + innerH - ((value - min) / (max - min)) * innerH,
    [min, max, innerH],
  );

  const linePath = React.useMemo(() => {
    if (points.length === 0) return "";
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`)
      .join(" ");
  }, [points, x, y]);

  const areaPath = React.useMemo(() => {
    if (points.length === 0 || !linePath) return "";
    const baseline = y(Math.max(min, min));
    return `${linePath} L${x(points.length - 1).toFixed(2)},${baseline} L${x(0).toFixed(2)},${baseline} Z`;
  }, [linePath, x, y, points.length, min]);

  return { width, padding, innerW, innerH, min, max, x, y, linePath, areaPath, values };
}

/* ---- Area chart --------------------------------------------------------- */

export function AreaChart({
  points,
  height = 240,
  color = "var(--accent)",
  formatValue = (v: number) => compact(v),
  reference = null,
  showAxis = true,
}: AreaChartProps) {
  const frame = useFrame({ points, height });
  const { width, padding, innerH, min, max, x, y, linePath, areaPath } = frame;
  const gradientId = React.useId();

  if (points.length === 0) {
    return (
      <div className="state" style={{ padding: "var(--sp-8) 0" }}>
        <p className="faint">No series to plot.</p>
      </div>
    );
  }

  const yTicks = ticks(min, max, 5);
  const xTicks = timeTicks(points, 4);
  const last = points[points.length - 1];

  return (
    <div className="chart-box">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        style={{ height }}
        role="img"
        aria-label={`Line chart from ${date(points[0].time)} to ${date(last.time)}, latest ${formatValue(last.value)}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
            {showAxis ? (
              <text
                x={width - padding.right + 6}
                y={y(value)}
                dominantBaseline="middle"
                fontSize="10"
                fill="var(--text-tertiary)"
                className="num"
              >
                {formatValue(value)}
              </text>
            ) : null}
          </g>
        ))}

        {xTicks.map((point, index) => (
          <text
            key={`${point.time}-${index}`}
            x={x(points.indexOf(point))}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
            fontSize="10"
            fill="var(--text-tertiary)"
          >
            {date(point.time)}
          </text>
        ))}

        {reference ? (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke={reference.tone === "bull" ? "var(--bull)" : reference.tone === "bear" ? "var(--bear)" : "var(--accent)"}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.6"
            />
            <text
              x={padding.left + 4}
              y={y(reference.value) - 4}
              fontSize="9"
              fill="var(--text-tertiary)"
            >
              {reference.label}
            </text>
          </g>
        ) : null}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" fill={color} />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="6" fill={color} opacity="0.16" />
      </svg>
    </div>
  );
}

/* ---- Candle chart ------------------------------------------------------- */

export interface OhlcPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export function CandleChart({
  candles,
  height = 280,
}: {
  candles: OhlcPoint[];
  height?: number;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (candles.length === 0) {
    return (
      <div className="state" style={{ padding: "var(--sp-8) 0" }}>
        <p className="faint">No candles returned for this window.</p>
      </div>
    );
  }

  const width = 900;
  const padding = { top: 10, right: 56, bottom: 22, left: 8 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const volumeH = innerH * 0.18;
  const priceH = innerH - volumeH - 6;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const [min, max] = React.useMemo<[number, number]>(() => {
    const [lo] = extent(lows);
    const [, hi] = extent(highs);
    const pad = (hi - lo) * 0.06 || hi * 0.01;
    return [lo - pad, hi + pad];
  }, [lows, highs]);

  const maxVolume = Math.max(...candles.map((c) => c.volume ?? 0), 1);
  const slot = innerW / candles.length;
  const bodyW = Math.max(1.5, Math.min(9, slot * 0.62));

  const y = (value: number) => padding.top + priceH - ((value - min) / (max - min)) * priceH;
  const vy = (volume: number) => padding.top + priceH + 6 + volumeH - (volume / maxVolume) * volumeH;

  const yTicks = ticks(min, max, 5);
  const xTicks = timeTicks(candles as unknown as SeriesPoint[], 4);
  const active = hover === null ? null : candles[hover];

  return (
    <div className="chart-box" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        style={{ height }}
        role="img"
        aria-label={`Candlestick chart, ${candles.length} candles, ${date(candles[0].time)} to ${date(candles[candles.length - 1].time)}`}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const svgX = ((event.clientX - rect.left) / rect.width) * width;
          const index = Math.round((svgX - padding.left) / slot);
          setHover(index >= 0 && index < candles.length ? index : null);
        }}
      >
        {yTicks.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--chart-grid)"
            />
            <text
              x={width - padding.right + 6}
              y={y(value)}
              dominantBaseline="middle"
              fontSize="10"
              fill="var(--text-tertiary)"
              className="num"
            >
              {compact(value)}
            </text>
          </g>
        ))}

        {xTicks.map((point, index) => (
          <text
            key={`${point.time}-${index}`}
            x={padding.left + (candles.indexOf(point as unknown as OhlcPoint) + 0.5) * slot}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
            fontSize="10"
            fill="var(--text-tertiary)"
          >
            {date(point.time)}
          </text>
        ))}

        {candles.map((candle, index) => {
          const cx = padding.left + (index + 0.5) * slot;
          const up = candle.close >= candle.open;
          const colour = up ? "var(--bull)" : "var(--bear)";
          const top = y(Math.max(candle.open, candle.close));
          const bottom = y(Math.min(candle.open, candle.close));
          return (
            <g key={candle.time} opacity={hover === null || hover === index ? 1 : 0.55}>
              <line x1={cx} x2={cx} y1={y(candle.high)} y2={y(candle.low)} stroke={colour} strokeWidth="1" />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} fill={colour} rx="0.5" />
              {candle.volume ? (
                <rect
                  x={cx - bodyW / 2}
                  y={vy(candle.volume)}
                  width={bodyW}
                  height={padding.top + priceH + 6 + volumeH - vy(candle.volume)}
                  fill={colour}
                  opacity="0.22"
                />
              ) : null}
            </g>
          );
        })}

        {active ? (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(active.close)}
              y2={y(active.close)}
              stroke="var(--text-tertiary)"
              strokeDasharray="2 3"
            />
            <circle cx={padding.left + (hover! + 0.5) * slot} cy={y(active.close)} r="3" fill="var(--accent)" />
          </g>
        ) : null}
      </svg>

      <div className="row wrap gap-4" style={{ marginTop: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
        {active ? (
          <>
            <span className="faint">{date(active.time)}</span>
            <span>O <b className="num">{num(active.open)}</b></span>
            <span>H <b className="num">{num(active.high)}</b></span>
            <span>L <b className="num">{num(active.low)}</b></span>
            <span>C <b className="num">{num(active.close)}</b></span>
            {active.volume ? (
              <span className="faint">
                Vol <b className="num">{compact(active.volume)}</b>
              </span>
            ) : null}
          </>
        ) : (
          <span className="faint">Hover a candle for its OHLC values.</span>
        )}
      </div>
    </div>
  );
}

/* ---- Bar chart ---------------------------------------------------------- */

export function BarChart({
  points,
  height = 200,
  formatValue = (v) => `${num(v, 2)}%`,
}: {
  points: SeriesPoint[];
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const frame = useFrame({ points, height });
  const { width, padding, min, max, x, innerH } = frame;
  const zero = Math.min(max, Math.max(min, 0));
  const yZero = padding.top + innerH - ((zero - min) / (max - min)) * innerH;
  const slot = (width - padding.left - padding.right) / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(16, slot * 0.66));

  if (points.length === 0) {
    return (
      <div className="state" style={{ padding: "var(--sp-8) 0" }}>
        <p className="faint">No bars to plot.</p>
      </div>
    );
  }

  return (
    <div className="chart-box">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        style={{ height }}
        role="img"
        aria-label="Monthly return bars"
      >
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={yZero}
          y2={yZero}
          stroke="var(--border-strong)"
          strokeWidth="1"
        />
        {points.map((point, index) => {
          const cy = frame.y(point.value);
          const colour = point.value >= 0 ? "var(--bull)" : "var(--bear)";
          const top = Math.min(cy, yZero);
          const barHeight = Math.max(1, Math.abs(cy - yZero));
          const isWide = slot > 26;
          return (
            <g key={point.time}>
              <rect
                x={x(index) - barW / 2}
                y={top}
                width={barW}
                height={barHeight}
                fill={colour}
                rx="2"
                opacity="0.85"
              >
                <title>{`${date(point.time)}: ${formatValue(point.value)}`}</title>
              </rect>
              {isWide ? (
                <text
                  x={x(index)}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--text-tertiary)"
                >
                  {date(point.time).slice(3)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---- Drawdown chart ----------------------------------------------------- */

export function DrawdownChart({
  points,
  height = 130,
}: {
  points: SeriesPoint[];
  height?: number;
}) {
  const frame = useFrame({ points, height });
  const { width, padding, min, y, innerH, max } = frame;
  const gradientId = React.useId();

  if (points.length === 0) {
    return (
      <div className="state" style={{ padding: "var(--sp-6) 0" }}>
        <p className="faint">No drawdown series.</p>
      </div>
    );
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${frame.x(index).toFixed(2)},${y(point.value).toFixed(2)}`)
    .join(" ");
  const baseline = padding.top + innerH;

  return (
    <div className="chart-box">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        style={{ height }}
        role="img"
        aria-label={`Underwater drawdown, deepest ${num(min)}%`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bear)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--bear)" stopOpacity="0.34" />
          </linearGradient>
        </defs>
        <path d={`${path} L${frame.x(points.length - 1)},${baseline} L${frame.x(0)},${baseline} Z`} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke="var(--bear)" strokeWidth="1.2" />
        <text x={width - padding.right + 6} y={y(max)} dominantBaseline="middle" fontSize="10" fill="var(--text-tertiary)">
          0%
        </text>
        <text x={width - padding.right + 6} y={y(min)} dominantBaseline="middle" fontSize="10" fill="var(--bear)" className="num">
          {num(min)}%
        </text>
      </svg>
    </div>
  );
}

/* ---- Sparkline ---------------------------------------------------------- */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  positive,
}: {
  values: number[];
  width?: number;
  height?: number;
  positive?: boolean;
}) {
  if (values.length < 2) return null;
  const [min, max] = extent(values);
  const colour = positive === undefined ? "var(--text-tertiary)" : positive ? "var(--bull)" : "var(--bear)";
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / (max - min)) * (height - 3) - 1.5;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: "visible", flex: "none" }}>
      <path d={path} fill="none" stroke={colour} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/* ---- Correlation heatmap ------------------------------------------------ */

export function CorrelationHeatmap({
  symbols,
  matrix,
  onSelect,
}: {
  symbols: string[];
  matrix: number[][];
  onSelect?: (a: string, b: string) => void;
}) {
  const [hover, setHover] = React.useState<{ r: number; c: number } | null>(null);

  if (symbols.length === 0 || matrix.length === 0) {
    return (
      <div className="state" style={{ padding: "var(--sp-6) 0" }}>
        <p className="faint">Not enough overlap to build a correlation matrix.</p>
      </div>
    );
  }

  const cell = 54;
  const labelW = 82;
  const height = labelW + symbols.length * cell;
  const width = labelW + symbols.length * cell + 8;

  /* Built from the theme's directional tokens, so no colour is named here. */
  const colour = (value: number) => {
    const strength = Math.abs(value);
    const alpha = Math.min(0.85, strength * 0.8);
    const token = value >= 0 ? "var(--bull)" : "var(--bear)";
    return `color-mix(in srgb, ${token} ${Math.round(alpha * 100)}%, transparent)`;
  };

  return (
    <div className="chart-box scroll-x">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height, minWidth: width }}
        role="img"
        aria-label={`Correlation matrix for ${symbols.join(", ")}`}
      >
        {symbols.map((symbol, row) => (
          <text
            key={`r-${symbol}`}
            x={labelW - 8}
            y={labelW + row * cell + cell / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--text-secondary)"
          >
            {symbol.length > 11 ? `${symbol.slice(0, 10)}…` : symbol}
          </text>
        ))}
        {symbols.map((colSymbol, col) => (
          <text
            key={`c-${colSymbol}`}
            x={labelW + col * cell + cell / 2}
            y={labelW - 8}
            textAnchor="start"
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--text-secondary)"
            transform={`rotate(-40 ${labelW + col * cell + cell / 2} ${labelW - 8})`}
          >
            {colSymbol.length > 11 ? `${colSymbol.slice(0, 10)}…` : colSymbol}
          </text>
        ))}
        {matrix.map((row, r) =>
          row.map((value, c) => (
            <g
              key={`${r}-${c}`}
              onMouseEnter={() => setHover({ r, c })}
              onMouseLeave={() => setHover(null)}
              onClick={() => r !== c && onSelect?.(symbols[r], symbols[c])}
              style={{ cursor: r !== c && onSelect ? "pointer" : "default" }}
            >
              <rect
                x={labelW + c * cell + 1}
                y={labelW + r * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx="4"
                fill={r === c ? "var(--bg-subtle)" : colour(value)}
                stroke={hover?.r === r && hover?.c === c ? "var(--text-primary)" : "transparent"}
                strokeWidth="1.5"
              />
              <text
                x={labelW + c * cell + cell / 2}
                y={labelW + r * cell + cell / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fontWeight="600"
                fill={Math.abs(value) > 0.45 ? "var(--tp-acc-ink)" : "var(--text-secondary)"}
                className="num"
              >
                {num(value, 2)}
              </text>
            </g>
          )),
        )}
      </svg>
    </div>
  );
}
