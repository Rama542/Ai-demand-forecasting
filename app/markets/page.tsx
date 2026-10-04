"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Metric, Tabs, SkeletonCard, SkeletonMetrics } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { AreaChart, Sparkline } from "@/components/charts/Charts";
import { useAsync, AsyncBoundary } from "@/lib/hooks";
import { api, type Period, type Quote } from "@/lib/api";
import { compact, num, pct, pctPlain, tone } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";

type Tab = "overview" | "universes" | "sectors";

function WatchCard({ quote }: { quote: Quote }) {
  const positive = quote.change >= 0;
  return (
    <Link href={`/research?symbol=${encodeURIComponent(quote.symbol)}`} style={{ display: "block" }}>
      <Card className="stack-sm" >
        <div className="row-between">
          <div className="grow truncate">
            <b style={{ fontSize: "var(--text-sm)" }}>{quote.symbol}</b>
            <p className="faint truncate" style={{ fontSize: "var(--text-xs)" }}>
              {quote.name}
            </p>
          </div>
          {quote.spark ? <Sparkline values={quote.spark} positive={positive} width={80} height={26} /> : null}
        </div>
        <div className="row-between" style={{ alignItems: "baseline" }}>
          <span className="num" style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
            {num(quote.price)}
          </span>
          <span className={`num ${tone(quote.change)}`} style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
            {pct(quote.change_pct)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function MarketsPage() {
  const [tab, setTab] = React.useState<Tab>("overview");

  const dashboard = useAsync((signal) => api.dashboard(signal), []);
  const universes = useAsync((signal) => api.universes(signal), []);
  const sectors = useAsync((signal) => api.sectors(signal), []);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Workspace"
        title="Markets"
        description="Index levels, the tradable universe by index and sector, and where each quote actually came from."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            loading={dashboard.loading}
            onClick={() => {
              dashboard.reload();
              universes.reload();
              sectors.reload();
            }}
          >
            Refresh
          </Button>
        }
      />

      <div style={{ marginBottom: "var(--sp-5)" }}>
        <Tabs
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "universes", label: "Index universes", count: universes.data?.groups.length },
            { value: "sectors", label: "Sectors", count: sectors.data?.sectors.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" ? (
        <AsyncBoundary
          loading={dashboard.loading}
          error={dashboard.error}
          onRetry={dashboard.reload}
          skeleton={
            <div className="stack">
              <SkeletonMetrics count={4} />
              <SkeletonCard height={320} />
            </div>
          }
        >
          {dashboard.data ? (
            <div className="stack">
              <div className="metric-grid">
                <Metric
                  label="Feed mode"
                  value={dashboard.data.live.is_live ? "Live" : "Simulated"}
                  hint={dashboard.data.live.source ?? dashboard.data.data_mode}
                  tone={dashboard.data.live.is_live ? "bull" : "muted"}
                />
                <Metric label="Model" value={dashboard.data.forecast.model} hint={dashboard.data.model_ready ? "trained" : "pending"} />
                <Metric
                  label="Direction accuracy"
                  value={pctPlain(dashboard.data.forecast.direction_accuracy, 1)}
                  hint="out-of-sample"
                />
                <Metric label="Instruments" value={String(universes.data?.total_symbols ?? "—")} hint="in universe" />
              </div>

              <Card
                title="Primary quote"
                subtitle={dashboard.data.market.symbol}
                actions={
                  dashboard.data.live.is_live ? <Badge tone="bull">live</Badge> : <Badge tone="warn">simulated</Badge>
                }
              >
                <div className="grid grid-sidebar">
                  <div className="col gap-1">
                    <span className="num" style={{ fontSize: "var(--text-3xl)", fontWeight: 650, letterSpacing: "-.03em" }}>
                      {num(dashboard.data.market.price)}
                    </span>
                    <span className={`num ${tone(dashboard.data.market.change)}`} style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                      {num(dashboard.data.market.change)} ({pct(dashboard.data.market.change_pct)})
                    </span>
                    <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                      previous close {num(dashboard.data.market.prev_close)}
                    </span>
                  </div>
                  <AreaChart
                    points={(dashboard.data.market.spark ?? []).map((value, index) => ({
                      time: (dashboard.data!.market.spark?.length ?? 0) - index,
                      value,
                    }))}
                    height={200}
                    formatValue={(v) => compact(v)}
                  />
                </div>
              </Card>

              <Card title="Indices" subtitle="Levels for the benchmark set.">
                <div className="grid grid-4">
                  {dashboard.data.indices.map((quote) => (
                    <WatchCard key={quote.symbol} quote={quote} />
                  ))}
                </div>
              </Card>

              {dashboard.data.live.error ? (
                <Card>
                  <div className="row gap-3">
                    <Icon name="alert" size={16} style={{ color: "var(--warn)", flex: "none" }} />
                    <div>
                      <b style={{ fontSize: "var(--text-sm)" }}>Live provider reported a problem</b>
                      <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                        {dashboard.data.live.error}
                      </p>
                    </div>
                  </div>
                </Card>
              ) : null}
            </div>
          ) : null}
        </AsyncBoundary>
      ) : null}

      {tab === "universes" ? (
        <AsyncBoundary
          loading={universes.loading}
          error={universes.error}
          onRetry={universes.reload}
          isEmpty={universes.data?.groups.length === 0}
          emptyTitle="No universes configured"
          emptyDescription="The universe service returned no index definitions."
          skeleton={<SkeletonCard height={320} />}
        >
          <Card
            title="Index universes"
            subtitle={`${universes.data?.total_symbols ?? 0} instruments in total.`}
          >
            {universes.data?.note ? (
              <p className="faint" style={{ fontSize: "var(--text-xs)", marginBottom: "var(--sp-3)" }}>
                {universes.data.note}
              </p>
            ) : null}
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Universe</th>
                    <th className="num-cell">Constituents</th>
                    <th style={{ width: "40%" }}>Share of universe</th>
                  </tr>
                </thead>
                <tbody>
                  {universes.data?.groups.map((group) => {
                    const max = Math.max(...universes.data!.groups.map((i) => i.count), 1);
                    return (
                      <tr key={group.label}>
                        <td>
                          <b>{group.label}</b>
                          {group.symbols.length > 0 ? (
                            <span className="faint num" style={{ fontSize: "var(--text-xs)" }}>
                              {" "}
                              · {group.symbols.slice(0, 6).join(", ")}
                              {group.symbols.length > 6 ? ` +${group.symbols.length - 6}` : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="num-cell">{group.count}</td>
                        <td>
                          <span style={{ display: "block", height: 5, borderRadius: 3, background: "var(--bg-inset)" }}>
                            <span
                              style={{
                                display: "block",
                                height: "100%",
                                width: `${(group.count / max) * 100}%`,
                                borderRadius: 3,
                                background: "var(--accent)",
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
          </Card>
        </AsyncBoundary>
      ) : null}

      {tab === "sectors" ? (
        <AsyncBoundary
          loading={sectors.loading}
          error={sectors.error}
          onRetry={sectors.reload}
          isEmpty={sectors.data?.sectors.length === 0}
          emptyTitle="No sectors"
          emptyDescription="The universe has no sector grouping configured."
          skeleton={<SkeletonCard height={320} />}
        >
          <Card title="Sector grouping" subtitle="Every instrument mapped to its sector, straight from the universe definition.">
            <div className="grid grid-2">
              {sectors.data?.sectors.map((sector) => (
                <div key={sector.sector} className="card" style={{ padding: "var(--sp-4)" }}>
                  <div className="row-between">
                    <b>{sector.sector}</b>
                    <Badge tone="neutral">{sector.count}</Badge>
                  </div>
                  <div className="row wrap gap-1" style={{ marginTop: "var(--sp-3)" }}>
                    {sector.symbols.map((symbol) => (
                      <Link key={symbol} href={`/research?symbol=${encodeURIComponent(symbol)}`}>
                        <Badge tone="neutral">{symbol}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </AsyncBoundary>
      ) : null}
    </main>
  );
}