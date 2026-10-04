"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui";

export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        DE
      </button>

      {open ? (
        <div className="dropdown-menu" role="menu">
          <div className="dropdown-label">Demo workspace</div>
          <div style={{ padding: "0 var(--sp-3) var(--sp-2)" }}>
            <p className="faint" style={{ fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
              You are in a local demo environment. No account is connected and nothing is billed.
            </p>
          </div>
          <div className="dropdown-sep" />
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/settings");
            }}
          >
            <Icon name="settings" />
            Settings
          </button>
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            disabled
            title="Authentication is not enabled in this build."
            style={{ opacity: 0.5, cursor: "not-allowed" }}
          >
            <Icon name="logout" />
            Sign out — coming soon
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Page header with title, subtitle, and action slot. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-title">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="row wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** A control that is intentionally unavailable, so no dead buttons ship. */
export function ComingSoon({ label = "Coming soon" }: { label?: string }) {
  return (
    <Button variant="secondary" disabled title={`${label} — this feature is not built yet.`}>
      <Icon name="clock" />
      {label}
    </Button>
  );
}