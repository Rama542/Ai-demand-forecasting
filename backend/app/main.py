"""MarketMind AI API. Provider adapters can replace deterministic demo services via env config."""
from contextlib import asynccontextmanager
from datetime import datetime
import json
import os
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.services.market_data import (
    SYMBOLS, hub as market_hub, normalize_interval, normalize_symbol,
)
from app.services.backtester import run_backtest
from app.services.forecast import forecast_report
from app.services.recommendation import generate_recommendation
from app.services.strategies import STRATEGIES

@asynccontextmanager
async def lifespan(_: FastAPI):
    market_hub.start()
    try:
        yield
    finally:
        await market_hub.stop()

app = FastAPI(title="MarketMind AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_forecast_cache: dict = {}
_FORECAST_TTL = 15.0

def _cached_forecast(symbol: str = "NIFTY 50", interval: str = "1D") -> dict:
    """Forecast report computed from the live engine, cached for a few seconds."""
    engine = market_hub.engine_for(symbol, interval)
    candles = [*engine.history(), engine.current] if engine.current else engine.history()
    if not candles:
        return {"error": "No candle data yet"}
    key = (symbol, interval, candles[-1]["time"], len(candles))
    now = time.time()
    cached = _forecast_cache.get(key)
    if cached and now - cached["ts"] < _FORECAST_TTL:
        return cached["data"]
    report = forecast_report(candles, symbol, interval)
    _forecast_cache[key] = {"ts": now, "data": report}
    if len(_forecast_cache) > 32:
        for k in list(_forecast_cache)[:16]:
            _forecast_cache.pop(k, None)
    return report

class StrategyRequest(BaseModel):
    symbol: str = "RELIANCE"
    risk_level: str = "Medium"
    style: str = "Swing"
    indicators: list[str] = Field(default_factory=lambda: ["RSI", "MACD", "EMA"])
    strategy: str | None = "Moving Average Crossover"
    period: str | None = "Last 2 years"

@app.get("/api/health")
def health():
    data_mode = "upstox" if market_hub.live_mode else "simulated"
    live_active = market_hub.live_provider is not None and market_hub.live_provider._running
    return {"status": "ok", "engine": "xgboost", "time": datetime.utcnow(),
            "data_mode": data_mode, "live_provider_active": live_active}

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

@app.get("/api/market/candles")
def market_candles(symbol: str = "NIFTY 50", interval: str = "1m", limit: int = 150):
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    limit = max(10, min(500, limit))
    engine = market_hub.engine_for(symbol, interval)
    candles = engine.history(limit)
    if engine.current is not None:
        candles = [*candles, engine.current]
    source = "upstox" if market_hub.live_mode else "simulated"
    notice = None if market_hub.live_mode else "Simulated feed. Set MARKET_DATA_MODE=upstox and UPSTOX_ACCESS_TOKEN for real-time NSE data."
    return {"symbol": symbol, "interval": interval, "source": source,
            "candles": candles, "notice": notice}

@app.get("/api/market/history")
def market_history(
    symbol: str = "NIFTY 50",
    interval: str = "1m",
    num_candles: int = 150,
):
    """Fetch fresh historical candles from the Upstox REST API and reload the engine.

    Only works when ``MARKET_DATA_MODE=upstox`` and a valid token is set.
    Useful for manually refreshing chart data or pulling a specific range.
    """
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

    # Reload the engine with fresh data
    engine = market_hub.engine_for(symbol, interval)
    engine.candles = candles
    engine.price = candles[-1]["close"]
    import time as _time
    now = _time.time()
    boundary = int(now) - (int(now) % engine.seconds)
    engine._open_candle(boundary)

    return {
        "symbol": symbol,
        "interval": interval,
        "source": "upstox",
        "candles_loaded": len(candles),
        "last_price": engine.price,
        "candles": engine.history(num_candles),
    }

@app.websocket("/ws/market/{symbol}")
async def market_stream(websocket: WebSocket, symbol: str, interval: str = "1m"):
    await websocket.accept()
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    queue, engine = market_hub.subscribe(symbol, interval)
    source = "upstox" if market_hub.live_mode else "simulated"
    try:
        history = engine.history()
        if engine.current is not None:
            history = [*history, engine.current]
        await websocket.send_json({"type": "history", "symbol": symbol, "interval": interval,
                                   "source": source, "candles": history})
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        market_hub.unsubscribe(symbol, interval, queue)

@app.get("/api/dashboard")
def dashboard():
    data_mode = "upstox" if market_hub.live_mode else "simulated"
    report = _cached_forecast("NIFTY 50", "1D")
    acc = report.get("direction_accuracy") if report.get("error") is None else None
    mae = report.get("mae") if report.get("error") is None else None
    rmse = report.get("rmse") if report.get("error") is None else None
    latest = report.get("latest_forecast", {}) if report.get("error") is None else {}
    bars = [b["accuracy"] for b in report.get("rolling_accuracy", [])] if report.get("error") is None else []
    return {"market": {"name":"NIFTY 50", "price": 22493.55, "change": 0.84}, "portfolio_score": 82,
      "forecast": {"direction_accuracy": acc if acc is not None else 0.0, "mae": mae if mae is not None else 0.0,
                   "rmse": rmse if rmse is not None else 0.0, "model_health": "Healthy" if acc is not None else "Warming up",
                   "latest": latest},
      "bars": bars,
      "data_mode": data_mode}

@app.get("/api/forecast/accuracy")
def forecast_accuracy(symbol: str = "NIFTY 50", interval: str = "1D"):
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    return _cached_forecast(symbol, interval)

@app.get("/api/backtests/strategies")
def backtest_strategies():
    return {"strategies": list(STRATEGIES.keys())}

def _analysis_interval(style: str) -> str:
    return {"Intraday": "15m", "Swing": "1H", "Positional": "1D", "Long Term": "1D"}.get(style, "1H")

@app.post("/api/strategies/generate")
def generate_strategy(request: StrategyRequest):
    symbol = normalize_symbol(request.symbol)
    interval = _analysis_interval(request.style)
    engine = market_hub.engine_for(symbol, interval)
    candles = [*engine.history(), engine.current] if engine.current else engine.history()
    return generate_recommendation(candles, symbol, request.risk_level, request.style, request.indicators, interval)

class PortfolioRequest(BaseModel):
    holdings: list[str] = Field(default_factory=list)

class AllocationRequest(BaseModel):
    amount: float = Field(gt=0)
    risk_profile: str = "Moderate"
    investment_goal: str = "Wealth Creation"
    horizon: str = "3 Years"
    market: str = "Indian Market"
    market_signal: str = "Current conditions"

@app.post("/api/market-doctor/analyze")
def analyze_portfolio(request: PortfolioRequest):
    count = max(1, len(request.holdings))
    return {"score": min(91, 68 + count * 4), "risk":"Moderate", "diversification":"Good" if count >= 4 else "Needs attention",
      "strengths":["Core holdings show positive momentum", "Risk is within the selected profile"],
      "risks":["Financial-sector concentration is elevated", "Review stop-loss levels before major events"],
      "suggestion":"Add exposure from a low-correlated sector such as healthcare or FMCG."}

@app.post("/api/asset-allocation/recommend")
def recommend_allocation(request: AllocationRequest):
    allocations = {
        "Conservative": {"Gold":25,"Nifty 50":25,"FMCG":10,"Pharma":10,"IT":5,"Silver":5,"Cash":20},
        "Moderate": {"Gold":15,"Nifty 50":25,"Bank Nifty":10,"IT":10,"Auto":7,"Pharma":8,"Midcap":10,"Silver":5,"Cash":10},
        "Aggressive": {"Nifty 50":25,"Midcap":15,"Smallcap":10,"IT":12,"Banking":10,"Auto":8,"Pharma":5,"Gold":5,"Silver":5,"Cash":5},
    }[request.risk_profile]
    # Make transparent, bounded allocation adjustments while preserving the 100% invariant.
    if request.market_signal == "Gold bullish" and allocations.get("Cash", 0) >= 5:
        allocations["Cash"] -= 5; allocations["Gold"] = allocations.get("Gold", 0) + 5
    if request.market_signal == "VIX spike" and allocations.get("Cash", 0) < 20:
        source = "Bank Nifty" if "Bank Nifty" in allocations else "Nifty 50"
        allocations[source] -= 5; allocations["Cash"] += 5
    return {"allocation": allocations, "total": sum(allocations.values()), "portfolio_health":84,
      "confidence":78, "expected_return_range":"11–15%", "expected_volatility":"14.2%",
      "max_drawdown_estimate":"−12%", "sharpe_ratio_estimate":1.36,
      "reasoning":"Broad-market exposure supports participation while gold, cash, and low-correlated sectors manage regime risk.",
      "disclaimer":"Allocation recommendations are AI-generated research insights and should not be considered financial advice."}

@app.get("/api/news")
def get_news():
    return [{"id":1,"tag":"Markets","headline":"Nifty holds above 22,400 as banking stocks lead the session","impact":"Bullish","confidence":82},
            {"id":2,"tag":"Earnings","headline":"Reliance expands green-energy investment roadmap","impact":"Bullish","confidence":76}]

@app.get("/api/community")
def community():
    return {"sentiment":64,"trending_symbols":["RELIANCE","TATAMOTORS","INFY"],"posts":[
      {"source":"r/IndianStreetBets","text":"Bank Nifty breaks out after a strong opening.","sentiment":"Bullish"},
      {"source":"Stocktwits","text":"Traders are watching IT earnings guidance.","sentiment":"Neutral"}]}

@app.post("/api/backtests/run")
def run_backtest_endpoint(request: StrategyRequest):
    symbol = normalize_symbol(request.symbol)
    strategy = request.strategy if request.strategy in STRATEGIES else "Moving Average Crossover"
    interval = _analysis_interval(request.style)
    engine = market_hub.engine_for(symbol, interval)
    candles = [*engine.history(), engine.current] if engine.current else engine.history()
    result = run_backtest(
        candles, strategy, symbol=symbol, interval=interval,
        initial_capital=100_000.0, cost_pct=0.05, atr_mult=2.0,
    )
    result["symbol"] = symbol
    result["period"] = request.period or "Available history"
    result["candles_analyzed"] = len(candles)
    result["interval"] = interval
    result["disclaimer"] = "Predictions are AI-generated research insights and should not be considered financial advice."
    return result

@app.get("/api/correlations")
def correlations():
    return {"assets":["NIFTY","SENSEX","BANKNIFTY","GOLD","USDINR","CRUDE","VIX"],
      "matrix":[[1,.96,.84,.11,-.22,-.08,-.62],[.96,1,.79,.13,-.21,-.06,-.57],[.84,.79,1,.03,-.17,.09,-.54],[.11,.13,.03,1,-.36,.22,.08],[-.22,-.21,-.17,-.36,1,.42,.19],[-.08,-.06,.09,.22,.42,1,.14],[-.62,-.57,-.54,.08,.19,.14,1]]}

class MentorRequest(BaseModel):
    message: str = Field(min_length=2, max_length=1000)
    symbol: str | None = None

@app.post("/api/mentor/chat")
def mentor(request: MentorRequest):
    """Explain market concepts without giving personalised investment advice.

    The primary provider is the local Ollama runtime; a deterministic fallback
    keeps the user experience useful while the local model is unavailable.
    """
    text = request.message.lower()
    fallback = _mentor_fallback(text)
    try:
        answer = _ask_ollama(request.message, request.symbol)
        return {"answer": answer, "topic": "market-education", "provider": "ollama", "model": os.getenv("OLLAMA_MODEL", "qwen2.5:3b"), "disclaimer": "Educational research only; not financial advice."}
    except (URLError, TimeoutError, OSError, ValueError, KeyError, json.JSONDecodeError, TypeError) as exc:
        # Preserve an available mentor when Ollama is starting, unavailable, or returns malformed data.
        return {"answer": fallback, "topic": "market-education", "provider": "fallback", "model": None, "service_notice": f"Local Ollama unavailable: {exc}", "disclaimer": "Educational research only; not financial advice."}

def _mentor_fallback(text: str) -> str:
    if "rsi" in text and "divergen" in text:
        return "RSI divergence occurs when price and RSI move in opposite directions. A bullish divergence (price lower low, RSI higher low) suggests weakening selling pressure. A bearish divergence (price higher high, RSI lower high) suggests weakening buying pressure. Divergences are strongest when RSI is in extreme zones (below 30 or above 70). Always wait for price confirmation before acting on a divergence signal."
    elif "rsi" in text:
        return "RSI measures the speed of recent price changes on a 0–100 scale. Above 70 can indicate stretched momentum and below 30 can indicate selling pressure, but neither is a buy or sell signal by itself. Confirm with price trend, volume and a defined risk limit."
    elif "macd" in text and "histogram" in text:
        return "The MACD histogram shows the difference between the MACD line and the Signal line. Growing bars (moving away from zero) indicate strengthening momentum. Shrinking bars (moving toward zero) indicate the trend may be losing steam. When the histogram crosses zero, it confirms the MACD/Signal crossover."
    elif "macd" in text and ("cross" in text or "signal" in text):
        return "MACD crossover signals: When the MACD line crosses above the Signal line, it's a bullish signal — momentum is shifting up. When it crosses below, it's bearish. The strength of the signal is stronger when the crossover happens far from the zero line. Always confirm with volume and the overall trend."
    elif "macd" in text and "combine" in text or ("macd" in text and "rsi" in text):
        return "Combining MACD and RSI: Use MACD for trend direction (is momentum bullish or bearish?) and RSI for timing (is the entry overextended?). A strong setup is when MACD gives a bullish crossover while RSI is below 50 but above 30 — this means the trend is turning up and you're not buying at a stretched level."
    elif "macd" in text:
        return "MACD compares short- and long-term moving averages. A MACD line crossing above its signal line can support improving momentum; a cross below can signal weakening momentum. Look for confirmation from trend structure and volume."
    elif "candlestick" in text and ("hammer" in text or "shooting" in text):
        return "Hammer: Small body at the top, long lower wick (at least 2x the body). Appears at the bottom of a downtrend — the long lower wick shows buyers rejected lower prices. Shooting Star is the inverse: small body at the bottom, long upper wick at the top of an uptrend. Both are reversal signals but need confirmation from the next candle."
    elif "candlestick" in text and "pattern" in text:
        return "Key candlestick patterns: Hammer and Shooting Star (single candle reversals), Engulfing (second candle body fully covers the first — strong reversal), Morning/Evening Star (3-candle reversal formations). Reliability increases when patterns appear at key support/resistance levels and are confirmed by volume."
    elif "candlestick" in text or "candle" in text:
        return "A candlestick shows four prices: Open, High, Low, Close. A green/bullish candle means Close > Open (price rose). A red/bearish candle means Close < Open (price fell). The body shows the open-close range; wicks show the full price range. Long wicks indicate rejection of extreme prices."
    elif "stop" in text and ("loss" in text or "type" in text):
        return "Types of stop-losses: (1) Fixed stop — set at a specific price below entry. (2) ATR stop — based on Average True Range, adjusts to volatility. (3) Structure stop — below the most recent swing low for technical stops. (4) Time stop — exit after N days if the trade hasn't worked. The best stop placement depends on your timeframe and the stock's volatility."
    elif "position" in text and ("siz" in text or "1%" in text or "rule" in text):
        return "Position sizing formula: Position Size = Risk Amount ÷ (Entry Price − Stop Loss). The 1% Rule means never risk more than 1% of your portfolio on a single trade. Example: ₹1,00,000 portfolio × 1% = ₹1,000 max risk. If your stop is ₹100 below entry, you buy 10 shares. This ensures a losing streak won't devastate your account."
    elif "risk" in text and ("reward" in text or "r:r" in text or "ratio" in text):
        return "Risk-Reward Ratio (R:R) = (Target − Entry) ÷ (Entry − Stop Loss). A 1:2 R:R means you risk ₹1 to make ₹2. Minimum recommended R:R is 1:1.5 for swing trades. With a 1:2 R:R, you only need a 40% win rate to be profitable. Always define your R:R before entering a trade — if it's below 1:1, skip the trade."
    elif "drawdown" in text:
        return "Drawdown is the peak-to-trough decline in your portfolio. A 50% loss requires a 100% gain to break even (asymmetric). Key rules: Keep max drawdown under 20% for consistent compounding. If you hit a 10% drawdown, reduce position sizes. A 20% drawdown means you're taking too much risk. Position sizing and stop-losses are your primary drawdown controls."
    elif "nifty" in text or "market" in text:
        return "For a market move, start with breadth, sector leadership, India VIX, macro events and news sentiment. A rising index with broad participation is generally healthier than a move driven by only a few large stocks."
    elif "portfolio" in text or "allocation" in text or "diversif" in text:
        return "Portfolio quality comes from diversification, appropriate equity risk, liquidity and rebalancing discipline. Review concentration by sector and correlated holdings; align your allocation with horizon and ability to tolerate drawdowns."
    elif "win rate" in text:
        return "Win rate alone doesn't determine profitability — it's the combination of win rate and risk-reward ratio. A 40% win rate can be profitable with a 1:2.5 R:R. A 60% win rate can lose money with a 1:0.5 R:R. Focus on R:R first, then work on improving win rate through better entry timing and confluence."
    return "A useful research workflow is: identify the trend, check momentum and volume, review catalysts and event risk, then define invalidation and position size. I can explain RSI, MACD, candlestick patterns, risk management, portfolio risk, market trends, or strategy concepts in more detail."

def _ask_ollama(message: str, symbol: str | None = None) -> str:
    """Call the local-only Ollama chat endpoint. No user data leaves the computer."""
    context = f" The user is currently researching {symbol}." if symbol else ""
    system = (
        "You are MarketMind AI Mentor, a concise, helpful Indian-market education assistant."
        " Explain concepts, trends, indicators, portfolio construction, and risk in plain English."
        " Do not promise returns, tell users exactly what to buy or sell, or give personalised financial advice."
        " State uncertainty and recommend further research where relevant."
        f"{context} Keep answers under 180 words."
    )
    payload = json.dumps({
        "model": os.getenv("OLLAMA_MODEL", "qwen2.5:3b"),
        "stream": False,
        "options": {"temperature": 0.35, "num_predict": 300},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": message}],
    }).encode("utf-8")
    endpoint = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
    request = Request(endpoint, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))
    with urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    answer = data["message"]["content"].strip()
    if not answer:
        raise ValueError("Ollama returned an empty response")
    return answer
