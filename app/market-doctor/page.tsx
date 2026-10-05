"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Field, Disclaimer, EmptyState, ScoreRing, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAsync } from "@/lib/hooks";
import { api, type Period } from "@/lib/api";
import { num, pct, tone, PERIODS } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";
import { SymbolInput } from "@/components/SymbolInput";

function PillarBar({ pillar, score, detail }: { pillar: string; score: number; detail: string }) {
  const colour = score >= 55 ? "var(--bull)" : score >= 35 ? "var(--warn)" : "var(--bear)";
  return (
    <div className="col gap-1">
      <div className="row-between">
        <b style={{ fontSize: "var(--text-sm)" }}>{pillar}</b>
        <span className="num" style={{ fontWeight: 600, color: colour }}>
          {score}
        </span>
      </div>
      <span style={{ height: 6, borderRadius: 3, background: "var(--bg-inset)", display: "block" }}>
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${score}%`,
            borderRadius: 3,
            background: colour,
            transition: "width var(--tp-dur-slow) var(--tp-ease)",
          }}
        />
      </span>
      <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
        {detail}
      </span>
    </div>
  );
}

export default function MarketDoctorPage() {
  const [symbol, setSymbol] = React.useState("NIFTY 50");
  const [draft, setDraft] = React.useState(symbol);
  const [period, setPeriod] = React.useState<Period>("Last 1 year");

  const condition = useAsync(
    (signal) => api.marketCondition({ symbol, period }, signal),
    [symbol, period],
  );

  const data = condition.data;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Market Doctor"
        description="A six-pillar read on the current regime, each pillar scored from measured indicators rather than opinion."
        actions={
          <Button variant="secondary" icon="refresh" onClick={condition.reload} loading={condition.loading}>
            Re-diagnose
          </Button>
        }
      />

      <Card style={{ marginBottom: "var(--sp-5)" }}>
        <div className="row wrap gap-3" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 190 }}>
            <Field label="Instrument" htmlFor="doc-symbol">
              <SymbolInput id="doc-symbol" value={draft} onChange={setDraft} onCommit={setSymbol} />
            </Field>
          </div>
          <div style={{ width: 165 }}>
            <Field label="Window">
              <select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
                {PERIODS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {data ? (
            <>
              <div className="grow" />
              <div className="row gap-3 wrap" style={{ alignSelf: "center" }}>
                <Badge tone={data.health_score >= 55 ? "bull" : data.health_score >= 35 ? "warn" : "bear"}>
                  {data.verdict}
                </Badge>
                <Badge tone="neutral">
                  {data.candles} candles · {data.period}
                </Badge>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {condition.loading && !data ? (
        <SkeletonCard height={420} />
      ) : condition.error || !data ? (
        <Card>
          <EmptyState
            icon="alert"
            title="Diagnosis unavailable"
            description={condition.error ?? "The service returned no result for this instrument and window."}
            action={
              <Button variant="secondary" icon="refresh" onClick={condition.reload}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stack">
          <div className="grid grid-sidebar">
            <Card title="Health score">
              <div className="col" style={{ alignItems: "center", gap: "var(--sp-3)" }}>
                <ScoreRing score={data.health_score} label="of 100" />
                <Badge tone={data.health_score >= 55 ? "bull" : data.health_score >= 35 ? "warn" : "bear"}>
                  {data.verdict}
                </Badge>
              </div>

              <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
              <div className="col gap-2" style={{ fontSize: "var(--text-sm)" }}>
                <div className="row-between">
                  <span className="muted">Instrument</span>
                  <b>
                    {data.name} <span className="faint num">· {data.symbol}</span>
                  </b>
                </div>
                <div className="row-between">
                  <span className="muted">Pillars scored</span>
                  <b className="num">{data.pillars.length}</b>
                </div>
                <div className="row-between">
                  <span className="muted">Weakest pillar</span>
                  <b className="num" style={{ color: "var(--bear)" }}>
                    {[...data.pillars].sort((a, b) => a.score - b.score)[0]?.pillar ?? "—"}
                  </b>
                </div>
                <div className="row-between">
                  <span className="muted">Strongest pillar</span>
                  <b className="num" style={{ color: "var(--bull)" }}>
                    {[...data.pillars].sort((a, b) => b.score - a.score)[0]?.pillar ?? "—"}
                  </b>
                </div>
              </div>
              <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
              <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                {data.historical_context}
              </p>
            </Card>

            <Card title="Six pillars" subtitle="Each pillar is an independent 0–100 score. The health score is their mean.">
              <div className="stack col gap-4">
                {data.pillars.map((pillar) => (
                  <PillarBar
                    key={pillar.pillar}
                    pillar={pillar.pillar}
                    score={pillar.score}
                    detail={pillar.detail}
                  />
                ))}
              </div>
            </Card>
          </div>

          <div className="grid grid-2">
            <Card title="Observations" subtitle={`${data.observations.length} statements derived from the scored pillars.`}>
              {data.observations.length === 0 ? (
                <EmptyState icon="info" title="No observations" description="The diagnosis produced no narrative statements." />
              ) : (
                <ul className="prose" style={{ margin: 0 }}>
                  {data.observations.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}

              <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
              <span className="field-label">Risks</span>
              {data.risks.length === 0 ? (
                <p className="faint" style={{ fontSize: "var(--text-sm)", marginTop: "var(--sp-2)" }}>
                  No risk flags were raised in this window.
                </p>
              ) : (
                <ul className="prose" style={{ margin: "var(--sp-2) 0 0" }}>
                  {data.risks.map((line, index) => (
                    <li key={index} style={{ color: "var(--warn)" }}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="What to monitor" subtitle="Concrete levels and events that would change this read.">
              {data.monitor.length === 0 ? (
                <EmptyState icon="info" title="Nothing flagged" description="The diagnosis produced no monitoring triggers." />
              ) : (
                <ul className="prose" style={{ margin: 0 }}>
                  {data.monitor.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}

              {data.sector_leaders.length > 0 ? (
                <>
                  <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
                  <span className="field-label">Leading sectors in this window</span>
                  <div className="stack-sm col gap-2" style={{ marginTop: "var(--sp-2)" }}>
                    {data.sector_leaders.map((leader) => (
                      <div key={leader.sector} className="row-between" style={{ fontSize: "var(--text-sm)" }}>
                        <span className="muted">{leader.sector}</span>
                        <b className={`num ${tone(leader.change_pct)}`}>{pct(leader.change_pct)}</b>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
              <Disclaimer>{data.disclaimer}</Disclaimer>
              <p className="faint" style={{ fontSize: "var(--text-xs)", marginTop: "var(--sp-2)" }}>
                Scored on {num(data.candles, 0)} candles for {data.name}.{" "}
                <Link href="/research" className="muted">
                  Change instrument →
                </Link>
              </p>
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}
