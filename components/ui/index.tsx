"use client";

import * as React from "react";
import { Icon, type IconName } from "./Icon";
import { DASH } from "@/lib/format";

/* ---- Spinner ------------------------------------------------------------ */

export function Spinner({ size = 16 }: { size?: number }) {
  return <Icon name="loader" size={size} spin aria-label="Loading" />;
}

/* ---- Button ------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: IconName;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
    block && "btn-block",
    !children && "btn-icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* ---- Badge -------------------------------------------------------------- */

type BadgeTone = "neutral" | "bull" | "bear" | "warn" | "accent";

export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

/* ---- Card --------------------------------------------------------------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  style,
  id,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <section id={id} className={["card", className].filter(Boolean).join(" ")} style={style}>
      {title || actions ? (
        <header className="card-head">
          <div className="grow">
            {typeof title === "string" ? <h2>{title}</h2> : title}
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="row gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/* ---- Metric tile -------------------------------------------------------- */

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "bull" | "bear" | "muted";
}) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={["metric-value", tone && tone !== "muted" ? tone : ""].filter(Boolean).join(" ")}>
        {value}
      </div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

/* ---- Field wrapper ------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}

/* ---- Empty state -------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  icon = "empty",
  action,
}: {
  title: string;
  description: string;
  icon?: IconName;
  action?: React.ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

/* ---- Error state -------------------------------------------------------- */

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state">
      <div className="state-icon" style={{ background: "var(--bear-soft)", color: "var(--bear)" }}>
        <Icon name="alert" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry ? (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ---- Loading skeleton --------------------------------------------------- */

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      style={{ display: "block", width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="metric-grid">
      {Array.from({ length: count }, (_, i) => (
        <div className="metric" key={i}>
          <Skeleton width="55%" height={10} />
          <Skeleton width="72%" height={22} style={{ marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 200 }: { height?: number }) {
  return (
    <div className="card">
      <Skeleton width="38%" height={14} />
      <Skeleton width="100%" height={height} style={{ marginTop: 16 }} />
    </div>
  );
}

/* ---- Segmented control -------------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---- Tabs --------------------------------------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={["tab", tab.value === value ? "active" : ""].join(" ")}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="faint"> {tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---- Disclaimer --------------------------------------------------------- */

export function Disclaimer({ children }: { children: React.ReactNode }) {
  return (
    <p className="disclaimer">
      <Icon name="shield" size={13} />
      <span>{children}</span>
    </p>
  );
}

/* ---- Score bar ---------------------------------------------------------- */

export function ScoreBar({ score, label }: { score: number | null | undefined; label?: string }) {
  const value = Number.isFinite(score) ? Math.max(0, Math.min(100, score as number)) : 0;
  const colour =
    value >= 55 ? "var(--bull)" : value >= 35 ? "var(--warn)" : "var(--bear)";
  return (
    <div className="col gap-1 grow">
      {label ? (
        <div className="row-between">
          <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
            {label}
          </span>
          <span className="num" style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
            {Number.isFinite(score) ? score : "—"}
          </span>
        </div>
      ) : null}
      <span
        style={{ height: 5, borderRadius: 3, background: "var(--bg-inset)", overflow: "hidden" }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${value}%`,
            background: colour,
            borderRadius: 3,
            transition: "width var(--tp-dur-slow) var(--tp-ease)",
          }}
        />
      </span>
    </div>
  );
}

/* ---- Score ring --------------------------------------------------------- */

/** SLATE's dashboard archetype: one score as a ring, read before any table. */
export function ScoreRing({
  score,
  label,
  caption,
  size = 148,
}: {
  score: number | null | undefined;
  label?: string;
  caption?: string;
  size?: number;
}) {
  const bounded = Number.isFinite(score) ? Math.max(0, Math.min(100, score as number)) : null;
  const value = bounded ?? 0;
  const colour = value >= 55 ? "var(--bull)" : value >= 35 ? "var(--warn)" : "var(--bear)";
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  return (
    <div className="col" style={{ alignItems: "center", gap: "var(--sp-2)" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label ?? "Score"}: ${bounded ?? "unavailable"}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-inset)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray var(--tp-dur-slow) var(--tp-ease)" }}
          />
        </svg>
        <div
          className="col"
          style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", gap: 2 }}
        >
          <span
            className="num"
            style={{
              fontSize: size * 0.3,
              fontWeight: 600,
              lineHeight: 1,
              color: bounded === null ? "var(--text-tertiary)" : colour,
            }}
          >
            {bounded ?? DASH}
          </span>
          {label ? (
            <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
              {label}
            </span>
          ) : null}
        </div>
      </div>
      {caption ? (
        <span className="faint" style={{ fontSize: "var(--text-xs)", textAlign: "center", maxWidth: "24ch" }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}
