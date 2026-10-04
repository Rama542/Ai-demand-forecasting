"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Metric, Field, Disclaimer, EmptyState, ScoreBar, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { BarChart } from "@/components/charts/Charts";
import { useAction } from "@/lib/hooks";
import { api, type Period, type PortfolioAnalysis, type Instrument } from "@/lib/api";
import { num, pctPlain, ratio, scoreLabel, scoreTone } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";

const DEFAULT_HOLDINGS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ITC"];

export default function PortfolioPage() {
  const [holdings, setHoldings] = React.useState<string[]>(DEFAULT_HOLDINGS);
  const [period, setPeriod] = React.useState<Period>("Last 1 year");
  const [result, setResult] = React.useState<PortfolioAnalysis | null>(null);

  const load = useAction(async () => {
    const response = await api.portfolio({ holdings, period });
    setResult(response);
    return response;
  });

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Portfolio diagnostics"
        description="Equal-weighted risk analysis of a holdings list. No positions, no P&L, no cost basis — only diversification and concentration."
        actions={
          <>
            <Badge tone="warn">Paper trading — simulation</Badge>
            <Button variant="primary" icon="portfolio" loading={load.pending} onClick={() => load.run()}>
              Analyse portfolio
            </Button>
          </>
        }
      />

      <div className="stack">
        <Card title="Holdings" subtitle="Equal weight is assumed across every position.">
          <div className="stack">
            <div className="row wrap gap-2">
              {holdings.map((symbol) => (
                <span key={symbol} className="badge badge-accent" style={{ gap: 4 }}>
                  {symbol}
                  <button
                    type="button"
                    onClick={() => setHoldings((c) => c.filter((s) => s !== symbol))}
                    aria-label={`Remove ${symbol}`}
                    style={{ display: "grid", placeItems: "center", marginLeft: 2 }}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
            </div>

            <div className="row wrap gap-3">
              <div style={{ width: 170 }}>
                <Field label="Window">
                  <select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
                    {(["Last 6 months", "Last 1 year", "Last 2 years", "Last 5 years"] as Period[]).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grow row wrap gap-2" style={{ alignSelf: "flex-end", paddingBottom: 4 }}>
                {["RELIANCE", "TCS", "HDFCBANK", "INFY", "ITC", "SBIN", "AXISBANK", "LT", "MARUTI", "TATAMOTORS", "WIPRO", "HINDUNILVR"]
                  .filter((symbol) => !holdings.includes(symbol))
                  .slice(0, 6)
                  .map((symbol) => (
                    <Button key={symbol} variant="secondary" size="sm" icon="plus" onClick={() => setHoldings((c) => [...c, symbol].slice(0, 10))}>
                      {symbol}
                    </Button>
                  ))}
              </div>
            </div>

            {load.error ? (
              <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
                <Icon name="alert" size={13} />
                <span>{load.error}</span>
              </p>
            ) : null}
          </div>
        </Card>

        {!result && !load.pending ? (
          <Card>
            <EmptyState
              icon="portfolio"
              title="No analysis yet"
              description="Set your holdings list and run the analysis to see sector concentration, weighted volatility, correlation overlap and concrete diversification risks."
              action={
                <Button variant="primary" icon="portfolio" loading={load.pending} onClick={() => load.run()}>
                  Analyse portfolio
                </Button>
              }
            />
          </Card>
        ) : load.pending ? (
          <SkeletonCard height={380} />
        ) : result ? (
          <>
            {result.error ? (
              <Card>
                <EmptyState icon="alert" title="Analysis failed" description={result.error} />
              </Card>
            ) : (
              <>
                <div className="grid grid-sidebar">
                  <Card title="Diversification">
                    <div className="col" style={{ alignItems: "center", gap: "var(--sp-2)" }}>
                      <span
                        className="num"
                        style={{
                          fontSize: 48,
                          fontWeight: 650,
                          letterSpacing: "-.03em",
                          lineHeight: 1,
                          color:
                            result.diversification_score >= 70
                              ? "var(--bull)"
                              : result.diversification_score >= 45
                                ? "var(--warn)"
                                : "var(--bear)",
                        }}
                      >
                        {result.diversification_score}
                      </span>
                      <Badge tone={scoreTone(result.diversification_score)}>
                        {scoreLabel(result.diversification_score)} · {result.risk_level} risk
                      </Badge>
                    </div>
                    <div style={{ marginTop: "var(--sp-4)" }}>
                      <ScoreBar score={result.diversification_score} />
                    </div>
                  </Card>

                  <div className="metric-grid">
                    <Metric label="Weighted volatility" value={pctPlain(result.weighted_volatility_pct)} hint="annualised, equal weight" />
                    <Metric label="Average correlation" value={ratio(result.correlation.average_pairwise)} />
                    <Metric label="Sectors" value={String(result.sectors.length)} hint="represented" />
                    <Metric label="Positions" value={String(result.positions.length)} hint={`${num(result.effective_positions, 1)} effective`} />
                  </div>
                </div>

                <div className="grid grid-2">
                  <Card title="Sector concentration" subtitle="Share of the equal-weighted book by sector.">
                    <BarChart
                      points={result.sectors.map((sector) => ({
                        time: result.sectors.indexOf(sector) + 1,
                        value: sector.share_of_book,
                      }))}
                      height={200}
                      formatValue={(v) => `${num(v, 0)}%`}
                    />
                    <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
                    <div className="stack-sm col gap-3">
                      {result.sectors.map((sector) => (
                        <div key={sector.sector}>
                          <div className="row-between" style={{ fontSize: "var(--text-sm)" }}>
                            <b>{sector.sector}</b>
<span className="num muted">
                              {pctPlain(sector.share_of_book, 1)} · {num(sector.weight_pct, 1)}%
                            </span>
                          </div>
                          <span style={{ display: "block", height: 5, borderRadius: 3, background: "var(--bg-inset)", marginTop: 4 }}>
                            <span
                              style={{
                                display: "block",
                                height: "100%",
                                width: `${sector.share_of_book}%`,
                                borderRadius: 3,
                                background: sector.share_of_book > 40 ? "var(--warn)" : "var(--accent)",
                              }}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <div className="stack">
                    <Card
                      title="Risks"
                      subtitle="Concrete concentration and overlap problems detected in the book."
                      className={result.risks.length === 0 ? undefined : ""}
                    >
                      {result.risks.length === 0 ? (
                        <EmptyState
                          icon="check"
                          title="No structural risks found"
                          description="No sector exceeded 40% and no pair was strongly correlated over the window. That is a clean bill of health, not a forecast."
                        />
                      ) : (
                        <ul className="prose" style={{ margin: 0 }}>
                          {result.risks.map((risk, index) => (
                            <li key={index} style={{ color: "var(--text-primary)" }}>
                              {risk}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>

                    <Card title="Strengths" subtitle="Where the diversification is actually working.">
                      {result.strengths.length === 0 ? (
                        <p className="faint" style={{ fontSize: "var(--text-sm)" }}>
                          No strong diversifying pairs were found in this window.
                        </p>
                      ) : (
                        <ul className="prose" style={{ margin: 0 }}>
                          {result.strengths.map((strength, index) => (
                            <li key={index}>{strength}</li>
                          ))}
                        </ul>
                      )}

                      <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
                      <div className="grid grid-2">
                        <div>
                          <span className="field-label">Least correlated pair</span>
                          <p className="num" style={{ fontSize: "var(--text-md)" }}>
                            {result.lowest_correlation
                              ? `${result.lowest_correlation.a} / ${result.lowest_correlation.b} · ${ratio(
                                  result.lowest_correlation.value,
                                )}`
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <span className="field-label">Most correlated pair</span>
                          <p className="num" style={{ fontSize: "var(--text-md)" }}>
                            {result.highest_correlation
                              ? `${result.highest_correlation.a} / ${result.highest_correlation.b} · ${ratio(
                                  result.highest_correlation.value,
                                )}`
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>

                {result.overlapping_pairs.length > 0 ? (
                  <Card title="Correlated pairs" subtitle="Positions that tend to move together, sorted by absolute correlation.">
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Pair</th>
                            <th className="num-cell">Correlation</th>
                            <th>Strength</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...result.overlapping_pairs]
                            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                            .map((pair) => (
                              <tr key={`${pair.a}-${pair.b}`}>
                                <td>
                                  <Link href={`/research?symbol=${encodeURIComponent(pair.a)}`}>{pair.a}</Link>{" "}
                                  <span className="faint">vs</span>{" "}
                                  <Link href={`/research?symbol=${encodeURIComponent(pair.b)}`}>{pair.b}</Link>
                                </td>
                                <td
                                  className="num-cell"
                                  style={{ color: pair.value >= 0 ? "var(--bull)" : "var(--bear)", fontWeight: 600 }}
                                >
                                  {ratio(pair.value)}
                                </td>
                                <td>
                                  <Badge tone={pair.value >= 0 ? "bull" : "bear"}>{pair.strength}</Badge>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ) : null}

                <Card title="Per-position risk" subtitle="Each holding measured on its own, over the selected window.">
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Sector</th>
<th className="num-cell">Weight</th>
                            <th className="num-cell">Volatility</th>
                            <th className="num-cell">Return</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {result.positions.map((holding) => (
                            <tr key={holding.symbol}>
                              <td>
                                <Link href={`/research?symbol=${encodeURIComponent(holding.symbol)}`}>
                                  <b>{holding.symbol}</b>
                                </Link>
                              </td>
                              <td className="muted">{holding.sector}</td>
                              <td className="num-cell">{pctPlain(holding.weight_pct, 1)}</td>
                              <td className="num-cell">{pctPlain(holding.volatility_pct)}</td>
                              <td
                                className="num-cell"
                                style={{ color: holding.return_pct >= 0 ? "var(--bull)" : "var(--bear)", fontWeight: 600 }}
                              >
                                {pctPlain(holding.return_pct)}
                              </td>
                            <td className="num-cell">
                              <Icon name="arrowRight" size={13} style={{ color: "var(--text-tertiary)" }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Disclaimer>{result.disclaimer}</Disclaimer>
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}