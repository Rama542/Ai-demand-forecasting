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

All predictions are research insights, not financial advice.
