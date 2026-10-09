"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card, Disclaimer, EmptyState, ErrorState, Field, Metric, Segmented, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/shell/UserMenu";
import { useAsync, useLocalStorage } from "@/lib/hooks";
import { api, type ScanCondition, type ScanResult, type ScannerCatalog } from "@/lib/api";
import { date, num, pct, tone } from "@/lib/format";

type Mode = "preset" | "custom";
type Query =
  | { kind: "preset"; id: string }
  | { kind: "custom"; conditions: ScanCondition[]; logic: "all" | "any" };

const OP_LABELS: Record<string, string> = {
  ">": "is above",
  ">=": "is at least",
  "<": "is below",
  "<=": "is at most",
  crosses_above: "crosses above",
  crosses_below: "crosses below",
};

const STARTER: ScanCondition[] = [
  { field: "rsi", op: "<", value: 40 },
  { field: "close", op: ">", value: "sma200" },
];

function describe(condition: ScanCondition, catalog: ScannerCatalog | null): string {
  const label = (id: string) => catalog?.fields.find((f) => f.id === id)?.label ?? id;
  const right = typeof condition.value === "string" ? label(condition.value) : num(condition.value, 2).replace(/\.00$/, "");
  return `${label(condition.field)} ${OP_LABELS[condition.op] ?? condition.op} ${right}`;
}

/* ---- Custom condition builder ------------------------------------------ */

function ConditionRow({
  index,
  condition,
  catalog,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  condition: ScanCondition;
  catalog: ScannerCatalog;
  onChange: (next: ScanCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const crossing = condition.op.startsWith("crosses");
  const comparesField = typeof condition.value === "string";
  return (
    <div className="row wrap gap-2" style={{ alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 170px" }}>
        <Field label={index === 0 ? "Indicator" : " "} htmlFor={`scan-field-${index}`}>
          <select
            id={`scan-field-${index}`}
            className="select"
            value={condition.field}
            onChange={(event) => onChange({ ...condition, field: event.target.value })}
          >
            {catalog.fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ flex: "0 1 150px" }}>
        <Field label={index === 0 ? "Rule" : " "} htmlFor={`scan-op-${index}`}>
          <select
            id={`scan-op-${index}`}
            className="select"
            value={condition.op}
            onChange={(event) => {
              const op = event.target.value;
              // A crossover needs a second series, so switch the value to a field.
              const value = op.startsWith("crosses") && typeof condition.value !== "string" ? "ema50" : condition.value;
              onChange({ ...condition, op, value });
            }}
          >
            {catalog.operators.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op] ?? op}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ flex: "0 1 120px" }}>
        <Field label={index === 0 ? "Compare to" : " "} htmlFor={`scan-kind-${index}`}>
          <select
            id={`scan-kind-${index}`}
            className="select"
            value={comparesField ? "field" : "number"}
            disabled={crossing}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value === "field" ? "ema50" : 50 })
            }
          >
            <option value="number">A number</option>
            <option value="field">Indicator</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: "1 1 150px" }}>
        <Field label={index === 0 ? "Value" : " "} htmlFor={`scan-value-${index}`}>
          {comparesField ? (
            <select
              id={`scan-value-${index}`}
              className="select"
              value={condition.value as string}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
            >
              {catalog.fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`scan-value-${index}`}
              className="input"
              type="number"
              step="any"
              value={Number.isFinite(condition.value as number) ? (condition.value as number) : ""}
              onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })}
            />
          )}
        </Field>
      </div>
      <Button variant="ghost" icon="trash" onClick={onRemove} disabled={!canRemove} aria-label="Remove condition" />
    </div>
  );
}

/* ---- Results table ------------------------------------------------------ */

function Results({ result }: { result: ScanResult }) {
  if (result.count === 0) {
    return (
      <EmptyState
        icon="filter"
        title="No instruments match right now"
        description={`All ${result.scanned} instruments were checked against the latest session. Try another scan, loosen a threshold, or widen the universe.`}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Sector</th>
            <th className="num-cell">Close</th>
            <th className="num-cell">Day</th>
            <th className="num-cell">20 days</th>
            <th className="num-cell">RSI</th>
            <th className="num-cell">ADX</th>
            <th className="num-cell">Volume ×</th>
            <th className="num-cell">From 52w high</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {result.results.map((row) => (
            <tr key={row.symbol}>
              <td>
                <Link href={`/research?symbol=${encodeURIComponent(row.symbol)}`} style={{ fontWeight: 600 }}>
                  {row.symbol}
                </Link>
                <div className="faint" style={{ fontSize: "var(--text-xs)" }}>
                  {row.name}
                  {row.source === "simulated" ? " · simulated data" : ""}
                </div>
              </td>
              <td className="muted">{row.sector}</td>
              <td className="num-cell">{num(row.close)}</td>
              <td className={`num-cell ${tone(row.change_pct)}`}>{pct(row.change_pct)}</td>
              <td className={`num-cell ${tone(row.ret_20)}`}>{pct(row.ret_20)}</td>
              <td className="num-cell">{num(row.rsi, 1)}</td>
              <td className="num-cell">{num(row.adx, 1)}</td>
              <td className="num-cell">{row.vol_ratio === null ? "—" : `${num(row.vol_ratio, 2)}×`}</td>
              <td className="num-cell">{row.pct_from_high52 === null ? "—" : `${num(row.pct_from_high52, 1)}%`}</td>
              <td>
                <Link
                  className="btn btn-ghost btn-sm"
                  href={`/backtesting?symbol=${encodeURIComponent(row.symbol)}`}
                  title={`Backtest ${row.symbol}`}
                >
                  <Icon name="flask" size={13} />
                  Backtest
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Page --------------------------------------------------------------- */

export default function ScannerPage() {
  const catalog = useAsync((signal) => api.scannerCatalog(signal), []);
  const [mode, setMode] = useLocalStorage<Mode>("scanner-mode", "preset");
  const [universe, setUniverse] = useLocalStorage("scanner-universe", "All");
  const [presetId, setPresetId] = useLocalStorage("scanner-preset", "strong_uptrend");
  const [conditions, setConditions] = React.useState<ScanCondition[]>(STARTER);
  const [logic, setLogic] = React.useState<"all" | "any">("all");
  const [query, setQuery] = React.useState<Query>({ kind: "preset", id: presetId });

  React.useEffect(() => {
    if (mode === "preset") setQuery({ kind: "preset", id: presetId });
  }, [mode, presetId]);

  const scan = useAsync(
    (signal) =>
      query.kind === "preset"
        ? api.scanPreset({ id: query.id, universe }, signal)
        : api.scanCustom({ conditions: query.conditions, logic: query.logic, universe }, signal),
    [JSON.stringify(query), universe],
  );

  const data = catalog.data;
  const presets = data?.presets.flatMap((group) => group.scans) ?? [];
  const activePreset = presets.find((preset) => preset.id === presetId);
  const result = scan.data;

  const runCustom = () => setQuery({ kind: "custom", conditions, logic });

  return (
    <main className="page">
      <PageHeader
        eyebrow="Workspace"
        title="Stock Scanner"
        description="Filter the whole universe by technical conditions on the latest daily close, from ready-made scans or rules you build yourself."
        actions={
          <Button variant="secondary" icon="refresh" onClick={scan.reload} loading={scan.loading}>
            Re-run
          </Button>
        }
      />

      <Card style={{ marginBottom: "var(--sp-5)" }}>
        <div className="row wrap gap-4" style={{ alignItems: "flex-end" }}>
          <Field label="Mode">
            <Segmented
              ariaLabel="Scanner mode"
              value={mode}
              onChange={(next) => {
                setMode(next);
                if (next === "custom") runCustom();
              }}
              options={[
                { value: "preset", label: "Ready-made scans" },
                { value: "custom", label: "Custom builder" },
              ]}
            />
          </Field>
          <div style={{ width: 210 }}>
            <Field label="Universe" htmlFor="scan-universe">
              <select
                id="scan-universe"
                className="select"
                value={universe}
                onChange={(event) => setUniverse(event.target.value)}
              >
                {(data?.universes ?? ["All"]).map((option) => (
                  <option key={option} value={option}>
                    {option === "All" ? "All instruments" : option}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {result ? (
            <>
              <div className="grow" />
              <div className="row gap-2 wrap" style={{ alignSelf: "center" }}>
                <Badge tone="accent">{result.count} matches</Badge>
                <Badge tone="neutral">as of {date(result.as_of)}</Badge>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {catalog.error ? (
        <Card>
          <ErrorState description={catalog.error} onRetry={catalog.reload} />
        </Card>
      ) : (
        <div className="grid grid-sidebar" style={{ alignItems: "start" }}>
          {/* ---- Left: scan picker or builder ---- */}
          {mode === "preset" ? (
            <Card title="Scans" subtitle="Pick one to run it across the universe.">
              {!data ? (
                <SkeletonCard height={360} />
              ) : (
                <div className="stack" style={{ gap: "var(--sp-4)" }}>
                  {data.presets.map((group) => (
                    <div key={group.group} className="col gap-1">
                      <span className="field-label">{group.group}</span>
                      {group.scans.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`scan-pick${preset.id === presetId ? " active" : ""}`}
                          aria-pressed={preset.id === presetId}
                          onClick={() => setPresetId(preset.id)}
                          title={preset.summary}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Your conditions" subtitle="Every rule is checked on the latest daily bar.">
              {!data ? (
                <SkeletonCard height={300} />
              ) : (
                <div className="stack">
                  <Field label="Match">
                    <Segmented
                      ariaLabel="Combine conditions"
                      value={logic}
                      onChange={setLogic}
                      options={[
                        { value: "all", label: "All rules" },
                        { value: "any", label: "Any rule" },
                      ]}
                    />
                  </Field>
                  {conditions.map((condition, index) => (
                    <ConditionRow
                      key={index}
                      index={index}
                      condition={condition}
                      catalog={data}
                      canRemove={conditions.length > 1}
                      onChange={(next) => setConditions(conditions.map((c, i) => (i === index ? next : c)))}
                      onRemove={() => setConditions(conditions.filter((_, i) => i !== index))}
                    />
                  ))}
                  <div className="row gap-2 wrap">
                    <Button
                      variant="secondary"
                      icon="plus"
                      disabled={conditions.length >= 12}
                      onClick={() => setConditions([...conditions, { field: "adx", op: ">", value: 25 }])}
                    >
                      Add rule
                    </Button>
                    <Button variant="primary" icon="filter" onClick={runCustom} loading={scan.loading && query.kind === "custom"}>
                      Run scan
                    </Button>
                  </div>
                  {activePreset ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="copy"
                      onClick={() => {
                        setConditions(activePreset.conditions);
                        setLogic(activePreset.logic);
                      }}
                    >
                      Start from “{activePreset.name}”
                    </Button>
                  ) : null}
                </div>
              )}
            </Card>
          )}

          {/* ---- Right: results ---- */}
          <div className="stack">
            <Card
              title={query.kind === "preset" ? activePreset?.name ?? "Scan results" : "Custom scan results"}
              subtitle={
                query.kind === "preset"
                  ? activePreset?.summary
                  : query.conditions.map((c) => describe(c, data)).join(query.logic === "all" ? " AND " : " OR ")
              }
            >
              {scan.loading && !result ? (
                <SkeletonCard height={360} />
              ) : scan.error ? (
                <ErrorState description={scan.error} onRetry={scan.reload} />
              ) : result ? (
                <div className="stack">
                  <div className="grid grid-4">
                    <Metric label="Instruments scanned" value={num(result.scanned, 0)} />
                    <Metric label="Matches" value={num(result.count, 0)} />
                    <Metric label="Latest session" value={date(result.as_of)} />
                    <Metric
                      label="Real NSE data"
                      value={`${num(result.real_data, 0)} symbols`}
                      hint="Others fall back to simulated history"
                    />
                  </div>
                  <Results result={result} />
                </div>
              ) : null}
            </Card>
            <Disclaimer>
              Scans describe what already happened on the latest daily close. They are research filters, not buy or sell
              recommendations.
            </Disclaimer>
          </div>
        </div>
      )}
    </main>
  );
}
