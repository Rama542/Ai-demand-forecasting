"""MarketMind AI API.

Data path: market feed → candle engine → daily research history → feature
engineering → XGBoost → TreeSHAP → this API → the dashboard.

Provider adapters can be swapped via env config. Nothing in this module returns
invented market data: when a data source is unavailable the endpoint says so and
the UI renders an error or empty state instead.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import os
import time
from typing import Any
from urllib.error import URLError
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.services.market_data import (
    SYMBOLS, hub as market_hub, normalize_interval, normalize_symbol,
)
from app.services.backtester import run_backtest
from app.services.forecast import forecast_report
from app.services.recommendation import generate_recommendation, indicator_readings
from app.services.strategies import STRATEGIES, execution_notes, strategy_catalog
from app.services.analytics import (
    correlation_matrix, explain_prediction, market_condition, portfolio_analysis,
    technical_summary, universe_sectors,
)
from app.services.history import daily_history
from app.services.indicators import compute_features
from app.services.universe import list_instruments, list_universes, lookup

RESEARCH_INTERVAL = "1D"


@asynccontextmanager
async def lifespan(_: FastAPI):
    market_hub.start()
    try:
        yield
    finally:
        await market_hub.stop()


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip() and origin.strip() != "*"]
    return origins or ["http://localhost:3000"]


app = FastAPI(title="MarketMind AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────
# Small TTL cache — the ML and history endpoints are expensive but stable
# ──────────────────────────────────────────────────────────────────────────
_cache: dict[str, dict[str, Any]] = {}


def _cached(key: str, ttl: float, producer):
    now = time.time()
    entry = _cache.get(key)
    if entry and now - entry["ts"] < ttl:
        return entry["value"]
    value = producer()
    if len(_cache) > 96:
        for stale in sorted(_cache, key=lambda k: _cache[k]["ts"])[:32]:
            _cache.pop(stale, None)
    _cache[key] = {"ts": now, "value": value}
    return value


# ──────────────────────────────────────────────────────────────────────────
# Live feed plumbing
# ──────────────────────────────────────────────────────────────────────────
def _live_status() -> dict:
    """Whether the app is currently serving real prices, and how fresh they are."""
    provider = market_hub.live_provider
    healthy = bool(getattr(provider, "healthy", False)) if provider is not None else False
    last_sync = market_hub.last_live_sync
    age = round(time.time() - last_sync, 1) if last_sync else None
    return {
        "mode": market_hub.mode,
        "is_live": bool(market_hub.live_mode),
        "healthy": healthy,
        "last_sync": last_sync,
        "age_seconds": age,
        "source": ("upstox" if market_hub.mode == "upstox"
                   else "live" if market_hub.mode == "live" else "simulated"),
        "error": getattr(provider, "last_error", None),
    }


def _live_quote(symbol: str, interval: str = "1D", spark: bool = False) -> dict:
    """Current price, day change and session range straight off the market engine.

    When a live provider is running it also supplies the authoritative previous
    close, which the simulated engine seed cannot know. Falling back to the
    engine keeps the endpoint working with no provider at all.
    """
    interval = normalize_interval(interval)
    engine = market_hub.engine_for(symbol, interval)
    quote = engine.quote()
    price = round(float(quote["price"]), 2)
    prev_close = price
    provider = market_hub.live_provider
    real_quote = provider.quote(symbol) if provider is not None else None
    if real_quote is not None:
        price = round(float(real_quote["price"]), 2)
        prev_close = round(float(real_quote.get("prev_close") or price), 2)
    else:
        prev_close = round(float(quote["last_close"] or price), 2)
    change = round(price - prev_close, 2)
    payload = {
        "symbol": symbol, "name": SYMBOLS[symbol].get("name", symbol), "interval": interval,
        "price": price, "prev_close": prev_close, "change": change,
        "change_pct": round((change / prev_close) * 100, 2) if prev_close else 0.0,
    }
    if spark:
        bars = engine.history(48)
        if engine.current is not None:
            bars = [*bars, engine.current]
        payload["spark"] = [round(float(b["close"]), 4) for b in bars][-48:]

        # The session high/low must describe *this* session. A live provider
        # reports it authoritatively; otherwise use the final bar alone rather
        # than the whole spark window, which would label a 48-day extreme as a
        # daily high.
        day_high = day_low = None
        if real_quote is not None:
            day_high = real_quote.get("day_high")
            day_low = real_quote.get("day_low")
        if bars:
            last = bars[-1]
            if day_high is None:
                day_high = last.get("high")
            if day_low is None:
                day_low = last.get("low")
        payload["day_high"] = round(float(day_high), 2) if day_high is not None else None
        payload["day_low"] = round(float(day_low), 2) if day_low is not None else None
    return payload


# ──────────────────────────────────────────────────────────────────────────
# Research windows — daily candles, matched to the requested period
# ──────────────────────────────────────────────────────────────────────────
def _analysis_interval(style: str) -> str:
    """Retained for API compatibility. Research windows are always daily."""
    return {"Intraday": "15m", "Swing": "1H", "Positional": "1D", "Long Term": "1D"}.get(style, "1D")


def _period_bars(period: str | None) -> int:
    from app.services.history import bars_for_period
    return bars_for_period(period)


def _research_candles(symbol: str, interval: str, period: str | None) -> list[dict]:
    """Weekday daily candles for the requested window, ending at the latest bar.

    Backtests and research run on daily history rather than the short rolling
    intraday window, so a "Last 2 years" test really covers two years of bars.
    """
    candles = daily_history(symbol, period=period or "Last 2 years")
    if not candles:
        return []
    # Append the live in-progress bar when its timestamp is genuinely newer.
    try:
        engine = market_hub.engine_for(symbol, RESEARCH_INTERVAL)
        if engine.current is not None and int(engine.current["time"]) > int(candles[-1]["time"]):
            candles = [*candles, engine.current]
    except Exception:
        pass
    return candles


# ──────────────────────────────────────────────────────────────────────────
# Health, symbols, quotes
# ──────────────────────────────────────────────────────────────────────────
_model_runtime_cache: dict[str, Any] | None = None


def _model_runtime() -> dict[str, Any]:
    """Which booster will actually fit, resolved once per process.

    forecast.py prefers XGBoost and falls back to scikit-learn, so reporting a
    hard-coded "xgboost" claims a capability the process may not have. This
    probes the real import path instead.
    """
    global _model_runtime_cache
    if _model_runtime_cache is not None:
        return _model_runtime_cache
    try:
        import xgboost  # noqa: F401
        _model_runtime_cache = {"ready": True, "booster": "xgboost"}
    except Exception:
        try:
            import sklearn  # noqa: F401
            _model_runtime_cache = {"ready": True, "booster": "sklearn"}
        except Exception:
            _model_runtime_cache = {"ready": False, "booster": None}
    return _model_runtime_cache


@app.get("/api/health")
def health():
    status = _live_status()
    provider = market_hub.live_provider
    runtime = _model_runtime()
    return {
        "status": "ok", "engine": runtime["booster"] or "unavailable",
        "time": datetime.now(timezone.utc),
        "data_mode": status["source"], "live": status,
        "live_provider_active": bool(provider is not None and getattr(provider, "_running", False)),
        "model_ready": runtime["ready"],
        "symbols": len(SYMBOLS),
        "universe_note": "Prices are demo bases unless MARKET_DATA_MODE points at a real feed.",
    }


@app.get("/api/market/symbols")
def market_symbols():
    from app.services.upstox_provider import INSTRUMENT_MAP
    symbols = []
    for symbol, spec in SYMBOLS.items():
        entry = {"symbol": symbol, "base_price": spec["base"], "decimals": spec["decimals"]}
        if symbol in INSTRUMENT_MAP:
            entry["instrument_key"] = INSTRUMENT_MAP[symbol]
        symbols.append(entry)
    return symbols


@app.get("/api/market/instruments")
def market_instruments():
    """Full instrument book with sectors and index membership."""
    return {"instruments": list_instruments(), "sectors": universe_sectors()}


@app.get("/api/market/universes")
def market_universes():
    return list_universes()


@app.get("/api/market/quote")
def market_quote(symbol: str = "NIFTY 50", interval: str = "1D"):
    symbol = normalize_symbol(symbol)
    if symbol not in SYMBOLS:
        return {"error": f"Unknown symbol: {symbol}"}
    return _live_quote(symbol, interval, spark=True)


@app.get("/api/market/quotes")
def market_quotes(symbols: str = "NIFTY 50,SENSEX,INDIA VIX", interval: str = "1D",
                  spark: bool = Query(False, description="Include the intraday sparkline")):
    wanted = [normalize_symbol(s.strip()) for s in symbols.split(",") if s.strip()]
    wanted = [s for s in wanted if s in SYMBOLS] or ["NIFTY 50"]
    status = _live_status()
    return {
        "source": status["source"], "live": status,
        "interval": normalize_interval(interval),
        "quotes": [_live_quote(s, interval, spark=spark) for s in wanted],
    }


INDEX_TICKER_SYMBOLS = ["NIFTY 50", "SENSEX", "BANKNIFTY", "INDIA VIX"]


def _index_quotes() -> list[dict]:
    return [_live_quote(s, "1D", spark=True) for s in INDEX_TICKER_SYMBOLS if s in SYMBOLS]


@app.get("/api/market/candles")
def market_candles(symbol: str = "NIFTY 50", interval: str = "1m", limit: int = 150):
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    limit = max(10, min(500, limit))
    engine = market_hub.engine_for(symbol, interval)
    candles = engine.history(limit)
    if engine.current is not None:
        candles = [*candles, engine.current]
    status = _live_status()
    covered = market_hub._covered_by_live_feed(symbol)
    notice = None if covered else (
        "Simulated feed. Set MARKET_DATA_MODE=live for real prices, or "
        "MARKET_DATA_MODE=upstox with UPSTOX_ACCESS_TOKEN for a streaming feed."
    )
    return {"symbol": symbol, "interval": interval, "source": status["source"],
            "live": status, "candles": candles, "notice": notice}


@app.get("/api/market/history")
def market_history(symbol: str = "NIFTY 50", interval: str = "1m", num_candles: int = 150):
    """Refresh history from the Upstox REST API. Requires a configured token."""
    if not market_hub.live_mode:
        return {"error": "Historical fetch requires MARKET_DATA_MODE=upstox",
                "notice": "Set MARKET_DATA_MODE=upstox and UPSTOX_ACCESS_TOKEN to use this endpoint."}
    access_token = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
    if not access_token:
        return {"error": "UPSTOX_ACCESS_TOKEN is not set"}

    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    num_candles = max(10, min(500, num_candles))

    from app.services.upstox_history import fetch_historical_candles
    from app.services.upstox_provider import INSTRUMENT_MAP

    instrument_key = INSTRUMENT_MAP.get(symbol)
    if instrument_key is None:
        return {"error": f"No Upstox instrument key for {symbol}"}

    candles = fetch_historical_candles(access_token, instrument_key, interval, num_candles)
    if not candles:
        return {"error": "No candles returned from Upstox", "symbol": symbol, "interval": interval}

    engine = market_hub.engine_for(symbol, interval)
    engine.candles = candles
    engine.price = candles[-1]["close"]
    boundary = int(time.time()) - (int(time.time()) % engine.seconds)
    engine._open_candle(boundary)

    return {"symbol": symbol, "interval": interval, "source": "upstox",
            "candles_loaded": len(candles), "last_price": engine.price,
            "candles": engine.history(num_candles)}


@app.websocket("/ws/market/{symbol}")
async def market_stream(websocket: WebSocket, symbol: str, interval: str = "1m"):
    await websocket.accept()
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    queue, engine = market_hub.subscribe(symbol, interval)
    status = _live_status()
    try:
        history = engine.history()
        if engine.current is not None:
            history = [*history, engine.current]
        await websocket.send_json({"type": "history", "symbol": symbol, "interval": interval,
                                   "source": status["source"], "live": status,
                                   "candles": history})
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        market_hub.unsubscribe(symbol, interval, queue)


# ──────────────────────────────────────────────────────────────────────────
# Forecast & dashboard
# ──────────────────────────────────────────────────────────────────────────
def _cached_forecast(symbol: str = "NIFTY 50", interval: str = "1D") -> dict:
    """Forecast report computed from the live engine, cached for a few seconds."""
    engine = market_hub.engine_for(symbol, interval)
    candles = [*engine.history(), engine.current] if engine.current else engine.history()
    if not candles:
        return {"error": "No candle data yet"}
    key = f"forecast:{symbol}:{interval}"
    return _cached(key, 15.0, lambda: forecast_report(candles, symbol, interval))


def _research_forecast(symbol: str, period: str) -> dict:
    candles = _research_candles(symbol, RESEARCH_INTERVAL, period)
    return _cached(f"rforecast:{symbol}:{period}", 300.0,
                   lambda: forecast_report(candles, symbol, RESEARCH_INTERVAL))


@app.get("/api/dashboard")
def dashboard():
    status = _live_status()
    report = _research_forecast("NIFTY 50", "Last 2 years")
    ready = report.get("error") is None
    return {
        "market": _live_quote("NIFTY 50", "1D", spark=True),
        "indices": _index_quotes(),
        "live": status,
        "forecast": {
            "direction_accuracy": report.get("direction_accuracy") if ready else None,
            "mae": report.get("mae") if ready else None,
            "rmse": report.get("rmse") if ready else None,
            "brier": report.get("brier") if ready else None,
            "model": report.get("model") if ready else None,
            "samples": report.get("samples") if ready else None,
            "latest_forecast": report.get("latest_forecast", {}) if ready else {},
        },
        "bars": [b["accuracy"] for b in report.get("rolling_accuracy", [])] if ready else [],
        "model_ready": ready,
        "data_mode": status["source"],
    }


@app.get("/api/forecast/accuracy")
def forecast_accuracy(symbol: str = "NIFTY 50", interval: str = "1D"):
    if normalize_interval(interval) == "1D":
        return _research_forecast(symbol, "Last 2 years")
    return _cached_forecast(symbol, interval)


# ──────────────────────────────────────────────────────────────────────────
# Research workspace
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/research/{symbol}")
def research(symbol: str = "NIFTY 50", period: str = "Last 1 year"):
    """Everything the research workspace needs for one instrument, in one call."""
    resolved = normalize_symbol(symbol)
    period = period if period in ("Last 6 months", "Last 1 year", "Last 2 years", "Last 5 years") else "Last 1 year"
    candles = _research_candles(resolved, RESEARCH_INTERVAL, period)
    if len(candles) < 60:
        return {"error": "Not enough history for this instrument yet.", "symbol": resolved}

    feat = compute_features(candles)
    technicals = technical_summary(resolved, period)
    if technicals.get("error"):
        technicals = {}
    readings = indicator_readings(feat, ["RSI", "MACD", "EMA", "Bollinger", "ADX", "ATR", "VWAP"])
    live = _live_quote(resolved, "1D", spark=True)

    def build() -> dict:
        return {
            "explanation": explain_prediction(resolved, period if period in ("Last 1 year", "Last 2 years", "Last 5 years") else "Last 2 years"),
            "forecast": _research_forecast(resolved, period if period in ("Last 1 year", "Last 2 years", "Last 5 years") else "Last 2 years"),
        }

    model = _cached(f"research:{resolved}:{period}", 600.0, build)

    return {
        "symbol": resolved,
        "meta": lookup(resolved),
        "period": period,
        "interval": RESEARCH_INTERVAL,
        "quote": live,
        "candles": candles,
        "technicals": technicals,
        "indicator_readings": readings,
        "explanation": model.get("explanation", {}),
        "forecast": model.get("forecast", {}),
        "strategy": strategy_catalog(["RSI", "MACD", "EMA"]),
        "disclaimer": "Model-generated research signals only. Not financial advice.",
    }


@app.get("/api/explain/{symbol}")
def explain(symbol: str = "NIFTY 50", period: str = "Last 2 years"):
    resolved = normalize_symbol(symbol)
    return _cached(f"explain:{resolved}:{period}", 600.0, lambda: explain_prediction(resolved, period))


# ──────────────────────────────────────────────────────────────────────────
# Strategies & backtesting
# ──────────────────────────────────────────────────────────────────────────
class StrategyRequest(BaseModel):
    symbol: str = "RELIANCE"
    risk_level: str = "Medium"
    style: str = "Swing"
    indicators: list[str] = Field(default_factory=lambda: ["RSI", "MACD", "EMA"])
    strategy: str | None = "Moving Average Crossover"
    period: str | None = "Last 2 years"
    initial_capital: float = Field(default=100_000.0, ge=1_000, le=100_000_000)
    cost_pct: float = Field(default=0.05, ge=0.0, le=5.0)
    atr_mult: float = Field(default=2.0, ge=0.25, le=10.0)


@app.get("/api/backtests/strategies")
def backtest_strategies(indicators: str = "RSI,MACD,EMA"):
    chosen = [item.strip() for item in indicators.split(",") if item.strip()]
    return {
        "strategies": list(STRATEGIES.keys()),
        "catalog": strategy_catalog(chosen),
        "execution": execution_notes(2.0, 0.05),
    }


@app.post("/api/strategies/generate")
def generate_strategy(request: StrategyRequest):
    symbol = normalize_symbol(request.symbol)
    candles = _research_candles(symbol, RESEARCH_INTERVAL, request.period)
    if not candles:
        return {"error": "No research window available for this symbol."}
    return generate_recommendation(
        candles, symbol, request.risk_level, request.style, request.indicators,
        RESEARCH_INTERVAL, strategy=request.strategy, period=request.period or "Last 2 years",
        symbol_meta=lookup(symbol), cost_pct=request.cost_pct, atr_mult=request.atr_mult,
    )


@app.post("/api/backtests/run")
def run_backtest_endpoint(request: StrategyRequest):
    symbol = normalize_symbol(request.symbol)
    strategy = request.strategy if request.strategy in STRATEGIES else "Moving Average Crossover"
    candles = _research_candles(symbol, RESEARCH_INTERVAL, request.period)
    if not candles:
        return {"error": "No research window available for this symbol.", "trades": 0}
    result = run_backtest(
        candles, strategy, symbol=symbol, interval=RESEARCH_INTERVAL,
        initial_capital=request.initial_capital, cost_pct=request.cost_pct,
        atr_mult=request.atr_mult, indicators=request.indicators,
    )
    result["symbol"] = symbol
    result["name"] = lookup(symbol)["name"]
    result["period"] = request.period or "Last 2 years"
    result["candles_analyzed"] = len(candles)
    result["initial_capital"] = request.initial_capital
    result["cost_pct"] = request.cost_pct
    result["atr_mult"] = request.atr_mult
    result["data_source"] = "upstox" if market_hub.live_mode else "deterministic research history"
    result["execution"] = execution_notes(request.atr_mult, request.cost_pct)
    result["disclaimer"] = "Research simulation only. Not investment advice and not a promise of future returns."
    return result


@app.get("/api/backtests/equity")
def equity_curve(symbol: str = "NIFTY 50", strategy: str = "Moving Average Crossover",
                 period: str = "Last 2 years", initial_capital: float = 100_000.0):
    """Equity, drawdown and monthly series without running the whole report payload."""
    resolved = normalize_symbol(symbol)
    chosen = strategy if strategy in STRATEGIES else "Moving Average Crossover"
    candles = _research_candles(resolved, RESEARCH_INTERVAL, period)
    result = run_backtest(candles, chosen, symbol=resolved, interval=RESEARCH_INTERVAL,
                          initial_capital=max(1000.0, initial_capital))
    if result.get("error"):
        return result
    return {
        "symbol": resolved, "strategy": chosen, "period": period,
        "equity_points": result["equity_points"],
        "drawdown_series": result["drawdown_series"],
        "monthly_returns": result["monthly_returns"],
        "final_equity": result["final_equity"],
        "net_return": result["net_return"],
        "max_drawdown": result["max_drawdown"],
    }


# ──────────────────────────────────────────────────────────────────────────
# Portfolio, correlation, market doctor
# ──────────────────────────────────────────────────────────────────────────
class PortfolioRequest(BaseModel):
    holdings: list[str] = Field(default_factory=list)
    period: str = "Last 1 year"


@app.post("/api/portfolio/analyze")
def analyze_portfolio(request: PortfolioRequest):
    return portfolio_analysis(request.holdings, request.period)


class CorrelationRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    period: str = "Last 1 year"


@app.post("/api/correlations")
def correlations(request: CorrelationRequest):
    if not request.symbols:
        return correlation_matrix(INDEX_TICKER_SYMBOLS, request.period)
    return correlation_matrix(request.symbols, request.period)


@app.get("/api/correlations/default")
def correlations_default():
    return correlation_matrix(INDEX_TICKER_SYMBOLS, "Last 1 year")


@app.get("/api/market-doctor/market")
def market_doctor_market(symbol: str = "NIFTY 50", period: str = "Last 1 year"):
    resolved = normalize_symbol(symbol)
    return _cached(f"market:{resolved}:{period}", 300.0, lambda: market_condition(resolved, period))


@app.get("/api/sectors")
def sectors():
    return {"sectors": universe_sectors()}


# ──────────────────────────────────────────────────────────────────────────
# Scenarios
# ──────────────────────────────────────────────────────────────────────────
class ScenarioRequest(BaseModel):
    scenario: str = Field(min_length=3, max_length=120)
    horizon: str = Field(default="1 month", max_length=40)


@app.post("/api/scenarios/run")
def run_scenario(request: ScenarioRequest):
    """Bounded, explainable scenario research. Not a forecast."""
    effects = {
        "RBI cuts rates by 25 bps": (
            "Banking and rate-sensitive sectors may benefit; high-quality bond proxies can also see support.",
            ["Banking: constructive", "Realty: constructive", "Export IT: neutral"], "Medium",
        ),
        "Crude oil rises 10%": (
            "Higher energy costs may pressure import-sensitive sectors and inflation expectations.",
            ["Energy: constructive", "Airlines: pressured", "FMCG: watch margins"], "Medium",
        ),
        "USDINR falls 3%": (
            "A stronger rupee can reduce the INR value of export revenue while easing imported-input costs.",
            ["IT services: pressured", "Oil marketing: constructive", "Pharma exporters: mixed"], "Medium",
        ),
        "Gold rises 5%": (
            "A gold rally can signal defensive positioning and may improve diversification characteristics.",
            ["Gold: constructive", "Jewellery retail: mixed", "High beta equities: watch"], "Low",
        ),
    }
    summary, sector_effects, confidence = effects.get(
        request.scenario,
        ("This event may change sector leadership and volatility. Review exposures before acting.",
         ["Broad market: mixed"], "Low"),
    )
    return {
        "scenario": request.scenario, "horizon": request.horizon, "summary": summary,
        "sector_effects": sector_effects, "confidence": confidence,
        "disclaimer": "Scenario analysis is educational research, not a forecast or financial advice.",
    }


# ──────────────────────────────────────────────────────────────────────────
# News, calendar, reports — honest empty states without a configured provider
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/news")
def get_news(symbol: str | None = None, limit: int = 40):
    """Headlines from a configured provider, optionally narrowed to one symbol.

    With no provider key the feed is honestly empty rather than filled with
    invented stories. When a symbol is supplied the search switches to the
    everything endpoint, so the filter is a real query and not a client-side
    pretence.
    """
    api_key = os.getenv("NEWS_API_KEY", "").strip()
    if not api_key:
        return {
            "items": [], "source": None, "count": 0,
            "notice": "No news provider is configured. Set NEWS_API_KEY (newsapi.org) in the backend .env to populate this feed.",
        }

    term = (symbol or "").strip().upper()
    size = max(1, min(50, limit))
    if term:
        label = f"newsapi.org · {term}"
        url = (
            "https://newsapi.org/v2/everything?language=en&sortBy=publishedAt"
            f"&q={quote_plus(term)}&pageSize={size}&apiKey={api_key}"
        )
    else:
        label = "newsapi.org"
        url = (
            "https://newsapi.org/v2/top-headlines?country=in&language=en"
            f"&pageSize={size}&apiKey={api_key}"
        )

    try:
        with urlopen(Request(url, headers={"User-Agent": "MarketMind/1.0"}), timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        return {"items": [], "source": label, "count": 0,
                "notice": f"The news provider could not be reached: {exc}"}

    # Keys below mirror the NewsItem contract in the frontend's lib/api.ts.
    # Anything renamed on one side must be renamed on the other.
    items = []
    for index, article in enumerate(payload.get("articles", [])):
        title = (article.get("title") or "").strip()
        if not title or title == "[Removed]":
            continue
        items.append({
            "id": f"news-{index}",
            "title": title,
            "summary": (article.get("description") or "").strip(),
            "source": (article.get("source") or {}).get("name") or "Unknown",
            "published_at": article.get("publishedAt") or "",
            "url": article.get("url") or "",
            "symbols": [term] if term else [],
            "sentiment": "neutral",
        })
    return {"items": items, "source": label, "count": len(items), "notice": None}


@app.get("/api/calendar/events")
def calendar_events():
    """Economic and corporate events require a licensed calendar feed.

    None is configured, so the API reports that honestly rather than shipping
    invented dates.
    """
    return {
        "events": [], "count": 0,
        "notice": "No economic calendar provider is configured. Connect a licensed calendar feed to populate earnings, dividends and macro releases.",
    }


# ──────────────────────────────────────────────────────────────────────────
# Reports
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/reports/research")
def research_report(symbol: str = "NIFTY 50", period: str = "Last 1 year"):
    """Composed research report built entirely from the live analysis services."""
    resolved = normalize_symbol(symbol)
    meta = lookup(resolved)
    candles = _research_candles(resolved, RESEARCH_INTERVAL, period)
    if len(candles) < 60:
        return {"error": "Not enough history to build a report for this instrument."}

    technicals = technical_summary(resolved, period)
    model = _cached(f"explain:{resolved}:{period}", 600.0, lambda: explain_prediction(resolved, period))
    accuracy = _research_forecast(resolved, period if period != "Last 6 months" else "Last 2 years")
    strategy = generate_recommendation(
        candles, resolved, "Medium", "Swing", ["RSI", "MACD", "EMA"],
        RESEARCH_INTERVAL, period=period, symbol_meta=meta,
    )

    close = float(candles[-1]["close"])
    period_open = float(candles[0]["open"])
    sections = [
        {"id": "executive", "title": "Executive summary",
         "body": (f"{meta['name']} ({resolved}) closed the {period} window at {close:,.2f}. "
                  f"The walk-forward model calls {model.get('direction', 'n/a')} with "
                  f"{model.get('probability_up', 'n/a')}% probability for the next session, "
                  f"based on {model.get('samples', 0)} labelled samples.")},
        {"id": "market", "title": "Market overview",
         "body": (f"Benchmark context: {INDEX_TICKER_SYMBOLS[0]} is "
                  f"{_live_quote('NIFTY 50', '1D')['change_pct']:+.2f}% on the day. "
                  f"Window return for {resolved}: {((close / period_open) - 1) * 100:+.2f}%.")},
        {"id": "asset", "title": "Asset analysis",
         "body": f"Sector: {meta['sector']}. Membership: {', '.join(meta['universes']) or 'n/a'}. "
                 f"20-period support {technicals.get('support_20')} / resistance {technicals.get('resistance_20')}."},
        {"id": "technical", "title": "Technical analysis",
         "body": (f"RSI {technicals.get('rsi')}, ADX {technicals.get('adx')}, "
                  f"ATR {technicals.get('atr')} ({technicals.get('atr_pct')}% of price), "
                  f"realised volatility {technicals.get('realised_vol_pct')}% annualised.")},
        {"id": "model", "title": "AI model output",
         "body": (f"{model.get('model', 'Model unavailable')}. Direction {model.get('direction', 'n/a')}, "
                  f"probability {model.get('probability_up', 'n/a')}%.")},
        {"id": "shap", "title": "Model explanation (SHAP)",
         "body": "; ".join(f"{row['label']} {row['contribution']:+.3f}" for row in model.get("contributions", [])[:6])
                 or "Feature contributions unavailable."},
        {"id": "risk", "title": "Risk analysis",
         "body": (strategy.get("explanation") or "Risk read unavailable.")},
        {"id": "news", "title": "News intelligence",
         "body": "No news provider is configured, so no narrative overlay is applied to this report."},
        {"id": "context", "title": "Historical context",
         "body": f"Measured across {len(candles)} weekday daily candles ({period})."},
        {"id": "conclusion", "title": "Conclusion",
         "body": (f"Model signal: {model.get('direction', 'n/a')}. Strategy read: {strategy.get('side', 'n/a')} "
                  f"at {strategy.get('entry')} with a stop at {strategy.get('stop_loss')}.")},
    ]
    return {
        "symbol": resolved, "name": meta["name"], "sector": meta["sector"], "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sections": sections,
        "disclaimer": "Generated research summary. Not investment advice and not a prediction of future prices.",
    }


# ──────────────────────────────────────────────────────────────────────────
# AI Mentor
# ──────────────────────────────────────────────────────────────────────────
class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=2000)


class MentorRequest(BaseModel):
    message: str = Field(min_length=2, max_length=1000)
    symbol: str | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


@app.post("/api/mentor/chat")
def mentor(request: MentorRequest):
    """Explain market concepts without giving personalised investment advice.

    The primary provider is the local Ollama runtime; a deterministic fallback
    keeps the user experience useful while the local model is unavailable.
    """
    text = request.message.lower()
    fallback = _mentor_fallback(text)
    try:
        answer = _ask_ollama(request.message, request.symbol, request.history)
        return {"answer": answer, "topic": "market-education", "provider": "ollama",
                "model": os.getenv("OLLAMA_MODEL", "qwen2.5:3b"),
                "disclaimer": "Educational research only; not financial advice."}
    except (URLError, TimeoutError, OSError, ValueError, KeyError, json.JSONDecodeError, TypeError) as exc:
        # Preserve an available mentor when Ollama is starting, unavailable, or returns malformed data.
        return {"answer": fallback, "topic": "market-education", "provider": "fallback", "model": None,
                "service_notice": f"Local Ollama unavailable: {exc}",
                "disclaimer": "Educational research only; not financial advice."}


def _market_snapshot(symbol: str | None = None) -> str:
    """Live levels so the mentor can ground answers instead of speaking in generalities."""
    parts: list[str] = []
    targets = ["NIFTY 50"]
    resolved = normalize_symbol(symbol) if symbol else None
    if resolved and resolved != "NIFTY 50":
        targets.append(resolved)
    for name in targets:
        quote = _live_quote(name, "1D")
        parts.append(f"{quote['name']} at {quote['price']:,.2f} ({quote['change_pct']:+.2f}% on the day)")
    return "; ".join(parts)


def _mentor_fallback(text: str) -> str:
    if "rsi" in text and "divergen" in text:
        return "RSI divergence occurs when price and RSI move in opposite directions. A bullish divergence (price lower low, RSI higher low) suggests weakening selling pressure. A bearish divergence (price higher high, RSI lower high) suggests weakening buying pressure. Divergences are strongest when RSI is in extreme zones (below 30 or above 70). Always wait for price confirmation before acting on a divergence signal."
    if "rsi" in text:
        return "RSI measures the speed of recent price changes on a 0–100 scale. Above 70 can indicate stretched momentum and below 30 can indicate selling pressure, but neither is a buy or sell signal by itself. Confirm with price trend, volume and a defined risk limit."
    if "macd" in text and "histogram" in text:
        return "The MACD histogram shows the difference between the MACD line and the Signal line. Growing bars (moving away from zero) indicate strengthening momentum. Shrinking bars (moving toward zero) indicate the trend may be losing steam. When the histogram crosses zero, it confirms the MACD/Signal crossover."
    if "macd" in text and ("cross" in text or "signal" in text):
        return "MACD crossover signals: When the MACD line crosses above the Signal line, it's a bullish signal — momentum is shifting up. When it crosses below, it's bearish. The strength of the signal is stronger when the crossover happens far from the zero line. Always confirm with volume and the overall trend."
    if ("macd" in text and "combine" in text) or ("macd" in text and "rsi" in text):
        return "Combining MACD and RSI: Use MACD for trend direction (is momentum bullish or bearish?) and RSI for timing (is the entry overextended?). A strong setup is when MACD gives a bullish crossover while RSI is below 50 but above 30 — this means the trend is turning up and you're not buying at a stretched level."
    if "macd" in text:
        return "MACD compares short- and long-term moving averages. A MACD line crossing above its signal line can support improving momentum; a cross below can signal weakening momentum. Look for confirmation from trend structure and volume."
    if "candlestick" in text and ("hammer" in text or "shooting" in text):
        return "Hammer: Small body at the top, long lower wick (at least 2x the body). Appears at the bottom of a downtrend — the long lower wick shows buyers rejected lower prices. Shooting Star is the inverse: small body at the bottom, long upper wick at the top of an uptrend. Both are reversal signals but need confirmation from the next candle."
    if "candlestick" in text and "pattern" in text:
        return "Key candlestick patterns: Hammer and Shooting Star (single candle reversals), Engulfing (second candle body fully covers the first — strong reversal), Morning/Evening Star (3-candle reversal formations). Reliability increases when patterns appear at key support/resistance levels and are confirmed by volume."
    if "candlestick" in text or "candle" in text:
        return "A candlestick shows four prices: Open, High, Low, Close. A green/bullish candle means Close > Open (price rose). A red/bearish candle means Close < Open (price fell). The body shows the open-close range; wicks show the full price range. Long wicks indicate rejection of extreme prices."
    if "stop" in text and ("loss" in text or "type" in text):
        return "Types of stop-losses: (1) Fixed stop — set at a specific price below entry. (2) ATR stop — based on Average True Range, adjusts to volatility. (3) Structure stop — below the most recent swing low for technical stops. (4) Time stop — exit after N days if the trade hasn't worked. The best stop placement depends on your timeframe and the stock's volatility."
    if "position" in text and ("siz" in text or "1%" in text or "rule" in text):
        return "Position sizing formula: Position Size = Risk Amount ÷ (Entry Price − Stop Loss). The 1% Rule means never risk more than 1% of your portfolio on a single trade. Example: ₹1,00,000 portfolio × 1% = ₹1,000 max risk. If your stop is ₹100 below entry, you buy 10 shares. This ensures a losing streak won't devastate your account."
    if "risk" in text and ("reward" in text or "r:r" in text or "ratio" in text):
        return "Risk-Reward Ratio (R:R) = (Target − Entry) ÷ (Entry − Stop Loss). A 1:2 R:R means you risk ₹1 to make ₹2. Minimum recommended R:R is 1:1.5 for swing trades. With a 1:2 R:R, you only need a 40% win rate to be profitable. Always define your R:R before entering a trade — if it's below 1:1, skip the trade."
    if "drawdown" in text:
        return "Drawdown is the peak-to-trough decline in your portfolio. A 50% loss requires a 100% gain to break even (asymmetric). Key rules: Keep max drawdown under 20% for consistent compounding. If you hit a 10% drawdown, reduce position sizes. A 20% drawdown means you're taking too much risk. Position sizing and stop-losses are your primary drawdown controls."
    if "sharpe" in text:
        return "The Sharpe ratio is return per unit of volatility. It is measured on mark-to-market equity, so flat days count as zero return and properly dampen the score. Above 1 is generally acceptable, above 2 is strong — but always read it next to maximum drawdown, because a high Sharpe can still hide a brutal 40% fall."
    if "correlation" in text:
        return "Correlation measures how two assets move together, from −1 to +1. Above about 0.7 they mostly move as one, so holding both adds little diversification. Below 0.3 they are close to independent. Negative correlation can offset portfolio risk, but only in calm periods — correlations tend to converge toward 1 during a crash."
    if "nifty" in text or "market" in text:
        return "For a market move, start with breadth, sector leadership, India VIX, macro events and news sentiment. A rising index with broad participation is generally healthier than a move driven by only a few large stocks."
    if "portfolio" in text or "allocation" in text or "diversif" in text:
        return "Portfolio quality comes from diversification, appropriate equity risk, liquidity and rebalancing discipline. Review concentration by sector and correlated holdings; align your allocation with horizon and ability to tolerate drawdowns."
    if "win rate" in text:
        return "Win rate alone doesn't determine profitability — it's the combination of win rate and risk-reward ratio. A 40% win rate can be profitable with a 1:2.5 R:R. A 60% win rate can lose money with a 1:0.5 R:R. Focus on R:R first, then work on improving win rate through better entry timing and confluence."
    return "A useful research workflow is: identify the trend, check momentum and volume, review catalysts and event risk, then define invalidation and position size. I can explain RSI, MACD, candlestick patterns, risk management, portfolio risk, market trends, or strategy concepts in more detail."


def _ask_ollama(message: str, symbol: str | None = None, history: list | None = None) -> str:
    """Call the local-only Ollama chat endpoint. No user data leaves the computer."""
    try:
        snapshot = _market_snapshot(symbol)
    except Exception:
        snapshot = ""
    context = f" The user is currently researching {symbol}." if symbol else ""
    system = (
        "You are MarketMind AI Mentor, a concise, helpful Indian-market education assistant."
        " Explain concepts, trends, indicators, portfolio construction, and risk in plain English."
        " Answer the question that was actually asked and build on earlier turns in this"
        " conversation instead of restarting."
        " Use the live levels below when the question is about the current market; if the"
        " levels do not cover what was asked, say so instead of guessing."
        " Do not promise returns, tell users exactly what to buy or sell, or give personalised"
        " financial advice."
        " State uncertainty and recommend further research where relevant."
        f"{context}"
        + (f" Current levels: {snapshot}." if snapshot else "")
        + " Keep answers under 180 words."
    )
    messages = [{"role": "system", "content": system}]
    for turn in (history or [])[-8:]:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": message})
    payload = json.dumps({
        "model": os.getenv("OLLAMA_MODEL", "qwen2.5:3b"),
        "stream": False,
        "options": {"temperature": 0.35, "num_predict": 300},
        "messages": messages,
    }).encode("utf-8")
    endpoint = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
    request = Request(endpoint, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))
    with urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    answer = str(data["message"]["content"]).strip()
    if not answer:
        raise ValueError("Ollama returned an empty response")
    return answer
