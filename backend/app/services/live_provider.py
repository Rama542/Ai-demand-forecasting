"""Live NSE/BSE market data from public quote endpoints.

This provider gives the app **real** Indian market prices with no API key and
no broker account. It polls a public chart endpoint for the instruments the UI
actually shows (benchmark indices first, then large-cap equities), then feeds
the numbers into the existing :class:`~app.services.market_data.MarketDataHub`
so every consumer - candles, WebSocket stream, quotes API, mentor - reads the
same live values.

Why this exists
---------------
The hub already supports a zero-config *simulated* feed and an optional Upstox
stream. The simulated feed anchors on static base prices, so the dashboard could
drift away from the real index level. This provider is the credential-free
middle ground: real prices, degraded gracefully to simulation if the network or
the upstream endpoint is unavailable.

Environment
-----------
``MARKET_DATA_MODE``
    ``live``     - use this public provider (default when no Upstox token).
    ``upstox``   - use the authenticated Upstox WebSocket stream.
    ``simulated``- never touch the network; keep the deterministic demo feed.

``LIVE_MARKET_POLL_SECONDS``
    Seconds between refreshes. Defaults to 20, which stays well inside the
    upstream rate limits while feeling live.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.services.market_data import SYMBOLS, MarketDataHub

logger = logging.getLogger(__name__)

CHART_HOSTS = (
    "https://query1.finance.yahoo.com/v8/finance/chart/",
    "https://query2.finance.yahoo.com/v8/finance/chart/",
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# --------------------------------------------------------------------------
# Instrument mapping: MarketMind symbol -> upstream ticker
# --------------------------------------------------------------------------
# Benchmark indices come first: they are polled on every refresh because the
# dashboard ticker and mentor grounding depend on them being accurate.
INDEX_TICKERS: dict[str, str] = {
    "NIFTY 50": "^NSEI",
    "NIFTY NEXT 50": "^CNXIT",
    "NIFTY 100": "^CNX100",
    "BANKNIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
    "INDIA VIX": "^INDIAVIX",
    "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY HEALTHCARE": "^CNXHEALTHCARE",
    "NIFTY MIDCAP 100": "^CNXMIDCAP",
    "NIFTY MIDCAP 150": "^CNXMID150",
    "NIFTY SMALLCAP 100": "^CNXSC",
    "NIFTY SMALLCAP 250": "^CNXSC250",
}

# Equities use the ``.NS`` (NSE) suffix. Only the names the UI surfaces are
# listed so the refresh stays inside upstream rate limits; anything missing
# keeps its simulated series.
EQUITY_TICKERS: dict[str, str] = {
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "INFY": "INFY.NS",
    "TATAMOTORS": "TATAMTRDVR.NS",
    "SBIN": "SBIN.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "ITC": "ITC.NS",
    "LT": "LT.NS",
    "AXISBANK": "AXISBANK.NS",
    "HCLTECH": "HCLTECH.NS",
    "TITAN": "TITAN.NS",
    "MARUTI": "MARUTI.NS",
    "SUNPHARMA": "SUNPHARMA.NS",
    "WIPRO": "WIPRO.NS",
    "BAJFINANCE": "BAJFINANCE.NS",
    "KOTAKBANK": "KOTAKBANK.NS",
    "HINDUNILVR": "HINDUNILVR.NS",
    "NTPC": "NTPC.NS",
    "POWERGRID": "POWERGRID.NS",
    "NESTLEIND": "NESTLEIND.NS",
    "ULTRACEMCO": "ULTRACEMCO.NS",
    "ASIANPAINT": "ASIANPAINT.NS",
    "ADANIENT": "ADANIENT.NS",
    "ADANIPORTS": "ADANIPORTS.NS",
    "BAJAJ-AUTO": "BAJAJ-AUTO.NS",
    "BAJAJFINSV": "BAJAJFINSV.NS",
    "M&M": "M&M.NS",
    "CIPLA": "CIPLA.NS",
    "DRREDDY": "DRREDDY.NS",
    "WONDER": "WONDER.NS",
}

TICKERS: dict[str, str] = {**INDEX_TICKERS, **EQUITY_TICKERS}

# Refreshed on every poll, in priority order.
CRITICAL: tuple[str, ...] = ("NIFTY 50", "SENSEX", "BANKNIFTY", "INDIA VIX")
ROTATING: tuple[str, ...] = tuple(s for s in TICKERS if s not in CRITICAL)

# Upstream range that yields enough history for each interval.
INTERVAL_RANGE: dict[str, str] = {
    "1m": "1d",
    "5m": "5d",
    "15m": "5d",
    "1H": "1mo",
    "1D": "6mo",
}

INTERVAL_SECONDS: dict[str, int] = {"1m": 60, "5m": 300, "15m": 900, "1H": 3600, "1D": 86400}

# Upstream interval spelling. The public endpoint rejects our internal `1H`
# and `1D` labels with HTTP 400, so translate them here.
UPSTREAM_INTERVALS: dict[str, str] = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1H": "60m",
    "1D": "1d",
}


def tickers_for(symbols: list[str]) -> dict[str, str]:
    """Keep only the requested symbols that this provider can actually resolve."""
    return {s: TICKERS[s] for s in symbols if s in TICKERS}


def selected_mode() -> str:
    """Resolve the configured data mode.

    ``live`` is the default so a fresh clone shows real prices without any
    credential setup. An explicit ``simulated`` or ``upstox`` value always
    wins, which keeps the deterministic demo and the authenticated stream
    reachable for demos and tests.
    """
    return os.getenv("MARKET_DATA_MODE", "live").strip().lower()


def live_mode_enabled() -> bool:
    return selected_mode() == "live"


def poll_seconds_from_env() -> float:
    try:
        return max(5.0, float(os.getenv("LIVE_MARKET_POLL_SECONDS", "20")))
    except ValueError:
        return 20.0


def _fetch_json(url: str, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _chart(symbol: str, interval: str, rng: str, timeout: float = 12.0) -> dict:
    """Fetch one instrument's chart payload, rotating hosts on failure.

    ``interval`` is our internal label (``1H``, ``1D``); the upstream endpoint
    only accepts its own spellings, so translate before building the query or it
    rejects the request with HTTP 400.
    """
    ticker = TICKERS[symbol]
    upstream_interval = UPSTREAM_INTERVALS.get(interval, interval)
    path = f"{urllib.parse.quote(ticker)}?interval={upstream_interval}&range={rng}"
    last_error: Exception | None = None
    for host in CHART_HOSTS:
        try:
            payload = _fetch_json(host + path, timeout)
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            continue
        results = (payload.get("chart") or {}).get("result") or []
        if results:
            return results[0]
        last_error = ValueError(f"no chart result for {ticker}")
    raise last_error or ValueError(f"unable to fetch {ticker}")


def parse_candles(symbol: str, interval: str, node: dict) -> list[dict]:
    """Convert a chart payload into our OHLCV candle contract.

    Drops bars with a null close (upstream emits placeholders for halted or
    pre-open intervals) and drops duplicates that share a timestamp.
    """
    stamps = node.get("timestamp") or []
    quote = ((node.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    decimals = int(SYMBOLS.get(symbol, {}).get("decimals", 2))
    candles: list[dict] = []
    seen: set[int] = set()
    for index, stamp in enumerate(stamps):
        close = closes[index] if index < len(closes) else None
        if close is None or stamp in seen:
            continue
        seen.add(stamp)
        open_ = opens[index] if index < len(opens) else close
        high = highs[index] if index < len(highs) else close
        low = lows[index] if index < len(lows) else close
        volume = volumes[index] if index < len(volumes) else None
        candles.append({
            "time": int(stamp),
            "open": round(float(open_ if open_ is not None else close), decimals),
            "high": round(float(high if high is not None else close), decimals),
            "low": round(float(low if low is not None else close), decimals),
            "close": round(float(close), decimals),
            "volume": int(volume) if volume else 0,
        })
    candles.sort(key=lambda c: c["time"])
    return candles


def parse_quote(symbol: str, node: dict) -> dict | None:
    """Extract price, previous close and the day's move from a chart payload."""
    meta = node.get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        return None
    previous = meta.get("previousClose")
    if previous is None:
        # `chartPreviousClose` is the close from *before the requested range*,
        # so on a long range it can be months stale and produce nonsense day
        # changes. The last two daily bars are the reliable source: the final
        # bar is the in-progress session, the one before it is the prior close.
        closes = parse_candles(symbol, "1d", node)
        if len(closes) >= 2:
            previous = closes[-2]["close"]
        elif closes:
            previous = closes[-1]["close"]
        else:
            previous = price
    change = float(price) - float(previous)
    spec = SYMBOLS.get(symbol, {})
    decimals = int(spec.get("decimals", 2))
    return {
        "symbol": symbol,
        "price": round(float(price), decimals),
        "prev_close": round(float(previous), decimals),
        "change": round(change, decimals),
        "change_pct": round(change / float(previous) * 100, 2) if previous else 0.0,
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "market_time": meta.get("regularMarketTime"),
        "as_of": meta.get("longName") or spec.get("name", symbol),
    }


class LiveQuoteProvider:
    """Polls real quotes and pushes them into a :class:`MarketDataHub`.

    The provider is intentionally conservative: one request per instrument per
    refresh cycle, hosts rotated on error, and every failure degrades to the
    hub's simulated feed rather than surfacing an error to the UI.
    """

    def __init__(self, hub: MarketDataHub, poll_seconds: float | None = None) -> None:
        self._hub = hub
        self._poll = poll_seconds or poll_seconds_from_env()
        self._task: asyncio.Task | None = None
        self._running = False
        self.last_error: str | None = None
        self.healthy: bool = False
        self.last_sync: float | None = None
        self._pending: set[tuple[str, str]] = set()
        # Latest real quote per symbol. ``prev_close`` from the simulated seed
        # would make day-change percentages meaningless, so callers read the
        # authoritative previous close from here.
        self.quotes: dict[str, dict] = {}

    def quote(self, symbol: str) -> dict | None:
        """Most recent real quote for ``symbol``, if one has been fetched."""
        return self.quotes.get(symbol)

    def covers(self, symbol: str) -> bool:
        """Whether this provider supplies real prices for ``symbol``."""
        return symbol in TICKERS

    def seed_async(self, symbol: str, interval: str) -> None:
        """Seed one engine with real candles in the background.

        Called from the synchronous ``engine_for`` path, so it must never block.
        Each ``(symbol, interval)`` pair is claimed once via ``_pending`` so
        repeated requests do not queue duplicate upstream calls.
        """
        key = (symbol, interval)
        if key in self._pending or interval not in INTERVAL_RANGE:
            return
        self._pending.add(key)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No event loop (sync context, e.g. a script): skip rather than
            # leaving the engine on simulated data silently.
            self._pending.discard(key)
            return
        loop.create_task(self._seed_task(symbol, interval, key))

    async def _seed_task(self, symbol: str, interval: str, key: tuple[str, str]) -> None:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._seed_symbol, symbol, interval)
        except Exception:
            logger.debug("Background live seed failed for %s %s", symbol, interval, exc_info=True)
        finally:
            self._pending.discard(key)

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def preload(self, symbols: list[str] | None = None, intervals: list[str] | None = None) -> int:
        """Seed engines with real candles so charts are correct on first paint.

        Defaults to the benchmark indices only. Seeding the whole equity list
        would serialise dozens of upstream calls and delay the live poll, which
        is what the dashboard actually renders; other symbols load on demand
        when their own engine is first requested.
        """
        targets = symbols or list(CRITICAL)
        loops = intervals or ["1D"]
        loop = asyncio.get_event_loop()
        jobs = [
            loop.run_in_executor(None, self._seed_symbol, symbol, interval)
            for symbol in targets
            if symbol in TICKERS
            for interval in loops
        ]
        results = await asyncio.gather(*jobs, return_exceptions=True)
        return sum(r for r in results if isinstance(r, int))

    # -- per-instrument work ------------------------------------------------

    def _seed_symbol(self, symbol: str, interval: str) -> int:
        """Replace one engine's simulated history with real candles.

        The upstream payload's final bar is the *in-progress* session, so it is
        removed and its close becomes the engine price. A single fresh candle is
        then opened at the interval boundary. Keeping both would append a second
        bar at the same instant and leave the series out of order.
        """
        rng = INTERVAL_RANGE.get(interval, "1mo")
        try:
            node = _chart(symbol, interval, rng)
        except Exception as exc:
            logger.debug("Live seed failed for %s %s: %s", symbol, interval, exc)
            return 0
        candles = parse_candles(symbol, interval, node)
        if len(candles) < 20:
            return 0

        engine = self._hub.engine_for(symbol, interval)
        price = candles[-1]["close"]
        now = int(time.time())
        boundary = now - (now % engine.seconds)
        # Drop any bar that already covers the boundary we are about to open.
        if candles[-1]["time"] >= boundary:
            price = candles[-1]["close"]
            candles = candles[:-1]
        engine.candles = candles
        engine.price = price
        engine._open_candle(boundary)
        logger.info(
            "Seeded %s %s with %d live candles (last %.2f)",
            symbol, interval, len(candles), engine.price,
        )
        return len(candles)

    def _refresh_quote(self, symbol: str) -> dict | None:
        try:
            node = _chart(symbol, "1d", "6mo")
        except Exception as exc:
            self.last_error = f"{symbol}: {exc}"
            logger.debug("Live quote failed for %s: %s", symbol, exc)
            return None
        quote = parse_quote(symbol, node)
        if quote is not None:
            self.last_error = None
            self.quotes[symbol] = quote
        return quote

    def _apply_quote(self, quote: dict) -> None:
        """Write a real price into every live engine for that symbol."""
        symbol = quote["symbol"]
        price = quote["price"]
        for (eng_symbol, _interval), engine in list(self._hub.engines.items()):
            if eng_symbol != symbol:
                continue
            engine.price = price
            if engine.current is None:
                continue
            engine.current["close"] = price
            engine.current["high"] = max(engine.current["high"], price)
            engine.current["low"] = min(engine.current["low"], price)
            update = {
                "type": "candle_update",
                "symbol": symbol,
                "interval": _interval,
                "candle": engine.current,
            }
            for queue in list(self._hub.subscribers.get((symbol, _interval), set())):
                try:
                    queue.put_nowait(update)
                except asyncio.QueueFull:
                    pass

    # -- main loop ----------------------------------------------------------

    async def _run(self) -> None:
        logger.info("Live market provider started (%.0fs refresh)", self._poll)
        cycle = 0
        while self._running:
            # Benchmark indices every cycle; equities in rotating batches so we
            # never burst-request the whole universe at once.
            batch = list(CRITICAL) + ([ROTATING[cycle % len(ROTATING)]] if ROTATING else [])
            loop = asyncio.get_event_loop()
            results = await asyncio.gather(
                *(loop.run_in_executor(None, self._refresh_quote, s) for s in batch),
                return_exceptions=True,
            )
            applied = 0
            for item in results:
                if isinstance(item, dict):
                    self._apply_quote(item)
                    applied += 1
            self.healthy = applied > 0
            if applied:
                self.last_sync = time.time()
                self._hub.last_live_sync = self.last_sync
                logger.debug("Live refresh applied %d/%d quotes", applied, len(batch))
            cycle += 1
            try:
                await asyncio.sleep(self._poll)
            except asyncio.CancelledError:
                break
        logger.info("Live market provider stopped")