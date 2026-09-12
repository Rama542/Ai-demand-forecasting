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
import math
import random
import time
from collections import defaultdict
from dataclasses import dataclass

INTERVALS: dict[str, int] = {"1m": 60, "5m": 300, "15m": 900, "1H": 3600, "1D": 86400}
SUPPORTED_INTERVALS: tuple[str, ...] = tuple(INTERVALS)

HISTORY_LIMIT = 150
MAX_RETAINED = 320
TICK_SECONDS = 1.0

SYMBOLS: dict[str, dict] = {
    "NIFTY 50": {"base": 22493.55, "vol": 0.00012, "decimals": 2, "volume": (12_000_000, 40_000_000)},
    "SENSEX": {"base": 74742.50, "vol": 0.00011, "decimals": 2, "volume": (9_000_000, 30_000_000)},
    "BANKNIFTY": {"base": 48320.10, "vol": 0.00015, "decimals": 2, "volume": (5_000_000, 20_000_000)},
    "RELIANCE": {"base": 2942.60, "vol": 0.00030, "decimals": 2, "volume": (2_000_000, 8_000_000)},
    "TCS": {"base": 3881.20, "vol": 0.00032, "decimals": 2, "volume": (900_000, 4_000_000)},
    "HDFCBANK": {"base": 1628.40, "vol": 0.00034, "decimals": 2, "volume": (6_000_000, 25_000_000)},
    "INFY": {"base": 1461.55, "vol": 0.00036, "decimals": 2, "volume": (4_000_000, 16_000_000)},
    "TATAMOTORS": {"base": 1014.20, "vol": 0.00040, "decimals": 2, "volume": (5_000_000, 18_000_000)},
}
SUPPORTED_SYMBOLS: tuple[str, ...] = tuple(SYMBOLS)


def normalize_symbol(symbol: str) -> str:
    cleaned = " ".join(symbol.strip().replace("-", " ").upper().split())
    return cleaned if cleaned in SYMBOLS else "NIFTY 50"


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
        start = interval_now - HISTORY_LIMIT * self.seconds
        candle_vol = self.volatility * math.sqrt(self.seconds)
        price = self.base * (1 + random.gauss(-0.002, 0.03))
        ts = start
        for _ in range(HISTORY_LIMIT):
            o = price
            c = price * (1 + random.gauss(0.00001, candle_vol))
            h = max(o, c) * (1 + random.random() * candle_vol * 0.5)
            l = min(o, c) * (1 - random.random() * candle_vol * 0.5)
            volume = random.randint(*self.volume_range)
            self.candles.append(
                {"time": ts, "open": round(o, self.decimals), "high": round(h, self.decimals),
                 "low": round(l, self.decimals), "close": round(c, self.decimals), "volume": volume}
            )
            price = c
            ts += self.seconds
        self.price = price
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

    def engine_for(self, symbol: str, interval: str) -> SymbolEngine:
        key = (symbol, interval)
        if key not in self.engines:
            self.engines[key] = SymbolEngine(symbol, interval)
        return self.engines[key]

    def subscribe(self, symbol: str, interval: str) -> tuple[asyncio.Queue, SymbolEngine]:
        engine = self.engine_for(symbol, interval)
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.subscribers[(symbol, interval)].add(queue)
        return queue, engine

    def unsubscribe(self, symbol: str, interval: str, queue: asyncio.Queue) -> None:
        self.subscribers[(symbol, interval)].discard(queue)

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    async def _run(self) -> None:
        while True:
            keys = list(self.subscribers.keys())
            now = time.time()
            for key in keys:
                engine = self.engines[key]
                message = engine.advance(now)
                for queue in list(self.subscribers[key]):
                    try:
                        queue.put_nowait(message)
                    except asyncio.QueueFull:
                        pass
            await asyncio.sleep(self.tick_seconds)


hub = MarketDataHub()