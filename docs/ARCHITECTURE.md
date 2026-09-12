# Architecture

`app/` is the Next.js presentation layer. It is intentionally component-ready: cards, navigation, tables, and responsive views live in the UI layer.

`backend/app/` is the FastAPI domain boundary. Data-provider adapters (news, social, market data), repositories (PostgreSQL), and model services should be added behind this API rather than called from React.

## Live market data

The live charting layer is a WebSocket pipeline, not a poll loop:

- `backend/app/services/market_data.py` maintains one rolling OHLCV history plus a forming candle per `(symbol, interval)`. A background task advances price by tick and broadcasts `candle_update` messages to subscribers.
- `GET /api/market/candles?symbol=NIFTY%2050&interval=1m` returns historical candles for the initial chart load.
- `GET /api/market/symbols` lists supported instruments and base prices.
- `WS /ws/market/{symbol}?interval=1m` streams a `history` snapshot followed by `candle_update` events; the frontend applies `series.update()` on each.

The default provider is `simulated` so the demo renders live charts with zero configuration. A real-time feed such as the Upstox V3 WebSocket (read-only analytics token) plugs in behind the same `MarketDataHub` contract: each message is `{"type": "candle_update", "symbol", "interval", "candle: {time, open, high, low, close, volume}}"`.

On the frontend, `app/components/LiveCandlestickChart.tsx` renders TradingView Lightweight Charts, supports the 1m/5m/15m/1H/1D intervals, and reconnects automatically. It is shown on the Overview and Markets views.

## Prediction lifecycle

1. An ingestion job stores immutable OHLCV, macro, event, and sentiment data.
2. A feature pipeline computes only values available before the prediction timestamp.
3. A walk-forward trainer fits XGBoost and records a version, metrics, and feature schema.
4. The predictor registry routes scoring to the selected approved model.
5. Predictions, confidence, and actual outcomes are retained for the accuracy dashboard.

Every user-facing forecast must include the financial-advice disclaimer.
