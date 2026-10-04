"""Rule-based trading strategies used by the backtester.

Each strategy maps the indicator feature set (see ``indicators.compute_features``)
to a per-bar signal array: ``+1`` (long), ``-1`` (short), ``0`` (flat). Signals
depend only on information available at that bar, so the backtest stays
leakage-free.

The catalog below is the same text the Strategy Lab and Backtesting screens
show, so the formula on screen is the formula that actually runs.
"""
from __future__ import annotations

from typing import Any, Callable
import numpy as np
from app.services.indicators import compute_features


INDICATOR_LIBRARY: dict[str, dict[str, str]] = {
    "RSI": {
        "equation": "RSI(14) = 100 − 100 / (1 + AvgGain / AvgLoss), Wilder smoothing",
        "bull": "45 ≤ RSI ≤ 70 (momentum up, not exhausted)",
        "bear": "30 ≤ RSI ≤ 55 (momentum down, not washed out)",
    },
    "MACD": {
        "equation": "MACD = EMA(12) − EMA(26); Signal = EMA(MACD, 9); Histogram = MACD − Signal",
        "bull": "MACD line above its signal line",
        "bear": "MACD line below its signal line",
    },
    "EMA": {
        "equation": "EMA_t = α · Close_t + (1 − α) · EMA_t−1, α = 2 / (N + 1)",
        "bull": "Close > EMA(20) and EMA(12) > EMA(26)",
        "bear": "Close < EMA(20) and EMA(12) < EMA(26)",
    },
    "VWAP": {
        "equation": "VWAP = Σ(Typical Price × Volume) / Σ Volume, Typical Price = (H + L + C) / 3, reset each day",
        "bull": "Close above VWAP",
        "bear": "Close below VWAP",
    },
    "Bollinger": {
        "equation": "Middle = SMA(20); Upper/Lower = Middle ± 2 × σ",
        "bull": "Close above the middle band and still under the upper band",
        "bear": "Close below the middle band and still above the lower band",
    },
    "ADX": {
        "equation": "DX = 100 × |+DI − −DI| / (+DI + −DI); ADX = Wilder smooth of DX, period 14",
        "bull": "ADX > 20 and +DI > −DI",
        "bear": "ADX > 20 and −DI > +DI",
    },
    "ATR": {
        "equation": "True Range = max(H−L, |H−prev close|, |L−prev close|); ATR(14) = Wilder smooth of True Range",
        "bull": "Does not vote. Sets the stop distance: entry ∓ ATR multiple",
        "bear": "Does not vote. Sets the stop distance: entry ∓ ATR multiple",
    },
}


def _finite(value: float) -> bool:
    return value == value and abs(value) != float("inf")


def ma_crossover(feat: dict[str, np.ndarray]) -> np.ndarray:
    """Hold a trend only while the 12/26 EMA stack agrees with the 50 EMA filter."""
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    ema_fast = feat["ema12"]
    ema_slow = feat["ema26"]
    ema_trend = feat["ema50"]
    state = 0
    for i in range(1, len(close)):
        if not (_finite(ema_fast[i]) and _finite(ema_slow[i]) and _finite(ema_trend[i])):
            signal[i] = 0
            state = 0
            continue
        crossed_up = ema_fast[i - 1] <= ema_slow[i - 1] and ema_fast[i] > ema_slow[i]
        crossed_dn = ema_fast[i - 1] >= ema_slow[i - 1] and ema_fast[i] < ema_slow[i]
        if crossed_up and close[i] > ema_trend[i]:
            state = 1
        elif crossed_dn and close[i] < ema_trend[i]:
            state = -1
        elif state == 1 and ema_fast[i] < ema_slow[i]:
            state = 0
        elif state == -1 and ema_fast[i] > ema_slow[i]:
            state = 0
        signal[i] = state
    return signal


def momentum(feat: dict[str, np.ndarray]) -> np.ndarray:
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    rsi = feat["rsi"]
    mom10 = feat["momentum10"]
    ema20 = feat["ema20"]
    for i in range(len(close)):
        if not (_finite(mom10[i]) and _finite(rsi[i]) and _finite(ema20[i])):
            continue
        if mom10[i] > 0.004 and 40 < rsi[i] < 68 and close[i] > ema20[i]:
            signal[i] = 1
        elif mom10[i] < -0.004 and 32 < rsi[i] < 60 and close[i] < ema20[i]:
            signal[i] = -1
    return signal


def mean_reversion(feat: dict[str, np.ndarray]) -> np.ndarray:
    """Enter on a stretch, exit when RSI mean-reverts through the midline."""
    close = feat["close"]
    signal = np.zeros(len(close), dtype=int)
    rsi = feat["rsi"]
    lower = feat["bb_lower"]
    upper = feat["bb_upper"]
    state = 0
    for i in range(len(close)):
        if not _finite(rsi[i]):
            signal[i] = state
            continue
        stretched_long = rsi[i] < 32 or (_finite(lower[i]) and close[i] < lower[i])
        stretched_short = rsi[i] > 68 or (_finite(upper[i]) and close[i] > upper[i])
        if state == 0 and stretched_long and not stretched_short:
            state = 1
        elif state == 0 and stretched_short and not stretched_long:
            state = -1
        elif state == 1 and rsi[i] > 52:
            state = 0
        elif state == -1 and rsi[i] < 48:
            state = 0
        signal[i] = state
    return signal


def breakout(feat: dict[str, np.ndarray]) -> np.ndarray:
    """Break of the prior 20-bar channel on a volume surge. Hold for 8 bars."""
    close = feat["close"]
    volume = feat["volume"]
    signal = np.zeros(len(close), dtype=int)
    hi20 = feat["high20"]
    lo20 = feat["low20"]
    n = len(close)
    vol_ma = np.full(n, np.nan)
    for i in range(20, n):
        window = volume[i - 20:i]
        if np.any(window > 0):
            vol_ma[i] = float(np.mean(window))
    state = 0
    expiry = -1
    for i in range(1, n):
        fired = 0
        if _finite(hi20[i - 1]) and _finite(lo20[i - 1]) and _finite(vol_ma[i]) and vol_ma[i] > 0:
            hot = volume[i] > 1.15 * vol_ma[i]
            if close[i] > hi20[i - 1] and hot:
                fired = 1
            elif close[i] < lo20[i - 1] and hot:
                fired = -1
        if fired:
            state = fired
            expiry = i + 8
        if state and i <= expiry:
            signal[i] = state
        else:
            state = 0
    return signal


def confluence(feat: dict[str, np.ndarray], indicators: list[str] | None = None) -> np.ndarray:
    """Long or short when a majority of the selected indicators agree. ATR never votes."""
    close = feat["close"]
    n = len(close)
    signal = np.zeros(n, dtype=int)
    chosen = [name for name in (indicators or ["RSI", "MACD", "EMA"]) if name in INDICATOR_LIBRARY and name != "ATR"]
    if not chosen:
        chosen = ["RSI", "MACD", "EMA"]
    rsi = feat["rsi"]
    macd_line = feat["macd"]
    macd_sig = feat["macd_signal"]
    ema12 = feat["ema12"]
    ema20 = feat["ema20"]
    ema26 = feat["ema26"]
    vwap = feat["vwap"]
    mid = feat["bb_mid"]
    upper = feat["bb_upper"]
    lower = feat["bb_lower"]
    adx = feat["adx"]
    plus_di = feat["plus_di"]
    minus_di = feat["minus_di"]

    for i in range(n):
        bull = bear = active = 0

        def vote(is_bull: bool, is_bear: bool) -> None:
            nonlocal bull, bear, active
            active += 1
            if is_bull and not is_bear:
                bull += 1
            elif is_bear and not is_bull:
                bear += 1

        if "RSI" in chosen and _finite(rsi[i]):
            vote(45 <= rsi[i] <= 70, 30 <= rsi[i] <= 55)
        if "MACD" in chosen and _finite(macd_line[i]) and _finite(macd_sig[i]):
            vote(macd_line[i] > macd_sig[i], macd_line[i] < macd_sig[i])
        if "EMA" in chosen and _finite(ema12[i]) and _finite(ema20[i]) and _finite(ema26[i]):
            vote(close[i] > ema20[i] and ema12[i] > ema26[i], close[i] < ema20[i] and ema12[i] < ema26[i])
        if "VWAP" in chosen and _finite(vwap[i]):
            vote(close[i] > vwap[i], close[i] < vwap[i])
        if "Bollinger" in chosen and _finite(mid[i]) and _finite(upper[i]) and _finite(lower[i]):
            vote(mid[i] < close[i] < upper[i], lower[i] < close[i] < mid[i])
        if "ADX" in chosen and _finite(adx[i]) and _finite(plus_di[i]) and _finite(minus_di[i]):
            vote(adx[i] > 20 and plus_di[i] > minus_di[i], adx[i] > 20 and minus_di[i] > plus_di[i])
        if active == 0:
            continue
        need = max(1, (active + 1) // 2)
        if bull >= need and bull > bear:
            signal[i] = 1
        elif bear >= need and bear > bull:
            signal[i] = -1
    return signal


def _custom(feat: dict[str, np.ndarray]) -> np.ndarray:
    return confluence(feat, ["RSI", "MACD", "EMA"])


STRATEGIES: dict[str, Callable[[dict[str, np.ndarray]], np.ndarray]] = {
    "Moving Average Crossover": ma_crossover,
    "Momentum": momentum,
    "Mean Reversion": mean_reversion,
    "Breakout": breakout,
    "Custom Confluence": _custom,
}

DEFAULT_STRATEGY = "Moving Average Crossover"

CATALOG: dict[str, dict[str, Any]] = {
    "Moving Average Crossover": {
        "name": "Moving Average Crossover",
        "summary": "Trade the turn in the 12/26 EMA stack, but only in the direction of the 50-day trend.",
        "formula": "Long when EMA(12) crosses above EMA(26) and Close > EMA(50). Short on the opposite cross with Close < EMA(50). Flat once the 12/26 stack flips back.",
        "equations": [
            INDICATOR_LIBRARY["EMA"]["equation"],
            "Fast = EMA(Close, 12), Slow = EMA(Close, 26), Trend = EMA(Close, 50)",
            "Cross up: Fast_t−1 ≤ Slow_t−1 and Fast_t > Slow_t",
        ],
        "uses": ["EMA 12", "EMA 26", "EMA 50"],
        "best_for": "Swing and positional trend changes",
    },
    "Momentum": {
        "name": "Momentum",
        "summary": "Stay with a move only while 10-bar momentum, RSI and the 20-day EMA agree.",
        "formula": "Long when 10-bar momentum > 0.4%, RSI is between 40 and 68, and Close > EMA(20). Short on the mirror image. Flat on any bar that fails the test.",
        "equations": [
            "Momentum(10) = Close_t / Close_t−10 − 1",
            INDICATOR_LIBRARY["RSI"]["equation"],
            "Long: Momentum(10) > 0.004 and 40 < RSI < 68 and Close > EMA(20)",
        ],
        "uses": ["Momentum 10", "RSI 14", "EMA 20"],
        "best_for": "Riding a push that is not yet stretched",
    },
    "Mean Reversion": {
        "name": "Mean Reversion",
        "summary": "Buy a washed-out bar and sell a stretched bar, then exit when RSI comes back through the middle.",
        "formula": "Long when RSI < 32 or Close falls through the lower Bollinger band. Short when RSI > 68 or Close breaks the upper band. Exit a long above RSI 52 and a short below RSI 48.",
        "equations": [
            INDICATOR_LIBRARY["RSI"]["equation"],
            INDICATOR_LIBRARY["Bollinger"]["equation"],
            "Exit long when RSI crosses back above 52; exit short when RSI crosses back below 48",
        ],
        "uses": ["RSI 14", "Bollinger 20, 2σ"],
        "best_for": "Fading short-term stretches",
    },
    "Breakout": {
        "name": "Breakout",
        "summary": "Enter when price leaves the prior 20-bar channel on a volume surge, and hold the burst for 8 bars.",
        "formula": "Long when Close > prior 20-bar high and today's volume > 1.15 × the previous 20-bar average volume. Short through the prior 20-bar low on the same volume test. The signal lasts 8 bars.",
        "equations": [
            "Channel high_t−1 = max(High over the prior 20 bars), not including today",
            "Volume average uses the prior 20 bars only, so today's spike is not in the baseline",
            "Hold = 8 trading days after the break",
        ],
        "uses": ["20-bar high", "20-bar low", "20-bar average volume"],
        "best_for": "Catching a range break with participation",
    },
    "Custom Confluence": {
        "name": "Custom Confluence",
        "summary": "Your indicator chips vote. A majority has to agree before the strategy takes a side.",
        "formula": "Each selected indicator casts a bullish or bearish vote from the rules below. Long when bullish votes are a majority. Short when bearish votes are a majority. ATR sets the stop and does not vote.",
        "equations": [],
        "uses": ["Indicators you select"],
        "best_for": "A rule you assemble yourself in the Strategy Lab",
    },
}


def describe_strategy(name: str, indicators: list[str] | None = None) -> dict[str, Any]:
    """Formula card for one strategy. Custom confluence lists the chips that vote."""
    key = name if name in CATALOG else DEFAULT_STRATEGY
    card = {
        "name": CATALOG[key]["name"],
        "summary": CATALOG[key]["summary"],
        "formula": CATALOG[key]["formula"],
        "equations": list(CATALOG[key]["equations"]),
        "uses": list(CATALOG[key]["uses"]),
        "best_for": CATALOG[key]["best_for"],
    }
    if key == "Custom Confluence":
        chosen = [item for item in (indicators or ["RSI", "MACD", "EMA"]) if item in INDICATOR_LIBRARY]
        if not chosen:
            chosen = ["RSI", "MACD", "EMA"]
        card["uses"] = chosen
        card["equations"] = [
            f"{item}: {INDICATOR_LIBRARY[item]['equation']} → bull when {INDICATOR_LIBRARY[item]['bull']}; bear when {INDICATOR_LIBRARY[item]['bear']}"
            for item in chosen
        ]
        card["formula"] = (
            "Majority vote of " + ", ".join(chosen) + ". "
            "Long when bullish votes beat bearish votes and clear half the ballots. "
            "ATR, when selected, only widens or tightens the stop."
        )
    return card


def strategy_catalog(indicators: list[str] | None = None) -> list[dict[str, Any]]:
    return [describe_strategy(name, indicators) for name in STRATEGIES]


def execution_notes(atr_mult: float, cost_pct: float) -> dict[str, str]:
    return {
        "signal": "A signal is known only after that bar closes. Nothing from the next bar is used.",
        "fill": "The order is filled at the open of the next bar.",
        "stop": f"Stop = entry ∓ {atr_mult:.2f} × ATR(14). If ATR is not ready yet, the stop falls back to 5% from entry.",
        "cost": f"Round-trip cost is {cost_pct:.2f}% of the position (charged on the way in and the way out).",
        "return": "Trade return = price change / entry, after that cost.",
        "drawdown": "Max drawdown = the deepest peak-to-trough fall of the equity curve.",
        "sharpe": "Sharpe = mean(daily equity return) / std(daily equity return) × √252.",
        "profit_factor": "Profit factor = sum of winning trade % / |sum of losing trade %|.",
        "holdout": "The recent 40% block is re-run on its own, so you can see if the edge survived the later window.",
    }


def research_stages(
    *,
    symbol_meta: dict[str, Any],
    period: str,
    candle_count: int,
    strategy_name: str,
    indicators: list[str],
    readings: list[dict[str, Any]],
    backtest: dict[str, Any],
    style: str,
    risk_level: str,
    atr_mult: float,
    cost_pct: float,
) -> list[dict[str, str]]:
    universes = ", ".join(symbol_meta.get("universes") or [])
    reading_text = ", ".join(f"{row['label']} {row['value']}" for row in readings[:6]) or "warming up"
    trades = backtest.get("trades", 0)
    if backtest.get("error"):
        score = backtest["error"]
    elif trades:
        score = (
            f"{trades} trades, win rate {backtest.get('win_rate')}%, "
            f"net {backtest.get('net_return')}%, max drawdown {backtest.get('max_drawdown')}%, "
            f"Sharpe {backtest.get('sharpe')}"
        )
    else:
        score = backtest.get("warning") or "No trades fired on this window."
    return [
        {
            "step": "1",
            "name": "Resolve the symbol",
            "detail": f"{symbol_meta.get('symbol')} · {symbol_meta.get('name')} · {symbol_meta.get('sector')} · {universes}",
        },
        {
            "step": "2",
            "name": "Build the test window",
            "detail": f"{period} · {candle_count} weekday daily candles. Style {style} changes the stop and the cost, not the candle size, so the window really is that long.",
        },
        {
            "step": "3",
            "name": "Compute the indicators",
            "detail": reading_text,
        },
        {
            "step": "4",
            "name": "Turn readings into a signal",
            "detail": describe_strategy(strategy_name, indicators)["formula"],
        },
        {
            "step": "5",
            "name": "Fill, stop, and charge cost",
            "detail": (
                f"Risk profile {risk_level}. Fill at the next bar's open. "
                f"Stop is {atr_mult:.2f} × ATR(14). Round-trip cost {cost_pct:.2f}%."
            ),
        },
        {
            "step": "6",
            "name": "Score the equity curve",
            "detail": score,
        },
    ]


def apply_strategy(
    strategy_name: str,
    candles: list[dict],
    indicators: list[str] | None = None,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Compute the feature set and signal array for a named strategy."""
    if strategy_name not in STRATEGIES:
        strategy_name = DEFAULT_STRATEGY
    feat = compute_features(candles)
    if strategy_name == "Custom Confluence":
        signal = confluence(feat, indicators)
    else:
        signal = STRATEGIES[strategy_name](feat)
    return signal, feat
