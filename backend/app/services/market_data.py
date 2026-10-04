"""Provider-agnostic live market data engine.

The engine synthesizes a deterministic, realistic OHLCV candlestick stream so
the live charting demo works with zero configuration. Every ``(symbol,
interval)`` pair maintains a rolling history plus one forming candle that is
mutated tick-by-tick and broadcast to subscribed WebSocket clients.

A real-time feed (for example the Upstox V3 market-data WebSocket using a
read-only analytics token) can replace the simulated provider behind this same
interface without changing the charting contract: each broadcast is
``{"type": "candle_update", "symbol", "interval", "candle"}`` where ``candle``
is ``{time, open, high, low, close, volume}`` with ``time`` as the candle-open
Unix timestamp in seconds.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import random
import time
from collections import defaultdict
from dataclasses import dataclass

from app.services.universe import market_specs, normalize_symbol

logger = logging.getLogger(__name__)

INTERVALS: dict[str, int] = {"1m": 60, "5m": 300, "15m": 900, "1H": 3600, "1D": 86400}
SUPPORTED_INTERVALS: tuple[str, ...] = tuple(INTERVALS)

# Keep a short rolling window for charts, but seed enough completed bars for
# meaningful research.  The old 150-bar seed meant that a "5 years" backtest
# silently tested only a few days/weeks of data and a number of strategies had
# no chance to warm up.
HISTORY_LIMIT = 150
RESEARCH_HISTORY_LIMIT = 1_300
MAX_RETAINED = 1_500
TICK_SECONDS = 1.0

# Full research universe (indices, Nifty 50, Nifty 100, midcap, smallcap, pharma).
SYMBOLS: dict[str, dict] = market_specs()
SUPPORTED_SYMBOLS: tuple[str, ...] = tuple(SYMBOLS)


def normalize_interval(interval: str) -> str:
    return interval if interval in INTERVALS else "1m"


@dataclass
class SymbolEngine:
    symbol: str
    interval: str

    def __post_init__(self) -> None:
        self.seconds: int = INTERVALS[self.interval]
        spec = SYMBOLS[self.symbol]
        self.base: float = spec["base"]
        self.volatility: float = spec["vol"]
        self.decimals: int = spec["decimals"]
        self.volume_range: tuple[int, int] = spec["volume"]
        self.price: float = self.base
        self.candles: list[dict] = []
        self.current: dict | None = None
        self._seed()

    def _seed(self) -> None:
        interval_now = int(time.time()) - (int(time.time()) % self.seconds)
        start = interval_now - RESEARCH_HISTORY_LIMIT * self.seconds
        # ``volatility`` is calibrated for the intraday simulator.  Cap the
        # square-root scaling for daily research bars so a five-year demo path
        # remains plausible instead of applying an 8%+ daily move to stocks.
        candle_vol = self.volatility * min(math.sqrt(self.seconds), 80.0)
        # A per-market seed makes the demo data repeatable between restarts.
        # Real providers replace this series when configured.
        rng = random.Random(f"marketmind:{self.symbol}:{self.interval}")
        price = self.base * (1 + rng.gauss(-0.002, 0.03))
        ts = start
        # The retained window ends on the *previous* completed bar; the extra
        # step below stands in for the session that ``_open_candle`` opens.
        for _ in range(RESEARCH_HISTORY_LIMIT + 1):
            o = price
            c = price * (1 + rng.gauss(0.00001, candle_vol))
            h = max(o, c) * (1 + rng.random() * candle_vol * 0.5)
            l = min(o, c) * (1 - rng.random() * candle_vol * 0.5)
            volume = rng.randint(*self.volume_range)
            self.candles.append(
                {"time": ts, "open": round(o, self.decimals), "high": round(h, self.decimals),
                 "low": round(l, self.decimals), "close": round(c, self.decimals), "volume": volume}
            )
            price = c
            ts += self.seconds
        # Rescale the generated path so the newest step lands exactly on
        # ``self.base`` - the configured market rate the UI quotes. A long
        # window of unconstrained random steps otherwise drifts several percent
        # away from the base (NIFTY 50 rendered at ~24,300 instead of 22,559).
        # Scaling keeps the generated shape intact, and mirrors the backwards
        # walk already used by ``services.history``.
        scale = self.base / price
        for candle in self.candles:
            for field in ("open", "high", "low", "close"):
                candle[field] = round(candle[field] * scale, self.decimals)
        # Drop the step that now represents the live session, so the newest
        # retained bar stays the previous close. Anchoring on it instead would
        # make every quote report a 0.00% change.
        self.candles.pop()
        self.price = self.base
        self._open_candle(interval_now)

    def _open_candle(self, boundary: int) -> None:
        price = round(self.price, self.decimals)
        self.current = {"time": boundary, "open": price, "high": price, "low": price,
                        "close": price, "volume": 0}

    def advance(self, now: float) -> dict:
        self.price = self.price * (1 + random.gauss(0, self.volatility))
        price = round(self.price, self.decimals)
        boundary = int(now) - (int(now) % self.seconds)
        if self.current is None or boundary != self.current["time"]:
            if self.current is not None:
                self.candles.append(self.current)
                if len(self.candles) > MAX_RETAINED:
                    del self.candles[: len(self.candles) - MAX_RETAINED]
            self._open_candle(boundary)
        candle = self.current
        candle["high"] = max(candle["high"], price)
        candle["low"] = min(candle["low"], price)
        candle["close"] = price
        candle["volume"] += random.randint(self.volume_range[0] // 1000, self.volume_range[1] // 500)
        return {"type": "candle_update", "symbol": self.symbol, "interval": self.interval,
                "candle": candle}

    def history(self, limit: int = HISTORY_LIMIT) -> list[dict]:
        return self.candles[-limit:]

    def quote(self) -> dict:
        candles = self.candles + ([self.current] if self.current else [])
        return {"symbol": self.symbol, "interval": self.interval, "price": self.price,
                "last_close": candles[-2]["close"] if len(candles) > 1 else self.price}


class MarketDataHub:
    def __init__(self, tick_seconds: float = TICK_SECONDS) -> None:
        self.engines: dict[tuple[str, str], SymbolEngine] = {}
        self.subscribers: dict[tuple[str, str], set[asyncio.Queue]] = defaultdict(set)
        self.tick_seconds = tick_seconds
        self.task: asyncio.Task | None = None
        self._preload_task: asyncio.Task | None = None
        self.live_provider = None
        # "live"     -> credential-free public quotes (real prices, default)
        # "upstox"   -> authenticated Upstox WebSocket stream
        # "simulated"-> never touch the network; deterministic demo feed
        self.mode: str = os.getenv("MARKET_DATA_MODE", "live").strip().lower()
        self.live_mode: bool = self.mode in ("live", "upstox")
        # Simulated ticks keep running in live mode as a fallback for symbols
        # the public provider cannot resolve.
        self.simulated_loop: bool = True
        self.last_live_sync: float | None = None

    def engine_for(self, symbol: str, interval: str) -> SymbolEngine:
        key = (symbol, interval)
        if key not in self.engines:
            self.engines[key] = SymbolEngine(symbol, interval)
            self._maybe_seed_live(symbol, interval, key)
        return self.engines[key]

    def _maybe_seed_live(self, symbol: str, interval: str, key: tuple[str, str]) -> None:
        """Swap a fresh simulated engine for real candles without blocking callers.

        Only the charted intervals are seeded; the 1D engine is preloaded at
        startup for every benchmark index, so this covers the intraday charts
        the moment a user opens one.
        """
        provider = self.live_provider
        if provider is None or self.mode != "live" or not provider.covers(symbol):
            return
        seeder = getattr(provider, "seed_async", None)
        if callable(seeder):
            seeder(symbol, interval)

    def subscribe(self, symbol: str, interval: str) -> tuple[asyncio.Queue, SymbolEngine]:
        engine = self.engine_for(symbol, interval)
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.subscribers[(symbol, interval)].add(queue)
        return queue, engine

    def unsubscribe(self, symbol: str, interval: str, queue: asyncio.Queue) -> None:
        self.subscribers[(symbol, interval)].discard(queue)

    def start(self) -> None:
        # Start the simulated tick loop first so charts have data immediately,
        # then overlay real prices from whichever live provider is configured.
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())
        if self.mode == "upstox" and self.live_provider is None:
            self._start_upstox_provider()
        elif self.mode == "live" and self.live_provider is None:
            self._start_live_provider()

    def _start_live_provider(self) -> None:
        """Start the credential-free public quote provider."""
        try:
            from app.services.live_provider import LiveQuoteProvider, live_mode_enabled
        except ImportError:
            logger.warning("live_provider unavailable – staying on simulated feed")
            return
        if not live_mode_enabled():
            return
        self.live_provider = LiveQuoteProvider(self)
        if self._preload_task is None or self._preload_task.done():
            self._preload_task = asyncio.create_task(self._live_preload_and_start())

    async def _live_preload_and_start(self) -> None:
        """Seed real candles, then begin polling real quotes."""
        try:
            total = await self.live_provider.preload()
            if total > 0:
                logger.info("Live preload complete: %d real candles loaded", total)
            else:
                logger.warning("Live preload returned no candles – using simulated history")
        except Exception:
            logger.warning("Live preload failed – continuing with simulated data", exc_info=True)
        self.live_provider.start()
        self.simulated_loop = True
        logger.info("Live market provider started – real prices active")

    async def _preload_and_start(self) -> None:
        """Preload historical data then start the live WebSocket streamer."""
        try:
            total = await self.live_provider.preload_historical()
            if total > 0:
                logger.info(
                    "Historical preload complete: %d candles loaded across all engines", total
                )
            else:
                logger.info("No historical candles returned – starting with simulated seed data")
        except Exception:
            logger.warning("Historical preload failed – continuing with simulated data", exc_info=True)

        # Now start the live WebSocket streamer
        self.live_provider.start()
        logger.info("Upstox live provider started – real-time market data active")

    async def stop(self) -> None:
        if self._preload_task is not None:
            self._preload_task.cancel()
            try:
                await self._preload_task
            except asyncio.CancelledError:
                pass
            self._preload_task = None
        if self.live_provider is not None:
            await self.live_provider.stop()
            self.live_provider = None
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    def _start_upstox_provider(self) -> None:
        """Lazily import and start the Upstox live-data provider.

        First preloads historical candles via the REST API (so charts show
        real data immediately), then starts the live WebSocket streamer.
        """
        from app.services.upstox_provider import UpstoxProvider, _upstox_available

        access_token = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
        if not access_token:
            logger.warning(
                "MARKET_DATA_MODE=upstox but UPSTOX_ACCESS_TOKEN is not set – "
                "falling back to simulated feed"
            )
            self.live_mode = False
            return

        if not _upstox_available():
            logger.warning(
                "upstox-python-sdk is not installed – run 'pip install upstox-python-sdk' "
                "then restart the server"
            )
            self.live_mode = False
            return

        self.live_provider = UpstoxProvider(self, access_token)

        # Schedule the historical preload as a background task so it runs
        # concurrently with the simulated tick loop.  The preload fetches
        # real candles via REST and replaces the simulated seed data in each
        # engine *before* the WebSocket streamer begins pushing live updates.
        if self._preload_task is None or self._preload_task.done():
            self._preload_task = asyncio.create_task(self._preload_and_start())

    def _covered_by_live_feed(self, symbol: str) -> bool:
        """True when a live provider owns this symbol's price."""
        if not self.live_mode or self.live_provider is None:
            return False
        covers = getattr(self.live_provider, "covers", None)
        return bool(covers(symbol)) if callable(covers) else True

    async def _run(self) -> None:
        while True:
            # Symbols owned by a live provider keep their real price: the loop
            # only re-broadcasts the current candle so chart clients stay warm.
            # Anything the provider cannot resolve still ticks on the simulated
            # path so no panel ever renders an empty series.
            now = time.time()
            for key in list(self.subscribers.keys()):
                engine = self.engines[key]
                if self._covered_by_live_feed(key[0]):
                    if engine.current is None:
                        continue
                    message = {
                        "type": "candle_update",
                        "symbol": key[0],
                        "interval": key[1],
                        "candle": engine.current,
                    }
                else:
                    message = engine.advance(now)
                for queue in list(self.subscribers[key]):
                    try:
                        queue.put_nowait(message)
                    except asyncio.QueueFull:
                        pass
            await asyncio.sleep(self.tick_seconds)


hub = MarketDataHub()
