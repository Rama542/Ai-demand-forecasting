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

## Live market data with Upstox V3

To switch from the simulated feed to real-time NSE/BSE data:

1. **Get an Upstox developer account** at https://upstox.com/developer/api-registration
2. **Generate a read-only analytics access token** (no order permissions needed)
3. **Install the SDK** in your backend virtualenv:
   ```bash
   pip install upstox-python-sdk
   ```
4. **Set environment variables** in `.env`:
   ```
   MARKET_DATA_MODE=upstox
   UPSTOX_ACCESS_TOKEN=your_token_here
   ```
5. **Restart the backend** — the WebSocket stream will now carry live candlestick data

The provider uses the `MarketDataStreamerV3` in *full* mode, which delivers 1-minute candlestick data, depth, and last-trade information for all supported instruments.

### Supported instruments

| Symbol | Upstox Instrument Key |
|--------|----------------------|
| NIFTY 50 | `NSE_INDEX|Nifty 50` |
| SENSEX | `BSE_INDEX|SENSEX` |
| BANKNIFTY | `NSE_INDEX|Nifty Bank` |
| RELIANCE | `NSE_EQ|INE002A01018` |
| TCS | `NSE_EQ|INE467B01029` |
| HDFCBANK | `NSE_EQ|INE040A01026` |
| INFY | `NSE_EQ|INE009A01021` |
| TATAMOTORS | `NSE_EQ|INE157A01041` |

Add more instruments by extending the `INSTRUMENT_MAP` in `backend/app/services/upstox_provider.py`.

All predictions are research insights, not financial advice.
