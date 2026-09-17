"""Fetch historical OHLCV candles from the Upstox REST API.

Endpoint reference
------------------
``GET /v2/historical-candle/{instrument_key}/{interval}/{to_date}[/{from_date}]``

Returns candles as arrays: ``[timestamp, open, high, low, close, volume, oi]``

Availability limits (per Upstox docs):
  - 1-minute : last 1 month
  - 30-minute: last 1 year
  - day      : last 1 year
  - week     : last 10 years
  - month    : last 10 years

This module uses only ``urllib`` (no extra dependencies) so it works without
the full ``upstox-python-sdk`` — useful when you only need market data and
don't want to install the full trading SDK.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL = "https://api.upstox.com/v2"

# Mapping from our internal interval keys to Upstox API interval strings
INTERVAL_TO_UPSTOX: dict[str, str] = {
    "1m":  "1minute",
    "5m":  "30minute",   # 5m not available; best approximation is 30m
    "15m": "30minute",   # 15m not available; best approximation is 30m
    "1H":  "30minute",   # 1H not available; best approximation is 30m
    "1D":  "day",
}


def _upstox_interval_for(interval: str) -> str:
    """Convert our interval key to the Upstox API interval string."""
    return INTERVAL_TO_UPSTOX.get(interval, "1minute")


def _date_range(
    interval: str, num_candles: int
) -> tuple[str, str]:
    """Return ``(to_date, from_date)`` as YYYY-MM-DD strings.

    The range is chosen to request roughly *num_candles* candles while
    respecting the Upstox data-availability limits.
    """
    now = datetime.now(timezone.utc)
    to_date = now.strftime("%Y-%m-%d")

    if interval == "1m":
        # 1-minute data: max ~1 month back
        from_date = (now - timedelta(days=min(num_candles // 390 + 1, 28))).strftime("%Y-%m-%d")
    elif interval in ("5m", "15m", "1H"):
        # 30-minute data: max ~1 year back; estimate ~6-8 candles per trading day
        days = min(num_candles // 7 + 10, 365)
        from_date = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    else:
        # daily/weekly/monthly: generous limits
        days = min(num_candles * 2 + 30, 3650)
        from_date = (now - timedelta(days=days)).strftime("%Y-%m-%d")

    return to_date, from_date


def fetch_historical_candles(
    access_token: str,
    instrument_key: str,
    interval: str = "1m",
    num_candles: int = 150,
) -> list[dict]:
    """Fetch historical candles from the Upstox REST API.

    Parameters
    ----------
    access_token : str
        A valid Upstox OAuth2 access token.
    instrument_key : str
        e.g. ``"NSE_INDEX|Nifty 50"`` or ``"NSE_EQ|INE002A01018"``.
    interval : str
        Our internal key: ``"1m"``, ``"5m"``, ``"15m"``, ``"1H"``, or ``"1D"``.
    num_candles : int
        Desired number of candles (the API may return fewer).

    Returns
    -------
    list[dict]
        Each dict has ``time`` (unix seconds), ``open``, ``high``, ``low``,
        ``close``, ``volume`` — the format expected by ``SymbolEngine.candles``.
    """
    upstox_interval = _upstox_interval_for(interval)
    to_date, from_date = _date_range(interval, num_candles)

    # URL-encode the pipe in instrument_key
    encoded_key = instrument_key.replace("|", "%7C")
    url = f"{BASE_URL}/historical-candle/{encoded_key}/{upstox_interval}/{to_date}/{from_date}"

    logger.info(
        "Fetching historical candles: %s %s from %s to %s",
        instrument_key, upstox_interval, from_date, to_date,
    )

    request = urllib.request.Request(
        url,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.warning(
            "Upstox historical candle HTTP %d for %s: %s",
            exc.code, instrument_key, exc.read().decode("utf-8", errors="replace")[:300],
        )
        return []
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        logger.warning("Upstox historical candle request failed for %s: %s", instrument_key, exc)
        return []

    if body.get("status") != "success":
        logger.warning("Upstox historical candle non-success for %s: %s", instrument_key, body)
        return []

    raw_candles = (body.get("data") or {}).get("candles") or []
    candles: list[dict] = []
    for row in raw_candles:
        # row format: [timestamp_str, open, high, low, close, volume, oi]
        if len(row) < 6:
            continue
        ts_str = row[0]
        try:
            # Parse ISO timestamp → unix seconds
            dt = datetime.fromisoformat(ts_str)
            candle_time = int(dt.timestamp())
        except (ValueError, TypeError):
            # If it's already a number, use it directly
            try:
                candle_time = int(float(ts_str))
            except (ValueError, TypeError):
                continue

        candles.append({
            "time": candle_time,
            "open": round(float(row[1]), 2),
            "high": round(float(row[2]), 2),
            "low": round(float(row[3]), 2),
            "close": round(float(row[4]), 2),
            "volume": int(row[5]),
        })

    # Sort by time ascending (oldest first)
    candles.sort(key=lambda c: c["time"])

    # Trim to the most recent num_candles
    if len(candles) > num_candles:
        candles = candles[-num_candles:]

    logger.info(
        "Fetched %d historical candles for %s %s (requested %d)",
        len(candles), instrument_key, upstox_interval, num_candles,
    )
    return candles


def preload_engines(
    hub: Any,  # MarketDataHub
    access_token: str,
    symbols: list[str] | None = None,
    intervals: list[str] | None = None,
    num_candles: int = 150,
) -> int:
    """Fetch historical candles and seed the hub's SymbolEngines.

    This is called once at startup (before the WebSocket stream begins) so
    that the charts display real historical data from the first paint.

    Parameters
    ----------
    hub : MarketDataHub
    access_token : str
    symbols : list[str] | None
        Subset of symbols to preload. ``None`` = all supported symbols.
    intervals : list[str] | None
        Subset of intervals. ``None`` = ``["1m", "1D"]``.
    num_candles : int

    Returns
    -------
    int
        Total number of candles loaded across all engines.
    """
    from app.services.upstox_provider import INSTRUMENT_MAP
    from app.services.market_data import SYMBOLS, normalize_interval

    if symbols is None:
        symbols = list(SYMBOLS.keys())
    if intervals is None:
        intervals = ["1m", "1D"]

    total = 0
    for symbol in symbols:
        instrument_key = INSTRUMENT_MAP.get(symbol)
        if instrument_key is None:
            logger.debug("No Upstox instrument key for %s – skipping historical preload", symbol)
            continue

        for interval in intervals:
            norm_interval = normalize_interval(interval)
            candles = fetch_historical_candles(
                access_token, instrument_key, norm_interval, num_candles
            )
            if not candles:
                continue

            # Seed the engine: replace the simulated history with real data
            engine = hub.engine_for(symbol, norm_interval)
            engine.candles = candles
            engine.price = candles[-1]["close"]

            # Open a fresh forming candle aligned to the current interval boundary
            now = datetime.now(timezone.utc).timestamp()
            boundary = int(now) - (int(now) % engine.seconds)
            engine._open_candle(boundary)

            total += len(candles)
            logger.info(
                "Seeded %s %s engine with %d real candles (last price: %.2f)",
                symbol, norm_interval, len(candles), engine.price,
            )

    return total
