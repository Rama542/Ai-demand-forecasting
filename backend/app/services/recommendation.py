"""Data-driven trade recommendation generator.

Combines live indicator readings, the walk-forward model probability and a quick
strategy backtest on the same candle series so every recommended level
(entry / stop / targets) is derived from actual market data rather than a
constant.
"""
from __future__ import annotations

import numpy as np
from app.services.indicators import compute_features
from app.services.forecast import forecast_report
from app.services.backtester import run_backtest

STYLE_TO_STRATEGY = {
    "Intraday": "Momentum",
    "Swing": "Moving Average Crossover",
    "Positional": "Breakout",
    "Long Term": "Mean Reversion",
}
STYLE_TO_INTERVAL = {
    "Intraday": "15m",
    "Swing": "1H",
    "Positional": "1D",
    "Long Term": "1D",
}
STYLE_HOLDING = {
    "Intraday": "1 trading day",
    "Swing": "3–7 trading days",
    "Positional": "2–8 weeks",
    "Long Term": "6–12 months",
}
RISK_ATR_MULT = {"Low": 3.0, "Medium": 2.0, "High": 1.5}
TARGET_RATIOS = [2.0, 3.0, 4.0]


def _clamp(v: float, lo: float = 5.0, hi: float = 95.0) -> float:
    return min(hi, max(lo, v))


def generate_recommendation(
    candles: list[dict],
    symbol: str,
    risk_level: str = "Medium",
    style: str = "Swing",
    indicators: list[str] | None = None,
    interval: str = "1H",
) -> dict:
    if len(candles) < 60:
        return {"error": "Insufficient candle history for a recommendation"}

    indicators = indicators or ["RSI", "MACD", "EMA"]
    feat = compute_features(candles)
    close = feat["close"]
    price = float(close[-1])

    ema20 = feat["ema20"][-1]
    ema50 = feat["ema50"][-1]
    ema_fast = feat["ema12"][-1]
    ema_slow = feat["ema26"][-1]
    rsi_val = float(feat["rsi"][-1]) if not np.isnan(feat["rsi"][-1]) else 50.0
    macd_val = feat["macd"][-1]
    macd_sig = feat["macd_signal"][-1]
    adx_val = float(feat["adx"][-1]) if not np.isnan(feat["adx"][-1]) else 20.0
    atr_val = float(feat["atr"][-1]) if not np.isnan(feat["atr"][-1]) else price * 0.012
    vwap_val = feat["vwap"][-1]
    mom10 = feat["momentum10"][-1]
    hi20 = feat["high20"][-1]
    lo20 = feat["low20"][-1]

    p_above_20 = price > ema20
    p_above_50 = price > ema50
    macd_pos = macd_val > macd_sig
    rsi_bull = rsi_val > 50
    rsi_room = rsi_val < 70
    adx_trend = adx_val > 22
    mom_pos = not np.isnan(mom10) and mom10 > 0
    vwap_bull = not np.isnan(vwap_val) and price > vwap_val

    bullish_tech = sum([
        p_above_20, p_above_50, macd_pos, rsi_bull, rsi_room and macd_pos,
        adx_trend and (p_above_20 or p_above_50 > 0), mom_pos, vwap_bull,
    ])
    bullish_tech = min(bullish_tech, 8)
    bearish_tech = 8 - sum([
        p_above_20, p_above_50, macd_pos, rsi_bull, rsi_room,
        adx_trend, 1 if mom_pos else 0, 1 if vwap_bull else 0,
    ])

    forecast = forecast_report(candles, symbol, interval)
    model_prob = forecast.get("latest_forecast", {}).get("probability", 50.0) / 100.0 if isinstance(forecast, dict) else 0.5
    direction = forecast.get("latest_forecast", {}).get("direction", "UP") if isinstance(forecast, dict) else "UP"

    if direction == "UP":
        tech_signal = bullish_tech
        tech_side = max(bullish_tech, bearish_tech)
        probability = _clamp(0.55 * model_prob * 100.0 + 0.45 * (50.0 + (tech_signal - 4.0) * 8.0))
        side = "BUY"
        market_outlook = "Bullish"
    else:
        tech_signal = bearish_tech
        tech_side = max(bullish_tech, bearish_tech)
        probability = _clamp(0.55 * model_prob * 100.0 + 0.45 * (50.0 + (tech_signal - 4.0) * 8.0))
        side = "SELL / AVOID"
        market_outlook = "Bearish"

    atr_mult = RISK_ATR_MULT.get(risk_level, 2.0)
    risk_points = atr_mult * atr_val
    entry = round(price, 2)
    if side == "BUY":
        stop = round(price - risk_points, 2)
        if stop >= entry:
            stop = round(entry * 0.985, 2)
        targets = [round(entry + risk_points * r, 2) for r in TARGET_RATIOS]
        rr = (targets[0] - entry) / (entry - stop) if (entry - stop) > 0 else 0.0
    else:
        stop = round(price + risk_points, 2)
        if stop <= entry:
            stop = round(entry * 1.015, 2)
        targets = [round(entry - risk_points * r, 2) for r in TARGET_RATIOS]
        rr = (entry - targets[0]) / (stop - entry) if (stop - entry) > 0 else 0.0

    if adx_val >= 25:
        regime = "strong trend"
    elif adx_val >= 20:
        regime = "moderate trend"
    else:
        regime = "range-bound market"
    if tech_signal >= 6:
        strength = "Strong"
    elif tech_signal >= 4:
        strength = "Moderate"
    else:
        strength = "Weak"

    conditions = []
    if "RSI" in indicators or True:
        conditions.append(f"RSI {rsi_val:.0f}")
    if "MACD" in indicators or True:
        conditions.append("MACD " + ("positive" if macd_val > 0 else "negative"))
    if "EMA" in indicators:
        conditions.append("price " + ("above" if price > ema20 else "below") + " EMA20")
    explanation = (
        f"{market_outlook} outlook: {', '.join(conditions)} in a {regime}. "
        f"ADX {adx_val:.0f}, 20-bar channel {lo20:.2f}–{hi20:.2f}. "
        f"Walk-forward model confidence {model_prob * 100:.0f}%."
    )

    strategy = STYLE_TO_STRATEGY.get(style, "Moving Average Crossover")
    backtest = run_backtest(candles, strategy, symbol=symbol, interval=interval)
    backtest_metrics = {}
    if "error" not in backtest and backtest.get("trades", 0) > 0:
        backtest_metrics = {
            "trades": backtest["trades"],
            "win_rate": backtest["win_rate"],
            "net_return": backtest["net_return"],
            "max_drawdown": backtest["max_drawdown"],
            "sharpe": backtest["sharpe"],
            "equity_curve": backtest["equity_curve"],
        }

    return {
        "symbol": symbol.upper(),
        "side": side,
        "entry": entry,
        "stop_loss": stop,
        "targets": targets,
        "risk_reward": round(max(rr, 0.1), 2),
        "probability": round(probability, 0),
        "holding_time": STYLE_HOLDING.get(style, "3–7 trading days"),
        "condition": f"{market_outlook} {regime}".capitalize(),
        "signal_strength": strength,
        "trend": {
            "price": price, "ema20": round(ema20, 2) if not np.isnan(ema20) else None,
            "ema50": round(ema50, 2) if not np.isnan(ema50) else None,
            "rsi": round(rsi_val, 1), "adx": round(adx_val, 1),
            "macd": round(macd_val, 4) if not np.isnan(macd_val) else None,
            "support": round(lo20, 2), "resistance": round(hi20, 2),
            "atr": round(atr_val, 2),
        },
        "indicator_confluence": {"bullish": bullish_tech, "bearish": bearish_tech},
        "model_confidence_pct": round(model_prob * 100.0, 1),
        "explanation": explanation,
        "backtest": backtest_metrics,
        "forecast_accuracy": {
            "direction_accuracy": forecast.get("direction_accuracy"),
            "mae": forecast.get("mae"),
            "rmse": forecast.get("rmse"),
        } if isinstance(forecast, dict) else None,
        "disclaimer": "Predictions are AI-generated research insights and should not be considered financial advice.",
    }