"""Deterministic daily history for research backtests.

The live chart only keeps a short rolling window. A two-year or five-year
test needs its own series. The path is seeded by symbol, ends on that
symbol's demo base price, and walks through bull, quiet, bear and recovery
regimes so trend, momentum, mean-reversion and breakout rules all get trades.
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone

from app.services.universe import lookup

PERIOD_BARS = {
    "Last 6 months": 126,
    "Last 1 year": 252,
    "Last 2 years": 504,
    "Last 5 years": 1260,
}

# (share of the window, daily drift, daily volatility)
_REGIMES = (
    (0.22, 0.00055, 0.012),
    (0.18, 0.00005, 0.009),
    (0.18, -0.00045, 0.016),
    (0.20, 0.00028, 0.013),
    (0.22, 0.00040, 0.011),
)


def bars_for_period(period: str | None) -> int:
    return PERIOD_BARS.get(period or "", 504)


def _seed(symbol: str) -> int:
    digest = hashlib.sha256(symbol.encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def _trading_days(n: int) -> list[int]:
    day = 86400
    cursor = (int(datetime.now(timezone.utc).timestamp()) // day) * day
    out: list[int] = []
    while len(out) < n:
        cursor -= day
        if datetime.fromtimestamp(cursor, timezone.utc).weekday() < 5:
            out.append(cursor)
    out.reverse()
    return out


def _drift_vol(index: int, total: int, kind: str) -> tuple[float, float]:
    pos = index / max(total, 1)
    cursor = 0.0
    drift, vol = _REGIMES[-1][1], _REGIMES[-1][2]
    for share, regime_drift, regime_vol in _REGIMES:
        cursor += share
        if pos <= cursor:
            drift, vol = regime_drift, regime_vol
            break
    if kind == "index":
        vol *= 0.72
    elif kind == "small":
        vol *= 1.35
    elif kind == "mid":
        vol *= 1.15
    return drift, vol


def daily_history(symbol: str, period: str | None = None, bars: int | None = None) -> list[dict]:
    """Build `bars` weekday candles ending at the symbol's demo base price."""
    meta = lookup(symbol)
    count = bars if bars is not None else bars_for_period(period)
    count = max(80, min(1500, int(count)))
    rng = random.Random(_seed(meta["symbol"]))
    returns: list[float] = []
    for i in range(count):
        drift, vol = _drift_vol(i, count, meta["kind"])
        shock = rng.gauss(drift, vol)
        if rng.random() < 0.015:
            shock += rng.choice((-1, 1)) * rng.uniform(0.02, 0.045)
        returns.append(shock)

    # Walk backwards from today's base so the last close matches the quote.
    closes = [float(meta["base"])]
    for change in reversed(returns):
        prev = closes[-1] / (1.0 + change)
        closes.append(max(prev, 0.5))
    closes.reverse()
    closes = closes[:count]

    times = _trading_days(count)
    volume_low, volume_high = (5_000_000, 25_000_000) if meta["kind"] == "index" else (200_000, 4_000_000)
    if meta["base"] < 200 and meta["kind"] != "index":
        volume_low, volume_high = 2_000_000, 20_000_000

    candles: list[dict] = []
    for i, close in enumerate(closes):
        change = returns[i] if i < len(returns) else 0.0
        _, vol = _drift_vol(i, count, meta["kind"])
        open_price = close / (1.0 + change) if i else close * (1 - change)
        wick = abs(rng.gauss(0, vol)) * close
        high = max(open_price, close) + abs(wick) * rng.uniform(0.15, 1.0)
        low = min(open_price, close) - abs(wick) * rng.uniform(0.15, 1.0)
        low = max(low, 0.5)
        burst = 1.8 if abs(change) > vol * 1.6 else 1.0
        volume = int(rng.randint(volume_low, volume_high) * burst)
        candles.append({
            "time": times[i],
            "open": round(open_price, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "close": round(close, 2),
            "volume": volume,
        })
    return candles
