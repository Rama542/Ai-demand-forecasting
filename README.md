# MarketMind AI

AI-powered market intelligence and decision support platform. The repository includes a premium Next.js dashboard and FastAPI service scaffold, with XGBoost as the default prediction engine.

## Run locally

```bash
npm install
npm run dev
```

In a second terminal:

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The dashboard now ships a live candlestick chart (TradingView Lightweight Charts) on the Overview and Markets views. It streams a live feed over WebSocket from the FastAPI backend (`/ws/market/{symbol}`). The default feed is a zero-configuration simulated provider; set `MARKET_DATA_MODE` / `UPSTOX_*` in `.env` to plug in a real-time Indian market-data feed (e.g. Upstox V3 with a read-only analytics token).

All predictions are research insights, not financial advice.
