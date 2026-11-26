import type { ScorecardActual } from "./api";

export type SavedForecast = {
  id: string;
  symbol: string;
  name: string;
  savedAt: string;
  anchorTime: number;
  baseClose: number;
  direction: "UP" | "DOWN";
  probability: number;
  model: string;
  source: string;
  outcome?: {
    time: number;
    close: number;
    returnPct: number;
    correct: boolean;
    baselineCorrect: boolean;
  };
};

const MAX_RECORDS = 200;
const key = (userId: string) => `marketmind-scorecard-v1:${userId}`;

export function readScorecard(userId: string): SavedForecast[] {
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem(key(userId)) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is SavedForecast =>
      item && typeof item.id === "string" && typeof item.symbol === "string" &&
      typeof item.anchorTime === "number" && Number.isFinite(item.anchorTime) &&
      typeof item.baseClose === "number" && Number.isFinite(item.baseClose) && item.baseClose > 0 &&
      (item.direction === "UP" || item.direction === "DOWN") &&
      typeof item.savedAt === "string" && typeof item.probability === "number"
    ).slice(0, MAX_RECORDS);
  } catch { return []; }
}

export function writeScorecard(userId: string, records: SavedForecast[]) {
  window.localStorage.setItem(key(userId), JSON.stringify(records));
}

export function addForecast(userId: string, forecast: SavedForecast): boolean {
  const records = readScorecard(userId);
  if (records.some(item => item.id === forecast.id)) return false;
  if (records.length >= MAX_RECORDS) throw new Error("This browser has reached its 200-call limit. Remove old calls before saving more.");
  writeScorecard(userId, [forecast, ...records]);
  return true;
}

export function scoreForecast(forecast: SavedForecast, actual: ScorecardActual): { status: "pending" | "revised" | "resolved"; outcome?: SavedForecast["outcome"] } {
  if (!actual.anchor_bar || !Number.isFinite(actual.anchor_bar.close) ||
      Math.abs(actual.anchor_bar.close - forecast.baseClose) / forecast.baseClose > 0.005) {
    return { status: "revised" };
  }
  const bar = actual.next_bar;
  if (!bar || !Number.isFinite(bar.close) || bar.close <= 0) return { status: "pending" };
  const up = bar.close > forecast.baseClose;
  return { status: "resolved", outcome: {
    time: bar.time,
    close: bar.close,
    returnPct: Math.round((bar.close / forecast.baseClose - 1) * 10000) / 100,
    correct: forecast.direction === (up ? "UP" : "DOWN"),
    baselineCorrect: up,
  } };
}
