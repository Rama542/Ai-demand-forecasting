"""Technical stock scanner over the whole universe (Chartink-style).

Each instrument is reduced to one *snapshot* of its latest indicator values
(plus the previous bar's values, so crossovers can be detected) computed from
the same daily history the rest of the app uses — real NSE bars where stored.
A scan is a list of conditions joined by AND / OR; presets are just named
condition lists, so the custom builder and the presets share one evaluator.
"""
from __future__ import annotations

import math
import operator
import threading
import time
from typing import Any

import numpy as np

from app.services.history import daily_history, history_source
from app.services.indicators import compute_features, ema, sma
from app.services.universe import INSTRUMENTS

SNAPSHOT_BARS = 300  # enough for a 200-period average plus a 52-week range
# A volatility gauge, not a tradable price, so trend and breakout rules would mislead.
EXCLUDED = {"INDIA VIX"}
CACHE_SECONDS = 600.0

# field id -> (label, unit) — the custom builder offers exactly these.
FIELDS: dict[str, tuple[str, str]] = {
    "close": ("Close", "₹"),
    "change_pct": ("Day change", "%"),
    "ret_5": ("5-day return", "%"),
    "ret_20": ("20-day return", "%"),
    "rsi": ("RSI (14)", ""),
    "macd": ("MACD line", ""),
    "macd_signal": ("MACD signal", ""),
    "macd_hist": ("MACD histogram", ""),
    "ema20": ("EMA 20", "₹"),
    "ema50": ("EMA 50", "₹"),
    "ema200": ("EMA 200", "₹"),
    "sma50": ("SMA 50", "₹"),
    "sma200": ("SMA 200", "₹"),
    "adx": ("ADX (14)", ""),
    "plus_di": ("+DI", ""),
    "minus_di": ("−DI", ""),
    "atr_pct": ("ATR % of price", "%"),
    "bb_upper": ("Bollinger upper", "₹"),
    "bb_lower": ("Bollinger lower", "₹"),
    "bb_width": ("Bollinger width", "%"),
    "volume": ("Volume", ""),
    "vol_ratio": ("Volume ÷ 20-day avg", "×"),
    "prev_high20": ("Prior 20-day high", "₹"),
    "prev_low20": ("Prior 20-day low", "₹"),
    "high52": ("52-week high", "₹"),
    "low52": ("52-week low", "₹"),
    "pct_from_high52": ("% below 52-week high", "%"),
    "pct_from_low52": ("% above 52-week low", "%"),
}

OPERATORS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le}
CROSS_OPERATORS = ("crosses_above", "crosses_below")

PRESETS: dict[str, dict[str, Any]] = {
    "rsi_oversold": {"name": "RSI oversold", "group": "Momentum",
                     "summary": "RSI(14) below 30: heavy recent selling, watch for a bounce.",
                     "logic": "all", "conditions": [{"field": "rsi", "op": "<", "value": 30}],
                     "sort": ("rsi", False)},
    "rsi_overbought": {"name": "RSI overbought", "group": "Momentum",
                       "summary": "RSI(14) above 70: stretched rally, momentum may cool.",
                       "logic": "all", "conditions": [{"field": "rsi", "op": ">", "value": 70}],
                       "sort": ("rsi", True)},
    "macd_bull_cross": {"name": "MACD bullish crossover", "group": "Momentum",
                        "summary": "MACD line crossed above its signal line on the latest bar.",
                        "logic": "all", "conditions": [{"field": "macd", "op": "crosses_above", "value": "macd_signal"}],
                        "sort": ("macd_hist", True)},
    "macd_bear_cross": {"name": "MACD bearish crossover", "group": "Momentum",
                        "summary": "MACD line crossed below its signal line on the latest bar.",
                        "logic": "all", "conditions": [{"field": "macd", "op": "crosses_below", "value": "macd_signal"}],
                        "sort": ("macd_hist", False)},
    "ema_20_50_cross": {"name": "EMA 20 crosses above EMA 50", "group": "Trend",
                        "summary": "Short-term average turning up through the medium-term one.",
                        "logic": "all", "conditions": [{"field": "ema20", "op": "crosses_above", "value": "ema50"}],
                        "sort": ("change_pct", True)},
    "golden_cross": {"name": "Golden cross (50 / 200)", "group": "Trend",
                     "summary": "SMA 50 crossed above SMA 200 on the latest bar: classic long-term bull signal.",
                     "logic": "all", "conditions": [{"field": "sma50", "op": "crosses_above", "value": "sma200"}],
                     "sort": ("change_pct", True)},
    "death_cross": {"name": "Death cross (50 / 200)", "group": "Trend",
                    "summary": "SMA 50 crossed below SMA 200 on the latest bar.",
                    "logic": "all", "conditions": [{"field": "sma50", "op": "crosses_below", "value": "sma200"}],
                    "sort": ("change_pct", False)},
    "strong_uptrend": {"name": "Strong uptrend", "group": "Trend",
                       "summary": "Close above EMA 20 above EMA 50, ADX above 25 and +DI leading.",
                       "logic": "all", "conditions": [
                           {"field": "close", "op": ">", "value": "ema20"},
                           {"field": "ema20", "op": ">", "value": "ema50"},
                           {"field": "adx", "op": ">", "value": 25},
                           {"field": "plus_di", "op": ">", "value": "minus_di"}],
                       "sort": ("adx", True)},
    "above_200": {"name": "Above 200-day average", "group": "Trend",
                  "summary": "Close above the 200-day SMA: long-term trend intact.",
                  "logic": "all", "conditions": [{"field": "close", "op": ">", "value": "sma200"}],
                  "sort": ("ret_20", True)},
    "breakout_volume": {"name": "20-day breakout on volume", "group": "Breakout",
                        "summary": "Close above the prior 20-day high with volume at least 1.5× normal.",
                        "logic": "all", "conditions": [
                            {"field": "close", "op": ">", "value": "prev_high20"},
                            {"field": "vol_ratio", "op": ">=", "value": 1.5}],
                        "sort": ("vol_ratio", True)},
    "breakdown_volume": {"name": "20-day breakdown on volume", "group": "Breakout",
                         "summary": "Close below the prior 20-day low with volume at least 1.5× normal.",
                         "logic": "all", "conditions": [
                             {"field": "close", "op": "<", "value": "prev_low20"},
                             {"field": "vol_ratio", "op": ">=", "value": 1.5}],
                         "sort": ("vol_ratio", True)},
    "near_52w_high": {"name": "Near 52-week high", "group": "Breakout",
                      "summary": "Within 3% of the 52-week high.",
                      "logic": "all", "conditions": [{"field": "pct_from_high52", "op": "<=", "value": 3}],
                      "sort": ("pct_from_high52", False)},
    "near_52w_low": {"name": "Near 52-week low", "group": "Breakout",
                     "summary": "Within 3% of the 52-week low.",
                     "logic": "all", "conditions": [{"field": "pct_from_low52", "op": "<=", "value": 3}],
                     "sort": ("pct_from_low52", False)},
    "volume_spike": {"name": "Volume spike", "group": "Volume",
                     "summary": "Volume at least 2× its 20-day average.",
                     "logic": "all", "conditions": [{"field": "vol_ratio", "op": ">=", "value": 2}],
                     "sort": ("vol_ratio", True)},
    "bollinger_lower": {"name": "Below lower Bollinger band", "group": "Volatility",
                        "summary": "Close under the lower band: stretched to the downside.",
                        "logic": "all", "conditions": [{"field": "close", "op": "<", "value": "bb_lower"}],
                        "sort": ("rsi", False)},
    "bollinger_squeeze": {"name": "Bollinger squeeze", "group": "Volatility",
                          "summary": "Band width under 6% of price: volatility compressed, a move often follows.",
                          "logic": "all", "conditions": [{"field": "bb_width", "op": "<", "value": 6}],
                          "sort": ("bb_width", False)},
    "top_gainers": {"name": "Top gainers", "group": "Movers",
                    "summary": "Up more than 2% on the latest session.",
                    "logic": "all", "conditions": [{"field": "change_pct", "op": ">", "value": 2}],
                    "sort": ("change_pct", True)},
    "top_losers": {"name": "Top losers", "group": "Movers",
                   "summary": "Down more than 2% on the latest session.",
                   "logic": "all", "conditions": [{"field": "change_pct", "op": "<", "value": -2}],
                   "sort": ("change_pct", False)},
}

_cache: dict[str, Any] = {"ts": 0.0, "snapshots": {}}
_lock = threading.Lock()


def _f(value: Any) -> float | None:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _pct(a: float | None, b: float | None) -> float | None:
    return (a / b - 1.0) * 100.0 if a is not None and b else None


def _snapshot(symbol: str) -> dict[str, Any] | None:
    candles = daily_history(symbol, bars=SNAPSHOT_BARS)
    if len(candles) < 60:
        return None
    feat = compute_features(candles)
    close = feat["close"]
    volume = feat["volume"].astype(float)
    ema200 = ema(close, 200)
    sma50, sma200 = sma(close, 50), sma(close, 200)
    highs, lows = feat["high"][-252:], feat["low"][-252:]

    def at(i: int) -> dict[str, float | None]:
        c = _f(close[i])
        avg_vol = float(np.mean(volume[i - 20:i])) if len(volume) > 21 else None
        return {
            "close": c,
            "change_pct": _pct(c, _f(close[i - 1])),
            "ret_5": _pct(c, _f(close[i - 5])),
            "ret_20": _pct(c, _f(close[i - 20])),
            "rsi": _f(feat["rsi"][i]),
            "macd": _f(feat["macd"][i]), "macd_signal": _f(feat["macd_signal"][i]),
            "macd_hist": _f(feat["macd_hist"][i]),
            "ema20": _f(feat["ema20"][i]), "ema50": _f(feat["ema50"][i]), "ema200": _f(ema200[i]),
            "sma50": _f(sma50[i]), "sma200": _f(sma200[i]),
            "adx": _f(feat["adx"][i]), "plus_di": _f(feat["plus_di"][i]), "minus_di": _f(feat["minus_di"][i]),
            "atr_pct": (_f(feat["atr"][i]) or 0) / c * 100.0 if c else None,
            "bb_upper": _f(feat["bb_upper"][i]), "bb_lower": _f(feat["bb_lower"][i]),
            "bb_width": ((_f(feat["bb_upper"][i]) or 0) - (_f(feat["bb_lower"][i]) or 0)) / c * 100.0
                        if c and _f(feat["bb_upper"][i]) is not None else None,
            "volume": float(volume[i]),
            "vol_ratio": float(volume[i]) / avg_vol if avg_vol else None,
            "prev_high20": _f(feat["high20"][i - 1]), "prev_low20": _f(feat["low20"][i - 1]),
        }

    latest, previous = at(-1), at(-2)
    high52, low52 = float(np.max(highs)), float(np.min(lows))
    latest.update({
        "high52": high52, "low52": low52,
        "pct_from_high52": (1.0 - latest["close"] / high52) * 100.0 if high52 else None,
        "pct_from_low52": (latest["close"] / low52 - 1.0) * 100.0 if low52 else None,
    })
    meta = INSTRUMENTS[symbol]
    return {
        "symbol": symbol, "name": meta["name"], "sector": meta["sector"], "kind": meta["kind"],
        "universes": list(meta["universes"]), "source": history_source(symbol),
        "as_of": int(candles[-1]["time"]), "latest": latest, "previous": previous,
    }


def snapshots() -> dict[str, dict[str, Any]]:
    """Latest indicator snapshot for every instrument, cached for a few minutes."""
    with _lock:
        if _cache["snapshots"] and time.time() - _cache["ts"] < CACHE_SECONDS:
            return _cache["snapshots"]
        built = {}
        for symbol in INSTRUMENTS:
            if symbol in EXCLUDED:
                continue
            try:
                snap = _snapshot(symbol)
            except Exception:
                snap = None
            if snap:
                built[symbol] = snap
        _cache.update(ts=time.time(), snapshots=built)
        return built


def warm_up() -> None:
    """Build the snapshot cache in the background so the first scan is instant."""
    threading.Thread(target=snapshots, name="scanner-warm-up", daemon=True).start()


def _operand(snap: dict, value: Any, which: str) -> float | None:
    if isinstance(value, str):
        return snap[which].get(value)
    return _f(value)


def _check(snap: dict, cond: dict) -> bool:
    field, op, value = cond["field"], cond["op"], cond["value"]
    left_now = snap["latest"].get(field)
    right_now = _operand(snap, value, "latest")
    if left_now is None or right_now is None:
        return False
    if op in OPERATORS:
        return OPERATORS[op](left_now, right_now)
    left_prev = snap["previous"].get(field)
    right_prev = _operand(snap, value, "previous")
    if left_prev is None or right_prev is None:
        return False
    if op == "crosses_above":
        return left_prev <= right_prev and left_now > right_now
    if op == "crosses_below":
        return left_prev >= right_prev and left_now < right_now
    return False


def validate(conditions: list[dict]) -> str | None:
    if not conditions:
        return "Add at least one condition."
    for cond in conditions:
        if cond.get("field") not in FIELDS:
            return f"Unknown field '{cond.get('field')}'."
        if cond.get("op") not in (*OPERATORS, *CROSS_OPERATORS):
            return f"Unknown operator '{cond.get('op')}'."
        value = cond.get("value")
        if isinstance(value, str) and value not in FIELDS:
            return f"Unknown comparison field '{value}'."
        if not isinstance(value, str) and _f(value) is None:
            return "Each condition needs a number or a field to compare against."
    return None


def run_scan(conditions: list[dict], logic: str = "all", universe: str | None = None,
             sort: tuple[str, bool] | None = None, limit: int = 200) -> dict[str, Any]:
    error = validate(conditions)
    if error:
        return {"error": error}
    snaps = snapshots()
    combine = all if logic != "any" else any
    matches = []
    for snap in snaps.values():
        if universe and universe != "All" and universe not in snap["universes"]:
            continue
        if combine(_check(snap, c) for c in conditions):
            matches.append(snap)

    key, descending = sort or ("change_pct", True)
    matches.sort(key=lambda s: (s["latest"].get(key) is None, -(s["latest"].get(key) or 0) if descending else (s["latest"].get(key) or 0)))
    scanned = sum(1 for s in snaps.values() if not universe or universe == "All" or universe in s["universes"])
    return {
        "scanned": scanned,
        "count": len(matches),
        "as_of": max((s["as_of"] for s in snaps.values()), default=None),
        "real_data": sum(1 for s in snaps.values() if s["source"] != "simulated"),
        "results": [_row(s) for s in matches[:limit]],
    }


def _round(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def _row(snap: dict) -> dict[str, Any]:
    v = snap["latest"]
    return {
        "symbol": snap["symbol"], "name": snap["name"], "sector": snap["sector"], "source": snap["source"],
        "close": _round(v["close"]), "change_pct": _round(v["change_pct"]), "ret_20": _round(v["ret_20"]),
        "rsi": _round(v["rsi"], 1), "adx": _round(v["adx"], 1), "macd_hist": _round(v["macd_hist"], 3),
        "vol_ratio": _round(v["vol_ratio"]), "pct_from_high52": _round(v["pct_from_high52"]),
        "as_of": snap["as_of"],
    }


def catalog() -> dict[str, Any]:
    groups: dict[str, list[dict]] = {}
    for key, preset in PRESETS.items():
        groups.setdefault(preset["group"], []).append({
            "id": key, "name": preset["name"], "summary": preset["summary"],
            "conditions": preset["conditions"], "logic": preset["logic"],
        })
    return {
        "presets": [{"group": g, "scans": scans} for g, scans in groups.items()],
        "fields": [{"id": k, "label": label, "unit": unit} for k, (label, unit) in FIELDS.items()],
        "operators": [*OPERATORS, *CROSS_OPERATORS],
    }


def run_preset(preset_id: str, universe: str | None = None) -> dict[str, Any]:
    preset = PRESETS.get(preset_id)
    if not preset:
        return {"error": f"Unknown scan '{preset_id}'."}
    result = run_scan(preset["conditions"], preset["logic"], universe, preset.get("sort"))
    result.update({"scan": preset["name"], "summary": preset["summary"], "id": preset_id})
    return result
