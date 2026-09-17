"""Upstox V3 real-time market data provider.

Uses the official ``upstox-python-sdk`` ``MarketDataStreamerV3`` in *full* mode
to receive live candlestick data and forward it into the existing
:class:`~app.services.market_data.MarketDataHub`.

The ``full`` subscription mode includes 1-minute, 30-minute, and daily
candlestick data alongside depth and last-trade information.  The provider
extracts the 1-minute candles from each message and translates them into the
``{"type": "candle_update", ...}`` contract that the charting layer already
understands.

Environment variables
---------------------
``MARKET_DATA_MODE``
    Set to ``upstox`` to activate this provider.  Any other value (including
    the default ``simulated``) keeps the zero-config demo running.

``UPSTOX_ACCESS_TOKEN``
    A **read-only analytics / market-data token** obtained through the Upstox
    OAuth2 flow.  The token must not have order-placement permissions.

Instrument key mapping
----------------------
The mapping below converts our human-friendly symbol names into Upstox
instrument keys.  Extend the ``INSTRUMENT_MAP`` dictionary to add more
instruments.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.market_data import MarketDataHub

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Instrument key mapping  (MarketMind symbol → Upstox instrument key)
# Keys follow the format ``SEGMENT|identifier`` used by the Upstox API.
# For NSE indices the identifier is the display name; for equities it is the
# ISIN.
# ---------------------------------------------------------------------------
INSTRUMENT_MAP: dict[str, str] = {
    "NIFTY 50":    "NSE_INDEX|Nifty 50",
    "SENSEX":      "BSE_INDEX|SENSEX",
    "BANKNIFTY":   "NSE_INDEX|Nifty Bank",
    "RELIANCE":    "NSE_EQ|INE002A01018",
    "TCS":         "NSE_EQ|INE467B01029",
    "HDFCBANK":    "NSE_EQ|INE040A01026",
    "INFY":        "NSE_EQ|INE009A01021",
    "TATAMOTORS":  "NSE_EQ|INE157A01041",
}

# Reverse map: Upstox instrument key → MarketMind symbol
_INSTRUMENT_REVERSE: dict[str, str] = {v: k for k, v in INSTRUMENT_MAP.items()}

# Default interval used when converting Upstox full-mode candle data
_DEFAULT_INTERVAL = "1m"


def _upstox_available() -> bool:
    """Return ``True`` when the Upstox SDK is importable and credentials are set."""
    token = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
    if not token:
        return False
    try:
        import upstox_client  # noqa: F401
        return True
    except ImportError:
        return False


def _candle_time_to_unix(ts_ms: int) -> int:
    """Convert an Upstox millisecond timestamp to a Unix-second boundary."""
    return int(ts_ms / 1000)


def _extract_candles_from_message(
    message: dict,
) -> list[tuple[str, dict]]:
    """Parse a ``full``-mode Upstox message and return (symbol, candle) pairs.

    The ``full`` payload looks like::

        {
          "type": "live_market_data",
          "data": {
            "instrument_key": "NSE_INDEX|Nifty 50",
            "last_price": 22500.0,
            "candle_1m": {"o": 22490, "h": 22510, "l": 22485, "c": 22500, "v": 123456, "ts": 1694000000000},
            "candle_30m": {...},
            "candle_1d": {...},
            ...
          }
        }

    We extract ``candle_1m`` (or fall back to building one from the last price)
    and convert it into our standard candle dict.
    """
    results: list[tuple[str, dict]] = []
    data = message.get("data") or message
    instrument_key = data.get("instrument_key", "")
    symbol = _INSTRUMENT_REVERSE.get(instrument_key)
    if symbol is None:
        return results

    # Prefer the explicit 1-minute candle from the full-mode payload
    candle_data = data.get("candle_1m") or data.get("candle")
    if candle_data and isinstance(candle_data, dict):
        open_price = candle_data.get("o") or candle_data.get("open", 0)
        high_price = candle_data.get("h") or candle_data.get("high", 0)
        low_price = candle_data.get("l") or candle_data.get("low", 0)
        close_price = candle_data.get("c") or candle_data.get("close", 0)
        volume = candle_data.get("v") or candle_data.get("volume", 0)
        ts_raw = candle_data.get("ts") or candle_data.get("time", 0)
        candle_time = _candle_time_to_unix(ts_raw) if ts_raw > 1e12 else int(ts_raw)

        candle = {
            "time": candle_time,
            "open": round(float(open_price), 2),
            "high": round(float(high_price), 2),
            "low": round(float(low_price), 2),
            "close": round(float(close_price), 2),
            "volume": int(volume),
        }
        results.append((symbol, candle))
        return results

    # Fallback: build a tick-level candle from the last price
    last_price = data.get("last_price") or data.get("ltp", 0)
    if last_price:
        now = int(time.time())
        candle_time = now - (now % 60)  # align to 1-minute boundary
        candle = {
            "time": candle_time,
            "open": round(float(last_price), 2),
            "high": round(float(last_price), 2),
            "low": round(float(last_price), 2),
            "close": round(float(last_price), 2),
            "volume": int(data.get("volume", 0)),
        }
        results.append((symbol, candle))

    return results


class UpstoxProvider:
    """Bridges the Upstox ``MarketDataStreamerV3`` into a :class:`MarketDataHub`.

    The provider runs the Upstox WebSocket on a background thread (the SDK
    manages its own event loop) and forwards parsed candles into the hub's
    asyncio queues via :meth:`_dispatch`.
    """

    def __init__(self, hub: MarketDataHub, access_token: str) -> None:
        self._hub = hub
        self._access_token = access_token
        self._streamer = None
        self._thread: threading.Thread | None = None
        self._running = False

    # -- public lifecycle ---------------------------------------------------

    def start(self) -> None:
        """Connect to the Upstox WebSocket and begin streaming."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run_streamer, name="upstox-streamer", daemon=True
        )
        self._thread.start()
        logger.info("Upstox provider starting (thread %s)", self._thread.name)

    async def stop(self) -> None:
        """Gracefully disconnect."""
        self._running = False
        if self._streamer is not None:
            try:
                self._streamer.disconnect()
            except Exception:
                logger.debug("Error disconnecting Upstox streamer", exc_info=True)
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=5)
        logger.info("Upstox provider stopped")

    # -- historical data preloading ----------------------------------------

    async def preload_historical(
        self,
        symbols: list[str] | None = None,
        intervals: list[str] | None = None,
        num_candles: int = 150,
    ) -> int:
        """Fetch historical candles from the Upstox REST API and seed engines.

        This runs *before* the WebSocket connects so that charts display real
        historical data from the first paint.  Returns the total number of
        candles loaded.

        Uses the dedicated :mod:`app.services.upstox_history` module which
        makes direct HTTP calls (no SDK dependency required).
        """
        from app.services.upstox_history import preload_engines
        import asyncio

        total = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: preload_engines(
                self._hub, self._access_token, symbols, intervals, num_candles
            ),
        )
        return total

    # -- internal -----------------------------------------------------------

    def _run_streamer(self) -> None:
        """Thread entry-point: create the SDK streamer and block."""
        try:
            import upstox_client
        except ImportError:
            logger.error("upstox-python-sdk is not installed – cannot start live feed")
            return

        configuration = upstox_client.Configuration()
        configuration.access_token = self._access_token

        instrument_keys = list(INSTRUMENT_MAP.values())
        logger.info(
            "Subscribing to %d instruments in full mode: %s",
            len(instrument_keys),
            ", ".join(INSTRUMENT_MAP.keys()),
        )

        streamer = upstox_client.MarketDataStreamerV3(
            upstox_client.ApiClient(configuration),
            instrument_keys,
            "full",
        )
        self._streamer = streamer

        # Enable auto-reconnect (default: enabled)
        streamer.auto_reconnect(True, 5, 10)

        def on_open() -> None:
            logger.info("Upstox WebSocket connected – streaming live market data")

        def on_close() -> None:
            logger.warning("Upstox WebSocket disconnected")

        def on_error(err) -> None:
            logger.error("Upstox WebSocket error: %s", err)

        def on_reconnecting(msg) -> None:
            logger.info("Upstox WebSocket reconnecting: %s", msg)

        def on_message(raw_message) -> None:
            self._handle_message(raw_message)

        streamer.on("open", on_open)
        streamer.on("close", on_close)
        streamer.on("error", on_error)
        streamer.on("reconnecting", on_reconnecting)
        streamer.on("message", on_message)

        try:
            streamer.connect()
            # Block until provider is stopped
            while self._running:
                time.sleep(1)
        except Exception:
            logger.exception("Upstox streamer thread crashed")

    def _handle_message(self, raw_message) -> None:
        """Parse an Upstox message and dispatch candles to the hub."""
        try:
            message = raw_message
            if isinstance(raw_message, str):
                import json
                message = json.loads(raw_message)

            pairs = _extract_candles_from_message(message)
            for symbol, candle in pairs:
                # Determine which engines need this candle
                for key, engine in list(self._hub.engines.items()):
                    eng_symbol, eng_interval = key
                    if eng_symbol == symbol:
                        # Update the engine's current candle
                        boundary = candle["time"]
                        if engine.current is None or boundary != engine.current["time"]:
                            if engine.current is not None:
                                engine.candles.append(engine.current)
                            engine.current = dict(candle)
                        else:
                            engine.current["high"] = max(engine.current["high"], candle["high"])
                            engine.current["low"] = min(engine.current["low"], candle["low"])
                            engine.current["close"] = candle["close"]
                            engine.current["volume"] = candle["volume"]
                        engine.price = candle["close"]

                        # Broadcast to WebSocket subscribers
                        update = {
                            "type": "candle_update",
                            "symbol": symbol,
                            "interval": eng_interval,
                            "candle": engine.current,
                        }
                        for queue in list(self._hub.subscribers.get(key, set())):
                            try:
                                queue.put_nowait(update)
                            except asyncio.QueueFull:
                                pass
        except Exception:
            logger.debug("Failed to process Upstox message", exc_info=True)
