"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { api, type ResearchBundle } from "@/lib/api";
import { date, num, pctPlain } from "@/lib/format";
import { addForecast, readScorecard, type SavedForecast } from "@/lib/scorecard";

export function ForecastCapture({ bundle }: { bundle: ResearchBundle }) {
  const [userId, setUserId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const forecast = bundle.forecast?.latest_forecast;
  const anchor = bundle.candles[bundle.candles.length - 1];
  const id = anchor ? `${bundle.symbol}:${anchor.time}` : "";
  const real = Boolean(bundle.data_source && bundle.data_source !== "simulated");
  const recent = Boolean(anchor && Date.now() - anchor.time * 1000 < 7 * 86400_000);
  const valid = Boolean(forecast && anchor && real && recent &&
    (forecast.direction === "UP" || forecast.direction === "DOWN") &&
    Number.isFinite(forecast.probability) && Number.isFinite(forecast.last_close));

  React.useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then(async response => {
      if (response.ok) setUserId((await response.json() as { id: string }).id);
    }).catch(() => {});
  }, []);
  React.useEffect(() => {
    setMessage("");
    setSaved(Boolean(userId && readScorecard(userId).some(item => item.id === id)));
  }, [userId, id]);

  async function save() {
    if (!userId || !forecast || !anchor || !valid || busy) return;
    setBusy(true); setMessage("");
    try {
      const actual = await api.scorecardActual(bundle.symbol, anchor.time);
      if (actual.latest_bar.time !== anchor.time || !actual.anchor_bar || actual.next_bar ||
          Math.abs(actual.anchor_bar.close - forecast.last_close) > 0.01) {
        setMessage("The completed daily close has changed. Refresh this research page before saving a new call.");
        return;
      }
      const entry: SavedForecast = {
        id, symbol: bundle.symbol, name: bundle.meta.name, savedAt: new Date().toISOString(),
        anchorTime: anchor.time, baseClose: forecast.last_close,
        direction: forecast.direction as "UP" | "DOWN", probability: forecast.probability,
        model: bundle.forecast.model, source: actual.source,
      };
      if (addForecast(userId, entry)) setSaved(true);
      else setMessage("This daily call is already in your scorecard.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check the completed daily price.");
    } finally { setBusy(false); }
  }

  return <Card title="Track this forecast" subtitle="Save the current direction call before the next daily close is available."
    actions={<Link className="btn btn-secondary" href="/scorecard">View scorecard →</Link>}>
    {forecast && anchor ? <div className="scorecard-capture">
      <div className="metric"><div className="metric-label">Next daily close</div><div className="metric-value">
        <Badge tone={forecast.direction === "UP" ? "bull" : "bear"}>{forecast.direction}</Badge>
        <span style={{ marginLeft: 10 }}>{pctPlain(forecast.probability, 1)} confidence</span>
      </div><div className="metric-hint">From {date(anchor.time)} close · {num(forecast.last_close)}</div></div>
      <div className="scorecard-capture-action"><Button variant="primary" icon={saved ? "check" : "plus"} onClick={save}
        disabled={!valid || !userId || saved} loading={busy}>{saved ? "Saved on this browser" : "Save this call"}</Button></div>
    </div> : <p className="faint">No forward forecast is available for this instrument.</p>}
    {!real ? <p className="scorecard-note">Tracking requires real daily prices; simulated history cannot be scored.</p> :
      !recent ? <p className="scorecard-note">The last daily bar is older than a week. Wait for the history feed to refresh before tracking this call.</p> :
      <p className="scorecard-note">Only completed daily bars can be tracked. Calls are kept in this browser for your signed-in account.</p>}
    {message ? <p className="scorecard-error" role="alert">{message}</p> : null}
  </Card>;
}
