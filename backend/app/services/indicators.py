"""Technical indicator computations on OHLCV candle data.

All functions accept a ``candles`` list of dicts with keys ``time``, ``open``,
``high``, ``low``, ``close``, ``volume`` and return numpy arrays aligned with
the input (leading values are ``nan`` where the indicator needs warm-up bars).
"""
from __future__ import annotations

import numpy as np
from typing import Sequence


def _arrays(candles: Sequence[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        np.asarray([c["open"] for c in candles], dtype=float),
        np.asarray([c["high"] for c in candles], dtype=float),
        np.asarray([c["low"] for c in candles], dtype=float),
        np.asarray([c["close"] for c in candles], dtype=float),
        np.asarray([c.get("volume", 0) or 0 for c in candles], dtype=float),
    )


def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average (Wilder/standard alpha)."""
    if period <= 0 or len(values) == 0:
        return np.full_like(values, np.nan, dtype=float)
    out = np.full(len(values), np.nan, dtype=float)
    alpha = 2.0 / (period + 1.0)
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = alpha * values[i] + (1.0 - alpha) * out[i - 1]
    return out


def sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple moving average."""
    if period <= 0 or len(values) == 0:
        return np.full_like(values, np.nan, dtype=float)
    out = np.full(len(values), np.nan, dtype=float)
    cumsum = np.cumsum(np.insert(values, 0, 0.0))
    out[period - 1:] = (cumsum[period:] - cumsum[:-period]) / period
    return out


def rsi(candles: Sequence[dict], period: int = 14) -> np.ndarray:
    """Relative Strength Index using Wilder smoothing (0–100)."""
    close = _arrays(candles)[3]
    n = len(close)
    out = np.full(n, np.nan, dtype=float)
    if n <= period:
        return out
    delta = np.diff(close)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.mean(gain[:period])
    avg_loss = np.mean(loss[:period])
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss if avg_loss else np.inf)
    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gain[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + loss[i - 1]) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss if avg_loss else np.inf)
    return out


def macd(candles: Sequence[dict], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(macd_line, signal_line, histogram)``."""
    close = _arrays(candles)[3]
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(np.nan_to_num(macd_line, nan=0.0), signal)
    signal_line[:slow + signal - 2] = np.nan
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger(candles: Sequence[dict], period: int = 20, num_std: float = 2.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(middle, upper, lower)`` Bollinger Bands."""
    close = _arrays(candles)[3]
    mid = sma(close, period)
    std = np.full(len(close), np.nan, dtype=float)
    if len(close) >= period:
        for i in range(period - 1, len(close)):
            std[i] = np.std(close[i - period + 1:i + 1])
    return mid, mid + num_std * std, mid - num_std * std


def atr(candles: Sequence[dict], period: int = 14) -> np.ndarray:
    """Average True Range with Wilder smoothing."""
    _, high, low, close, _ = _arrays(candles)
    n = len(close)
    out = np.full(n, np.nan, dtype=float)
    if n < 2:
        return out
    tr = np.empty(n, dtype=float)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    out[period - 1] = np.mean(tr[1:period + 1])
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def adx(candles: Sequence[dict], period: int = 14) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(adx, plus_di, minus_di)``."""
    _, high, low, close, _ = _arrays(candles)
    n = len(close)
    adx_out = np.full(n, np.nan, dtype=float)
    plus_di_out = np.full(n, np.nan, dtype=float)
    minus_di_out = np.full(n, np.nan, dtype=float)
    if n <= period + 1:
        return adx_out, plus_di_out, minus_di_out
    tr = np.empty(n)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
        up = high[i] - high[i - 1]
        down = low[i - 1] - low[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
    atr_start = np.sum(tr[1:period + 1])
    pdm_start = np.sum(plus_dm[1:period + 1])
    mdm_start = np.sum(minus_dm[1:period + 1])
    dx = np.full(n, np.nan, dtype=float)
    atr_prev, pdm_prev, mdm_prev = atr_start, pdm_start, mdm_start
    for i in range(period, n):
        atr_prev = (atr_prev * (period - 1) + tr[i]) / period
        pdm_prev = (pdm_prev * (period - 1) + plus_dm[i]) / period
        mdm_prev = (mdm_prev * (period - 1) + minus_dm[i]) / period
        pdi = 100.0 * pdm_prev / atr_prev if atr_prev else 0.0
        mdi = 100.0 * mdm_prev / atr_prev if atr_prev else 0.0
        plus_di_out[i] = pdi
        minus_di_out[i] = mdi
        denom = pdi + mdi
        dx[i] = 100.0 * abs(pdi - mdi) / denom if denom else 0.0
    if n >= period + period:
        adx_out[2 * period - 1] = np.nanmean(dx[period:2 * period])
        for i in range(2 * period, n):
            adx_out[i] = (adx_out[i - 1] * (period - 1) + dx[i]) / period
    return adx_out, plus_di_out, minus_di_out


def vwap(candles: Sequence[dict]) -> np.ndarray:
    """Volume-weighted average price, reset at each new trading day."""
    opens, highs, lows, closes, volumes = _arrays(candles)
    n = len(closes)
    out = np.full(n, np.nan, dtype=float)
    typical = (highs + lows + closes) / 3.0
    days = np.asarray([int((c["time"] / 86400) % 7) for c in candles], dtype=int)
    day_bucket = np.asarray([(c["time"] // 86400) for c in candles], dtype=np.int64)
    cum_pv, cum_v = 0.0, 0.0
    for i in range(n):
        if i > 0 and day_bucket[i] != day_bucket[i - 1]:
            cum_pv, cum_v = 0.0, 0.0
        cum_pv += typical[i] * volumes[i]
        cum_v += volumes[i]
        out[i] = cum_pv / cum_v if cum_v else np.nan
    return out


def momentum(close: np.ndarray, period: int = 10) -> np.ndarray:
    out = np.full(len(close), np.nan, dtype=float)
    if len(close) > period:
        out[period:] = close[period:] / close[:-period] - 1.0
    return out


def roc(close: np.ndarray, period: int = 5) -> np.ndarray:
    return momentum(close, period)


def realized_vol(close: np.ndarray, period: int = 10) -> np.ndarray:
    """Rolling standard deviation of log returns."""
    n = len(close)
    out = np.full(n, np.nan, dtype=float)
    if n <= period:
        return out
    rets = np.log(close[1:] / close[:-1])
    for i in range(period, n):
        out[i] = np.std(rets[i - period:i])
    return out


def rolling_high(high: np.ndarray, period: int = 20) -> np.ndarray:
    n = len(high)
    out = np.full(n, np.nan, dtype=float)
    if n < period:
        return out
    for i in range(period - 1, n):
        out[i] = np.max(high[i - period + 1:i + 1])
    return out


def rolling_low(low: np.ndarray, period: int = 20) -> np.ndarray:
    n = len(low)
    out = np.full(n, np.nan, dtype=float)
    if n < period:
        return out
    for i in range(period - 1, n):
        out[i] = np.min(low[i - period + 1:i + 1])
    return out


def compute_features(candles: Sequence[dict]) -> dict[str, np.ndarray]:
    """Compute the full feature set used by strategies, backtesting and the ML model."""
    opens, highs, lows, closes, volumes = _arrays(candles)
    ema_fast = ema(closes, 12)
    ema_slow = ema(closes, 26)
    ema_20 = ema(closes, 20)
    ema_50 = ema(closes, 50)
    rsi_14 = rsi(candles)
    macd_line, signal_line, hist = macd(candles)
    mid, upper, lower = bollinger(candles)
    atr_14 = atr(candles)
    adx_14, plus_di, minus_di = adx(candles)
    vwap_series = vwap(candles)
    mom_10 = momentum(closes, 10)
    mom_3 = momentum(closes, 3)
    vol_10 = realized_vol(closes, 10)
    hi_20 = rolling_high(highs, 20)
    lo_20 = rolling_low(lows, 20)
    return {
        "open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes,
        "ema12": ema_fast, "ema26": ema_slow, "ema20": ema_20, "ema50": ema_50,
        "rsi": rsi_14, "macd": macd_line, "macd_signal": signal_line, "macd_hist": hist,
        "bb_mid": mid, "bb_upper": upper, "bb_lower": lower,
        "atr": atr_14, "adx": adx_14, "plus_di": plus_di, "minus_di": minus_di,
        "vwap": vwap_series, "momentum10": mom_10, "momentum3": mom_3,
        "volatility10": vol_10, "high20": hi_20, "low20": lo_20,
    }