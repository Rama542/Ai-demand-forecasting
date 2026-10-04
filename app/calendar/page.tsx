"use client";

import * as React from "react";
import { Card, Button, Badge, EmptyState, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAsync, AsyncBoundary } from "@/lib/hooks";
import { api, type CalendarEvent } from "@/lib/api";
import { date } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";

function importanceTone(value: string): "bear" | "warn" | "neutral" {
  const lower = value.toLowerCase();
  if (lower === "high") return "bear";
  if (lower === "medium" || lower === "moderate") return "warn";
  return "neutral";
}

function groupByMonth(events: CalendarEvent[]): { month: string; events: CalendarEvent[] }[] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.date.slice(0, 7);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({
      month: new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      events: items.sort((a, b) => a.date.localeCompare(b.date)),
    }));
}

export default function CalendarPage() {
  const calendar = useAsync((signal) => api.calendar(signal), []);
  const events = calendar.data?.events ?? [];
  const groups = React.useMemo(() => groupByMonth(events), [events]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Intelligence"
        title="Economic calendar"
        description="Scheduled macro releases with their consensus and prior prints, as reported by the configured calendar provider."
        actions={
          <Button variant="secondary" icon="refresh" onClick={calendar.reload} loading={calendar.loading}>
            Refresh
          </Button>
        }
      />

      <AsyncBoundary
        loading={calendar.loading}
        error={calendar.error}
        onRetry={calendar.reload}
        isEmpty={events.length === 0}
        emptyTitle="No calendar provider configured"
        emptyDescription={
          calendar.data?.notice ??
          "The backend has no economic calendar provider wired up. Nothing is generated locally — configure a provider to populate this page."
        }
        emptyIcon="calendar"
        skeleton={<SkeletonCard height={360} />}
      >
        <div className="stack">
          <div className="row wrap gap-2">
            <Badge tone="accent">{calendar.data?.count} events</Badge>
            {groups.map((group) => (
              <Badge key={group.month} tone="neutral">
                {group.month}
              </Badge>
            ))}
          </div>

          {groups.map((group) => (
            <Card key={group.month} title={group.month} subtitle={`${group.events.length} scheduled releases`}>
              <div className="stack-sm col gap-2">
                {group.events.map((event) => (
                  <div
                    key={`${event.date}-${event.title}`}
                    className="row gap-3"
                    style={{
                      padding: "var(--sp-3)",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--bg-subtle)",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ width: 90, flex: "none" }}>
                      <b className="num" style={{ fontSize: "var(--text-sm)" }}>
                        {date(event.date)}
                      </b>
                      {event.country ? (
                        <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                          {event.country}
                        </p>
                      ) : null}
                    </div>
                    <div className="grow">
                      <b style={{ fontSize: "var(--text-sm)" }}>{event.title}</b>
                      {event.forecast || event.previous ? (
                        <p className="faint num" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                          {event.forecast ? `Forecast ${event.forecast}` : ""}
                          {event.forecast && event.previous ? " · " : ""}
                          {event.previous ? `Previous ${event.previous}` : ""}
                          {event.actual ? ` · Actual ${event.actual}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={importanceTone(event.importance)}>{event.importance}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </AsyncBoundary>
    </main>
  );
}