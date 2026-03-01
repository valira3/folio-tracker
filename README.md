# Folio — Portfolio Tracker

Full-stack portfolio tracker with live market data, authentication, and real-time stock analytics.

## Features
- Real-time stock quotes via Yahoo Finance (yfinance)
- Portfolio management with multi-lot tracking
- Watchlist with live price updates
- News feed from multiple financial sources
- Analyst ratings and price targets
- Interactive charts with historical data
- Portfolio value predictions
- Sector allocation analysis
- Authentication with secure password hashing
- Auto-refreshing quotes (60-second intervals)

## Tech Stack
- **Frontend**: Vanilla JS, CSS (mobile-first design)
- **Backend**: Python Flask, SQLite
- **Market Data**: yfinance (Yahoo Finance)
- **Deployment**: Docker, Google Cloud Run, Railway

## Quick Start

```bash
pip install -r requirements.txt
python app_server.py
# Open http://localhost:8080
```

## Deploy to Google Cloud Run

```bash
gcloud run deploy folio-tracker --source . --region us-central1 --allow-unauthenticated --memory 512Mi
```

## Deploy to Railway
1. Push to GitHub
2. Connect repo at [railway.app](https://railway.app)
3. Railway auto-detects the Dockerfile and deploys

## License
MIT
