"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Metric, Field, Disclaimer, EmptyState, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { CorrelationHeatmap } from "@/components/charts/Charts";
import { useAsync, useAction, AsyncBoundary } from "@/lib/hooks";
import { api, type Period, type CorrelationMatrix, type Instrument } from "@/lib/api";
import { num, ratio } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";

const DEFAULT_SET = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ITC"];

export default function CorrelationsPage() {
  const [symbols, setSymbols] = React.useState<string[]>(DEFAULT_SET);
  const [period, setPeriod] = React.useState<Period>("Last 1 year");
  const [matrix, setMatrix] = React.useState<CorrelationMatrix | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [selected, setSelected] = React.useState<{ a: string; b: string } | null>(null);

  const load = useAction(async () => {
    const response = await api.correlations({ symbols, period });
    setMatrix(response);
    setSelected(null);
    return response;
  });

  const toggle = (symbol: string) => {
    setSymbols((current) =>
      current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol].slice(0, 8),
    );
  };

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Correlations"
        description="Pairwise return correlations computed from real overlapping daily returns. Diagonal is always 1; the interesting cells are the ones off it."
        actions={
          <Button variant="primary" icon="chart" loading={load.pending} onClick={() => load.run()}>
            Compute matrix
          </Button>
        }
      />

      <div className="stack">
        <Card title="Selection" subtitle="Pick two to eight instruments with a real overlap in the chosen window.">
          <div className="stack">
            <div className="row wrap gap-2">
              {symbols.map((symbol) => (
                <span key={symbol} className="badge badge-accent" style={{ gap: 4 }}>
                  {symbol}
                  <button
                    type="button"
                    onClick={() => setSymbols((c) => c.filter((s) => s !== symbol))}
                    aria-label={`Remove ${symbol}`}
                    style={{ display: "grid", placeItems: "center", marginLeft: 2 }}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
              <Button variant="secondary" size="sm" icon="plus" onClick={() => setPicking(true)}>
                Add instrument
              </Button>
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
              <p className="faint grow" style={{ fontSize: "var(--text-xs)", alignSelf: "flex-end", paddingBottom: 8 }}>
                {symbols.length} instrument{symbols.length === 1 ? "" : "s"} selected
                {symbols.length < 2 ? " — pick at least two" : ""}.
              </p>
            </div>

            {load.error ? (
              <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
                <Icon name="alert" size={13} />
                <span>{load.error}</span>
              </p>
            ) : null}
          </div>
        </Card>

        {!matrix && !load.pending ? (
          <Card>
            <EmptyState
              icon="chart"
              title="No matrix computed"
              description="Select your instruments and compute the matrix. Every value comes from actual overlapping daily returns in the selected window."
              action={
                <Button variant="primary" icon="chart" loading={load.pending} onClick={() => load.run()}>
                  Compute matrix
                </Button>
              }
            />
          </Card>
        ) : load.pending ? (
          <SkeletonCard height={400} />
        ) : matrix ? (
          <>
            <div className="metric-grid">
              <Metric
                label="Average correlation"
                value={ratio(matrix.average_pairwise)}
                hint={`${period} · ${matrix.observations} observations`}
              />
              <Metric label="Instruments" value={String(matrix.assets.map(a => a.symbol).length)} />
              <Metric
                label="Strongest pair"
                value={
                  matrix.pairs.length
                    ? matrix.pairs.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)).a.replace("|", " / ")
                    : "—"
                }
                hint="by absolute rho"
              />
              <Metric label="Data source" value={matrix.period} />
            </div>

            <Card
              title="Correlation matrix"
              subtitle="Green is positive co-movement, red is inverse. Click any off-diagonal cell to inspect the pair."
            >
              <CorrelationHeatmap symbols={matrix.assets.map(a => a.symbol)} matrix={matrix.matrix} onSelect={(a, b) => setSelected({ a, b })} />
              {selected ? (
                <PairDetail
                  matrix={matrix}
                  pair={selected}
                  onClose={() => setSelected(null)}
                  onExplore={(symbol) => {
                    window.location.href = `/research?symbol=${encodeURIComponent(symbol)}`;
                  }}
                />
              ) : null}
              <div style={{ marginTop: "var(--sp-4)" }}>
                <Disclaimer>Correlation is computed from overlapping daily returns in the selected window. It is a statistical measure of co-movement, not a causal link and not a forecast.</Disclaimer>
              </div>
            </Card>

            <Card title="All pairs" subtitle="Sorted by absolute correlation, strongest first.">
              {matrix.pairs.length === 0 ? (
                <EmptyState icon="empty" title="No overlapping pairs" description="None of the selected instruments shared enough history in this window." />
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Pair</th>
                        <th className="num-cell">Correlation</th>
                        <th>Strength</th>
                        <th className="num-cell">Window bars</th>
                        <th style={{ width: "30%" }}>Magnitude</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...matrix.pairs]
                        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                        .map((pair) => (
                          <tr key={`${pair.a}-${pair.b}`}>
                            <td>
                              <b>{pair.a}</b> <span className="faint">vs</span> <b>{pair.b}</b>
                            </td>
                            <td
                              className="num-cell"
                              style={{
                                color: pair.value >= 0 ? "var(--bull)" : "var(--bear)",
                                fontWeight: 600,
                              }}
                            >
                              {ratio(pair.value)}
                            </td>
                            <td>
                              <Badge tone={pair.value >= 0 ? "bull" : "bear"}>{pair.strength}</Badge>
                            </td>
                            <td className="num-cell">{matrix.observations}</td>
                            <td>
                              <span style={{ display: "block", height: 5, borderRadius: 3, background: "var(--bg-inset)" }}>
                                <span
                                  style={{
                                    display: "block",
                                    height: "100%",
                                    width: `${Math.min(100, Math.abs(pair.value) * 100)}%`,
                                    borderRadius: 3,
                                    background: pair.value >= 0 ? "var(--bull)" : "var(--bear)",
                                  }}
                                />
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ) : null}
      </div>

      <InstrumentModal
        open={picking}
        onClose={() => setPicking(false)}
        selected={symbols}
        onToggle={toggle}
      />
    </main>
  );
}

function PairDetail({
  matrix,
  pair,
  onClose,
  onExplore,
}: {
  matrix: CorrelationMatrix;
  pair: { a: string; b: string };
  onClose: () => void;
  onExplore: (symbol: string) => void;
}) {
  const found = matrix.pairs.find(
    (p) => (p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a),
  );
  if (!found) return null;

  return (
    <div className="card" style={{ marginTop: "var(--sp-4)", background: "var(--bg-subtle)" }}>
      <div className="row-between">
        <div>
          <b>
            {found.a} ↔ {found.b}
          </b>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
{found.strength} correlation of <b className="num">{ratio(found.value)}</b> across{" "}
            {matrix.observations} daily returns in {matrix.period.toLowerCase()}.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close pair detail">
          <Icon name="x" size={14} />
        </Button>
      </div>
      <div className="row wrap gap-2" style={{ marginTop: "var(--sp-3)" }}>
        <Link className="btn btn-secondary btn-sm" href={`/research?symbol=${encodeURIComponent(found.a)}`}>
          Research {found.a}
        </Link>
        <Link className="btn btn-secondary btn-sm" href={`/research?symbol=${encodeURIComponent(found.b)}`}>
          Research {found.b}
        </Link>
      </div>
    </div>
  );
}

function InstrumentModal({
  open,
  onClose,
  selected,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onToggle: (symbol: string) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const instruments = useAsync((signal) => api.instruments(signal), [], { enabled: open });

  const filtered = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = instruments.data?.instruments ?? [];
    if (!term) return list.slice(0, 120);
    return list
      .filter((item) => item.symbol.toLowerCase().includes(term) || item.name.toLowerCase().includes(term))
      .slice(0, 120);
  }, [instruments.data, filter]);

  return (
    <Modal open={open} onClose={onClose} title="Add instruments" description="Up to eight at a time." wide>
      <div className="stack">
        <input
          className="input"
          placeholder="Filter by symbol or name"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter instruments"
        />
        <AsyncBoundary
          loading={instruments.loading}
          error={instruments.error}
          onRetry={instruments.reload}
          isEmpty={filtered.length === 0}
          emptyTitle="No matches"
          emptyDescription="No instrument matches that filter."
          skeleton={<SkeletonCard height={260} />}
        >
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Sector</th>
                  <th className="num-cell">Added</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isSelected = selected.includes(item.symbol);
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => onToggle(item.symbol)}
                      style={{ cursor: "pointer", opacity: isSelected ? 1 : 0.75 }}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onToggle(item.symbol);
                      }}
                    >
                      <td>
                        <b>{item.symbol}</b>
                      </td>
                      <td className="muted truncate" style={{ maxWidth: 220 }}>
                        {item.name}
                      </td>
                      <td className="faint">{item.sector}</td>
                      <td className="num-cell">
                        {isSelected ? <Icon name="check" size={14} style={{ color: "var(--bull)" }} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
