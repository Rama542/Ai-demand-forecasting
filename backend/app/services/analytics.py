"""Real portfolio, correlation and market-regime analytics.

Everything here is computed from actual price history — there are no hardcoded
correlation matrices or invented scores. Model explanations use XGBoost's own
TreeSHAP contributions, so every number shown as an attribution is the model's
real feature contribution.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np

from app.services.history import daily_history
from app.services.indicators import compute_features, sma
from app.services.universe import INSTRUMENTS, lookup, normalize_symbol


# ──────────────────────────────────────────────────────────────────────────
# Correlation
# ──────────────────────────────────────────────────────────────────────────
def _log_returns(candles: list[dict]) -> np.ndarray:
    close = np.asarray([float(c["close"]) for c in candles], dtype=float)
    if close.size < 3:
        return np.zeros(0, dtype=float)
    safe = np.where(close[:-1] != 0, close[:-1], np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        rets = close[1:] / safe - 1.0
    return np.nan_to_num(rets, nan=0.0, posinf=0.0, neginf=0.0)


def return_series(symbol: str, period: str = "Last 1 year") -> np.ndarray:
    candles = daily_history(symbol, period=period)
    return _log_returns(candles)


def correlation_matrix(symbols: list[str], period: str = "Last 1 year") -> dict[str, Any]:
    """Pearson correlation of daily returns, aligned on trading-day position."""
    resolved = [normalize_symbol(s) for s in symbols if str(s).strip()]
    resolved = list(dict.fromkeys(resolved))
    if len(resolved) < 2:
        return {"error": "Pick at least two instruments to compare.", "assets": resolved, "matrix": []}

    series: dict[str, np.ndarray] = {}
    for symbol in resolved:
        values = return_series(symbol, period)
        if values.size >= 20:
            series[symbol] = values
    if len(series) < 2:
        return {"error": "Not enough price history to correlate these instruments.", "assets": list(series), "matrix": []}

    length = min(len(v) for v in series.values())
    ordered = list(series.keys())
    matrix = np.zeros((len(ordered), len(ordered)), dtype=float)
    for i, a in enumerate(ordered):
        for j, b in enumerate(ordered):
            if i == j:
                matrix[i][j] = 1.0
                continue
            x, y = series[a][-length:], series[b][-length:]
            sx, sy = float(np.std(x)), float(np.std(y))
            if sx == 0 or sy == 0:
                matrix[i][j] = 0.0
                continue
            matrix[i][j] = float(np.clip(np.mean((x - x.mean()) * (y - y.mean())) / (sx * sy), -1.0, 1.0))

    labels = []
    for symbol in ordered:
        meta = lookup(symbol)
        labels.append({"symbol": symbol, "name": meta["name"], "sector": meta["sector"]})

    pairs: list[dict[str, Any]] = []
    for i in range(len(ordered)):
        for j in range(i + 1, len(ordered)):
            pairs.append({
                "a": ordered[i], "b": ordered[j],
                "value": round(matrix[i][j], 3),
                "strength": _correlation_strength(matrix[i][j]),
            })
    pairs.sort(key=lambda row: abs(row["value"]), reverse=True)

    return {
        "assets": labels,
        "matrix": [[round(float(v), 3) for v in row] for row in matrix],
        "pairs": pairs[:12],
        "observations": int(length),
        "period": period,
        "average_pairwise": round(float(np.mean([p["value"] for p in pairs])) if pairs else 0.0, 3),
    }


def _correlation_strength(value: float) -> str:
    v = abs(value)
    if v >= 0.8:
        return "Very strong"
    if v >= 0.6:
        return "Strong"
    if v >= 0.35:
        return "Moderate"
    if v >= 0.15:
        return "Weak"
    return "Negligible"


# ──────────────────────────────────────────────────────────────────────────
# Portfolio analytics
# ──────────────────────────────────────────────────────────────────────────
def _annualised_vol(rets: np.ndarray) -> float:
    if rets.size < 5:
        return 0.0
    return float(np.std(rets, ddof=1) * math.sqrt(252) * 100.0)


def portfolio_analysis(holdings: list[str], period: str = "Last 1 year") -> dict[str, Any]:
    """Equal-weighted diagnostics over the supplied symbols.

    Without position sizes there is nothing to weight by, so weights are equal
    and the response says so explicitly instead of implying a real mandate.
    """
    symbols = [normalize_symbol(s) for s in holdings if str(s).strip()]
    symbols = list(dict.fromkeys(symbols))
    if not symbols:
        return {"error": "Add at least one symbol to analyse a portfolio."}

    series: dict[str, np.ndarray] = {}
    for symbol in symbols:
        values = return_series(symbol, period)
        if values.size >= 20:
            series[symbol] = values
    if not series:
        return {"error": "Not enough price history for these symbols."}

    ordered = list(series.keys())
    length = min(len(v) for v in series.values())
    weight = round(100.0 / len(ordered), 2)

    positions = []
    total_return = 0.0
    weighted_vol = 0.0
    for symbol in ordered:
        values = series[symbol][-length:]
        ret = float((np.prod(1.0 + values) - 1.0) * 100.0)
        vol = _annualised_vol(values)
        meta = lookup(symbol)
        total_return += ret * weight / 100.0
        weighted_vol += vol * weight / 100.0
        positions.append({
            "symbol": symbol, "name": meta["name"], "sector": meta["sector"],
            "weight_pct": weight, "return_pct": round(ret, 2),
            "volatility_pct": round(vol, 2), "universes": meta["universes"],
        })

    positions.sort(key=lambda row: row["return_pct"], reverse=True)
    sectors: dict[str, float] = {}
    for row in positions:
        sectors[row["sector"]] = round(sectors.get(row["sector"], 0.0) + row["weight_pct"], 2)
    sector_rows = sorted(
        [{"sector": k, "weight_pct": v, "share_of_book": round(v / 100.0 * 100.0, 1)} for k, v in sectors.items()],
        key=lambda row: row["weight_pct"], reverse=True,
    )

    corr = correlation_matrix(ordered[:8], period=period)
    pairwise = corr.get("pairs", []) if isinstance(corr, dict) else []
    worst = min(pairwise, key=lambda row: row["value"], default=None)
    best = max(pairwise, key=lambda row: row["value"], default=None)
    overlap = [row for row in pairwise if abs(row["value"]) >= 0.6]

    concentration = max((row["weight_pct"] for row in positions), default=0.0)
    hhi = sum((row["weight_pct"] / 100.0) ** 2 for row in positions)
    effective_n = (1.0 / hhi) if hhi else len(positions)
    top_sector = sector_rows[0]["share_of_book"] if sector_rows else 0.0

    risks: list[str] = []
    strengths: list[str] = []
    if top_sector > 40:
        risks.append(f"{sector_rows[0]['sector']} is {top_sector:.0f}% of the book, above a 40% single-sector guideline.")
    if overlap:
        pair = overlap[0]
        risks.append(f"{pair['a']} and {pair['b']} move together at {pair['value']:+.2f}, so both positions can fall as one.")
    if concentration > 100.0 / max(len(positions), 2) * 1.2:
        risks.append("Position sizes are uneven; a single name dominates day-to-day P&L.")
    if len(positions) >= 5:
        strengths.append(f"{len(positions)} positions spread across {len(sectors)} sectors gives genuine breadth.")
    if best and best["value"] < 0.7:
        strengths.append(f"{best['a']} and {best['b']} are only {best['value']:+.2f} correlated, which diversifies the mix.")
    if not strengths:
        strengths.append("Equal weighting keeps single-name risk predictable while you build the position detail.")
    if not risks:
        risks.append("No concentration or correlation thresholds breached in this equal-weighted view.")

    health = _score(
        penalties={
            "top_sector": max(0.0, (top_sector - 35.0) / 3.0),
            "overlap": min(28.0, len(overlap) * 9.0),
            "count": max(0.0, (4 - len(positions)) * 7.0),
            "volatility": max(0.0, (weighted_vol - 26.0) / 1.6),
        },
    )

    return {
        "positions": positions,
        "sectors": sector_rows,
        "period": period,
        "observations": int(length),
        "weighted_return_pct": round(total_return, 2),
        "weighted_volatility_pct": round(weighted_vol, 2),
        "effective_positions": round(effective_n, 2),
        "diversification_score": health,
        # A high diversification score means low risk, so the labels run strong → weak.
        "risk_level": _band(health, ("Low", "Moderate", "Elevated", "High"), reverse=True),
        "correlation": corr,
        "highest_correlation": best,
        "lowest_correlation": worst,
        "overlapping_pairs": overlap[:6],
        "risks": risks,
        "strengths": strengths,
        "weighting_note": "No position sizes were supplied, so every holding is weighted equally.",
        "disclaimer": "Research diagnostics only. Not investment advice.",
    }


def _score(penalties: dict[str, float]) -> int:
    base = 100.0
    for value in penalties.values():
        base -= float(value)
    return int(max(28, min(96, round(base))))


def _band(score: int, labels: tuple[str, ...], reverse: bool = False) -> str:
    """Map a 0–100 score onto ordered labels.

    ``reverse`` treats a high score as the first (strongest) label, which is what
    a health score needs; the default treats a high score as the last label.
    """
    step = max(1, 100 // len(labels))
    index = min(len(labels) - 1, max(0, score // step))
    if reverse:
        index = len(labels) - 1 - index
    return labels[index]


# ──────────────────────────────────────────────────────────────────────────
# Market regime (Market Doctor)
# ──────────────────────────────────────────────────────────────────────────
REGIME_PILLARS = ("Trend", "Momentum", "Volatility", "Liquidity", "Breadth", "Sector strength")


def market_condition(symbol: str = "NIFTY 50", period: str = "Last 1 year") -> dict[str, Any]:
    """Score six pillars of market health from real index and constituent history."""
    index = normalize_symbol(symbol)
    meta = lookup(index)
    candles = daily_history(index, period=period)
    if len(candles) < 90:
        return {"error": "Not enough index history to score market conditions."}

    feat = compute_features(candles)
    close = np.asarray(feat["close"], dtype=float)
    rets = _log_returns(candles)
    last = float(close[-1])

    ema20, ema50 = float(feat["ema20"][-1]), float(feat["ema50"][-1])
    rsi = float(feat["rsi"][-1]) if not np.isnan(feat["rsi"][-1]) else 50.0
    adx = float(feat["adx"][-1]) if not np.isnan(feat["adx"][-1]) else 20.0
    macd_hist = float(feat["macd_hist"][-1])
    realised = float(np.std(rets[-60:], ddof=1) * math.sqrt(252) * 100.0) if rets.size > 60 else 0.0
    hi20, lo20 = float(feat["high20"][-1]), float(feat["low20"][-1])
    channel_position = ((last - lo20) / (hi20 - lo20) * 100.0) if hi20 > lo20 else 50.0
    above_ema20 = (close > ema20).astype(float)[-60:]
    # Ranges are set so a genuinely healthy market lands near 70–85 rather than
    # pegging at 98, which keeps the six pillars distinguishable.
    trend_score = _band_score(
        (last > ema20) * 24 + (last > ema50) * 24 + (rsi - 50) * 0.7 + (adx - 20) * 0.5,
        low=8, high=82,
    )
    momentum_score = _band_score(
        (rsi - 50) * 1.2 + (macd_hist / last * 100.0 if last else 0) * 7.0 + (channel_position - 50) * 0.45,
        low=-18, high=52,
    )
    volatility_score = _band_score(36.0 - realised * 1.15, low=-14, high=40)
    volume_ma = float(np.mean(feat["volume"][-20:]))
    liquidity_score = _band_score(volume_ma / 1e6 * 9.0, low=4, high=86)

    members = [s for s, m in INSTRUMENTS.items() if "Nifty 50" in m["universes"] and s != index][:25]
    advances, declines, sector_moves = 0, 0, {}
    for member in members:
        member_candles = daily_history(member, period="Last 3 months")
        if len(member_candles) < 30:
            continue
        change = (member_candles[-1]["close"] / member_candles[-2]["close"] - 1.0) * 100.0
        advances += 1 if change > 0 else 0
        declines += 1 if change <= 0 else 0
        sector = lookup(member)["sector"]
        sector_moves.setdefault(sector, []).append(change)
    breadth_ratio = (advances / (advances + declines) * 100.0) if (advances + declines) else 50.0
    breadth_score = _band_score(breadth_ratio - 50.0, low=-32, high=32)

    sector_avg = {k: float(np.mean(v)) for k, v in sector_moves.items() if v}
    sector_dispersion = (max(sector_avg.values()) - min(sector_avg.values())) if sector_avg else 0.0
    # A wide dispersion means leadership is rotating hard — informative but not
    # automatically healthy, so it is scored in the middle of the range.
    sector_score = _band_score(72.0 - sector_dispersion * 9.0, low=20, high=80)

    pillars = [
        {"pillar": "Trend", "score": trend_score, "detail": f"Close {last:,.0f} vs EMA20 {ema20:,.0f} / EMA50 {ema50:,.0f}, ADX {adx:.0f}."},
        {"pillar": "Momentum", "score": momentum_score, "detail": f"RSI {rsi:.0f}, MACD histogram {'positive' if macd_hist >= 0 else 'negative'}, {channel_position:.0f}% of the 20-bar channel."},
        {"pillar": "Volatility", "score": volatility_score, "detail": f"60-day realised volatility {realised:.1f}% annualised."},
        {"pillar": "Liquidity", "score": liquidity_score, "detail": f"Average traded volume {np.mean(feat['volume'][-20:]):,.0f} over the last 20 sessions."},
        {"pillar": "Breadth", "score": breadth_score, "detail": f"{advances} of {advances + declines} tracked constituents advanced in the latest session."},
        {"pillar": "Sector strength", "score": sector_score, "detail": f"Leadership spread of {sector_dispersion:.2f}% between the strongest and weakest tracked sector."},
    ]
    health = int(round(sum(p["score"] for p in pillars) / len(pillars)))

    leaders = sorted(sector_avg.items(), key=lambda kv: kv[1], reverse=True)
    observations: list[str] = []
    if last > ema20 and last > ema50:
        observations.append(f"{meta['name']} is holding above both its 20- and 50-period averages, which is the basic condition for an uptrend.")
    else:
        observations.append(f"{meta['name']} is trading below at least one of its 20/50-period averages, so the trend is not confirmed.")
    if rsi >= 70:
        observations.append(f"RSI at {rsi:.0f} is in overbought territory; momentum is extended rather than fresh.")
    elif rsi <= 30:
        observations.append(f"RSI at {rsi:.0f} is oversold, which can signal capitulation or an unfinished decline.")
    else:
        observations.append(f"RSI at {rsi:.0f} sits mid-range, so there is no momentum extreme to trade against.")
    if breadth_ratio >= 60:
        observations.append(f"Breadth is broad at {breadth_ratio:.0f}% of tracked constituents advancing, which usually makes a move more durable.")
    elif breadth_ratio <= 40:
        observations.append(f"Only {breadth_ratio:.0f}% of tracked constituents advanced, so participation is narrow behind the index.")
    else:
        observations.append(f"Breadth is mixed at {breadth_ratio:.0f}% advancing, which argues for patience rather than a directional bet.")
    if leaders:
        observations.append(f"{leaders[0][0]} leads the tracked sectors at {leaders[0][1]:+.2f}% for the session, with {leaders[-1][0]} weakest at {leaders[-1][1]:+.2f}%.")

    risks: list[str] = []
    if realised > 22:
        risks.append(f"Realised volatility of {realised:.1f}% is high; position sizes should be reduced and stops widened to fit the range.")
    if channel_position > 90:
        risks.append("Price is at the very top of its 20-bar channel, where new entries have poor room to run.")
    if breadth_score < 40:
        risks.append("Narrow breadth means the index can be carried by very few large constituents.")
    if adx < 18:
        risks.append(f"ADX at {adx:.0f} points to a range-bound tape where trend-following rules repeatedly get whipsawed.")
    if not risks:
        risks.append("No volatility, breadth or positioning threshold is currently flashing a risk flag.")

    return {
        "symbol": index,
        "name": meta["name"],
        "period": period,
        "candles": len(candles),
        "health_score": health,
        "verdict": _band(health, ("Risk-off", "Cautious", "Balanced", "Constructive")),
        "pillars": pillars,
        "observations": observations,
        "risks": risks,
        "monitor": [
            f"Watch whether the index holds {ema20:,.0f} (20-period average) on a daily close.",
            f"Momentum warning: RSI crossing back below 50 from {rsi:.0f} would weaken the current read.",
            "Re-check breadth after the next index rebalance or a large F&O expiry.",
        ],
        "historical_context": (
            f"Scored on {len(candles)} daily candles over {period} ({meta['name']}). "
            "The health score blends six equally weighted pillars, so a single strong pillar cannot dominate the verdict."
        ),
        "sector_leaders": [{"sector": k, "change_pct": round(v, 2)} for k, v in leaders[:6]],
        "disclaimer": "Research diagnostics only. Not investment advice.",
    }


def _band_score(value: float, low: float, high: float) -> int:
    if high <= low:
        return 50
    ratio = (float(value) - low) / (high - low)
    return int(max(2, min(98, round(ratio * 100.0))))


# ──────────────────────────────────────────────────────────────────────────
# Model explanation (TreeSHAP)
# ──────────────────────────────────────────────────────────────────────────
FEATURE_LABELS = {
    "rsi": "RSI (14)", "macd": "MACD line", "macd_signal": "MACD signal", "macd_hist": "MACD histogram",
    "momentum10": "10-bar momentum", "momentum3": "3-bar momentum", "volatility10": "Realised volatility",
    "atr_pct": "ATR as % of price", "ema_spread_pct": "EMA 12/26 spread", "bb_position": "Bollinger position",
    "bb_width": "Bollinger width", "adx": "ADX (14)", "plus_di": "+DI", "minus_di": "−DI",
    "vwap_dev_pct": "VWAP deviation", "volume_z": "Volume z-score", "breakout_dist_pct": "Distance to 20-bar high",
    "ret_1": "1-bar return", "ret_5": "5-bar return",
}


def explain_prediction(symbol: str, period: str = "Last 2 years") -> dict[str, Any]:
    """Fit the direction model, then attribute the latest call with TreeSHAP."""
    from app.services.forecast import FEATURE_COLUMNS, MIN_SAMPLES, build_dataset

    resolved = normalize_symbol(symbol)
    candles = daily_history(resolved, period=period)
    if len(candles) < MIN_SAMPLES + 30:
        return {"error": "Not enough history to explain a model call for this symbol."}

    X, y, _, _ = build_dataset(candles)
    if X.shape[0] < MIN_SAMPLES:
        return {"error": "Not enough labelled samples to explain a model call."}

    feature_rows = X[:-1]
    feature_labels = y[:-1]
    latest = X[-1:]

    contributions = _treeshap_contributions(feature_rows, feature_labels, latest)
    if contributions is None:
        return {"error": "The explainability engine is unavailable for this model right now."}

    values, base_value = contributions
    probability = 1.0 / (1.0 + math.exp(-float(np.sum(values) + base_value)))
    probability = min(0.93, max(0.07, probability))

    rows = []
    for name, value in zip(FEATURE_COLUMNS, values):
        rows.append({
            "feature": name,
            "label": FEATURE_LABELS.get(name, name),
            "contribution": round(float(value), 4),
            "direction": "bullish" if value > 0 else "bearish" if value < 0 else "neutral",
        })
    rows.sort(key=lambda row: abs(row["contribution"]), reverse=True)

    drivers = [r for r in rows if r["contribution"] > 0][:5]
    headwinds = [r for r in rows if r["contribution"] < 0][:5]

    return {
        "symbol": resolved,
        "name": lookup(resolved)["name"],
        "period": period,
        "model": "XGBoost classifier (TreeSHAP)",
        "base_value": round(float(base_value), 4),
        "probability_up": round(probability * 100.0, 1),
        "direction": "UP" if probability >= 0.5 else "DOWN",
        "contributions": rows[:14],
        "drivers": drivers,
        "headwinds": headwinds,
        "samples": int(len(feature_rows)),
        "method": "Exact TreeSHAP values from the fitted booster (pred_contribs).",
        "disclaimer": "Model-generated research signal. Not a guarantee of future returns.",
    }


def _treeshap_contributions(X: np.ndarray, y: np.ndarray, sample: np.ndarray):
    """Exact SHAP values via the booster. Returns None when no booster is available."""
    try:
        import xgboost as xgb
    except Exception:
        return None
    try:
        model = xgb.XGBClassifier(
            n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9,
            colsample_bytree=0.8, objective="binary:logistic", eval_metric="logloss",
            tree_method="hist", random_state=7,
        )
        model.fit(X, y)
        booster = model.get_booster()
        names = [str(i) for i in range(X.shape[1])]
        # Exact TreeSHAP values: one contribution per feature plus the bias term.
        shap = booster.predict(xgb.DMatrix(sample, feature_names=names), pred_contribs=True)
        row = np.asarray(shap, dtype=float)[0]
        return row[:-1], float(row[-1])
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────
# Research summary
# ──────────────────────────────────────────────────────────────────────────
def technical_summary(symbol: str, period: str = "Last 1 year") -> dict[str, Any]:
    resolved = normalize_symbol(symbol)
    candles = daily_history(resolved, period=period)
    if len(candles) < 60:
        return {"error": "Not enough history for a technical summary."}
    feat = compute_features(candles)
    close = float(feat["close"][-1])

    def safe(key: str, digits: int = 2) -> float | None:
        value = float(feat[key][-1])
        return round(value, digits) if math.isfinite(value) else None

    def safe_sma(period: int) -> float | None:
        value = float(sma(feat["close"], period)[-1])
        return round(value, 2) if math.isfinite(value) else None

    rets = _log_returns(candles)
    return {
        "symbol": resolved,
        "name": lookup(resolved)["name"],
        "close": round(close, 2),
        "sma20": safe_sma(20), "sma50": safe_sma(50), "sma200": safe_sma(200),
        "ema20": safe("ema20"), "ema50": safe("ema50"),
        "rsi": safe("rsi", 1), "macd": safe("macd", 3), "macd_signal": safe("macd_signal", 3), "macd_hist": safe("macd_hist", 3),
        "adx": safe("adx", 1), "atr": safe("atr"), "atr_pct": round(float(feat["atr"][-1]) / close * 100.0, 2) if close else None,
        "bb_upper": safe("bb_upper"), "bb_mid": safe("bb_mid"), "bb_lower": safe("bb_lower"),
        "support_20": safe("low20"), "resistance_20": safe("high20"),
        "vwap": safe("vwap"),
        "realised_vol_pct": round(float(np.std(rets, ddof=1) * math.sqrt(252) * 100.0), 2) if rets.size > 5 else None,
        "period": period,
        "candles": len(candles),
    }


def universe_sectors() -> list[dict[str, Any]]:
    sectors: dict[str, list[str]] = {}
    for symbol, meta in INSTRUMENTS.items():
        sectors.setdefault(meta["sector"], []).append(symbol)
    return sorted(
        [{"sector": name, "count": len(members), "symbols": sorted(members)[:12]} for name, members in sectors.items()],
        key=lambda row: row["count"], reverse=True,
    )


def clamp_symbols(symbols: Iterable[str], limit: int) -> list[str]:
    seen: list[str] = []
    for raw in symbols:
        resolved = normalize_symbol(str(raw))
        if resolved not in seen:
            seen.append(resolved)
        if len(seen) >= limit:
            break
    return seen