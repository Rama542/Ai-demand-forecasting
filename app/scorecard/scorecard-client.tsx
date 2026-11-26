"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Metric } from "@/components/ui";
import { PageHeader } from "@/components/shell/UserMenu";
import { api } from "@/lib/api";
import { date, num, pctPlain } from "@/lib/format";
import { readScorecard, scoreForecast, writeScorecard, type SavedForecast } from "@/lib/scorecard";

export default function ScorecardClient() {
  const [userId, setUserId] = React.useState<string | null>(null);
  const [records, setRecords] = React.useState<SavedForecast[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState("");
  const [revised, setRevised] = React.useState<string[]>([]);
  const mounted = React.useRef(true);

  async function checkOutcomes(id: string, entries: SavedForecast[]) {
    const pending = entries.filter(item => !item.outcome);
    if (!pending.length) return;
    setChecking(true); setError("");
    const results = await Promise.allSettled(pending.map(item => api.scorecardActual(item.symbol, item.anchorTime)));
    if (!mounted.current) return;
    let failed = 0;
    const changed = new Map<string, SavedForecast["outcome"]>();
    const revisedIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") { failed++; return; }
      const scored = scoreForecast(pending[index], result.value);
      if (scored.status === "resolved") changed.set(pending[index].id, scored.outcome);
      if (scored.status === "revised") revisedIds.push(pending[index].id);
    });
    const updated = entries.map(item => changed.has(item.id) ? { ...item, outcome: changed.get(item.id) } : item);
    try {
      if (changed.size) writeScorecard(id, updated);
      setRecords(updated);
      setRevised(revisedIds);
      if (failed) setError(`Could not check ${failed} call${failed === 1 ? "" : "s"}. The market data service may be unavailable.`);
    } catch { setError("Could not save the updated scorecard in this browser."); }
    finally { setChecking(false); }
  }

  React.useEffect(() => {
    mounted.current = true;
    fetch("/api/auth/me", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Sign in to view your scorecard.");
      const { id } = await response.json() as { id: string };
      if (!mounted.current) return;
      const stored = readScorecard(id);
      setUserId(id); setRecords(stored); setLoading(false);
      void checkOutcomes(id, stored);
    }).catch(cause => { if (mounted.current) { setError(cause instanceof Error ? cause.message : "Could not load your scorecard."); setLoading(false); } });
    return () => { mounted.current = false; };
    // Check once on opening the page; manual refresh handles later checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function remove(id: string) {
    if (!userId) return;
    const updated = records.filter(item => item.id !== id);
    try { writeScorecard(userId, updated); setRecords(updated); setRevised(items => items.filter(item => item !== id)); }
    catch { setError("Could not update this browser's scorecard."); }
  }

  const completed = records.filter(item => item.outcome);
  const hits = completed.filter(item => item.outcome?.correct).length;
  const baselineHits = completed.filter(item => item.outcome?.baselineCorrect).length;
  const pending = records.length - completed.length;

  return <main className="page">
    <PageHeader eyebrow="Analysis" title="Prediction scorecard"
      description="Calls saved before the next completed daily close, checked against real prices and an always-UP baseline."
      actions={<Link className="btn btn-primary" href="/research">Track a forecast →</Link>} />
    <div className="grid grid-4" style={{ marginBottom: "var(--sp-5)" }}>
      <Metric label="Tracked calls" value={records.length} hint="saved in this browser" />
      <Metric label="Waiting for close" value={pending} hint="not scored yet" />
      <Metric label="Model accuracy" value={completed.length ? pctPlain(hits / completed.length * 100, 1) : "—"} hint={`${completed.length} completed calls`} />
      <Metric label="Always-UP baseline" value={completed.length ? pctPlain(baselineHits / completed.length * 100, 1) : "—"} hint="same completed calls" />
    </div>
    <Card title="Saved daily calls" subtitle="One call per symbol and completed daily bar."
      actions={<Button icon="refresh" onClick={() => userId && void checkOutcomes(userId, records)} loading={checking} disabled={!userId || !pending}>Check outcomes</Button>}>
      {loading ? <p className="faint">Loading your scorecard…</p> : records.length === 0 ?
        <EmptyState icon="chart" title="No calls saved yet" description="Open Stock Research, select Forecast & explanation, then save a real daily call before its outcome is available." action={<Link className="btn btn-primary" href="/research">Open stock research</Link>} /> :
        <div className="table-wrap"><table className="data"><thead><tr><th>Saved</th><th>Instrument</th><th>Call</th><th>Next close</th><th>Result</th><th>Baseline</th><th aria-label="Remove" /></tr></thead><tbody>
          {records.map(item => <tr key={item.id}>
            <td>{date(item.savedAt)}</td><td><Link href={`/research?symbol=${encodeURIComponent(item.symbol)}`}>{item.symbol}</Link><div className="faint">{item.name}</div></td>
            <td><Badge tone={item.direction === "UP" ? "bull" : "bear"}>{item.direction}</Badge><div className="faint">{pctPlain(item.probability, 1)} · base {num(item.baseClose)}</div></td>
            <td>{item.outcome ? <>{num(item.outcome.close)}<div className="faint">{date(item.outcome.time)} · {pctPlain(item.outcome.returnPct, 2)}</div></> : "—"}</td>
            <td>{item.outcome ? <Badge tone={item.outcome.correct ? "bull" : "bear"}>{item.outcome.correct ? "Correct" : "Missed"}</Badge> : revised.includes(item.id) ? <Badge tone="warn">Price revised</Badge> : <Badge>Pending</Badge>}</td>
            <td>{item.outcome ? (item.outcome.baselineCorrect ? "Correct" : "Missed") : "—"}</td>
            <td><Button variant="ghost" size="sm" icon="trash" aria-label={`Remove ${item.symbol} call from ${date(item.anchorTime)}`} onClick={() => remove(item.id)} /></td>
          </tr>)}</tbody></table></div>}
    </Card>
    {error ? <p className="scorecard-error" role="alert">{error}</p> : null}
    <p className="scorecard-note">Only real, completed daily prices count. A revised historical price is left unscored. Calls are stored on this device for the signed-in account; clearing browser storage removes them. Fewer than 20 completed calls is too small a sample to judge the model.</p>
  </main>;
}
