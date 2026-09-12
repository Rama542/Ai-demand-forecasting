"""MarketMind AI API. Provider adapters can replace deterministic demo services via env config."""
from contextlib import asynccontextmanager
from datetime import datetime
import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.services.market_data import (
    SYMBOLS, hub as market_hub, normalize_interval, normalize_symbol,
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    market_hub.start()
    try:
        yield
    finally:
        await market_hub.stop()

app = FastAPI(title="MarketMind AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class StrategyRequest(BaseModel):
    symbol: str = "RELIANCE"
    risk_level: str = "Medium"
    style: str = "Swing"
    indicators: list[str] = Field(default_factory=lambda: ["RSI", "MACD", "EMA"])

@app.get("/api/health")
def health(): return {"status": "ok", "engine": "xgboost", "time": datetime.utcnow()}

@app.get("/api/market/symbols")
def market_symbols():
    return [{"symbol": symbol, "base_price": spec["base"], "decimals": spec["decimals"]}
            for symbol, spec in SYMBOLS.items()]

@app.get("/api/market/candles")
def market_candles(symbol: str = "NIFTY 50", interval: str = "1m", limit: int = 150):
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    limit = max(10, min(500, limit))
    engine = market_hub.engine_for(symbol, interval)
    candles = engine.history(limit)
    if engine.current is not None:
        candles = [*candles, engine.current]
    return {"symbol": symbol, "interval": interval, "source": "simulated",
            "candles": candles,
            "notice": "Simulated feed. Configure a market-data provider (e.g. Upstox) for real-time NSE data."}

@app.websocket("/ws/market/{symbol}")
async def market_stream(websocket: WebSocket, symbol: str, interval: str = "1m"):
    await websocket.accept()
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    queue, engine = market_hub.subscribe(symbol, interval)
    try:
        history = engine.history()
        if engine.current is not None:
            history = [*history, engine.current]
        await websocket.send_json({"type": "history", "symbol": symbol, "interval": interval,
                                   "source": "simulated", "candles": history})
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        market_hub.unsubscribe(symbol, interval, queue)

@app.get("/api/dashboard")
def dashboard():
    return {"market": {"name":"NIFTY 50", "price": 22493.55, "change": 0.84}, "portfolio_score": 82,
      "forecast": {"direction_accuracy": 71.4, "mae": 1.87, "model_health": "Healthy"}}

@app.post("/api/strategies/generate")
def generate_strategy(request: StrategyRequest):
    return {"symbol":request.symbol.upper(), "entry": 2928.0, "stop_loss": 2870.0,
      "targets":[3005.0, 3055.0, 3110.0], "risk_reward": 2.65, "probability": 73,
      "holding_time":"3–7 trading days", "condition":"Bullish continuation",
      "explanation":"Momentum remains constructive: price holds above EMA20 while MACD stays positive.",
      "disclaimer":"Predictions are AI-generated research insights and should not be considered financial advice."}

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
def run_backtest(request: StrategyRequest):
    return {"symbol":request.symbol, "trades":34, "win_rate":61.8, "net_return":18.4, "drawdown":-7.2, "sharpe":1.43,
            "equity_curve":[100,102,101,106,108,107,112,116,115,118]}

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
    except (URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        # Preserve an available mentor when Ollama is starting, unavailable, or returns malformed data.
        return {"answer": fallback, "topic": "market-education", "provider": "fallback", "model": None, "service_notice": f"Local Ollama unavailable: {exc}", "disclaimer": "Educational research only; not financial advice."}

def _mentor_fallback(text: str) -> str:
    if "rsi" in text:
        return "RSI measures the speed of recent price changes on a 0–100 scale. Above 70 can indicate stretched momentum and below 30 can indicate selling pressure, but neither is a buy or sell signal by itself. Confirm with price trend, volume and a defined risk limit."
    elif "macd" in text:
        return "MACD compares short- and long-term moving averages. A MACD line crossing above its signal line can support improving momentum; a cross below can signal weakening momentum. Look for confirmation from trend structure and volume."
    elif "nifty" in text or "market" in text:
        return "For a market move, start with breadth, sector leadership, India VIX, macro events and news sentiment. A rising index with broad participation is generally healthier than a move driven by only a few large stocks."
    elif "portfolio" in text or "allocation" in text:
        return "Portfolio quality comes from diversification, appropriate equity risk, liquidity and rebalancing discipline. Review concentration by sector and correlated holdings; align your allocation with horizon and ability to tolerate drawdowns."
    return "A useful research workflow is: identify the trend, check momentum and volume, review catalysts and event risk, then define invalidation and position size. I can explain RSI, MACD, portfolio risk, market trends, or strategy concepts in more detail."

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
