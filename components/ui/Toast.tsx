"use client";

import * as React from "react";
import { Icon } from "./Icon";
import { Badge } from "./index";
import { ago } from "@/lib/format";
import type { LiveStatus } from "@/lib/api";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (kind: ToastKind, title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = React.useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4200);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <Icon name={toast.kind === "error" ? "alert" : toast.kind === "info" ? "info" : "check"} />
            <div className="toast-body">
              <b>{toast.title}</b>
              {toast.description ? <span>{toast.description}</span> : null}
            </div>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 22, height: 22, marginLeft: "auto" }}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

/**
 * Live vs simulated vs offline, driven entirely by what the backend reports.
 * Nothing here assumes a feed is healthy.
 */
export function MarketStatusBadge({ live, compact }: { live?: LiveStatus | null; compact?: boolean }) {
  const [sessionOpen, setSessionOpen] = React.useState(false);

  React.useEffect(() => {
    const update = () => {
      const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const minutes = ist.getHours() * 60 + ist.getMinutes();
      const weekend = ist.getDay() === 0 || ist.getDay() === 6;
      setSessionOpen(!weekend && minutes >= 555 && minutes < 900);
    };
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!live) {
    return (
      <span className="market-status">
        <span className="status-dot off" />
        {compact ? "Offline" : "API offline"}
      </span>
    );
  }

  if (!live.is_live) {
    return (
      <span className="market-status" title={live.error ?? "No live provider configured"}>
        <span className="status-dot sim" />
        {compact ? "Sim" : "Simulated feed"}
      </span>
    );
  }

  return (
    <span
      className="market-status"
      title={`${live.source ?? "live"} · synced ${ago(live.age_seconds)}`}
    >
      <span className={sessionOpen ? "status-dot live" : "status-dot"} />
      {sessionOpen ? "Market open" : "Market closed"}
    </span>
  );
}

/** Small inline pill showing where a data set actually came from. */
export function SourceBadge({ source, live }: { source?: string | null; live?: LiveStatus | null }) {
  if (live && live.is_live) {
    return <Badge tone="bull">{source ?? live.source ?? "live"}</Badge>;
  }
  return <Badge tone="warn">{source ?? "simulated"}</Badge>;
}