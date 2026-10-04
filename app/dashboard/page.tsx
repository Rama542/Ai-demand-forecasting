"use client";

import * as React from "react";
import Link from "next/link";
import { Card, SkeletonMetrics, SkeletonCard, Badge, ScoreRing, Metric } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { AreaChart, BarChart, CandleChart, Sparkline } from "@/components/charts/Charts";
import { useAsync, AsyncBoundary, useLocalStorage } from "@/lib/hooks";
import { api, type Interval, type Quote } from "@/lib/api";
import { compact, num, pct, pctPlain, scoreLabel, scoreTone, tone, INTERVALS } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";

/** SLATE's hero block: one headline figure, then a horizontal rail of cards. */
function HeroQuote({ quote, isLoading }: { quote: Quote | null | undefined; isLoading: boolean }) {
  if (isLoading || !quote) {
    return (
      <Card>
        <SkeletonMetrics count={1} />
      </Card>
    );
  }

  return (
    <section className="card">
      <div className="row-between wrap gap-5">
        <div className="col gap-1" style={{ minWidth: 0 }}>
          <span className="eyebrow">{quote.name}</span>
          <div className="row gap-3 wrap" style={{ alignItems: "baseline" }}>
            <span
              className="num"
              style={{ fontSize: "var(--text-hero)", fontWeight: 600, letterSpacing: "-.045em", lineHeight: 1 }}
            >
              {num(quote.price)}
            </span>
            <span className={`num ${tone(quote.change)}`} style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>
              {pct(quote.change_pct)}
            </span>
          </div>
          <span className="faint num" style={{ fontSize: "var(--text-sm)" }}>
            {quote.change >= 0 ? "+" : ""}
            {num(quote.change)} on the day · previous close {num(quote.prev_close)}
          </span>
        </div>

        {quote.spark && quote.spark.length > 1 ? (
          <div className="col gap-1" style={{ minWidth: 220, flex: 1, maxWidth: 420 }}>
            <Sparkline values={quote.spark} positive={quote.change >= 0} width={400} height={72} />
            <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
              Last {quote.spark.length} bars · session {num(quote.day_low)} – {num(quote.day_high)}
            </span>
          </div>
        ) : null}

        <Link className="btn btn-secondary" href={`/research?symbol=${encodeURIComponent(quote.symbol)}`}>
          Open research
          <Icon name="arrowRight" size={13} />
        </Link>
      </div>
    </section>
  );
}

function IndexRail({ indices, isLoading }: { indices: Quote[] | undefined; isLoading: boolean }) {
  if (isLoading || !indices) {
    return (
      <div className="grid grid-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} height={80} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-4">
      {indices.map((index) => (
        <Link key={index.symbol} href={`/research?symbol=${encodeURIComponent(index.symbol)}`} style={{ display: "block" }}>
          <div className="metric" style={{ height: "100%" }}>
            <div className="row-between">
              <span className="metric-label">{index.symbol}</span>
              <span className={`num ${tone(index.change_pct)}`} style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
                {pct(index.change_pct)}
              </span>
            </div>
            <div className="metric-value">{compact(index.price)}</div>
            <div style={{ marginTop: 6 }}>
              {index.spark ? (
                <Sparkline values={index.spark} positive={index.change >= 0} width={150} height={24} />
              ) : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [symbol, setSymbol] = useLocalStorage("dashboard-symbol", "RELIANCE");
  const [interval, setInterval] = useLocalStorage<Interval>("dashboard-interval", "1D");

  const dashboard = useAsync((signal) => api.dashboard(signal), []);
  const condition = useAsync((signal) => api.marketCondition({ symbol: "NIFTY 50" }, signal), []);
  const candles = useAsync(
    (signal) => api.candles({ symbol, interval, limit: interval === "1D" ? 180 : 240 }, signal),
    [symbol, interval],
  );

  const forecast = dashboard.data?.forecast;
  const latest = forecast?.latest_forecast;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Workspace"
        title="Market overview"
        description="Live quotes, regime health and the model's own track record, read straight from the analytics service."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              dashboard.reload();
              condition.reload();
              candles.reload();
            }}
          >
            <Icon name="refresh" />
            Refresh
          </button>
        }
      />

      <div className="stack">
        <AsyncBoundary
          loading={dashboard.loading}
          error={dashboard.error}
          onRetry={dashboard.reload}
          skeleton={<SkeletonCard height={140} />}
        >
          <HeroQuote quote={dashboard.data?.market} isLoading={false} />
        </AsyncBoundary>

        <IndexRail indices={dashboard.data?.indices} isLoading={dashboard.loading} />

        <div className="grid grid-workspace">
          <div className="stack">
            <Card
              title="Price action"
              subtitle={
                candles.data
                  ? `${symbol} · ${interval} · ${candles.data.candles.length} bars from ${candles.data.source}`
                  : "Loading chart data"
              }
              actions={
                <>
                  <select
                    className="select input-sm"
                    style={{ width: "auto" }}
                    value={interval}
                    onChange={(event) => setInterval(event.target.value as Interval)}
                    aria-label="Chart interval"
                  >
                    {INTERVALS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Link className="btn btn-secondary btn-sm" href={`/research?symbol=${encodeURIComponent(symbol)}`}>
                    Deep dive
                  </Link>
                </>
              }
            >
              <div className="row gap-2" style={{ marginBottom: "var(--sp-4)" }}>
                <input
                  className="input input-sm"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  aria-label="Chart symbol"
                  spellCheck={false}
                  style={{ maxWidth: 180 }}
                />
                <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                  Change the symbol to redraw the chart from the candle service.
                </span>
              </div>

              <AsyncBoundary
                loading={candles.loading}
                error={candles.error}
                isEmpty={candles.data?.candles.length === 0}
                onRetry={candles.reload}
                emptyTitle="No candles returned"
                emptyDescription="The provider returned an empty series for this instrument and interval."
                skeleton={<SkeletonCard height={280} />}
              >
                <CandleChart candles={candles.data?.candles ?? []} height={300} />
                {candles.data?.notice ? (
                  <p className="faint" style={{ marginTop: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
                    {candles.data.notice}
                  </p>
                ) : null}
              </AsyncBoundary>
            </Card>

            <Card
              title="Model track record"
              subtitle="Walk-forward accuracy of the direction classifier, measured only on bars it never saw during training."
            >
              {dashboard.loading ? (
                <SkeletonMetrics count={4} />
              ) : dashboard.error || !dashboard.data ? (
                <p className="faint">{dashboard.error ?? "No forecast data."}</p>
              ) : (
                <>
                  <div className="metric-grid">
                    <Metric label="Direction accuracy" value={pctPlain(forecast?.direction_accuracy, 1)} hint="out-of-sample" />
                    <Metric label="MAE" value={pctPlain(forecast?.mae, 2)} hint="mean absolute error" />
                    <Metric label="RMSE" value={pctPlain(forecast?.rmse, 2)} hint="root mean squared error" />
                    <Metric label="Brier" value={num(forecast?.brier, 3)} hint="lower is better" />
                  </div>
                  {dashboard.data.bars.length > 1 ? (
                    <div style={{ marginTop: "var(--sp-4)" }}>
                      <AreaChart
                        points={dashboard.data.bars.map((value, index) => ({
                          time: dashboard.data!.bars.length - index,
                          value,
                        }))}
                        height={150}
                        formatValue={(v) => `${num(v, 0)}%`}
                        color="var(--accent)"
                      />
                      <p className="faint" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                        Rolling 20-bar direction accuracy, oldest to newest.
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </div>

          <div className="stack">
            <Card
              title="Market Doctor"
              subtitle="Six-pillar regime score for NIFTY 50"
              actions={
                <Link className="btn btn-ghost btn-sm" href="/market-doctor">
                  Full report
                </Link>
              }
            >
              {condition.loading ? (
                <SkeletonMetrics count={2} />
              ) : condition.error || !condition.data ? (
                <p className="faint">{condition.error ?? "No condition data."}</p>
              ) : (
                <>
                  <div className="col" style={{ alignItems: "center", gap: "var(--sp-3)" }}>
                    <ScoreRing
                      score={condition.data.health_score}
                      label="of 100"
                      caption={`${scoreLabel(condition.data.health_score)} regime`}
                    />
                    <Badge tone={scoreTone(condition.data.health_score)}>{condition.data.verdict}</Badge>
                  </div>
                  <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
                  <div className="stack-sm col gap-3">
                    {condition.data.pillars.map((pillar) => (
                      <div key={pillar.pillar} className="col gap-1">
                        <div className="row-between" style={{ fontSize: "var(--text-xs)" }}>
                          <span className="muted">{pillar.pillar}</span>
                          <span className="num" style={{ fontWeight: 600 }}>
                            {pillar.score}
                          </span>
                        </div>
                        <span style={{ height: 5, borderRadius: 3, background: "var(--bg-inset)", display: "block" }}>
                          <span
                            style={{
                              display: "block",
                              height: "100%",
                              width: `${pillar.score}%`,
                              borderRadius: 3,
                              background:
                                pillar.score >= 55
                                  ? "var(--bull)"
                                  : pillar.score >= 35
                                    ? "var(--warn)"
                                    : "var(--bear)",
                            }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card title="Next forecast" subtitle="The model's directional call for the next bar">
              {!latest ? (
                <p className="faint" style={{ fontSize: "var(--text-sm)" }}>
                  No forecast is available yet. The model trains on history, so give it a few seconds and retry.
                </p>
              ) : (
                <>
                  <div className="row-between">
                    <div>
                      <div
                        className="num"
                        style={{
                          fontSize: "var(--text-2xl)",
                          fontWeight: 600,
                          lineHeight: 1.1,
                          color: latest.direction === "UP" ? "var(--bull)" : "var(--bear)",
                        }}
                      >
                        {latest.direction}
                      </div>
                      <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                        {latest.horizon}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="metric-value">{pctPlain(latest.probability, 0)}</div>
                      <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                        confidence
                      </p>
                    </div>
                  </div>

                  {dashboard.data && dashboard.data.bars.length > 0 ? (
                    <div style={{ marginTop: "var(--sp-4)" }}>
                      <BarChart
                        points={dashboard.data.bars.map((value, index) => ({
                          time: dashboard.data!.bars.length - index,
                          value,
                        }))}
                        height={110}
                        formatValue={(v) => `${num(v, 0)}%`}
                      />
                    </div>
                  ) : null}

                  <Link
                    className="btn btn-secondary btn-sm btn-block"
                    style={{ marginTop: "var(--sp-3)" }}
                    href={`/research?symbol=${encodeURIComponent(symbol)}`}
                  >
                    See what drives this call
                    <Icon name="arrowRight" size={13} />
                  </Link>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
