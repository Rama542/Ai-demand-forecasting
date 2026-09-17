"""Rule-based trading strategies used by the backtester.

Each strategy maps the indicator feature set (see ``indicators.compute_features``)
to a per-bar signal array: ``+1`` (long), ``-1`` (short), ``0`` (flat). Signals
depend only on information available at that bar, so the backtest stays
leakage-free.
"""
from __future__ import annotations

from typing import Callable
import numpy as np
from app.services.indicators import compute_features


def ma_crossover(feat: dict[str, np.ndarray]) -> np.ndarray:
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    ema_fast = feat["ema12"]
    ema_slow = feat["ema26"]
    ema_trend = feat["ema50"]
    for i in range(1, len(close)):
        if np.isnan(ema_slow[i]) or np.isnan(ema_fast[i]):
            continue
        crossed_up = ema_fast[i - 1] <= ema_slow[i - 1] and ema_fast[i] > ema_slow[i]
        crossed_dn = ema_fast[i - 1] >= ema_slow[i - 1] and ema_fast[i] < ema_slow[i]
        if crossed_up and close[i] > ema_trend[i]:
            signal[i] = 1
        elif crossed_dn and close[i] < ema_trend[i]:
            signal[i] = -1
        elif ema_fast[i] > ema_slow[i] and signal[i - 1] == 1:
            signal[i] = 1
        elif ema_fast[i] < ema_slow[i] and signal[i - 1] == -1:
            signal[i] = -1
        signal[i] = int(signal[i - 1]) if signal[i] == 0 and i > 0 else signal[i]
    return signal


def momentum(feat: dict[str, np.ndarray]) -> np.ndarray:
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    rsi = feat["rsi"]
    mom10 = feat["momentum10"]
    ema20 = feat["ema20"]
    for i in range(len(close)):
        if np.isnan(mom10[i]) or np.isnan(rsi[i]) or np.isnan(ema20[i]):
            continue
        if mom10[i] > 0.002 and rsi[i] < 65 and close[i] > ema20[i]:
            signal[i] = 1
        elif mom10[i] < -0.002 and rsi[i] > 35 and close[i] < ema20[i]:
            signal[i] = -1
    for i in range(1, len(close)):
        if signal[i] == 0:
            signal[i] = signal[i - 1]
    return signal


def mean_reversion(feat: dict[str, np.ndarray]) -> np.ndarray:
    signal = np.zeros(len(feat["close"]), dtype=int)
    rsi = feat["rsi"]
    for i in range(len(feat["close"])):
        if np.isnan(rsi[i]):
            continue
        if rsi[i] < 30:
            signal[i] = 1
        elif rsi[i] > 70:
            signal[i] = -1
    for i in range(1, len(feat["close"])):
        if signal[i] == 0:
            signal[i] = signal[i - 1]
    return signal


def breakout(feat: dict[str, np.ndarray]) -> np.ndarray:
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    hi20 = feat["high20"]
    lo20 = feat["low20"]
    vol_ratio = feat["volume"] / np.nanmean(feat["volume"]) if np.nanmean(feat["volume"]) else 1.0
    for i in range(len(close)):
        if np.isnan(hi20[i]) or np.isnan(lo20[i]):
            continue
        if close[i] > hi20[i - 1] and vol_ratio[i] > 1.1:
            signal[i] = 1
        elif close[i] < lo20[i - 1] and vol_ratio[i] > 1.1:
            signal[i] = -1
    for i in range(1, len(close)):
        if signal[i] == 0:
            signal[i] = signal[i - 1]
    return signal


STRATEGIES: dict[str, Callable[[dict[str, np.ndarray]], np.ndarray]] = {
    "Moving Average Crossover": ma_crossover,
    "Momentum": momentum,
    "Mean Reversion": mean_reversion,
    "Breakout": breakout,
}

DEFAULT_STRATEGY = "Moving Average Crossover"


def apply_strategy(strategy_name: str, candles: list[dict]) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Compute the feature set and signal array for a named strategy."""
    if strategy_name not in STRATEGIES:
        strategy_name = DEFAULT_STRATEGY
    feat = compute_features(candles)
    signal = STRATEGIES[strategy_name](feat)
    return signal, feat