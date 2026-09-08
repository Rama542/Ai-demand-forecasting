# Architecture

`app/` is the Next.js presentation layer. It is intentionally component-ready: cards, navigation, tables, and responsive views live in the UI layer.

`backend/app/` is the FastAPI domain boundary. Data-provider adapters (news, social, market data), repositories (PostgreSQL), and model services should be added behind this API rather than called from React.

## Prediction lifecycle

1. An ingestion job stores immutable OHLCV, macro, event, and sentiment data.
2. A feature pipeline computes only values available before the prediction timestamp.
3. A walk-forward trainer fits XGBoost and records a version, metrics, and feature schema.
4. The predictor registry routes scoring to the selected approved model.
5. Predictions, confidence, and actual outcomes are retained for the accuracy dashboard.

Every user-facing forecast must include the financial-advice disclaimer.
