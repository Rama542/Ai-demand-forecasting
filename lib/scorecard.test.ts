import assert from "node:assert/strict";
import { scoreForecast, type SavedForecast } from "./scorecard";
import type { ScorecardActual } from "./api";

const forecast: SavedForecast = {
  id: "RELIANCE:1000", symbol: "RELIANCE", name: "Reliance", savedAt: "2026-11-26T00:00:00Z",
  anchorTime: 1000, baseClose: 100, direction: "UP", probability: 62,
  model: "xgboost walk-forward", source: "NSE bhavcopy",
};
const anchor = { time: 1000, open: 99, high: 101, low: 98, close: 100, volume: 1000 };
const actual: ScorecardActual = { symbol: "RELIANCE", source: "NSE bhavcopy", latest_bar: anchor, anchor_bar: anchor, next_bar: null };

assert.deepEqual(scoreForecast(forecast, actual), { status: "pending" });
assert.equal(scoreForecast(forecast, { ...actual, anchor_bar: { ...anchor, close: 50 } }).status, "revised");

const down = scoreForecast(forecast, { ...actual, next_bar: { ...anchor, time: 2000, close: 98 } });
assert.equal(down.status, "resolved");
assert.equal(down.outcome?.correct, false);
assert.equal(down.outcome?.baselineCorrect, false);
assert.equal(down.outcome?.returnPct, -2);

const up = scoreForecast(forecast, { ...actual, next_bar: { ...anchor, time: 2000, close: 104 } });
assert.equal(up.outcome?.correct, true);
assert.equal(up.outcome?.baselineCorrect, true);

const downCall = scoreForecast({ ...forecast, direction: "DOWN" }, { ...actual, next_bar: { ...anchor, time: 2000, close: 98 } });
assert.equal(downCall.outcome?.correct, true);
assert.equal(downCall.outcome?.baselineCorrect, false);

console.log("Scorecard outcome tests passed");
