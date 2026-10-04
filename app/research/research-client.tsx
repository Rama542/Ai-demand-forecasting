"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Field, Metric, Tabs, Disclaimer, EmptyState, ScoreBar, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { AreaChart, CandleChart } from "@/components/charts/Charts";
import { useAsync, AsyncBoundary } from "@/lib/hooks";
import { api, type Period, type Interval, type ResearchBundle } from "@/lib/api";
import { num, pctPlain, ratio, tone, INTERVALS, PERIODS } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";
import { useRouter, useSearchParams } from "next/navigation";

type Tab = "price" | "forecast" | "technicals";

export default function ResearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = (params.get("symbol") ?? "RELIANCE").toUpperCase();

  const [symbol, setSymbol] = React.useState(initial);
  const [committed, setCommitted] = React.useState(initial);
  const [interval, setInterval] = React.useState<Interval>("1D");
  const [period, setPeriod] = React.useState<Period>("Last 2 years");
  const [tab, setTab] = React.useState<Tab>("price");

  const bundle = useAsync(
    (signal) => api.researchBundle({ symbol: committed, period }, signal),
    [committed, period],
  );

  const intraday = useAsync(
    (signal) => api.candles({ symbol: committed, interval, limit: 240 }, signal),
    [committed, interval],
    { enabled: interval !== "1D" },
  );

  const submit = () => {
    const next = symbol.trim().toUpperCase();
    if (!next) return;
    setCommitted(next);
    router.replace(`/research?symbol=${encodeURIComponent(next)}`, { scroll: false });
  };

  const meta = bundle.data?.meta;
  const quote = bundle.data?.quote;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Workspace"
        title={meta ? `${meta.symbol} · ${meta.name}` : "Stock research"}
        description={
          meta
            ? `${meta.sector} · ${meta.primary_group} · ${meta.kind}`
            : "Price history, model output and the indicators behind them, for a single instrument at a time."
        }
        actions={
          <>
            <Link className="btn btn-secondary" href={`/backtesting?symbol=${encodeURIComponent(committed)}`}>
              <Icon name="flask" size={14} />
              Backtest
            </Link>
            <Link className="btn btn-secondary" href={`/reports?symbol=${encodeURIComponent(committed)}`}>
              <Icon name="report" size={14} />
              Full report
            </Link>
          </>
        }
      />

      <Card className="stack">
        <div className="row wrap gap-3">
          <div className="grow" style={{ minWidth: 190 }}>
            <Field label="Symbol" htmlFor="symbol">
              <input
                id="symbol"
                className="input"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                spellCheck={false}
                placeholder="RELIANCE"
              />
            </Field>
          </div>
          <div style={{ width: 148 }}>
            <Field label="Chart interval">
              <select className="select" value={interval} onChange={(event) => setInterval(event.target.value as Interval)}>
                {INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ width: 158 }}>
            <Field label="Research window">
              <select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
                {PERIODS.filter((option) => option !== "Last 3 months").map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <Button variant="primary" icon="search" onClick={submit} loading={bundle.loading}>
              Analyse
            </Button>
          </div>
        </div>

        {quote ? (
          <div className="metric-grid">
            <Metric label="Last price" value={num(quote.price)} hint={`prev ${num(quote.prev_close)}`} />
            <Metric label="Change" value={pctPlain(quote.change_pct)} tone={tone(quote.change)} hint={num(quote.change)} />
            <Metric label="Day range" value={`${num(quote.day_low)} – ${num(quote.day_high)}`} />
            <Metric label="Interval used" value={bundle.data?.interval ?? "1D"} hint={period} />
          </div>
        ) : null}
      </Card>

      <div style={{ marginTop: "var(--sp-5)" }}>
        <Tabs
          tabs={[
            { value: "price", label: "Price" },
            { value: "forecast", label: "Forecast & explanation" },
            { value: "technicals", label: "Technicals" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="stack" style={{ marginTop: "var(--sp-5)" }}>
        {bundle.error ? (
          <Card>
            <EmptyState
              icon="alert"
              title="Could not load research"
              description={bundle.error}
              action={
                <Button variant="secondary" icon="refresh" onClick={bundle.reload}>
                  Try again
                </Button>
              }
            />
          </Card>
        ) : bundle.loading && !bundle.data ? (
          <SkeletonCard height={340} />
        ) : bundle.data?.error ? (
          <Card>
            <EmptyState icon="info" title="Not enough history" description={bundle.data.error} />
          </Card>
        ) : bundle.data ? (
          <>
            {tab === "price" ? <PriceTab bundle={bundle.data} interval={interval} intraday={intraday} /> : null}
            {tab === "forecast" ? <ForecastTab bundle={bundle.data} /> : null}
            {tab === "technicals" ? <TechnicalsTab bundle={bundle.data} /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function PriceTab({
  bundle,
  interval,
  intraday,
}: {
  bundle: ResearchBundle;
  interval: Interval;
  intraday: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.candles>>>>;
}) {
  /* Daily candles come from the research bundle; intraday from the candles endpoint. */
  const daily = bundle.candles;
  const usingIntraday = interval !== "1D";
  const series = usingIntraday ? (intraday.data?.candles ?? []) : daily;
  const source = usingIntraday ? intraday.data?.source : bundle.meta?.primary_group ?? "daily history";
  const live = usingIntraday ? intraday.data?.live : null;

  return (
    <Card
      title={`Price history — ${interval}`}
      subtitle={
        intraday.loading && usingIntraday
          ? "Loading candles"
          : `${series.length} bars · source ${source}${live ? (live.is_live ? " · live" : " · simulated") : ""}`
      }
      actions={
        !live && !usingIntraday ? (
          <Badge tone="warn">simulated history</Badge>
        ) : live && !live.is_live ? (
          <Badge tone="warn">simulated</Badge>
        ) : live ? (
          <Badge tone="bull">live</Badge>
        ) : null
      }
    >
      <AsyncBoundary
        loading={usingIntraday ? intraday.loading : false}
        error={usingIntraday ? intraday.error : null}
        isEmpty={series.length === 0}
        emptyTitle="No candles"
        emptyDescription="The provider returned an empty series for this symbol and interval."
        skeleton={<SkeletonCard height={300} />}
      >
        <CandleChart candles={series} height={400} />
        <div className="row wrap gap-4" style={{ marginTop: "var(--sp-3)" }}>
          <Disclaimer>
            {usingIntraday
              ? `Intraday bars come from the configured provider${live?.is_live ? " in live mode" : "; no live provider is configured, so this feed is simulated"}.`
              : "Daily bars feed the research model. When no live provider is configured, this series is a deterministic simulation generated on the server — it is labelled as such everywhere it appears."}
          </Disclaimer>
        </div>
      </AsyncBoundary>
    </Card>
  );
}

function ForecastTab({ bundle }: { bundle: ResearchBundle }) {
  const explanation = bundle.explanation;
  const forecast = bundle.forecast?.latest_forecast ?? null;

  if (!explanation || explanation.error || explanation.contributions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="info"
          title="No explanation for this window"
          description={
            explanation?.error ??
            "The explainer needs at least two years of daily history. Try widening the research window."
          }
        />
      </Card>
    );
  }

  const bullish = explanation.contributions.filter((c) => c.contribution > 0);
  const bearish = explanation.contributions.filter((c) => c.contribution < 0);
  const maxAbs = Math.max(...explanation.contributions.map((c) => Math.abs(c.contribution)), 1e-4);

  return (
    <div className="stack">
      <Card
        title="What drives the next call"
        subtitle={`${explanation.model} · ${explanation.samples} samples · ${explanation.period}`}
        actions={
          <Badge tone={explanation.direction === "UP" ? "bull" : "bear"}>
            <Icon name={explanation.direction === "UP" ? "arrowUp" : "arrowDown"} size={11} />
            {explanation.direction} {pctPlain(explanation.probability_up, 0)}
          </Badge>
        }
      >
        <div className="grid grid-workspace">
          <div className="stack">
            <p className="prose">
              The classifier leans <strong>{explanation.direction}</strong> for the next bar with{" "}
              {pctPlain(explanation.probability_up, 0)} confidence. Each row below is an exact TreeSHAP value from the same
              model — the further right, the harder it pushed the call that way.
            </p>

            <div className="col gap-2">
              {explanation.contributions.map((contribution) => {
                const width = (Math.abs(contribution.contribution) / maxAbs) * 48;
                const positive = contribution.contribution > 0;
                return (
                  <div key={contribution.feature} className="row gap-3" style={{ fontSize: "var(--text-sm)" }}>
                    <span className="muted truncate" style={{ width: 160, flex: "none" }} title={contribution.label}>
                      {contribution.label}
                    </span>
                    <span style={{ flex: 1, display: "flex", justifyContent: "center", position: "relative", height: 16 }}>
                      <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border-default)" }} />
                      <span
                        style={{
                          position: "absolute",
                          top: 3,
                          height: 10,
                          borderRadius: 3,
                          background: positive ? "var(--bull)" : "var(--bear)",
                          opacity: 0.85,
                          left: positive ? "50%" : `calc(50% - ${width}%)`,
                          width: `${width}%`,
                          transition: "width 400ms cubic-bezier(.2,.8,.2,1)",
                        }}
                      />
                    </span>
                    <span
                      className={`num ${positive ? "bull" : "bear"}`}
                      style={{ width: 74, flex: "none", textAlign: "right", fontWeight: 600 }}
                    >
                      {positive ? "+" : ""}
                      {num(contribution.contribution, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="stack">
            <div className="metric">
              <div className="metric-label">Feature balance</div>
              <div className="metric-value" style={{ color: bullish.length > bearish.length ? "var(--bull)" : "var(--bear)" }}>
                {bullish.length} / {bearish.length}
              </div>
              <div className="metric-hint">bullish / bearish features</div>
            </div>
            <ScoreBar
              score={Math.round(explanation.probability_up)}
              label={`Confidence ${pctPlain(explanation.probability_up, 0)}`}
            />
            <div className="metric-grid">
              <Metric label="Direction accuracy" value={pctPlain(bundle.forecast?.direction_accuracy, 1)} hint="out-of-sample" />
              <Metric label="MAE" value={pctPlain(bundle.forecast?.mae)} hint="mean abs error" />
              <Metric label="RMSE" value={pctPlain(bundle.forecast?.rmse)} />
              <Metric label="Brier" value={ratio(bundle.forecast?.brier, 3)} hint="lower better" />
            </div>
            <Disclaimer>{explanation.disclaimer}</Disclaimer>
          </div>
        </div>
      </Card>
    </div>
  );
}

function TechnicalsTab({ bundle }: { bundle: ResearchBundle }) {
  const technicals = bundle.technicals;
  const readings = bundle.indicator_readings;

  if (readings.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="empty"
          title="No indicators computed"
          description="The feature set needs at least 60 bars of daily history. Try a different window."
        />
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="grid grid-4">
        {readings.map((reading) => (
          <Metric key={reading.id} label={reading.label} value={reading.value} hint={reading.formula} />
        ))}
      </div>

      {technicals && !technicals.error ? (
        <div className="grid grid-2">
          <Card title="Trend read" subtitle={`${technicals.candles} candles · ${technicals.period}`}>
            <p className="prose">
              Price sits at {num(technicals.close)} against a 20-day average of {num(technicals.sma20)}, a 50-day average of{" "}
              {num(technicals.sma50)} and a 200-day average of {num(technicals.sma200)}. The 20/50 relationship is{" "}
              <b>
                {technicals.sma20 !== null && technicals.sma50 !== null
                  ? technicals.sma20 > technicals.sma50
                    ? "constructive"
                    : "weakening"
                  : "unavailable"}
              </b>
              , ADX reads {num(technicals.adx, 1)} and RSI reads {num(technicals.rsi, 1)}.
            </p>
            <p className="prose" style={{ marginTop: "var(--sp-3)" }}>
              Support sits at {num(technicals.support_20)} and resistance at {num(technicals.resistance_20)}. Realised
              volatility is {pctPlain(technicals.realised_vol_pct)} and ATR is {num(technicals.atr, 2)} (
              {pctPlain(technicals.atr_pct)} of price).
            </p>
          </Card>

          <Card title="Volatility" subtitle={`${pctPlain(technicals.realised_vol_pct)} realised, ATR ${num(technicals.atr)}`}>
            <div className="metric-grid">
              <Metric label="RSI (14)" value={ratio(technicals.rsi, 1)} />
              <Metric label="Realised vol" value={pctPlain(technicals.realised_vol_pct)} hint="annualised" />
              <Metric label="ATR (14)" value={num(technicals.atr)} />
              <Metric label="SMA 20" value={num(technicals.sma20)} />
            </div>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <AreaChart
                points={bundle.candles.slice(-120).map((candle) => ({ time: candle.time, value: candle.close }))}
                height={150}
                formatValue={(v) => num(v, 0)}
              />
              <p className="faint" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                Last 120 daily closes.
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      <Disclaimer>{bundle.disclaimer}</Disclaimer>
    </div>
  );
}