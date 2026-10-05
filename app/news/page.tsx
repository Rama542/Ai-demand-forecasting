"use client";

import * as React from "react";
import Link from "next/link";
import { Card, Button, Badge, Field, EmptyState, SkeletonCard } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAsync, AsyncBoundary } from "@/lib/hooks";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/UserMenu";
import { SymbolInput } from "@/components/SymbolInput";

export default function NewsPage() {
  const [symbol, setSymbol] = React.useState("");
  const [query, setQuery] = React.useState("");

  const news = useAsync((signal) => api.news({ symbol: query || undefined }, signal), [query]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Intelligence"
        title="News feed"
        description="Headlines retrieved from the configured news provider. If no provider is configured, this page says so instead of inventing stories."
        actions={
          <Button variant="secondary" icon="refresh" onClick={news.reload} loading={news.loading}>
            Refresh
          </Button>
        }
      />

      <Card style={{ marginBottom: "var(--sp-5)" }}>
        <div className="row wrap gap-3" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 190 }}>
            <Field label="Filter by symbol" htmlFor="news-symbol">
              <SymbolInput id="news-symbol" value={symbol} onChange={setSymbol} placeholder="RELIANCE" />
            </Field>
          </div>
          <Button variant="primary" icon="search" onClick={() => setQuery(symbol.trim())}>
            Filter
          </Button>
          {query ? (
            <Button
              variant="ghost"
              icon="x"
              onClick={() => {
                setSymbol("");
                setQuery("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </Card>

      <AsyncBoundary
        loading={news.loading}
        error={news.error}
        onRetry={news.reload}
        isEmpty={news.data?.items.length === 0}
        emptyTitle="No news provider configured"
        emptyDescription={
          news.data?.notice ??
          "The backend has no news provider wired up, so there is genuinely nothing to show. Configure the provider in your environment to populate this feed — nothing is generated locally."
        }
        emptyIcon="news"
        skeleton={<SkeletonCard height={320} />}
      >
        <div className="stack">
          <div className="row wrap gap-2">
            <Badge tone="neutral">source: {news.data?.source}</Badge>
            <Badge tone="accent">{news.data?.count} items</Badge>
            {query ? <Badge tone="accent">filtered to {query}</Badge> : null}
          </div>

          <Card className="card-pad-0">
            <div className="stack-sm col" style={{ padding: "var(--sp-5)" }}>
              {news.data?.items.map((item) => (
                <article key={item.id} className="card" style={{ padding: "var(--sp-4)" }}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: "var(--sp-3)" }}>
                    <h3 style={{ fontSize: "var(--text-md)", lineHeight: 1.35 }}>{item.title}</h3>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-btn"
                        aria-label={`Open ${item.title} in a new tab`}
                        style={{ flex: "none" }}
                      >
                        <Icon name="external" />
                      </a>
                    ) : null}
                  </div>
                  <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: 6 }}>
                    {item.summary}
                  </p>
                  <div className="row wrap gap-2" style={{ marginTop: "var(--sp-3)" }}>
                    <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                      {item.source} · {dateTime(item.published_at)}
                    </span>
                    {item.sentiment && item.sentiment !== "neutral" ? (
                      <Badge tone={item.sentiment === "positive" ? "bull" : "bear"}>{item.sentiment}</Badge>
                    ) : null}
                    {item.symbols.map((value) => (
                      <Link key={value} href={`/research?symbol=${encodeURIComponent(value)}`}>
                        <Badge tone="accent">{value}</Badge>
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </div>
      </AsyncBoundary>
    </main>
  );
}