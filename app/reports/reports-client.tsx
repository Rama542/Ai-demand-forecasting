"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Field, EmptyState, Disclaimer } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { useAction } from "@/lib/hooks";
import { api, type Period, type ResearchReport } from "@/lib/api";
import { dateTime, PERIODS } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";
import { useSearchParams } from "next/navigation";

export default function ReportsPage() {
  const params = useSearchParams();
  const { notify } = useToast();
  const [symbol, setSymbol] = React.useState((params.get("symbol") ?? "RELIANCE").toUpperCase());
  const [period, setPeriod] = React.useState<Period>("Last 1 year");
  const [report, setReport] = React.useState<ResearchReport | null>(null);

  const generate = useAction(async () => {
    const response = await api.research({ symbol, period });
    setReport(response);
    notify("success", "Report ready", `${response.symbol} · ${response.sections.length} sections`);
    return response;
  });

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildPlainText(report));
      notify("success", "Copied to clipboard", `${report.symbol} brief copied as plain text.`);
    } catch {
      notify("error", "Clipboard unavailable", "Your browser blocked clipboard access. Select the text manually.");
    }
  };

  return (
    <main className="page">
      <PageHeader
        eyebrow="Intelligence"
        title="Research reports"
        description="A generated brief per instrument. Every figure is produced by the services this workspace runs — the report is assembled from their actual output, not written by hand."
        actions={
          <>
            <Button variant="secondary" icon="copy" onClick={copy} disabled={!report}>
              Copy as text
            </Button>
            <Button variant="primary" icon="report" loading={generate.pending} onClick={() => generate.run()}>
              {report ? "Regenerate" : "Generate report"}
            </Button>
          </>
        }
      />

      <div className="grid grid-sidebar" style={{ alignItems: "start" }}>
        <Card title="Report setup" className="stack">
          <Field label="Instrument" htmlFor="rep-symbol">
            <input
              id="rep-symbol"
              className="input"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              spellCheck={false}
            />
          </Field>
          <Field label="Window">
            <select className="select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              {PERIODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" icon="report" block loading={generate.pending} onClick={() => generate.run()}>
            Generate report
          </Button>
          {generate.error ? (
            <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
              <Icon name="alert" size={13} />
              <span>{generate.error}</span>
            </p>
          ) : null}
        </Card>

        <div className="stack">
          {!report && !generate.pending ? (
            <Card>
              <EmptyState
                icon="report"
                title="No report yet"
                description="Generate a brief to see the executive summary, market and asset analysis, technical read, model output with SHAP drivers, risk assessment, news intelligence and historical context."
                action={
                  <Button variant="primary" icon="report" loading={generate.pending} onClick={() => generate.run()}>
                    Generate report
                  </Button>
                }
              />
            </Card>
          ) : generate.pending ? (
            <Card>
              <div className="state">
                <Icon name="loader" size={22} spin className="muted" />
                <h3>Building the report</h3>
                <p>
                  Running the strategy walk, the forecast model and the explainer over {period.toLowerCase()}. This can take a
                  minute on a cold model.
                </p>
              </div>
            </Card>
          ) : report ? (
            <>
              <Card
                title={`${report.symbol} — ${report.name}`}
                subtitle={`${report.sector} · ${report.period} · generated ${dateTime(report.generated_at)}`}
                actions={
                  <Badge tone="neutral">
                    {report.sections.length} sections
                  </Badge>
                }
              >
                <div className="row wrap gap-2">
                  {report.sections.map((section, index) => (
                    <a key={section.id} href={`#section-${section.id}`} className="badge badge-neutral">
                      {index + 1}. {section.title}
                    </a>
                  ))}
                </div>
              </Card>

              {report.sections.map((section, index) => (
                <Card key={section.id} id={`section-${section.id}`} title={`${index + 1}. ${section.title}`}>
                  <p className="prose" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {section.body}
                  </p>
                </Card>
              ))}

              <Card title="Methodology and caveats">
                <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                  The brief is composed from the walk-forward forecast model, the technical indicator set, the TreeSHAP
                  explainer, the strategy backtester and the news aggregator over {report.period.toLowerCase()}. Each section
                  states the figures it used, so any number can be traced back to the service that produced it.
                </p>
                <div className="row wrap gap-2" style={{ marginTop: "var(--sp-3)" }}>
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/research?symbol=${encodeURIComponent(report.symbol)}&period=${encodeURIComponent(report.period)}`}
                  >
                    Open research workspace
                    <Icon name="arrowRight" size={13} />
                  </Link>
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/backtesting?symbol=${encodeURIComponent(report.symbol)}&period=${encodeURIComponent(report.period)}`}
                  >
                    Verify with a backtest
                    <Icon name="arrowRight" size={13} />
                  </Link>
                </div>
              </Card>

              <Disclaimer>{report.disclaimer}</Disclaimer>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function buildPlainText(report: ResearchReport): string {
  const lines = [
    `${report.symbol} — ${report.name}`,
    `${report.sector} · ${report.period} · generated ${dateTime(report.generated_at)}`,
    "",
  ];

  for (const section of report.sections) {
    lines.push(section.title.toUpperCase(), section.body, "");
  }

  lines.push(report.disclaimer);
  return lines.join("\n");
}