"use client";

import * as React from "react";
import { Card, Button, Badge, Field, Disclaimer, EmptyState, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAction } from "@/lib/hooks";
import { api, type ScenarioResult } from "@/lib/api";
import { PageHeader } from "@/components/shell/UserMenu";

const HORIZONS = ["1 week", "2 weeks", "1 month", "3 months", "6 months", "1 year"];

const PRESETS = [
  "A 200 bps RBI rate hike compresses valuations across rate-sensitive sectors",
  "Nifty 50 breaks below its 200-day moving average on rising volume",
  "A monsoon shortfall hits FMCG and agri-input volumes",
  "Crude spikes above USD 95 a barrel for a sustained quarter",
  "US CPI re-accelerates and the Fed holds rates higher for longer",
];

export default function ScenarioLabPage() {
  const [scenario, setScenario] = React.useState(PRESETS[0]);
  const [horizon, setHorizon] = React.useState(HORIZONS[1]);
  const [result, setResult] = React.useState<ScenarioResult | null>(null);

  const run = useAction(async (text: string, window: string) => {
    const response = await api.scenario({ scenario: text, horizon: window });
    setResult(response);
    return response;
  });

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Scenario Lab"
        description="Describe a hypothetical market event in plain language. The service maps it onto the sectors that would be affected and states how confident it can be. It does not predict prices."
      />

      <div className="grid grid-sidebar" style={{ alignItems: "start" }}>
        <Card title="Scenario setup" className="stack">
          <Field label="Scenario" htmlFor="sc-text">
            <textarea
              id="sc-text"
              className="textarea"
              rows={5}
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              placeholder="Describe the hypothetical event…"
            />
          </Field>

          <Field label="Horizon">
            <select className="select" value={horizon} onChange={(event) => setHorizon(event.target.value)}>
              {HORIZONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Button
            variant="primary"
            icon="layers"
            block
            loading={run.pending}
            disabled={!scenario.trim()}
            onClick={() => run.run(scenario, horizon)}
          >
            Run scenario
          </Button>

          <div className="divider" style={{ margin: "var(--sp-1) 0" }} />
          <span className="field-label">Presets</span>
          <div className="col gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="dropdown-item"
                style={{ border: "1px solid var(--border-subtle)", height: "auto", padding: "8px 10px" }}
                onClick={() => setScenario(preset)}
                disabled={run.pending}
              >
                <Icon name="sparkles" size={13} />
                <span style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{preset}</span>
              </button>
            ))}
          </div>

          {run.error ? (
            <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
              <Icon name="alert" size={13} />
              <span>{run.error}</span>
            </p>
          ) : null}
        </Card>

        <div className="stack">
          {!result && !run.pending ? (
            <Card>
              <EmptyState
                icon="layers"
                title="No scenario run yet"
                description="Describe a hypothetical event and run it to see the summary, the sectors it would touch and how confident the service is. Pick a preset on the left if you want a starting point."
                action={
                  <Button
                    variant="primary"
                    icon="layers"
                    loading={run.pending}
                    disabled={!scenario.trim()}
                    onClick={() => run.run(scenario, horizon)}
                  >
                    Run scenario
                  </Button>
                }
              />
            </Card>
          ) : run.pending ? (
            <SkeletonCard height={300} />
          ) : result ? (
            <>
              <Card
                title="Scenario read"
                subtitle={`Horizon: ${result.horizon}`}
                actions={
                  <Badge
                    tone={
                      result.confidence.toLowerCase() === "high"
                        ? "bull"
                        : result.confidence.toLowerCase() === "medium"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {result.confidence} confidence
                  </Badge>
                }
              >
                <p className="prose" style={{ margin: 0 }}>
                  {result.summary}
                </p>
                <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
                <span className="field-label">Scenario analysed</span>
                <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 4 }}>
                  {result.scenario}
                </p>
              </Card>

              <Card
                title="Affected sectors"
                subtitle="Where leadership would most likely shift if this event occurred."
              >
                {result.sector_effects.length === 0 ? (
                  <EmptyState
                    icon="info"
                    title="No sector mapping"
                    description="The service could not map this scenario onto a tracked sector."
                  />
                ) : (
                  <ul className="prose" style={{ margin: 0 }}>
                    {result.sector_effects.map((effect, index) => (
                      <li key={index}>{effect}</li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: "var(--sp-4)" }}>
                  <Disclaimer>{result.disclaimer}</Disclaimer>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}