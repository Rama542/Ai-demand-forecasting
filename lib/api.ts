/**
 * Typed request helpers for the FastAPI backend.
 *
 * Every function returns real data or throws — nothing is ever substituted with
 * a locally generated placeholder. Callers render an explicit empty or error
 * state instead.
 */

import { PERIODS } from "./format";

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

/** Strip a trailing slash so path joins stay predictable. */
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

export const WS_BASE = (() => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return API_BASE.replace(/^http/, "ws");
})();

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    if (first?.msg) return first.msg;
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 30_000, ...options } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      throw new ApiError(
        messageFromDetail((payload as { detail?: unknown })?.detail, response.statusText),
        response.status,
      );
    }

    /*
     * Several analysis endpoints answer 200 with { "error": "..." } when the
     * requested window has no usable history — the backtester, the research
     * bundle, portfolio analysis and the correlation matrix all do this. Left
     * as a success, that object reaches a component which then reads, say,
     * `.trade_log.length` on undefined and crashes the page. Converting it to
     * a real failure here, once, means every caller renders its own error
     * state with the backend's actual explanation.
     */
    const failure = payload as { error?: unknown } | null;
    if (failure && typeof failure.error === "string" && failure.error.length > 0) {
      throw new ApiError(failure.error, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request took too long and was cancelled.");
    }
    throw new ApiError("Could not reach the analytics service. Check that the API is running.");
  } finally {
    clearTimeout(timer);
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/* ---- Response shapes ---------------------------------------------------- */

export type Interval = "1m" | "5m" | "15m" | "30m" | "1H" | "1D" | "1W";
/**
 * The research periods are declared once, in lib/format.ts, and the type is
 * derived from that list — so a window can never be added to the dropdown
 * without the type following it.
 */
export type Period = (typeof PERIODS)[number];

/** Narrow an untrusted query-string value onto a valid research period. */
export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export interface LiveStatus {
  mode: string;
  is_live: boolean;
  healthy: boolean;
  last_sync: string | null;
  age_seconds: number | null;
  source: string | null;
  error: string | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResponse {
  symbol: string;
  interval: Interval;
  source: string;
  live: LiveStatus;
  candles: Candle[];
  notice?: string | null;
}

export interface Quote {
  symbol: string;
  name: string;
  interval: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  spark?: number[];
  day_high?: number;
  day_low?: number;
}

export interface HealthResponse {
  status: string;
  engine?: string;
  data_mode?: string;
  version?: string;
  market_ready?: boolean;
  model_ready?: boolean;
  live?: LiveStatus;
  providers?: Record<string, unknown>;
}

export interface Forecast {
  direction: "UP" | "DOWN" | string;
  probability: number;
  last_close: number;
  horizon: string;
}

export interface ForecastSummary {
  symbol?: string;
  interval?: string;
  direction_accuracy: number | null;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  mae: number | null;
  rmse: number | null;
  brier: number | null;
  confidence_calibration?: number | null;
  samples: number | { train: number; test: number } | null;
  model: string;
  latest_forecast: Forecast | null;
  rolling_accuracy?: { bucket: number; accuracy: number; samples: number }[];
}

export interface AccuracyResponse extends ForecastSummary {
  rolling_accuracy: { bucket: number; accuracy: number; samples: number }[];
}

export interface DashboardResponse {
  market: Quote;
  indices: Quote[];
  live: LiveStatus;
  forecast: ForecastSummary;
  bars: number[];
  model_ready: boolean;
  data_mode: string;
}

export interface Instrument {
  symbol: string;
  name: string;
  sector: string;
  base_price: number;
  decimals: number;
  kind: string;
  group: string;
  universes: string[];
}

export interface InstrumentsResponse {
  instruments: Instrument[];
  sectors: { sector: string; count: number; symbols: string[] }[];
}

export interface UniverseGroup {
  label: string;
  count: number;
  symbols: string[];
}

export interface Universes {
  groups: UniverseGroup[];
  total_symbols: number;
  note: string;
}

export interface StrategyCard {
  name: string;
  summary: string;
  formula: string;
  equations: string[];
  uses: string[];
  best_for: string;
}

export interface ExecutionNotes {
  signal: string;
  fill: string;
  stop: string;
  cost: string;
  return: string;
  drawdown: string;
  sharpe: string;
  profit_factor: string;
  holdout: string;
}

export interface StrategiesResponse {
  strategies: string[];
  catalog: StrategyCard[];
  execution: ExecutionNotes;
}

export interface EquityPoint {
  time: number;
  equity: number;
  position?: string;
}

export interface MonthlyReturn {
  period: string;
  year: number;
  month: number;
  return_pct: number;
}

export interface Trade {
  entry_time: number;
  exit_time: number;
  direction: string;
  entry: number;
  exit: number;
  shares: number;
  return_pct: number;
  pnl: number;
  costs: number;
  bars_held: number;
  mae_pct: number;
  exit_reason: string;
  r_multiple?: number;
}

export interface BacktestResult {
  symbol: string;
  strategy: string;
  interval: string;
  trades: number;
  long_trades: number;
  short_trades: number;
  win_rate: number;
  net_return: number;
  return_pct: number;
  cagr: number | null;
  max_drawdown: number;
  drawdown_days: number;
  recovery_to_peak_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  profit_factor: number | null;
  expectancy_pct: number | null;
  avg_win_pct: number | null;
  avg_loss_pct: number | null;
  payoff_ratio: number | null;
  avg_bars_held: number | null;
  avg_mae_pct: number | null;
  best_trade_pct: number | null;
  worst_trade_pct: number | null;
  exposure_pct: number | null;
  buy_hold_return: number;
  alpha_vs_buy_hold: number;
  final_equity: number;
  initial_capital: number;
  net_profit: number;
  total_costs_pct: number;
  atr_mult: number;
  total_return_multiple: number | null;
  equity_curve: number[];
  equity_points: EquityPoint[];
  drawdown_series: number[];
  monthly_returns: MonthlyReturn[];
  trade_log: Trade[];
  period_start: number | null;
  period_end: number | null;
  recent_40pct: Record<string, unknown>;
  candles_analyzed: number;
  cost_pct: number;
  data_source: string;
  execution: ExecutionNotes;
  disclaimer: string;
  warning?: string;
}

export interface Pillar {
  pillar: string;
  score: number;
  detail: string;
}

export interface MarketCondition {
  symbol: string;
  name: string;
  period: string;
  candles: number;
  health_score: number;
  verdict: string;
  pillars: Pillar[];
  observations: string[];
  risks: string[];
  monitor: string[];
  historical_context: string;
  sector_leaders: { sector: string; change_pct: number }[];
  disclaimer: string;
  error?: string;
}

export interface CorrelationPair {
  a: string;
  b: string;
  value: number;
  strength: string;
}

export interface CorrelationMatrix {
  assets: { symbol: string; name: string; sector: string }[];
  matrix: number[][];
  pairs: CorrelationPair[];
  observations: number;
  period: string;
  average_pairwise: number;
  disclaimer?: string;
}

export interface PortfolioPosition {
  symbol: string;
  name: string;
  sector: string;
  weight_pct: number;
  return_pct: number;
  volatility_pct: number;
  universes: string;
}

export interface PortfolioAnalysis {
  positions: PortfolioPosition[];
  sectors: { sector: string; weight_pct: number; share_of_book: number }[];
  period: string;
  observations: number;
  weighted_return_pct: number;
  weighted_volatility_pct: number;
  effective_positions: number;
  diversification_score: number;
  risk_level: string;
  correlation: CorrelationMatrix;
  highest_correlation: CorrelationPair | null;
  lowest_correlation: CorrelationPair | null;
  overlapping_pairs: CorrelationPair[];
  risks: string[];
  strengths: string[];
  weighting_note: string;
  disclaimer: string;
  error?: string;
}

export interface Contribution {
  feature: string;
  label: string;
  contribution: number;
  direction: "bullish" | "bearish";
}

export interface Explanation {
  symbol: string;
  name?: string;
  period?: string;
  direction: string;
  probability_up: number;
  base_value: number;
  contributions: Contribution[];
  drivers: Contribution[];
  headwinds: Contribution[];
  model: string;
  samples: number;
  method?: string;
  data_source?: string;
  disclaimer: string;
  error?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  body: string;
}

export interface ResearchReport {
  symbol: string;
  name: string;
  sector: string;
  period: string;
  generated_at: string;
  sections: ReportSection[];
  disclaimer: string;
  error?: string;
}

export interface ScenarioResult {
  scenario: string;
  horizon: string;
  summary: string;
  sector_effects: string[];
  confidence: string;
  disclaimer: string;
}

export interface TechnicalSummary {
  symbol: string;
  name: string;
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  adx: number | null;
  atr: number | null;
  atr_pct: number | null;
  bb_upper: number | null;
  bb_mid: number | null;
  bb_lower: number | null;
  support_20: number | null;
  resistance_20: number | null;
  vwap: number | null;
  realised_vol_pct: number | null;
  period: string;
  candles: number;
  error?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at: string;
  symbols: string[];
  sentiment: string;
}

export interface NewsResponse {
  items: NewsItem[];
  source: string;
  count: number;
  notice: string;
}

export interface CalendarEvent {
  date: string;
  title: string;
  importance: string;
  country: string;
  forecast?: string | null;
  previous?: string | null;
  actual?: string | null;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  count: number;
  notice: string;
}

export interface MentorTurn {
  role: "user" | "assistant";
  content: string;
}

export interface MentorReply {
  answer: string;
  topic: string;
  provider: string;
  model: string | null;
  disclaimer: string;
  error?: string;
}

export interface IndicatorReading {
  id: string;
  label: string;
  value: string;
  formula: string;
  selected: boolean;
  last_close: number | null;
}

export interface InstrumentMeta {
  symbol: string;
  name: string;
  sector: string;
  universes: string[];
  primary_group: string;
  base: number;
  kind: string;
}

export interface ResearchBundle {
  symbol: string;
  meta: InstrumentMeta;
  period: string;
  interval: Interval;
  quote: Quote | null;
  candles: Candle[];
  technicals: TechnicalSummary;
  indicator_readings: IndicatorReading[];
  explanation: Explanation;
  forecast: ForecastSummary;
  strategy: StrategyCard[];
  disclaimer: string;
  error?: string;
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<HealthResponse>("/api/health", { signal, timeoutMs: 15_000 }),

  dashboard: (signal?: AbortSignal) =>
    request<DashboardResponse>("/api/dashboard", { signal, timeoutMs: 60_000 }),

  instruments: (signal?: AbortSignal) =>
    request<InstrumentsResponse>("/api/market/instruments", {
      signal,
      timeoutMs: 20_000,
    }),

  universes: (signal?: AbortSignal) =>
    request<Universes>("/api/market/universes", { signal, timeoutMs: 20_000 }),

  quote: (symbol: string, signal?: AbortSignal) =>
    request<Quote>(`/api/market/quote${qs({ symbol })}`, { signal, timeoutMs: 20_000 }),

  candles: (
    params: { symbol: string; interval?: Interval; limit?: number },
    signal?: AbortSignal,
  ) =>
    request<CandleResponse>(`/api/market/candles${qs(params)}`, {
      signal,
      timeoutMs: 45_000,
    }),

  strategies: (signal?: AbortSignal) =>
    request<StrategiesResponse>("/api/backtests/strategies", { signal, timeoutMs: 20_000 }),

  runBacktest: (
    payload: {
      symbol: string;
      strategy: string;
      period: Period;
      initial_capital: number;
      atr_mult: number;
      cost_pct: number;
    },
    signal?: AbortSignal,
  ) =>
    request<BacktestResult>("/api/backtests/run", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
      timeoutMs: 180_000,
    }),

  equity: (
    params: { symbol: string; strategy: string; period: Period },
    signal?: AbortSignal,
  ) =>
    request<{
      symbol: string;
      strategy: string;
      period: string;
      equity_points: EquityPoint[];
      drawdown_series: number[];
      monthly_returns: MonthlyReturn[];
      final_equity: number;
      net_return: number;
      max_drawdown: number;
    }>(`/api/backtests/equity${qs(params)}`, { signal, timeoutMs: 120_000 }),

  marketCondition: (params: { symbol?: string; period?: Period } = {}, signal?: AbortSignal) =>
    request<MarketCondition>(`/api/market-doctor/market${qs(params)}`, {
      signal,
      timeoutMs: 120_000,
    }),

  correlations: (payload: { symbols: string[]; period: Period }, signal?: AbortSignal) =>
    request<CorrelationMatrix>("/api/correlations", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
      timeoutMs: 120_000,
    }),

  defaultCorrelations: (signal?: AbortSignal) =>
    request<CorrelationMatrix>("/api/correlations/default", { signal, timeoutMs: 120_000 }),

  portfolio: (payload: { holdings: string[]; period: Period }, signal?: AbortSignal) =>
    request<PortfolioAnalysis>("/api/portfolio/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
      timeoutMs: 120_000,
    }),

  sectors: (signal?: AbortSignal) =>
    request<{ sectors: { sector: string; count: number; symbols: string[] }[] }>("/api/sectors", {
      signal,
      timeoutMs: 60_000,
    }),

  /** Free-text what-if. The service maps the narrative onto affected sectors. */
  scenario: (payload: { scenario: string; horizon?: string }, signal?: AbortSignal) =>
    request<ScenarioResult>("/api/scenarios/run", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
      timeoutMs: 120_000,
    }),

  /** One call with everything the research workspace needs for one instrument. */
  researchBundle: (params: { symbol: string; period?: Period }, signal?: AbortSignal) =>
    request<ResearchBundle>(`/api/research/${encodeURIComponent(params.symbol)}${qs({ period: params.period })}`, {
      signal,
      timeoutMs: 240_000,
    }),

  explanation: (params: { symbol: string; period?: Period }, signal?: AbortSignal) =>
    request<Explanation>(`/api/explain/${encodeURIComponent(params.symbol)}${qs({ period: params.period })}`, {
      signal,
      timeoutMs: 180_000,
    }),

  research: (params: { symbol: string; period?: Period; strategy?: string }, signal?: AbortSignal) =>
    request<ResearchReport>(`/api/reports/research${qs(params)}`, {
      signal,
      timeoutMs: 240_000,
    }),

  accuracy: (signal?: AbortSignal) =>
    request<AccuracyResponse>("/api/forecast/accuracy", { signal, timeoutMs: 120_000 }),

  news: (params: { symbol?: string } = {}, signal?: AbortSignal) =>
    request<NewsResponse>(`/api/news${qs(params)}`, { signal, timeoutMs: 30_000 }),

  calendar: (signal?: AbortSignal) =>
    request<CalendarResponse>("/api/calendar/events", { signal, timeoutMs: 30_000 }),

  mentor: (payload: { message: string; symbol?: string }, signal?: AbortSignal) =>
    request<MentorReply>("/api/mentor/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
      timeoutMs: 60_000,
    }),
};
