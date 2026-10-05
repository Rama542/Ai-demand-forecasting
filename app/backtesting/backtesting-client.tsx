"use client";

import * as React from "react";
import { Card, Button, Badge, Field, Metric, Tabs, Disclaimer, EmptyState, ScoreBar } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { AreaChart, BarChart, DrawdownChart } from "@/components/charts/Charts";
import { useAsync, useAction, AsyncBoundary } from "@/lib/hooks";
import { api, isPeriod, type BacktestResult, type Period, type StrategyCard, type Instrument } from "@/lib/api";
import {
  compact,
  date,
inr0,
  inrCompact,
  num,
  pct,
  pctPlain,
  ratio,
  tone,
  PERIODS,
} from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";
import { useSearchParams } from "next/navigation";
import { SymbolInput } from "@/components/SymbolInput";

type Tab = "overview" | "trades" | "monthly" | "method";

const DEFAULT_STRATEGY = "Moving Average Crossover";

export default function BacktestingPage() {
  const { notify } = useToast();
  const params = useSearchParams();

  const [symbol, setSymbol] = React.useState((params.get("symbol") ?? "RELIANCE").toUpperCase());
  const [strategy, setStrategy] = React.useState(DEFAULT_STRATEGY);
  const [period, setPeriod] = React.useState<Period>(() => {
    const requested = params.get("period");
    return isPeriod(requested) ? requested : "Last 2 years";
  });
  const [capital, setCapital] = React.useState(500_000);
  const [atrMult, setAtrMult] = React.useState(2);
  const [costPct, setCostPct] = React.useState(0.1);
  const [result, setResult] = React.useState<BacktestResult | null>(null);
  const [tab, setTab] = React.useState<Tab>("overview");
  const [catalogOpen, setCatalogOpen] = React.useState<StrategyCard | null>(null);
  const [instrumentsOpen, setInstrumentsOpen] = React.useState(false);

  const strategies = useAsync((signal) => api.strategies(signal), []);
  const instruments = useAsync((signal) => api.instruments(signal), [], { enabled: instrumentsOpen });

  /*
   * Next does not remount a route for a query-only navigation, so a link such
   * as "Verify with a backtest" from the reports page would otherwise leave
   * this form showing the previous instrument and window.
   */
  React.useEffect(() => {
    const requestedSymbol = params.get("symbol");
    if (requestedSymbol) setSymbol(requestedSymbol.toUpperCase());
    const requestedPeriod = params.get("period");
    if (isPeriod(requestedPeriod)) setPeriod(requestedPeriod);
  }, [params]);

  const run = useAction(async () => {
    const response = await api.runBacktest({
      symbol,
      strategy,
      period,
      initial_capital: capital,
      atr_mult: atrMult,
      cost_pct: costPct,
    });
    setResult(response);
    setTab("overview");
    notify(
      "success",
      `Backtest complete — ${response.trades} trades`,
      `${response.symbol} · ${response.strategy} · ${response.candles_analyzed} bars`,
    );
    return response;
  });

  const equityPoints = React.useMemo(
    () =>
      (result?.equity_points ?? []).map((point) => ({ time: point.time, value: point.equity })),
    [result],
  );
  const drawdownPoints = React.useMemo(
    () => (result?.drawdown_series ?? []).map((value, index) => ({ time: index, value })),
    [result],
  );
  const monthlyPoints = React.useMemo(
    () =>
      (result?.monthly_returns ?? []).map((month) => ({
        time: new Date(month.year, month.month - 1, 1).getTime() / 1000,
        value: month.return_pct,
      })),
    [result],
  );

  const metrics = result
    ? [
        { label: "Net return", value: pct(result.return_pct), hint: `${inr0(result.net_profit)} P&L`, tone: tone(result.return_pct) },
        { label: "Max drawdown", value: pctPlain(result.max_drawdown), hint: `${result.drawdown_days} days underwater`, tone: "bear" as const },
        { label: "Sharpe", value: ratio(result.sharpe), hint: "risk-adjusted" },
        { label: "Win rate", value: pctPlain(result.win_rate, 1), hint: `${result.trades} trades` },
        { label: "CAGR", value: pctPlain(result.cagr), hint: "annualised" },
        { label: "Profit factor", value: ratio(result.profit_factor), hint: "wins / losses" },
        { label: "Exposure", value: pctPlain(result.exposure_pct, 1), hint: "time in market" },
        { label: "vs buy & hold", value: pct(result.alpha_vs_buy_hold), hint: `B&H ${pct(result.buy_hold_return)}`, tone: tone(result.alpha_vs_buy_hold) },
      ]
    : [];

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Backtesting"
        description="Every metric below is computed from a bar-by-bar mark-to-market equity curve with next-bar execution. Nothing is rounded up or smoothed."
        actions={
          <Button variant="secondary" icon="report" onClick={() => setCatalogOpen(strategies.data?.catalog[0] ?? null)} disabled={!strategies.data}>
            Strategy catalogue
          </Button>
        }
      />

      <div className="grid grid-trio" style={{ alignItems: "start" }}>
        {/* ---- Controls ---- */}
        <Card title="Run configuration" className="stack">
          <Field label="Instrument">
            <div className="row gap-2">
              <SymbolInput value={symbol} onChange={setSymbol} aria-label="Symbol" />
              <Button variant="secondary" onClick={() => setInstrumentsOpen(true)} aria-label="Browse instruments">
                <Icon name="search" size={14} />
              </Button>
            </div>
          </Field>

          <Field label="Strategy">
            <select className="select" value={strategy} onChange={(event) => setStrategy(event.target.value)}>
              {(strategies.data?.strategies ?? [DEFAULT_STRATEGY]).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Lookback period">
            <select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              {PERIODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starting capital (₹)">
            <input
              className="input"
              type="number"
              min={10_000}
              step={10_000}
              value={capital}
              onChange={(event) => setCapital(Number(event.target.value) || 0)}
            />
          </Field>

          <div className="grid grid-2" style={{ gap: "var(--sp-3)" }}>
            <Field label="ATR stop multiple">
              <input
                className="input"
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={atrMult}
                onChange={(event) => setAtrMult(Number(event.target.value) || 0)}
              />
            </Field>
            <Field label="Round-trip cost %">
              <input
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={costPct}
                onChange={(event) => setCostPct(Number(event.target.value) || 0)}
              />
            </Field>
          </div>

          <Button variant="primary" icon="flask" block loading={run.pending} onClick={() => run.run()}>
            {result ? "Re-run backtest" : "Run backtest"}
          </Button>

          {run.error ? (
            <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
              <Icon name="alert" size={13} />
              <span>{run.error}</span>
            </p>
          ) : null}

          <Disclaimer>
            Fills happen at the next bar&apos;s open. Stops use ATR({atrMult}) intrabar. Costs of{" "}
            {costPct}% are charged on entry and exit.
          </Disclaimer>
        </Card>

        {/* ---- Results ---- */}
        <div className="stack" style={{ gridColumn: "span 2" }}>
          {!result && !run.pending ? (
            <Card>
              <EmptyState
                icon="flask"
                title="No backtest yet"
                description="Choose an instrument, strategy and period on the left, then run the test. The report will show the full equity curve, every trade and the monthly return profile."
                action={
                  <Button variant="primary" icon="flask" loading={run.pending} onClick={() => run.run()}>
                    Run backtest
                  </Button>
                }
              />
            </Card>
          ) : run.pending ? (
            <Card>
              <div className="state">
                <Icon name="loader" size={22} spin className="muted" />
                <h3>Running the simulation</h3>
                <p>
                  Loading {period.toLowerCase()} of daily bars and stepping through them bar by bar. This can take up to a minute on a cold model.
                </p>
              </div>
            </Card>
          ) : result ? (
            <>
              <Card
                title="Equity curve"
                subtitle={`${result.symbol} · ${result.strategy} · ${result.candles_analyzed} bars from ${date(result.period_start)} to ${date(result.period_end)}`}
                actions={
                  <>
                    <Badge tone={result.return_pct >= 0 ? "bull" : "bear"}>
                      {pct(result.return_pct)}
                    </Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="download"
                      onClick={() => {
                        const rows = [
                          ["time", "equity", "position"],
                          ...result.equity_points.map((p) => [String(p.time), String(p.equity), p.position ?? ""]),
                        ];
                        const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], {
                          type: "text/csv",
                        });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${result.symbol}-${result.strategy.replace(/\s+/g, "-").toLowerCase()}-equity.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                        notify("info", "Equity curve exported", "CSV saved to your downloads.");
                      }}
                    >
                      Export CSV
                    </Button>
                  </>
                }
              >
                <div className="row wrap gap-4" style={{ marginBottom: "var(--sp-3)" }}>
                  <span className="chart-legend">
                    <span>
                      <i className="legend-swatch" style={{ background: "var(--accent)" }} />
                      Strategy equity
                    </span>
                    <span>
                      <i className="legend-swatch" style={{ background: "var(--text-tertiary)" }} />
                      Starting capital {inr0(result.initial_capital)}
                    </span>
                  </span>
                  <span className="faint" style={{ marginLeft: "auto", fontSize: "var(--text-xs)" }}>
                    Final {inr0(result.final_equity)} · data from {result.data_source}
                  </span>
                </div>
                <AreaChart
                  points={equityPoints}
                  height={280}
                  reference={{ value: result.initial_capital, label: "capital", tone: "accent" }}
                  formatValue={(v) => inrCompact(v)}
                />
              </Card>

              <div className="metric-grid">
                {metrics.map((metric) => (
                  <Metric key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} tone={metric.tone} />
                ))}
              </div>

              <Card className="card-pad-0">
                <div style={{ padding: "0 var(--sp-5)" }}>
                  <Tabs
                    tabs={[
                      { value: "overview", label: "Risk & attribution" },
                      { value: "trades", label: "Trades", count: result.trade_log.length },
                      { value: "monthly", label: "Monthly", count: result.monthly_returns.length },
                      { value: "method", label: "Method" },
                    ]}
                    value={tab}
                    onChange={setTab}
                  />
                </div>

                <div style={{ padding: "var(--sp-5)" }}>
                  {tab === "overview" ? (
                    <div className="stack">
                      <div className="grid grid-2">
                        <div className="col gap-2">
                          <h4>Underwater curve</h4>
                          <DrawdownChart points={drawdownPoints} height={140} />
                          <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                            Peak-to-trough fall at every bar. Deepest was {pctPlain(result.max_drawdown)}.
                          </p>
                        </div>
                        <div className="col gap-3">
                          <h4>Trade quality</h4>
                          <div className="stack-sm col gap-3">
                            <ScoreBar score={result.win_rate} label={`Win rate ${pctPlain(result.win_rate, 1)}`} />
                            <ScoreBar
                              score={result.profit_factor === null ? null : Math.min(100, result.profit_factor * 45)}
                              label={`Profit factor ${ratio(result.profit_factor)}`}
                            />
                            <ScoreBar
                              score={result.payoff_ratio === null ? null : Math.min(100, result.payoff_ratio * 33)}
                              label={`Payoff ratio ${ratio(result.payoff_ratio)}`}
                            />
                            <ScoreBar
                              score={result.alpha_vs_buy_hold >= 0 ? Math.min(100, 50 + result.alpha_vs_buy_hold * 2.5) : Math.max(0, 50 + result.alpha_vs_buy_hold * 2.5)}
                              label={`Alpha vs buy & hold ${pct(result.alpha_vs_buy_hold)}`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-4">
                        <Metric label="Avg win" value={pct(result.avg_win_pct)} tone="bull" />
                        <Metric label="Avg loss" value={pct(result.avg_loss_pct)} tone="bear" />
                        <Metric label="Expectancy / trade" value={pct(result.expectancy_pct, 3)} />
                        <Metric label="Sortino" value={ratio(result.sortino)} />
                        <Metric label="Calmar" value={ratio(result.calmar)} />
                        <Metric label="Avg bars held" value={ratio(result.avg_bars_held, 1)} />
                        <Metric label="Avg MAE" value={pct(result.avg_mae_pct)} hint="worst point in trade" />
                        <Metric label="Costs paid" value={pctPlain(result.total_costs_pct)} />
                        <Metric label="Best trade" value={pct(result.best_trade_pct)} tone="bull" />
                        <Metric label="Worst trade" value={pct(result.worst_trade_pct)} tone="bear" />
                        <Metric label="Long / short" value={`${result.long_trades} / ${result.short_trades}`} />
                        <Metric label="Recovery to peak" value={pctPlain(result.recovery_to_peak_pct)} hint="still needed" />
                      </div>

                      <Disclaimer>{result.disclaimer}</Disclaimer>
                    </div>
                  ) : null}

                  {tab === "trades" ? (
                    result.trade_log.length === 0 ? (
                      <EmptyState
                        icon="flask"
                        title="This strategy never triggered"
                        description={`${result.strategy} produced no entries over ${result.candles_analyzed} bars. Try a different strategy or a longer window.`}
                      />
                    ) : (
                      <div className="table-wrap">
                        <table className="data">
                          <thead>
                            <tr>
                              <th>Entry</th>
                              <th>Exit</th>
                              <th>Side</th>
                              <th className="num-cell">Entry px</th>
                              <th className="num-cell">Exit px</th>
                              <th className="num-cell">Qty</th>
                              <th className="num-cell">P&L</th>
                              <th className="num-cell">Return</th>
                              <th className="num-cell">Bars</th>
                              <th className="num-cell">MAE</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.trade_log.map((trade, index) => (
                              <tr key={`${trade.entry_time}-${index}`}>
                                <td className="num-cell">{date(trade.entry_time)}</td>
                                <td className="num-cell">{date(trade.exit_time)}</td>
                                <td>
                                  <Badge tone={trade.direction.toUpperCase().includes("SHORT") ? "bear" : "bull"}>
                                    {trade.direction}
                                  </Badge>
                                </td>
                                <td className="num-cell">{num(trade.entry)}</td>
                                <td className="num-cell">{num(trade.exit)}</td>
                                <td className="num-cell">{compact(trade.shares)}</td>
                                <td className={`num-cell ${tone(trade.pnl)}`}>{inr0(trade.pnl)}</td>
                                <td className={`num-cell ${tone(trade.return_pct)}`}>{pct(trade.return_pct)}</td>
                                <td className="num-cell">{trade.bars_held}</td>
                                <td className="num-cell">{pct(trade.mae_pct)}</td>
                                <td className="faint">{trade.exit_reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : null}

                  {tab === "monthly" ? (
                    result.monthly_returns.length === 0 ? (
                      <EmptyState
                        icon="calendar"
                        title="Not enough history for monthly buckets"
                        description="Pick a longer lookback period so at least a few full months are covered."
                      />
                    ) : (
                      <div className="stack">
                        <div className="row wrap gap-4">
                          <span className="chart-legend">
                            <span>
                              <i className="legend-swatch" style={{ background: "var(--bull)" }} />
                              Positive month
                            </span>
                            <span>
                              <i className="legend-swatch" style={{ background: "var(--bear)" }} />
                              Negative month
                            </span>
                          </span>
                          <span className="faint" style={{ marginLeft: "auto", fontSize: "var(--text-xs)" }}>
                            {result.monthly_returns.filter((m) => m.return_pct > 0).length} up /{" "}
                            {result.monthly_returns.filter((m) => m.return_pct <= 0).length} down of{" "}
                            {result.monthly_returns.length} months
                          </span>
                        </div>
                        <BarChart points={monthlyPoints} height={220} />
                        <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Month</th>
                                <th className="num-cell">Return</th>
                                <th style={{ width: "55%" }}>Visual</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.monthly_returns.map((month) => {
                                const peak = Math.max(...result.monthly_returns.map((m) => Math.abs(m.return_pct)), 1);
                                return (
                                  <tr key={month.period}>
                                    <td>{month.period}</td>
                                    <td className={`num-cell ${tone(month.return_pct)}`}>{pct(month.return_pct)}</td>
                                    <td>
                                      <span
                                        style={{
                                          display: "block",
                                          height: 5,
                                          borderRadius: 3,
                                          background: "var(--bg-inset)",
                                        }}
                                      >
                                        <span
                                          style={{
                                            display: "block",
                                            height: "100%",
                                            width: `${(Math.abs(month.return_pct) / peak) * 100}%`,
                                            borderRadius: 3,
                                            background: month.return_pct >= 0 ? "var(--bull)" : "var(--bear)",
                                          }}
                                        />
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  ) : null}

                  {tab === "method" ? (
                    <div className="stack">
                      <div className="prose">
                        <p>{result.execution.signal}</p>
                        <p>{result.execution.fill}</p>
                        <p>{result.execution.stop}</p>
                        <p>{result.execution.cost}</p>
                        <p>{result.execution.return}</p>
                        <p>{result.execution.drawdown}</p>
                        <p>{result.execution.sharpe}</p>
                        <p>{result.execution.profit_factor}</p>
                        <p>{result.execution.holdout}</p>
                      </div>
                      <div className="grid grid-3">
                        <Metric label="Interval" value={result.interval} />
                        <Metric label="Total costs" value={pctPlain(result.total_costs_pct)} />
                        <Metric
                          label="Return multiple"
                          value={ratio(result.total_return_multiple)}
                          hint="profit / max drawdown"
                        />
                      </div>
                      <Disclaimer>{result.disclaimer}</Disclaimer>
                    </div>
                  ) : null}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      {/* ---- Instrument picker ---- */}
      <Modal
        open={instrumentsOpen}
        onClose={() => setInstrumentsOpen(false)}
        title="Choose an instrument"
        description={`${instruments.data?.instruments.length ?? 0} instruments available`}
        wide
      >
        <AsyncBoundary
          loading={instruments.loading}
          error={instruments.error}
          onRetry={instruments.reload}
          isEmpty={instruments.data?.instruments.length === 0}
          emptyTitle="No instruments returned"
          emptyDescription="The universe endpoint returned nothing. Check the backend universe configuration."
        >
          <InstrumentPicker
            instruments={instruments.data?.instruments ?? []}
            onPick={(value) => {
              setSymbol(value);
              setInstrumentsOpen(false);
            }}
          />
        </AsyncBoundary>
      </Modal>

      {/* ---- Strategy catalogue ---- */}
      <Modal
        open={catalogOpen !== null}
        onClose={() => setCatalogOpen(null)}
        title={catalogOpen?.name ?? "Strategy"}
        description={catalogOpen?.best_for}
        wide
      >
        {catalogOpen ? (
          <div className="stack">
            <p className="prose">{catalogOpen.summary}</p>
            <div className="col gap-2">
              <h4>Entry logic</h4>
              <p className="prose">{catalogOpen.formula}</p>
            </div>
            <div className="col gap-2">
              <h4>Equations</h4>
              <div className="stack-sm col gap-2">
                {catalogOpen.equations.map((equation, index) => (
                  <code key={index} style={{ display: "block", padding: "var(--sp-2) var(--sp-3)", background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                    {equation}
                  </code>
                ))}
              </div>
            </div>
            <div className="col gap-2">
              <h4>Indicators used</h4>
              <div className="row wrap gap-2">
                {catalogOpen.uses.map((use) => (
                  <Badge key={use} tone="accent">
                    {use}
                  </Badge>
                ))}
              </div>
            </div>
            <Disclaimer>
              {strategies.data?.execution.signal} {strategies.data?.execution.fill}
            </Disclaimer>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}

function InstrumentPicker({
  instruments,
  onPick,
}: {
  instruments: Instrument[];
  onPick: (symbol: string) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const [sector, setSector] = React.useState("All");

  const sectors = React.useMemo(
    () => ["All", ...Array.from(new Set(instruments.map((item) => item.sector))).sort()],
    [instruments],
  );

  const filtered = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    return instruments.filter((item) => {
      if (sector !== "All" && item.sector !== sector) return false;
      if (!term) return true;
      return item.symbol.toLowerCase().includes(term) || item.name.toLowerCase().includes(term);
    });
  }, [instruments, filter, sector]);

  return (
    <div className="stack">
      <div className="row wrap gap-3">
        <input
          className="input grow"
          placeholder="Filter by symbol or name"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter instruments"
          style={{ minWidth: 180 }}
        />
        <select className="select" value={sector} onChange={(event) => setSector(event.target.value)} aria-label="Sector" style={{ width: "auto" }}>
          {sectors.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>
      <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
        {filtered.length} of {instruments.length} shown
      </p>
      <div className="table-wrap" style={{ maxHeight: 380, overflowY: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
<th>Type</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.symbol}
                onClick={() => onPick(item.symbol)}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPick(item.symbol);
                  }
                }}
              >
                <td>
                  <b>{item.symbol}</b>
                </td>
                <td className="muted truncate" style={{ maxWidth: 220 }}>
                  {item.name}
                </td>
<td className="faint">{item.kind}</td>
                <td className="faint">{item.sector}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
