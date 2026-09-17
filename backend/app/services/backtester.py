"""Leakage-free strategy backtester.

Signals computed at the end of bar *i* are executed at the open of bar *i+1*
(exactly how a live trader would act). A volatility-based stop is applied
intrabar. Deterministic metrics are derived from the resulting equity curve and
trade log.
"""
from __future__ import annotations

import math
from typing import Any
import numpy as np
from app.services.indicators import atr
from app.services.strategies import DEFAULT_STRATEGY, apply_strategy

INTERVAL_ANNUALIZATION = {"1m": 252 * 375, "5m": 252 * 75, "15m": 252 * 25, "1H": 252 * 6.5, "1D": 252}


def _run_engine(
    candles: list[dict],
    strategy_name: str,
    initial_capital: float,
    cost_pct: float,
    atr_mult: float,
    interval: str,
) -> dict[str, Any]:
    signal, _ = apply_strategy(strategy_name, candles)
    atr_series = atr(candles)
    opens = np.asarray([c["open"] for c in candles])
    n = len(candles)

    cost_bps = cost_pct / 100.0
    equity = initial_capital
    position = 0
    entry_price = 0.0
    entry_index = 0
    entry_stop = None
    trades: list[dict] = []

    def close_trade(exit_idx: int, exit_price: float, reason: str, direction: int) -> None:
        nonlocal equity
        gross = (exit_price - entry_price) / entry_price if direction == 1 else (entry_price - exit_price) / entry_price
        pnl = equity * gross
        fee = 2.0 * cost_bps * initial_capital
        equity += pnl - fee
        risk_units = abs(entry_price - entry_stop) / entry_price if entry_stop else 0.0
        trades.append({
            "entry_time": candles[entry_index]["time"],
            "entry_price": round(entry_price, 2),
            "exit_time": candles[exit_idx]["time"],
            "exit_price": round(exit_price, 2),
            "direction": "LONG" if direction == 1 else "SHORT",
            "reason": reason,
            "pnl_pct": round(((pnl - fee) / initial_capital) * 100.0, 3),
            "return_pct": round(gross * 100.0, 3),
            "bars_held": exit_idx - entry_index,
            "risk_at_entry_pct": round(risk_units * 100.0, 2),
            "rr_achieved": round(gross / risk_units, 2) if risk_units > 0 else 0.0,
            "equity_after": round(equity, 2),
        })

    for i in range(1, n - 1):
        sig = int(signal[i]) if not np.isnan(signal[i]) else 0
        if position != 0 and entry_stop is not None:
            ex = _execution_price(candles[i], position, entry_stop)
            if ex["stopped"]:
                close_trade(i, ex["price"], "stop", position)
                position, entry_stop = 0, None
        if position == 0 and sig != 0:
            position = sig
            entry_price, entry_index = float(opens[i + 1]), i + 1
            entry_stop = entry_price - atr_mult * atr_series[i] if position == 1 else entry_price + atr_mult * atr_series[i]
            if entry_stop is None or np.isnan(entry_stop):
                entry_stop = entry_price - 0.05 * entry_price if position == 1 else entry_price + 0.05 * entry_price
        elif position != 0 and sig != position:
            close_trade(i, float(opens[i + 1]), "signal", position)
            position, entry_stop = 0, None
            if sig != 0:
                position = sig
                entry_price, entry_index = float(opens[i + 1]), i + 1
                entry_stop = entry_price - atr_mult * atr_series[i] if position == 1 else entry_price + atr_mult * atr_series[i]
                if entry_stop is None or np.isnan(entry_stop):
                    entry_stop = entry_price - 0.05 * entry_price if position == 1 else entry_price + 0.05 * entry_price

    if position != 0:
        last = candles[-1]["close"]
        gross = (last - entry_price) / entry_price if position == 1 else (entry_price - last) / entry_price
        pnl = equity * gross
        fee = 2.0 * cost_bps * initial_capital
        equity += pnl - fee
        risk_units = abs(entry_price - entry_stop) / entry_price if entry_stop else 0.0
        trades.append({
            "entry_time": candles[entry_index]["time"],
            "entry_price": round(entry_price, 2),
            "exit_time": candles[-1]["time"],
            "exit_price": round(last, 2),
            "direction": "LONG" if position == 1 else "SHORT",
            "reason": "end_of_period",
            "pnl_pct": round(((pnl - fee) / initial_capital) * 100.0, 3),
            "return_pct": round(gross * 100.0, 3),
            "bars_held": n - 1 - entry_index,
            "risk_at_entry_pct": round(risk_units * 100.0, 2),
            "rr_achieved": 0.0,
            "equity_after": round(equity, 2),
        })

    # Per-bar equity curve: honour compounding by walking trades in time order
    # and crediting each exit's resulting equity to its exit bar.
    exits_by_bar: dict[Any, float] = {}
    for t in trades:
        exits_by_bar[t["exit_time"]] = t["equity_after"]
    mark = initial_capital
    bar_eq: list[float] = []
    for b in range(n):
        if candles[b]["time"] in exits_by_bar:
            mark = exits_by_bar[candles[b]["time"]]
        bar_eq.append(round(mark, 2))
    bar_eq[-1] = round(equity, 2)

    return {
        "equity_curve": bar_eq,
        "final_equity": equity,
        "trades_raw": trades,
    }


def run_backtest(
    candles: list[dict],
    strategy_name: str = DEFAULT_STRATEGY,
    initial_capital: float = 100_000.0,
    cost_pct: float = 0.05,
    atr_mult: float = 2.0,
    interval: str = "1D",
    symbol: str = "",
) -> dict[str, Any]:
    if len(candles) < 60:
        return {"error": "Need at least 60 candles to backtest this strategy", "trades": 0}

    result = _run_engine(candles, strategy_name, initial_capital, cost_pct, atr_mult, interval)
    equity_curve = result["equity_curve"]
    trades = result["trades_raw"]
    final_equity = result["final_equity"]

    if not trades:
        return {
            "symbol": symbol, "strategy": strategy_name, "trades": 0, "win_rate": 0.0,
            "net_return": 0.0, "max_drawdown": 0.0, "sharpe": 0.0, "profit_factor": 0.0,
            "expectancy_pct": 0.0, "avg_win_pct": 0.0, "avg_loss_pct": 0.0,
            "final_equity": initial_capital, "equity_curve": equity_curve, "trade_log": [],
            "recent_40pct": {"trades": 0, "win_rate": 0.0, "net_return": 0.0, "max_drawdown": 0.0, "sharpe": 0.0},
            "warning": "No trades generated for this strategy on this data",
        }

    wins = [t for t in trades if t["pnl_pct"] > 0]
    losses = [t for t in trades if t["pnl_pct"] <= 0]
    win_rate = len(wins) / len(trades) * 100.0
    net_return = (final_equity / initial_capital - 1.0) * 100.0

    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        peak = max(peak, v)
        dd = (v / peak - 1.0) * 100.0 if peak else 0.0
        max_dd = min(max_dd, dd)

    bar_rets = []
    for b in range(1, len(equity_curve)):
        if equity_curve[b - 1] > 0:
            bar_rets.append(equity_curve[b] / equity_curve[b - 1] - 1.0)
    if len(bar_rets) > 1:
        std = float(np.std(bar_rets))
        ann = INTERVAL_ANNUALIZATION.get(interval, 252)
        sharpe = float(np.mean(bar_rets) / std * math.sqrt(ann)) if std > 0 else 0.0
    else:
        sharpe = 0.0

    gross_profit = sum(t["pnl_pct"] for t in wins)
    gross_loss = abs(sum(t["pnl_pct"] for t in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0.0)
    avg_win = float(np.mean([t["pnl_pct"] for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t["pnl_pct"] for t in losses])) if losses else 0.0
    expectancy = float(np.mean([t["pnl_pct"] for t in trades]))

    split = int(len(candles) * 0.6)
    recent_result = _run_engine(candles[split:], strategy_name, initial_capital, cost_pct, atr_mult, interval)
    recent_trades = recent_result["trades_raw"]
    recent_equity = recent_result["equity_curve"]
    recent_wins = [t for t in recent_trades if t["pnl_pct"] > 0]
    recent_dd = 0.0
    rpeak = recent_equity[0] if recent_equity else initial_capital
    for v in recent_equity:
        rpeak = max(rpeak, v)
        recent_dd = min(recent_dd, (v / rpeak - 1.0) * 100.0 if rpeak else 0.0)

    return {
        "symbol": symbol,
        "strategy": strategy_name,
        "trades": len(trades),
        "win_rate": round(win_rate, 1),
        "net_return": round(net_return, 2),
        "max_drawdown": round(max_dd, 2),
        "sharpe": round(sharpe, 2),
        "profit_factor": round(profit_factor, 2),
        "expectancy_pct": round(expectancy, 3),
        "avg_win_pct": round(avg_win, 3),
        "avg_loss_pct": round(avg_loss, 3),
        "final_equity": round(final_equity, 2),
        "equity_curve": equity_curve,
        "trade_log": trades,
        "recent_40pct": {
            "trades": len(recent_trades),
            "win_rate": round(len(recent_wins) / len(recent_trades) * 100.0, 1) if recent_trades else 0.0,
            "net_return": round((recent_equity[-1] / initial_capital - 1.0) * 100.0, 2) if recent_equity else 0.0,
            "max_drawdown": round(recent_dd, 2),
            "sharpe": 0.0,
        },
    }


def _execution_price(candle: dict, direction: int, stop: float | None) -> dict:
    o, h, l = candle["open"], candle["high"], candle["low"]
    if direction == 1 and stop is not None and l <= stop:
        return {"price": min(o, stop), "stopped": True}
    if direction == -1 and stop is not None and h >= stop:
        return {"price": max(o, stop), "stopped": True}
    return {"price": o, "stopped": False}