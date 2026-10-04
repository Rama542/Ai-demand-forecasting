/** Display formatters. Every one returns a real, deterministic string — no "-" for zero. */

export const DASH = "—";

/** Format a number with a fixed decimal count, or the dash when it is missing. */
export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return Math.round(value).toLocaleString("en-IN");
}

/** Indian-style compact notation for axis labels and large counts. */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(abs < 10 ? 2 : 0);
}

/** Currency, with the rupee sign kept out of the tabular number for alignment. */
export function inr(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `\u20B9${num(value, digits)}`;
}

export function inrCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `\u20B9${compact(value)}`;
}

/** Whole rupees, no decimals — for headline capital figures. */
export function inr0(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `\u20B9${Math.round(value).toLocaleString("en-IN")}`;
}

/** Signed percentage. Pass `alreadyPercent` when the source value is a percent already. */
export function pct(value: number | null | undefined, digits = 2, alreadyPercent = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const scaled = alreadyPercent ? value : value * 100;
  return `${scaled >= 0 ? "+" : ""}${num(scaled, digits)}%`;
}

export function pctPlain(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${num(value, digits)}%`;
}

export function ratio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return num(value, digits);
}

/** unix seconds (or ms) → "28 Oct 2026" */
export function date(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return DASH;
  const ms = typeof value === "string" ? Date.parse(value) : normaliseEpoch(value);
  if (!Number.isFinite(ms)) return DASH;
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** unix seconds (or ms) → "28 Oct, 15:30" */
export function dateTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return DASH;
  const ms = typeof value === "string" ? Date.parse(value) : normaliseEpoch(value);
  if (!Number.isFinite(ms)) return DASH;
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function time(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return DASH;
  const ms = typeof value === "string" ? Date.parse(value) : normaliseEpoch(value);
  if (!Number.isFinite(ms)) return DASH;
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Accept seconds, milliseconds or ISO strings uniformly. */
function normaliseEpoch(value: number): number {
  return value < 1e11 ? value * 1000 : value;
}

/** "3m ago" / "2h ago" from a relative seconds delta. */
export function ago(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Direction → CSS tone class. */
export function tone(value: number | null | undefined): "bull" | "bear" | "muted" {
  if (value === null || value === undefined || !Number.isFinite(value)) return "muted";
  if (value > 0) return "bull";
  if (value < 0) return "bear";
  return "muted";
}

/** Human label for a 0-100 score. */
export function scoreLabel(score: number | null | undefined): "Strong" | "Healthy" | "Mixed" | "Weak" {
  if (score === null || score === undefined || !Number.isFinite(score)) return "Mixed";
  if (score >= 75) return "Strong";
  if (score >= 55) return "Healthy";
  if (score >= 35) return "Mixed";
  return "Weak";
}

export function scoreTone(score: number | null | undefined): "bull" | "warn" | "bear" {
  if (score === null || score === undefined || !Number.isFinite(score)) return "warn";
  if (score >= 55) return "bull";
  if (score >= 35) return "warn";
  return "bear";
}

/** Strip encoding damage and collapse whitespace in provider-supplied copy. */
export function clean(text: string): string {
  return text.replace(/\uFFFD/g, " ").replace(/\s+/g, " ").trim();
}

export const PERIODS = [
  "Last 3 months",
  "Last 6 months",
  "Last 1 year",
  "Last 2 years",
  "Last 5 years",
] as const;

export const INTERVALS: { value: string; label: string }[] = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "30m", label: "30 min" },
  { value: "1H", label: "1 hour" },
  { value: "1D", label: "1 day" },
  { value: "1W", label: "1 week" },
];

/** Indian market session in IST, used for the live/closed badge. */
export function marketSession(now = new Date()): "open" | "closed" {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const weekday = ist.getDay();
  if (weekday === 0 || weekday === 6) return "closed";
  if (minutes >= 555 && minutes < 900) return "open"; // 09:15 - 15:00
  return "closed";
}
