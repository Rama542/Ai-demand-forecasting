"""Leakage-free strategy backtester with mark-to-market accounting.

Signals computed at the close of bar *i* are executed at the open of bar *i+1*,
exactly how a live trader would act. The open position is revalued on every
single bar, so the equity curve is a true mark-to-market curve instead of a
staircase that only moves when a trade closes. A volatility-based stop is
applied intrabar, and a round-trip cost is charged once per completed position.

Every headline metric (return, CAGR, drawdown, Sharpe, Sortino, Calmar, profit
factor, expectancy, exposure) is derived from that same mark-to-market series,
so the numbers in the report always agree with the curve that is plotted.
"""
from __future__ import annotations

import math
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.services.indicators import atr
from app.services.strategies import DEFAULT_STRATEGY, apply_strategy

INTERVAL_ANNUALIZATION = {"1m": 252 * 375, "5m": 252 * 75, "15m": 252 * 25, "1H": 252 * 6.5, "1D": 252}
SECONDS_PER_YEAR = 365.25 * 24 * 3600
MIN_CANDLES = 60


# ──────────────────────────────────────────────────────────────────────────
# Series maths
# ──────────────────────────────────────────────────────────────────────────
def _bar_returns(equity: list[float]) -> np.ndarray:
    """Mark-to-market simple returns for every bar (flat bars are true zeros)."""
    series = np.asarray(equity, dtype=float)
    if series.size < 2:
        return np.zeros(0, dtype=float)
    prev = series[:-1]
    safe = np.where(prev != 0, prev, np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        rets = series[1:] / safe - 1.0
    return np.nan_to_num(rets, nan=0.0, posinf=0.0, neginf=0.0)


def _sharpe(equity: list[float], interval: str) -> float:
    rets = _bar_returns(equity)
    if rets.size < 2:
        return 0.0
    std = float(np.std(rets, ddof=1)) if rets.size > 1 else 0.0
    if std <= 0:
        return 0.0
    ann = INTERVAL_ANNUALIZATION.get(interval, 252)
    return float(np.mean(rets) / std * math.sqrt(ann))


def _sortino(equity: list[float], interval: str) -> float:
    """Return per unit of downside deviation rather than total deviation."""
    rets = _bar_returns(equity)
    if rets.size < 2:
        return 0.0
    downside = rets[rets < 0]
    if downside.size < 2:
        return 0.0
    dd = float(np.sqrt(np.mean(np.square(downside))))
    if dd <= 0:
        return 0.0
    ann = INTERVAL_ANNUALIZATION.get(interval, 252)
    return float(np.mean(rets) / dd * math.sqrt(ann))


def _drawdown_series(equity: list[float]) -> list[float]:
    """Percent below the running peak, for every bar."""
    series = np.asarray(equity, dtype=float)
    out: list[float] = []
    peak = float(series[0]) if series.size else 0.0
    for value in series:
        peak = max(peak, float(value))
        out.append(round((float(value) / peak - 1.0) * 100.0, 4) if peak else 0.0)
    return out


def _max_drawdown(equity: list[float]) -> float:
    series = _drawdown_series(equity)
    return min(series) if series else 0.0


def _cagr(initial: float, final: float, years: float) -> float | None:
    if initial <= 0 or final <= 0 or years <= 0:
        return None
    return ((final / initial) ** (1.0 / years) - 1.0) * 100.0


def _calendar_years(candles: list[dict], interval: str) -> float:
    """Real elapsed time when timestamps exist, otherwise the annualised bar count."""
    if len(candles) >= 2:
        span = float(candles[-1]["time"]) - float(candles[0]["time"])
        if span > 0:
            return span / SECONDS_PER_YEAR
    per_year = INTERVAL_ANNUALIZATION.get(interval, 252)
    return len(candles) / per_year if per_year else 0.0


def _monthly_returns(points: list[dict]) -> list[dict]:
    """Compound each calendar month from the mark-to-market curve."""
    if len(points) < 2:
        return []
    buckets: "OrderedDict[tuple[int, int], dict[str, float]]" = OrderedDict()
    for point in points:
        stamp = datetime.fromtimestamp(float(point["time"]), tz=timezone.utc)
        key = (stamp.year, stamp.month)
        if key not in buckets:
            buckets[key] = {"start": float(point["equity"]), "end": float(point["equity"]), "label": stamp.strftime("%b %Y")}
        buckets[key]["end"] = float(point["equity"])
    rows: list[dict] = []
    for (year, month), bucket in buckets.items():
        base = bucket["start"]
        ret = ((bucket["end"] / base - 1.0) * 100.0) if base > 0 else 0.0
        rows.append({
            "period": bucket["label"], "year": year, "month": month,
            "return_pct": round(ret, 2),
        })
    return rows


def _best_worst(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    return max(values), min(values)


# ──────────────────────────────────────────────────────────────────────────
# Engine
# ──────────────────────────────────────────────────────────────────────────
def _run_engine(
    candles: list[dict],
    strategy_name: str,
    initial_capital: float,
    cost_pct: float,
    atr_mult: float,
    interval: str,
    indicators: list[str] | None = None,
) -> dict[str, Any]:
    """Single pass: execute pending orders at the open, check stops, mark to market."""
    signal, _ = apply_strategy(strategy_name, candles, indicators)
    atr_series = atr(candles)
    n = len(candles)
    cost_bps = max(0.0, cost_pct) / 100.0

    cash = float(initial_capital)
    position = 0
    pending: int | None = None
    entry_price = 0.0
    entry_equity = float(initial_capital)
    entry_index = -1
    entry_stop: float | None = None
    mae = 0.0
    bars_in_market = 0
    trades: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []

    def stop_for(direction: int, fill_price: float, signal_index: int) -> float:
        reference = float(atr_series[signal_index]) if 0 <= signal_index < len(atr_series) else float("nan")
        if not math.isfinite(reference) or reference <= 0:
            reference = fill_price * 0.05
        distance = atr_mult * reference
        return fill_price - distance if direction == 1 else fill_price + distance

    def close(index: int, price: float, reason: str, held_bars: int) -> None:
        nonlocal cash, position, entry_stop
        gross = (price - entry_price) / entry_price if position == 1 else (entry_price - price) / entry_price
        pnl = entry_equity * gross
        fee = cost_bps * entry_equity
        cash = entry_equity + pnl - fee
        risk_units = abs(entry_price - entry_stop) / entry_price if entry_stop else 0.0
        trades.append({
            "entry_time": candles[entry_index]["time"],
            "entry_price": round(entry_price, 2),
            "exit_time": candles[index]["time"],
            "exit_price": round(price, 2),
            "direction": "LONG" if position == 1 else "SHORT",
            "reason": reason,
            "pnl_pct": round(((pnl - fee) / entry_equity) * 100.0, 3) if entry_equity else 0.0,
            "pnl_amount": round(pnl - fee, 2),
            "return_pct": round(gross * 100.0, 3),
            "bars_held": held_bars,
            "risk_at_entry_pct": round(risk_units * 100.0, 2),
            "rr_achieved": round(gross / risk_units, 2) if risk_units > 0 else 0.0,
            "mae_pct": round(mae * 100.0, 2),
            "equity_after": round(cash, 2),
        })
        position, entry_stop = 0, None

    for i in range(n):
        candle = candles[i]
        o, h, low, cl = float(candle["open"]), float(candle["high"]), float(candle["low"]), float(candle["close"])

        # 1 ─ execute the order decided at the previous close, at this bar's open
        if pending is not None and pending != position:
            if position != 0:
                close(i, o, "signal" if pending != 0 else "signal_flat", i - entry_index)
            if pending != 0:
                position = pending
                entry_price = o
                entry_equity = cash
                entry_index = i
                mae = 0.0
                entry_stop = stop_for(position, o, i - 1)
            pending = None

        # 2 ─ intrabar volatility stop (a gap fills at the open, not the stop)
        if position != 0 and entry_stop is not None:
            hit = (position == 1 and low <= entry_stop) or (position == -1 and h >= entry_stop)
            if hit:
                fill = min(o, entry_stop) if position == 1 else max(o, entry_stop)
                close(i, fill, "stop", i - entry_index)

        # 3 ─ mark to market at this bar's close
        if position != 0:
            unreal = entry_equity * (cl / entry_price - 1.0) if position == 1 else entry_equity * (entry_price / cl - 1.0)
            equity = cash + unreal
            excursion = (low / entry_price - 1.0) if position == 1 else (entry_price / h - 1.0)
            mae = min(mae, excursion)
            bars_in_market += 1
        else:
            equity = cash
        points.append({
            "time": int(candle["time"]),
            "equity": round(equity, 2),
            "position": "LONG" if position == 1 else "SHORT" if position == -1 else "FLAT",
        })

        # 4 ─ read the finished bar's signal and schedule next-bar execution
        if i < n - 1:
            raw = signal[i]
            sig = int(raw) if not np.isnan(raw) else 0
            if sig != position:
                pending = sig

    if position != 0:
        close(n - 1, float(candles[-1]["close"]), "end_of_period", n - 1 - entry_index)
        points[-1]["equity"] = round(cash, 2)
        points[-1]["position"] = "FLAT"

    values = [p["equity"] for p in points]
    return {
        "points": points,
        "equity_curve": values,
        "final_equity": values[-1] if values else float(initial_capital),
        "trades_raw": trades,
        "bars_in_market": bars_in_market,
        "bars_total": n,
    }


def _summarise(
    candles: list[dict],
    engine: dict[str, Any],
    trades: list[dict],
    initial_capital: float,
    interval: str,
    cost_pct: float,
    atr_mult: float,
    strategy_name: str,
    symbol: str,
) -> dict[str, Any]:
    points = engine["points"]
    values = engine["equity_curve"]
    final_equity = engine["final_equity"]

    net_return = ((final_equity / initial_capital) - 1.0) * 100.0 if initial_capital else 0.0
    years = _calendar_years(candles, interval)
    cagr = _cagr(initial_capital, final_equity, years)
    drawdowns = _drawdown_series(values)
    max_dd = min(drawdowns) if drawdowns else 0.0

    wins = [t for t in trades if t["pnl_amount"] > 0]
    losses = [t for t in trades if t["pnl_amount"] <= 0]
    gross_profit = sum(t["pnl_amount"] for t in wins)
    gross_loss = abs(sum(t["pnl_amount"] for t in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0.0)
    avg_win = float(np.mean([t["pnl_pct"] for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t["pnl_pct"] for t in losses])) if losses else 0.0

    first_open = float(candles[0]["open"])
    last_close = float(candles[-1]["close"])
    buy_hold = ((last_close / first_open) - 1.0) * 100.0 if first_open else 0.0

    best_trade, worst_trade = _best_worst([t["pnl_pct"] for t in trades])
    long_trades = sum(1 for t in trades if t["direction"] == "LONG")
    sharpe = _sharpe(values, interval)
    cagr_value = cagr if cagr is not None else net_return
    exposure = (engine["bars_in_market"] / engine["bars_total"] * 100.0) if engine["bars_total"] else 0.0
    recovery = (100.0 / abs(max_dd) - 1.0) * 100.0 if max_dd < 0 else 0.0

    return {
        "symbol": symbol,
        "strategy": strategy_name,
        "interval": interval,
        "trades": len(trades),
        "long_trades": long_trades,
        "short_trades": len(trades) - long_trades,
        "win_rate": round(len(wins) / len(trades) * 100.0, 1) if trades else 0.0,
        "net_return": round(net_return, 2),
        "return_pct": round(net_return, 2),
        "cagr": round(cagr_value, 2) if cagr is not None else None,
        "max_drawdown": round(max_dd, 2),
        "drawdown_days": sum(1 for d in drawdowns if d < -0.01),
        "recovery_to_peak_pct": round(recovery, 1) if recovery else 0.0,
        "sharpe": round(sharpe, 2),
        "sortino": round(_sortino(values, interval), 2),
        "calmar": round(cagr_value / abs(max_dd), 2) if max_dd < -0.01 else None,
        "profit_factor": round(profit_factor, 2),
        "expectancy_pct": round(float(np.mean([t["pnl_pct"] for t in trades])), 3) if trades else 0.0,
        "avg_win_pct": round(avg_win, 3),
        "avg_loss_pct": round(avg_loss, 3),
        "payoff_ratio": round(avg_win / abs(avg_loss), 2) if avg_loss else (avg_win if avg_win else 0.0),
        "avg_bars_held": round(float(np.mean([t["bars_held"] for t in trades])), 1) if trades else 0.0,
        "avg_mae_pct": round(float(np.mean([abs(t["mae_pct"]) for t in trades])), 2) if trades else 0.0,
        "best_trade_pct": best_trade,
        "worst_trade_pct": worst_trade,
        "exposure_pct": round(exposure, 1),
        "buy_hold_return": round(buy_hold, 2),
        "alpha_vs_buy_hold": round(net_return - buy_hold, 2),
        "final_equity": round(final_equity, 2),
        "initial_capital": round(initial_capital, 2),
        "net_profit": round(final_equity - initial_capital, 2),
        "total_costs_pct": round(cost_pct, 3),
        "atr_mult": round(atr_mult, 2),
        "total_return_multiple": round(final_equity / initial_capital, 3) if initial_capital else 1.0,
        "equity_curve": values,
        "equity_points": points,
        "drawdown_series": drawdowns,
        "monthly_returns": _monthly_returns(points),
        "trade_log": trades,
        "period_start": int(candles[0]["time"]),
        "period_end": int(candles[-1]["time"]),
    }


def _empty_result(symbol: str, strategy_name: str, initial_capital: float, interval: str, warning: str) -> dict[str, Any]:
    return {
        "symbol": symbol, "strategy": strategy_name, "interval": interval, "trades": 0,
        "long_trades": 0, "short_trades": 0, "win_rate": 0.0, "net_return": 0.0, "return_pct": 0.0,
        "cagr": None, "max_drawdown": 0.0, "drawdown_days": 0, "recovery_to_peak_pct": 0.0,
        "sharpe": 0.0, "sortino": 0.0, "calmar": None, "profit_factor": 0.0,
        "expectancy_pct": 0.0, "avg_win_pct": 0.0, "avg_loss_pct": 0.0, "payoff_ratio": 0.0,
        "avg_bars_held": 0.0, "avg_mae_pct": 0.0, "best_trade_pct": None, "worst_trade_pct": None,
        "exposure_pct": 0.0, "buy_hold_return": 0.0, "alpha_vs_buy_hold": 0.0,
        "final_equity": round(initial_capital, 2), "initial_capital": round(initial_capital, 2),
        "net_profit": 0.0, "total_costs_pct": 0.0, "atr_mult": 0.0, "total_return_multiple": 1.0,
        "equity_curve": [round(initial_capital, 2)], "equity_points": [], "drawdown_series": [0.0],
        "monthly_returns": [], "trade_log": [], "warning": warning,
    }


def run_backtest(
    candles: list[dict],
    strategy_name: str = DEFAULT_STRATEGY,
    initial_capital: float = 100_000.0,
    cost_pct: float = 0.05,
    atr_mult: float = 2.0,
    interval: str = "1D",
    symbol: str = "",
    indicators: list[str] | None = None,
) -> dict[str, Any]:
    if len(candles) < MIN_CANDLES:
        return {
            "error": f"Need at least {MIN_CANDLES} candles to backtest this strategy, got {len(candles)}.",
            "trades": 0, "symbol": symbol, "strategy": strategy_name, "interval": interval,
        }

    engine = _run_engine(candles, strategy_name, initial_capital, cost_pct, atr_mult, interval, indicators)
    trades = engine["trades_raw"]
    if not trades:
        result = _empty_result(
            symbol, strategy_name, initial_capital, interval,
            "No trades were generated: this strategy never triggered on this symbol and window. "
            "Try a different strategy, a longer window, or a different symbol.",
        )
        return result

    report = _summarise(candles, engine, trades, initial_capital, interval, cost_pct, atr_mult, strategy_name, symbol)

    # Re-run the most recent 40% on its own so the report shows whether the edge held up late.
    split = max(MIN_CANDLES, int(len(candles) * 0.6))
    tail = _run_engine(candles[split:], strategy_name, initial_capital, cost_pct, atr_mult, interval, indicators)
    tail_values = tail["equity_curve"]
    tail_trades = tail["trades_raw"]
    tail_wins = [t for t in tail_trades if t["pnl_amount"] > 0]
    report["recent_40pct"] = {
        "trades": len(tail_trades),
        "win_rate": round(len(tail_wins) / len(tail_trades) * 100.0, 1) if tail_trades else 0.0,
        "net_return": round(((tail_values[-1] / initial_capital) - 1.0) * 100.0, 2) if tail_values else 0.0,
        "max_drawdown": round(_max_drawdown(tail_values), 2),
        "sharpe": round(_sharpe(tail_values, interval), 2),
    }
    return report