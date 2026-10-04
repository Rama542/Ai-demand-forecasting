"use client";

import * as React from "react";
import { Card, Button, Badge, Field, Disclaimer } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAsync, useLocalStorage } from "@/lib/hooks";
import { api, API_BASE } from "@/lib/api";
import { BRAND_PRESETS, useBrand } from "@/components/Appearance";
import { PageHeader, ComingSoon } from "@/components/shell/UserMenu";

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="row-between" style={{ padding: "var(--sp-3) 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <b style={{ fontSize: "var(--text-sm)" }}>{label}</b>
        {hint ? (
          <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      <span className="num" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

/**
 * SLATE is a single dark theme with a single accent hue, so appearance is one
 * decision — the hue — rather than a light/dark switch. It writes --tp-h on
 * <html>, which re-tints every accent surface in the product at once.
 */
function BrandHueControl() {
  const { hue, setHue, reset, isDefault } = useBrand();

  return (
    <div id="appearance" className="stack">
      <div className="row wrap gap-2">
        {BRAND_PRESETS.map((preset) => {
          const active = preset.hue === hue;
          return (
            <button
              key={preset.hue}
              type="button"
              onClick={() => setHue(preset.hue)}
              aria-pressed={active}
              className={`badge ${active ? "badge-accent" : "badge-neutral"}`}
              style={{ height: "auto", padding: "8px 10px", cursor: "pointer" }}
              title={preset.note}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "var(--radius-full)",
                  background: `oklch(0.72 0.16 ${preset.hue})`,
                  flex: "none",
                }}
              />
              {preset.label}
            </button>
          );
        })}
      </div>

      <Field
        label={`Brand hue — ${hue}°`}
        htmlFor="brand-hue"
        hint="One value tints every accent in the workspace. Gains stay green and losses stay red regardless."
      >
        <input
          id="brand-hue"
          type="range"
          min={0}
          max={360}
          step={1}
          value={hue}
          onChange={(event) => setHue(Number(event.target.value))}
          style={{ accentColor: "var(--accent)", width: "100%", height: 32 }}
        />
      </Field>

      <div className="row gap-2">
        <Button variant="secondary" size="sm" onClick={reset} disabled={isDefault}>
          Reset to SLATE default
        </Button>
        <span className="faint" style={{ fontSize: "var(--text-xs)", alignSelf: "center" }}>
          Theme: <b className="num">slate</b> · surfaces are fixed
        </span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [collapsed, setCollapsed] = useLocalStorage("sidebar-collapsed", false);
  const [streaming, setStreaming] = useLocalStorage("marketmind-streaming", false);

  const health = useAsync((signal) => api.health(signal), []);
  const data = health.data;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Appearance and connection preferences. Preferences persist in this browser only — there is no account server in this build."
      />

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Card title="Appearance">
          <BrandHueControl />
          <div className="divider" style={{ margin: "var(--sp-4) 0" }} />
          <div className="row-between">
            <div>
              <b style={{ fontSize: "var(--text-sm)" }}>Collapsed sidebar</b>
              <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                Shrinks the navigation to icons on wide screens.
              </p>
            </div>
            <Button variant={collapsed ? "primary" : "secondary"} onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? "Collapsed" : "Expanded"}
            </Button>
          </div>
        </Card>

        <Card title="Data connection">
          <div className="stack">
            <Row label="API status" value={health.loading ? "checking…" : data ? data.status : "unreachable"} />
            <Row label="Engine" value={data?.engine ?? "—"} hint="Forecast model in use" />
            <Row label="Data mode" value={data?.data_mode ?? "—"} hint="live provider or simulated feed" />
            <Row
              label="Market data"
              value={data?.live?.is_live ? "live" : "simulated"}
              hint={data?.live?.source ?? undefined}
            />
            <Row
              label="Model runtime"
              value={data?.model_ready === undefined ? "—" : data.model_ready ? "available" : "unavailable"}
              hint="Whether the forecast engine loaded on the API"
            />
            {data?.live?.error ? (
              <p
                className="disclaimer"
                style={{ color: "var(--warn)", borderColor: "var(--warn-border)", marginTop: "var(--sp-2)" }}
              >
                <Icon name="alert" size={13} />
                <span>{data.live.error}</span>
              </p>
            ) : null}
            <Button variant="secondary" icon="refresh" onClick={health.reload} loading={health.loading}>
              Re-check connection
            </Button>
          </div>
        </Card>

        <Card title="Overrides">
          <div className="stack">
            <div className="row-between">
              <div>
                <b style={{ fontSize: "var(--text-sm)" }}>Streaming updates</b>
                <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
                  Drives the header refresh indicator. The underlying provider polling is configured on the server.
                </p>
              </div>
              <Button variant={streaming ? "primary" : "secondary"} onClick={() => setStreaming(!streaming)}>
                {streaming ? "On" : "Off"}
              </Button>
            </div>

            <div className="divider" />

            <Field
              label="API base URL"
              htmlFor="api-base"
              hint="Baked in at build time from NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_URL. Change it in the environment and rebuild — it cannot be edited in the browser."
            >
              <input id="api-base" className="input" value={API_BASE} readOnly spellCheck={false} />
            </Field>
            {health.error ? (
              <p className="disclaimer" style={{ color: "var(--bear)", borderColor: "var(--bear-border)" }}>
                <Icon name="alert" size={13} />
                <span>
                  Cannot reach the API at this address. {health.error} Check that the backend is running and that it
                  allows this origin via CORS.
                </span>
              </p>
            ) : null}
          </div>
        </Card>

        <Card title="Not built yet">
          <div className="stack">
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              These are deliberately disabled rather than left as dead buttons. Each one is a real feature that has not
              been built, and pretending otherwise would be worse than saying so.
            </p>
            <div className="row wrap gap-2">
              <ComingSoon label="Data provider keys" />
              <ComingSoon label="Alert rules" />
              <ComingSoon label="Report scheduling" />
              <ComingSoon label="Export to Excel" />
            </div>
          </div>
        </Card>

        <Card title="About this build" className="stack">
          <Disclaimer>
            MarketMind AI is an educational research workspace. Every metric is computed from the data shown on screen;
            nothing is pre-baked. Simulated feeds are labelled everywhere they appear, and no figure here is investment
            advice.
          </Disclaimer>
          <div className="row wrap gap-2">
            <Badge tone="neutral">Next.js App Router</Badge>
            <Badge tone="neutral">FastAPI + XGBoost</Badge>
            <Badge tone="neutral">SLATE theme</Badge>
            <Badge tone="warn">paper trading only</Badge>
          </div>
        </Card>
      </div>
    </main>
  );
}
