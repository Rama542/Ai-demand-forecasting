"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button } from "@/components/ui";
import { MarketStatusBadge } from "@/components/ui/Toast";
import { useBrand } from "@/components/Appearance";
import { api, type LiveStatus } from "@/lib/api";
import { useLocalStorage } from "@/lib/hooks";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Wide screens that need the extra horizontal room. */
  wide?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid" },
      { href: "/markets", label: "Markets", icon: "chart" },
      { href: "/research", label: "Stock Research", icon: "search", wide: true },
      { href: "/scanner", label: "Stock Scanner", icon: "filter", wide: true },
    ],
  },
  {
    title: "Analysis",
    items: [
      { href: "/backtesting", label: "Backtesting", icon: "flask", wide: true },
      { href: "/market-doctor", label: "Market Doctor", icon: "stethoscope" },
      { href: "/scenario-lab", label: "Scenario Lab", icon: "layers" },
      { href: "/portfolio", label: "Portfolio", icon: "portfolio", wide: true },
      { href: "/correlations", label: "Correlations", icon: "chart" },
      { href: "/calculator", label: "Calculator", icon: "calculator" },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/reports", label: "Research Reports", icon: "report", wide: true },
      { href: "/news", label: "News Feed", icon: "news" },
      { href: "/calendar", label: "Economic Calendar", icon: "calendar" },
      { href: "/mentor", label: "AI Mentor", icon: "mentor" },
    ],
  },
  {
    title: "Account",
    items: [{ href: "/settings", label: "Settings", icon: "settings" }],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <Link href="/dashboard" className="sidebar-brand" onClick={onNavigate}>
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <span className="brand-name">
          Market<em>Mind</em> AI
        </span>
      </Link>

      <div className="workspace" role="group" aria-label="Current workspace">
        <span className="workspace-avatar" aria-hidden="true">
          DE
        </span>
        <span className="workspace-meta">
          <b>Demo workspace</b>
          <small>paper trading</small>
        </span>
      </div>

      <div className="sidebar-nav">
        {NAV.map((section) => (
          <React.Fragment key={section.title}>
            <div className="nav-section">{section.title}</div>
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`nav-item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon">
                    <Icon name={item.icon} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="sidebar-foot">
        <button type="button" className="nav-collapse" onClick={onToggleCollapse} aria-label="Toggle sidebar">
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { hue } = useBrand();
  const [collapsed, setCollapsed] = useLocalStorage("sidebar-collapsed", false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [live, setLive] = React.useState<LiveStatus | null>(null);
  const [realtime, setRealtime] = useLocalStorage("marketmind-streaming", false);

  const active = NAV.flatMap((section) => section.items).find((item) => isActive(pathname, item.href));
  const wide = active?.wide ?? false;

  /* Poll health so the status badge reflects the real backend, not a guess. */
  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    const poll = async () => {
      try {
        const health = await api.health(controller.signal);
        if (alive) setLive(health.live ?? null);
      } catch {
        if (alive) setLive(null);
      }
    };
    poll();
    const timer = setInterval(poll, 45_000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  /* Cmd/Ctrl+K opens the palette from anywhere. */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div
      className="shell"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
      data-realtime={realtime}
    >
      {/* SLATE's ambient layer: a faint 24px technical grid behind everything. */}
      <div className="tp-fx" aria-hidden="true" />

      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className={`shell-main${wide ? " wide" : ""}`}>
        <header className="header">
          <Button
            variant="ghost"
            className="menu-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Icon name="menu" />
          </Button>

          <button type="button" className="header-search" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={14} />
            <span>Search instruments or jump to a page</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="grow" />

          <MarketStatusBadge live={live} />

          <button
            type="button"
            className="icon-btn"
            onClick={() => setRealtime(!realtime)}
            aria-pressed={realtime}
            aria-label={realtime ? "Stop streaming updates" : "Start streaming updates"}
            title={realtime ? "Streaming on — click to pause" : "Streaming off — click to stream"}
            style={realtime ? { color: "var(--accent)" } : undefined}
          >
            <Icon name="refresh" className={realtime ? "icon-pulse" : undefined} />
          </button>

          <Link
            href="/settings#appearance"
            className="icon-btn"
            aria-label="Appearance settings"
            title={`Brand hue ${hue}° — change it in Settings`}
          >
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                borderRadius: "var(--radius-full)",
                background: "var(--accent)",
                display: "block",
              }}
            />
          </Link>

          <UserMenu />
        </header>

        {children}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
