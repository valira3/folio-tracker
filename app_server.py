#!/usr/bin/env python3
"""
Folio Portfolio Tracker — Flask Server v2.1
Wraps the CGI backend scripts for standalone deployment.

Usage:
  pip install flask gunicorn yfinance
  gunicorn -w 2 -b 0.0.0.0:8080 app_server:app
"""

import json
import os
import sys
import sqlite3
import hashlib
import secrets
import time
from urllib.parse import parse_qs
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='.', static_url_path='')

# ---------------------
# Database
# ---------------------

DB_PATH = os.environ.get("FOLIO_DB_PATH", "folio.db")

# Ensure the database directory exists (for Railway volume mount at /data)
_db_dir = os.path.dirname(DB_PATH)
if _db_dir and not os.path.exists(_db_dir):
    try:
        os.makedirs(_db_dir, exist_ok=True)
    except OSError:
        # If we can't create /data, fall back to local directory
        DB_PATH = "folio.db"
        print(f"Warning: Could not create {_db_dir}, using local DB path: {DB_PATH}")

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def init_db():
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS watchlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            data TEXT NOT NULL DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            created_at REAL NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            condition TEXT NOT NULL,
            price REAL NOT NULL,
            enabled INTEGER DEFAULT 1,
            triggered INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS saved_screens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            filters TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)
    db.commit()
    db.close()

init_db()

# ---------------------
# Auth helpers
# ---------------------

def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}${h.hex()}"

def verify_password(password, stored_hash):
    salt = stored_hash.split('$')[0]
    return hash_password(password, salt) == stored_hash

def get_user_from_token():
    token = request.args.get('token', '')
    if not token:
        return None
    db = get_db()
    row = db.execute(
        "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?",
        [token]
    ).fetchone()
    db.close()
    return row

DEFAULT_PORTFOLIO = {
    "AAPL": {"lots": [{"date": "2023-06-15", "qty": 25, "price": 182.50}]},
    "MSFT": {"lots": [{"date": "2023-03-20", "qty": 12, "price": 285.40}]},
    "GOOGL": {"lots": [{"date": "2023-08-05", "qty": 30, "price": 131.50}]},
    "NVDA": {"lots": [{"date": "2023-05-10", "qty": 40, "price": 42.80}]},
    "TSLA": {"lots": [{"date": "2024-04-20", "qty": 8, "price": 162.30}]},
}
DEFAULT_WATCHLIST = ["DIS", "NFLX", "AMD", "COST"]

# ---------------------
# Static files
# ---------------------

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    if path.startswith('api/') or path.startswith('market/'):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory('.', path)

# ---------------------
# Auth API routes
# ---------------------

@app.route('/api/signup', methods=['POST'])
def signup():
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", [email]).fetchone()
    if existing:
        db.close()
        return jsonify({"error": "An account with this email already exists"}), 409
    pw_hash = hash_password(password)
    cursor = db.execute("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
                        [email, pw_hash, name or email.split("@")[0]])
    user_id = cursor.lastrowid
    db.execute("INSERT INTO portfolios (user_id, data) VALUES (?, ?)",
               [user_id, json.dumps(DEFAULT_PORTFOLIO)])
    db.execute("INSERT INTO watchlists (user_id, data) VALUES (?, ?)",
               [user_id, json.dumps(DEFAULT_WATCHLIST)])
    token = secrets.token_urlsafe(48)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, user_id])
    db.commit()
    db.close()
    return jsonify({"token": token, "user": {"id": user_id, "email": email, "name": name or email.split("@")[0]}}), 201

@app.route('/api/login', methods=['POST'])
def login_route():
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    db = get_db()
    user = db.execute("SELECT id, email, name, password_hash FROM users WHERE email = ?", [email]).fetchone()
    if not user or not verify_password(password, user["password_hash"]):
        db.close()
        return jsonify({"error": "Invalid email or password"}), 401
    token = secrets.token_urlsafe(48)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, user["id"]])
    db.commit()
    db.close()
    return jsonify({"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"]}})

@app.route('/api/logout', methods=['POST'])
def logout_route():
    token = request.args.get('token', '')
    if token:
        db = get_db()
        db.execute("DELETE FROM sessions WHERE token = ?", [token])
        db.commit()
        db.close()
    return jsonify({"ok": True})

@app.route('/api/me', methods=['GET'])
def me():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    return jsonify({"user": {"id": user["id"], "email": user["email"], "name": user["name"]}})

# ---------------------
# Password Reset API
# ---------------------

import random

RESET_CODE_EXPIRY = 600  # 10 minutes

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "Email is required"}), 400
    db = get_db()
    user = db.execute("SELECT id, email FROM users WHERE email = ?", [email]).fetchone()
    if not user:
        db.close()
        # Don't reveal whether the email exists — return success either way
        return jsonify({"ok": True, "message": "If an account exists with that email, a reset code has been generated."})
    # Invalidate any previous unused codes for this user
    db.execute("UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0", [user["id"]])
    # Generate 6-digit code
    code = f"{random.randint(0, 999999):06d}"
    db.execute("INSERT INTO password_resets (user_id, code, created_at) VALUES (?, ?, ?)",
               [user["id"], code, time.time()])
    db.commit()
    db.close()
    # In production, send this code via email. For now, return it in the response.
    # TODO: integrate with SendGrid/Resend to email the code
    return jsonify({"ok": True, "message": "If an account exists with that email, a reset code has been generated.", "_code": code})

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    new_password = body.get("new_password") or ""
    if not email or not code or not new_password:
        return jsonify({"error": "Email, code, and new password are required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    db = get_db()
    user = db.execute("SELECT id FROM users WHERE email = ?", [email]).fetchone()
    if not user:
        db.close()
        return jsonify({"error": "Invalid reset code"}), 400
    reset = db.execute(
        "SELECT id, code, created_at FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1",
        [user["id"]]
    ).fetchone()
    if not reset:
        db.close()
        return jsonify({"error": "Invalid or expired reset code"}), 400
    # Check expiry
    if time.time() - reset["created_at"] > RESET_CODE_EXPIRY:
        db.execute("UPDATE password_resets SET used = 1 WHERE id = ?", [reset["id"]])
        db.commit()
        db.close()
        return jsonify({"error": "Reset code has expired. Please request a new one."}), 400
    # Check code
    if reset["code"] != code:
        db.close()
        return jsonify({"error": "Invalid reset code"}), 400
    # Update password and mark code as used
    pw_hash = hash_password(new_password)
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [pw_hash, user["id"]])
    db.execute("UPDATE password_resets SET used = 1 WHERE id = ?", [reset["id"]])
    # Invalidate all sessions (force re-login with new password)
    db.execute("DELETE FROM sessions WHERE user_id = ?", [user["id"]])
    db.commit()
    db.close()
    return jsonify({"ok": True, "message": "Password has been reset. Please sign in with your new password."})

@app.route('/api/portfolio', methods=['GET', 'POST'])
def portfolio_route():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    if request.method == 'GET':
        row = db.execute("SELECT data FROM portfolios WHERE user_id = ?", [user["id"]]).fetchone()
        db.close()
        return jsonify({"portfolio": json.loads(row["data"]) if row else {}})
    else:
        body = request.get_json() or {}
        data = json.dumps(body.get("portfolio", {}))
        existing = db.execute("SELECT id FROM portfolios WHERE user_id = ?", [user["id"]]).fetchone()
        if existing:
            db.execute("UPDATE portfolios SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                       [data, user["id"]])
        else:
            db.execute("INSERT INTO portfolios (user_id, data) VALUES (?, ?)", [user["id"], data])
        db.commit()
        db.close()
        return jsonify({"ok": True})

@app.route('/api/watchlist', methods=['GET', 'POST'])
def watchlist_route():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    if request.method == 'GET':
        row = db.execute("SELECT data FROM watchlists WHERE user_id = ?", [user["id"]]).fetchone()
        db.close()
        return jsonify({"watchlist": json.loads(row["data"]) if row else []})
    else:
        body = request.get_json() or {}
        data = json.dumps(body.get("watchlist", []))
        existing = db.execute("SELECT id FROM watchlists WHERE user_id = ?", [user["id"]]).fetchone()
        if existing:
            db.execute("UPDATE watchlists SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                       [data, user["id"]])
        else:
            db.execute("INSERT INTO watchlists (user_id, data) VALUES (?, ?)", [user["id"], data])
        db.commit()
        db.close()
        return jsonify({"ok": True})

# ---------------------
# Market Data API routes
# ---------------------

import yfinance as yf

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
os.makedirs(CACHE_DIR, exist_ok=True)

def cache_key_hash(prefix, params):
    raw = f"{prefix}:{json.dumps(params, sort_keys=True)}"
    return hashlib.md5(raw.encode()).hexdigest()

def cache_get(key, max_age):
    path = os.path.join(CACHE_DIR, f"{key}.json")
    try:
        if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age:
            with open(path) as f:
                return json.load(f)
    except:
        pass
    return None

def cache_set(key, data):
    try:
        with open(os.path.join(CACHE_DIR, f"{key}.json"), "w") as f:
            json.dump(data, f, default=str)
    except:
        pass

def fetch_quotes(tickers):
    results = {}
    for symbol in tickers:
        ck = cache_key_hash("quote", {"t": symbol})
        cached = cache_get(ck, 60)
        if cached:
            results[symbol] = cached
            continue
        try:
            t = yf.Ticker(symbol)
            info = t.info
            price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose", 0)
            prev = info.get("previousClose") or price
            dc = price - prev if price and prev else 0
            dcp = (dc / prev * 100) if prev else 0
            mc = info.get("marketCap", 0)
            mc_str = f"{mc/1e12:.2f}T" if mc >= 1e12 else f"{mc/1e9:.1f}B" if mc >= 1e9 else f"{mc/1e6:.0f}M" if mc >= 1e6 else str(mc)
            vol = info.get("volume") or 0
            vol_str = f"{vol/1e6:.1f}M" if vol >= 1e6 else f"{vol/1e3:.0f}K" if vol >= 1e3 else str(vol)
            dy = info.get("dividendYield")
            dy = round(dy * 100, 2) if dy and 0 < dy < 1 else round(dy, 2) if dy else 0
            recs = None
            try: recs = t.recommendations
            except: pass
            buy = hold = sell = 0
            if recs is not None and len(recs) > 0:
                r = recs.iloc[0]
                buy = int(r.get("strongBuy", 0)) + int(r.get("buy", 0))
                hold = int(r.get("hold", 0))
                sell = int(r.get("sell", 0)) + int(r.get("strongSell", 0))
            data = {
                "name": info.get("shortName") or symbol, "sector": info.get("sector") or "Unknown",
                "price": round(price, 2), "previousClose": round(prev, 2),
                "dayChange": round(dc, 2), "dayChangePct": round(dcp, 2),
                "pe": round(info.get("trailingPE") or 0, 1), "marketCap": mc_str,
                "high52": round(info.get("fiftyTwoWeekHigh") or 0, 2),
                "low52": round(info.get("fiftyTwoWeekLow") or 0, 2),
                "volume": vol_str, "divYield": dy,
                "divPerShare": round(info.get("dividendRate") or 0, 2),
                "beta": round(info.get("beta") or 1.0, 2),
                "analystBuy": buy, "analystHold": hold, "analystSell": sell,
                "ptLow": round(info.get("targetLowPrice") or 0, 0),
                "ptAvg": round(info.get("targetMeanPrice") or 0, 0),
                "ptHigh": round(info.get("targetHighPrice") or 0, 0),
                "eps": round(info.get("trailingEps") or 0, 2),
            }
            cache_set(ck, data)
            results[symbol] = data
        except Exception as e:
            results[symbol] = {"error": str(e), "name": symbol, "price": 0}
    return results

def fetch_history(tickers, period="1mo"):
    results = {}
    ttl = 3600 if period in ("1y", "2y", "5y", "max") else 600 if period in ("3mo", "6mo") else 300
    for symbol in tickers:
        ck = cache_key_hash("hist", {"t": symbol, "p": period})
        cached = cache_get(ck, ttl)
        if cached:
            results[symbol] = cached
            continue
        try:
            h = yf.Ticker(symbol).history(period=period)
            if h.empty:
                results[symbol] = {"dates": [], "close": []}
                continue
            data = {
                "dates": [d.strftime("%Y-%m-%d") for d in h.index],
                "close": [round(v, 2) for v in h["Close"].tolist()],
            }
            cache_set(ck, data)
            results[symbol] = data
        except:
            results[symbol] = {"dates": [], "close": []}
    return results

@app.route('/market/quotes')
def market_quotes():
    tickers = [t.strip().upper() for t in request.args.get('tickers', '').split(',') if t.strip()]
    if not tickers:
        return jsonify({"error": "tickers required"}), 400
    return jsonify({"quotes": fetch_quotes(tickers[:30])})

@app.route('/market/history')
def market_history():
    tickers = [t.strip().upper() for t in request.args.get('tickers', '').split(',') if t.strip()]
    if not tickers:
        return jsonify({"error": "tickers required"}), 400
    return jsonify({"history": fetch_history(tickers[:10], request.args.get('period', '1mo'))})

@app.route('/market/news')
def market_news():
    tickers = [t.strip().upper() for t in request.args.get('tickers', '').split(',') if t.strip()]
    all_news = []
    seen = set()
    for symbol in tickers[:5]:
        ck = cache_key_hash("news", {"t": symbol})
        cached = cache_get(ck, 900)
        if cached:
            for item in cached:
                if item["id"] not in seen:
                    seen.add(item["id"])
                    all_news.append(item)
            continue
        try:
            news = yf.Ticker(symbol).news or []
            items = []
            for n in news[:8]:
                c = n.get("content", {})
                title = c.get("title", "")
                if not title: continue
                item = {
                    "id": c.get("id", ""), "headline": title,
                    "summary": c.get("summary", ""),
                    "source": c.get("provider", {}).get("displayName", "Yahoo Finance"),
                    "url": c.get("clickThroughUrl", {}).get("url", ""),
                    "pubDate": c.get("pubDate", ""), "ticker": symbol,
                }
                items.append(item)
                if item["id"] not in seen:
                    seen.add(item["id"])
                    all_news.append(item)
            cache_set(ck, items)
        except: pass
    all_news.sort(key=lambda x: x.get("pubDate", ""), reverse=True)
    return jsonify({"news": all_news[:30]})

@app.route('/market/search')
def market_search():
    query = request.args.get('q', '')
    if not query:
        return jsonify({"error": "q required"}), 400
    ck = cache_key_hash("search", {"q": query})
    cached = cache_get(ck, 3600)
    if cached:
        return jsonify({"results": cached})
    try:
        results = [{"symbol": q.get("symbol"), "name": q.get("shortname") or q.get("symbol"), "type": q.get("quoteType")}
                   for q in (yf.Search(query).quotes or [])[:12] if q.get("quoteType") in ("EQUITY", "ETF")]
        cache_set(ck, results)
        return jsonify({"results": results})
    except:
        return jsonify({"results": []})

@app.route('/market/sp500')
def market_sp500():
    period = request.args.get('period', '1mo')
    ck = cache_key_hash("sp500", {"p": period})
    cached = cache_get(ck, 600)
    if cached:
        return jsonify({"sp500": cached})
    try:
        h = yf.Ticker("^GSPC").history(period=period)
        data = {"dates": [d.strftime("%Y-%m-%d") for d in h.index], "close": [round(v, 2) for v in h["Close"].tolist()]}
        cache_set(ck, data)
        return jsonify({"sp500": data})
    except:
        return jsonify({"sp500": {"dates": [], "close": []}})

# ---------------------
# Bloomberg-lite: imports, constants, helpers
# ---------------------

import pandas as pd
import numpy as np
import math

SCREENER_UNIVERSE = [
    "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "META", "BRK-B", "TSLA", "UNH", "XOM",
    "JNJ", "JPM", "V", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "LLY",
    "PEP", "KO", "COST", "AVGO", "TMO", "MCD", "WMT", "CSCO", "ACN", "ABT",
    "CRM", "DHR", "CMCSA", "VZ", "ADBE", "NKE", "NFLX", "TXN", "PM", "NEE",
    "BMY", "RTX", "HON", "UNP", "QCOM", "LOW", "INTC", "ORCL", "AMD", "SBUX",
    "CAT", "BA", "GS", "ISRG", "AMAT", "MS", "BLK", "MDT", "ADP", "DE",
    "GILD", "PYPL", "SYK", "BKNG", "CB", "MDLZ", "ADI", "REGN", "VRTX", "AXP",
    "TMUS", "LRCX", "MU", "PANW", "KLAC", "SNPS", "CDNS", "FI", "CME", "SHW",
    "PLD", "ICE", "ABNB", "MCO", "APD", "NSC", "MAR", "DIS", "HUM", "CL",
    "TGT", "SO", "DUK", "F", "GM", "RIVN", "PLTR", "COIN", "SOFI", "SQ",
]

# Sector ETF mapping for heatmap
SECTOR_ETFS = {
    "XLK":  "Technology",
    "XLF":  "Financials",
    "XLV":  "Health Care",
    "XLE":  "Energy",
    "XLI":  "Industrials",
    "XLC":  "Communication Services",
    "XLY":  "Consumer Discretionary",
    "XLP":  "Consumer Staples",
    "XLB":  "Materials",
    "XLRE": "Real Estate",
    "XLU":  "Utilities",
}

# Major indices
INDEX_MAP = {
    "^GSPC":  "S&P 500",
    "^DJI":   "Dow Jones",
    "^IXIC":  "Nasdaq Composite",
    "^RUT":   "Russell 2000",
    "^VIX":   "VIX",
    "^FTSE":  "FTSE 100",
    "^N225":  "Nikkei 225",
    "^GDAXI": "DAX",
}

def _safe(v):
    """Convert a value to a JSON-safe primitive (NaN/Inf → None)."""
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(v, (np.floating, np.integer)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if isinstance(v, (pd.Timestamp,)):
        return str(v.date())
    return v

def _safe_round(v, digits=2):
    s = _safe(v)
    if s is None:
        return None
    try:
        return round(float(s), digits)
    except Exception:
        return None

def _df_to_annual(df, row_keys):
    """
    Convert a yfinance financial DataFrame (rows=items, cols=dates) to a
    dict keyed by year-string, each containing only the requested row_keys.
    Returns last 4 years sorted oldest-first.
    """
    if df is None or df.empty:
        return {}
    result = {}
    for col in df.columns[:4]:  # most-recent 4 columns
        year = str(col.year) if hasattr(col, 'year') else str(col)[:4]
        entry = {}
        for key, row_label in row_keys.items():
            val = None
            if row_label in df.index:
                val = _safe(df.loc[row_label, col])
            entry[key] = val
        result[year] = entry
    # return in chronological order
    return dict(sorted(result.items()))


# ---------------------
# /market/fundamentals
# ---------------------

@app.route('/market/fundamentals')
def market_fundamentals():
    ticker = request.args.get('ticker', '').strip().upper()
    if not ticker:
        return jsonify({"error": "ticker required"}), 400
    ck = cache_key_hash("fundamentals", {"t": ticker})
    cached = cache_get(ck, 3600)
    if cached:
        return jsonify(cached)
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        # ── Income Statement ──
        income_stmt = _df_to_annual(t.financials, {
            "revenue":          "Total Revenue",
            "gross_profit":     "Gross Profit",
            "operating_income": "Operating Income",
            "net_income":       "Net Income",
        })

        # ── Balance Sheet ──
        bs = t.balance_sheet
        balance = _df_to_annual(bs, {
            "total_assets":      "Total Assets",
            "total_liabilities": "Total Liabilities Net Minority Interest",
            "total_equity":      "Stockholders Equity",
            "cash":              "Cash And Cash Equivalents",
            "debt":              "Total Debt",
        })

        # ── Cash Flow ──
        cf = t.cashflow
        cash_flow = _df_to_annual(cf, {
            "operating":       "Operating Cash Flow",
            "investing":       "Investing Cash Flow",
            "financing":       "Financing Cash Flow",
            "free_cash_flow":  "Free Cash Flow",
        })

        # ── Key Ratios from info ──
        roe    = _safe_round(info.get("returnOnEquity"))
        roa    = _safe_round(info.get("returnOnAssets"))
        pm     = _safe_round(info.get("profitMargins"))
        d2e    = _safe_round(info.get("debtToEquity"))
        cr     = _safe_round(info.get("currentRatio"))
        qr     = _safe_round(info.get("quickRatio"))
        key_ratios = {
            "ROE": roe, "ROA": roa,
            "profit_margin": pm, "debt_to_equity": d2e,
            "current_ratio": cr, "quick_ratio": qr,
        }

        # ── Earnings / Revenue Estimates ──
        earnings_estimates = {
            "current_year_eps":  _safe_round(info.get("epsCurrentYear")),
            "next_year_eps":     _safe_round(info.get("epsForward")),
            "current_year_revenue": _safe(info.get("revenueEstimateCurrentYear")),
            "next_year_revenue":    _safe(info.get("revenueEstimateNextYear")),
        }
        revenue_estimates = {
            "current_year": _safe(info.get("revenueEstimateCurrentYear")),
            "next_year":    _safe(info.get("revenueEstimateNextYear")),
        }

        # ── Historical Quarterly EPS (last 8 quarters) ──
        quarterly_eps = []
        try:
            ed = t.earnings_dates
            if ed is not None and not ed.empty:
                ed = ed.dropna(subset=["Reported EPS", "EPS Estimate"], how="all")
                for idx, row in ed.head(8).iterrows():
                    quarterly_eps.append({
                        "date":     str(idx.date()) if hasattr(idx, 'date') else str(idx)[:10],
                        "actual":   _safe_round(row.get("Reported EPS")),
                        "estimate": _safe_round(row.get("EPS Estimate")),
                    })
                quarterly_eps.reverse()  # oldest-first
        except Exception:
            pass

        result = {
            "ticker": ticker,
            "name": info.get("shortName") or ticker,
            "income_statement": income_stmt,
            "balance_sheet": balance,
            "cash_flow": cash_flow,
            "key_ratios": key_ratios,
            "earnings_estimates": earnings_estimates,
            "revenue_estimates": revenue_estimates,
            "quarterly_eps": quarterly_eps,
        }
        cache_set(ck, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------
# /market/screener
# ---------------------

@app.route('/market/screener', methods=['GET', 'POST'])
def market_screener():
    if request.method == 'POST':
        params = request.get_json() or {}
    else:
        params = request.args.to_dict()

    sector         = params.get('sector', '').strip()
    min_pe         = _safe(float(params['min_pe']))         if 'min_pe'         in params else None
    max_pe         = _safe(float(params['max_pe']))         if 'max_pe'         in params else None
    min_market_cap = _safe(float(params['min_market_cap'])) if 'min_market_cap' in params else None
    max_market_cap = _safe(float(params['max_market_cap'])) if 'max_market_cap' in params else None
    min_div_yield  = _safe(float(params['min_div_yield']))  if 'min_div_yield'  in params else None
    max_div_yield  = _safe(float(params['max_div_yield']))  if 'max_div_yield'  in params else None
    min_beta       = _safe(float(params['min_beta']))       if 'min_beta'       in params else None
    max_beta       = _safe(float(params['max_beta']))       if 'max_beta'       in params else None
    min_52w_pct    = _safe(float(params['min_52w_pct']))    if 'min_52w_pct'    in params else None
    max_52w_pct    = _safe(float(params['max_52w_pct']))    if 'max_52w_pct'    in params else None

    ck_universe = cache_key_hash("screener_universe", {})
    all_quotes = cache_get(ck_universe, 300)
    if not all_quotes:
        all_quotes = fetch_quotes(SCREENER_UNIVERSE)
        cache_set(ck_universe, all_quotes)

    results = []
    for sym, q in all_quotes.items():
        if q.get("error"):
            continue
        # Sector filter
        if sector and q.get("sector", "").lower() != sector.lower():
            continue

        pe_val = q.get("pe") or 0
        # Parse market cap back to numeric
        mc_raw = q.get("marketCap", "0")
        try:
            if isinstance(mc_raw, str):
                if mc_raw.endswith('T'):
                    mc_num = float(mc_raw[:-1]) * 1e12
                elif mc_raw.endswith('B'):
                    mc_num = float(mc_raw[:-1]) * 1e9
                elif mc_raw.endswith('M'):
                    mc_num = float(mc_raw[:-1]) * 1e6
                else:
                    mc_num = float(mc_raw)
            else:
                mc_num = float(mc_raw)
        except Exception:
            mc_num = 0

        div_yield = q.get("divYield") or 0
        beta      = q.get("beta") or 1.0
        price     = q.get("price") or 0
        low52     = q.get("low52") or 0
        pct_from_low = ((price - low52) / low52 * 100) if low52 else 0

        if min_pe         is not None and (pe_val <= 0 or pe_val < min_pe): continue
        if max_pe         is not None and (pe_val <= 0 or pe_val > max_pe): continue
        if min_market_cap is not None and mc_num < min_market_cap: continue
        if max_market_cap is not None and mc_num > max_market_cap: continue
        if min_div_yield  is not None and div_yield < min_div_yield: continue
        if max_div_yield  is not None and div_yield > max_div_yield: continue
        if min_beta       is not None and beta < min_beta: continue
        if max_beta       is not None and beta > max_beta: continue
        if min_52w_pct    is not None and pct_from_low < min_52w_pct: continue
        if max_52w_pct    is not None and pct_from_low > max_52w_pct: continue

        results.append({
            "ticker": sym,
            "name":          q.get("name"),
            "sector":        q.get("sector"),
            "price":         q.get("price"),
            "dayChangePct":  q.get("dayChangePct"),
            "pe":            pe_val,
            "marketCap":     q.get("marketCap"),
            "marketCapNum":  mc_num,
            "divYield":      div_yield,
            "beta":          beta,
            "high52":        q.get("high52"),
            "low52":         low52,
            "pctFrom52wLow": round(pct_from_low, 2),
            "eps":           q.get("eps"),
        })

    results.sort(key=lambda x: x.get("marketCapNum") or 0, reverse=True)
    return jsonify({"results": results, "count": len(results)})


# ---------------------
# /market/peers
# ---------------------

@app.route('/market/peers')
def market_peers():
    ticker = request.args.get('ticker', '').strip().upper()
    if not ticker:
        return jsonify({"error": "ticker required"}), 400
    ck = cache_key_hash("peers", {"t": ticker})
    cached = cache_get(ck, 1800)
    if cached:
        return jsonify(cached)
    try:
        # Determine sector of the requested ticker
        base_info = yf.Ticker(ticker).info or {}
        base_sector = base_info.get("sector") or ""

        # Find peers in SCREENER_UNIVERSE with the same sector
        peer_tickers = []
        if base_sector:
            ck_u = cache_key_hash("screener_universe", {})
            universe_quotes = cache_get(ck_u, 300)
            if not universe_quotes:
                universe_quotes = fetch_quotes(SCREENER_UNIVERSE)
                cache_set(ck_u, universe_quotes)
            for sym, q in universe_quotes.items():
                if sym != ticker and q.get("sector", "").lower() == base_sector.lower():
                    peer_tickers.append(sym)

        # Include the base ticker itself for comparison
        compare_set = [ticker] + peer_tickers[:14]

        peers = []
        for sym in compare_set:
            info = (yf.Ticker(sym).info or {}) if sym != ticker else base_info
            price    = info.get("currentPrice") or info.get("regularMarketPrice") or 0
            prev     = info.get("previousClose") or price
            mc       = info.get("marketCap") or 0
            revenue  = info.get("totalRevenue") or 0
            rev_gr   = info.get("revenueGrowth")
            dy       = info.get("dividendYield")
            dy       = round(dy * 100, 2) if dy and 0 < dy < 1 else (round(dy, 2) if dy else 0)
            peers.append({
                "ticker":         sym,
                "name":           info.get("shortName") or sym,
                "is_base":        sym == ticker,
                "price":          _safe_round(price),
                "market_cap":     _safe(mc),
                "pe":             _safe_round(info.get("trailingPE")),
                "ev_ebitda":      _safe_round(info.get("enterpriseToEbitda")),
                "price_to_sales": _safe_round(info.get("priceToSalesTrailing12Months")),
                "price_to_book":  _safe_round(info.get("priceToBook")),
                "revenue_growth": _safe_round(rev_gr),
                "profit_margin":  _safe_round(info.get("profitMargins")),
                "roe":            _safe_round(info.get("returnOnEquity")),
                "div_yield":      dy,
                "sector":         info.get("sector") or base_sector,
            })

        result = {"ticker": ticker, "sector": base_sector, "peers": peers}
        cache_set(ck, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------
# /market/calendar
# ---------------------

ECONOMIC_EVENTS_2026 = [
    # FOMC meetings
    {"date": "2026-01-28", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-03-18", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-05-06", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-06-17", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-07-29", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-09-16", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-11-04", "event": "FOMC Rate Decision",       "category": "Fed"},
    {"date": "2026-12-16", "event": "FOMC Rate Decision",       "category": "Fed"},
    # CPI releases (approximate first-Tuesday-of-month+10)
    {"date": "2026-01-15", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-02-12", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-03-12", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-04-10", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-05-13", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-06-11", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-07-14", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-08-13", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-09-11", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-10-13", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-11-12", "event": "CPI Report",               "category": "Inflation"},
    {"date": "2026-12-10", "event": "CPI Report",               "category": "Inflation"},
    # NFP (first Friday of month)
    {"date": "2026-01-09", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-02-06", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-03-06", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-04-03", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-05-08", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-06-05", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-07-10", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-08-07", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-09-04", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-10-02", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-11-06", "event": "Non-Farm Payrolls",        "category": "Employment"},
    {"date": "2026-12-04", "event": "Non-Farm Payrolls",        "category": "Employment"},
    # GDP advance estimates (quarterly)
    {"date": "2026-01-29", "event": "GDP Advance Estimate Q4 2025", "category": "GDP"},
    {"date": "2026-04-29", "event": "GDP Advance Estimate Q1 2026", "category": "GDP"},
    {"date": "2026-07-30", "event": "GDP Advance Estimate Q2 2026", "category": "GDP"},
    {"date": "2026-10-29", "event": "GDP Advance Estimate Q3 2026", "category": "GDP"},
]

@app.route('/market/calendar')
def market_calendar():
    tickers_param = request.args.get('tickers', '').strip()
    tickers = [t.strip().upper() for t in tickers_param.split(',') if t.strip()] if tickers_param else []

    ck = cache_key_hash("calendar", {"tickers": sorted(tickers)})
    cached = cache_get(ck, 3600)
    if cached:
        return jsonify(cached)

    earnings_calendar = []
    for sym in tickers[:20]:
        try:
            ed = yf.Ticker(sym).earnings_dates
            if ed is None or ed.empty:
                continue
            for idx, row in ed.head(4).iterrows():
                date_str = str(idx.date()) if hasattr(idx, 'date') else str(idx)[:10]
                earnings_calendar.append({
                    "ticker":   sym,
                    "date":     date_str,
                    "eps_estimate": _safe_round(row.get("EPS Estimate")),
                    "reported_eps": _safe_round(row.get("Reported EPS")),
                })
        except Exception:
            pass

    result = {
        "earnings": sorted(earnings_calendar, key=lambda x: x["date"]),
        "economic_events": sorted(ECONOMIC_EVENTS_2026, key=lambda x: x["date"]),
    }
    cache_set(ck, result)
    return jsonify(result)


# ---------------------
# /market/technicals
# ---------------------

def _compute_rsi(series, period=14):
    """Wilder-smoothed RSI."""
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = -delta.clip(upper=0)
    # First average: SMA
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    # Then Wilder smoothing
    for i in range(period, len(series)):
        avg_gain.iat[i] = (avg_gain.iat[i-1] * (period - 1) + gain.iat[i]) / period
        avg_loss.iat[i] = (avg_loss.iat[i-1] * (period - 1) + loss.iat[i]) / period
    rs  = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi

def _to_list(series):
    """Pandas Series → list of JSON-safe values."""
    return [_safe_round(v, 4) for v in series.tolist()]

@app.route('/market/technicals')
def market_technicals():
    ticker = request.args.get('ticker', '').strip().upper()
    period = request.args.get('period', '6mo')
    if not ticker:
        return jsonify({"error": "ticker required"}), 400
    ck = cache_key_hash("technicals", {"t": ticker, "p": period})
    cached = cache_get(ck, 300)
    if cached:
        return jsonify(cached)
    try:
        h = yf.Ticker(ticker).history(period=period)
        if h.empty:
            return jsonify({"error": "No data"}), 404

        close  = h["Close"]
        dates  = [d.strftime("%Y-%m-%d") for d in h.index]

        # SMAs
        sma20  = close.rolling(20).mean()
        sma50  = close.rolling(50).mean()
        sma200 = close.rolling(200).mean()

        # EMAs
        ema12  = close.ewm(span=12, adjust=False).mean()
        ema26  = close.ewm(span=26, adjust=False).mean()

        # MACD
        macd_line   = ema12 - ema26
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        histogram   = macd_line - signal_line

        # Bollinger Bands
        bb_mid   = close.rolling(20).mean()
        bb_std   = close.rolling(20).std()
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std

        # RSI
        rsi = _compute_rsi(close, 14)

        result = {
            "ticker": ticker,
            "period": period,
            "dates":  dates,
            "ohlcv": {
                "open":   [_safe_round(v, 4) for v in h["Open"].tolist()],
                "high":   [_safe_round(v, 4) for v in h["High"].tolist()],
                "low":    [_safe_round(v, 4) for v in h["Low"].tolist()],
                "close":  [_safe_round(v, 4) for v in h["Close"].tolist()],
                "volume": [int(v) if v == v else None for v in h["Volume"].tolist()],
            },
            "indicators": {
                "SMA_20":  _to_list(sma20),
                "SMA_50":  _to_list(sma50),
                "SMA_200": _to_list(sma200),
                "EMA_12":  _to_list(ema12),
                "EMA_26":  _to_list(ema26),
                "RSI_14":  _to_list(rsi),
                "MACD": {
                    "macd_line":   _to_list(macd_line),
                    "signal_line": _to_list(signal_line),
                    "histogram":   _to_list(histogram),
                },
                "bollinger": {
                    "upper":  _to_list(bb_upper),
                    "middle": _to_list(bb_mid),
                    "lower":  _to_list(bb_lower),
                },
            },
        }
        cache_set(ck, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------
# /market/indices
# ---------------------

@app.route('/market/indices')
def market_indices():
    ck = cache_key_hash("indices", {})
    cached = cache_get(ck, 120)
    if cached:
        return jsonify(cached)
    indices = []
    for symbol, name in INDEX_MAP.items():
        try:
            info  = yf.Ticker(symbol).info or {}
            price = info.get("regularMarketPrice") or info.get("previousClose") or 0
            prev  = info.get("previousClose") or price
            chg   = price - prev if price and prev else 0
            chg_p = (chg / prev * 100) if prev else 0
            indices.append({
                "symbol":     symbol,
                "name":       name,
                "price":      _safe_round(price, 2),
                "change":     _safe_round(chg, 2),
                "change_pct": _safe_round(chg_p, 2),
            })
        except Exception as e:
            indices.append({"symbol": symbol, "name": name, "error": str(e)})
    result = {"indices": indices}
    cache_set(ck, result)
    return jsonify(result)


# ---------------------
# /market/heatmap
# ---------------------

@app.route('/market/heatmap')
def market_heatmap():
    ck = cache_key_hash("heatmap", {})
    cached = cache_get(ck, 300)
    if cached:
        return jsonify(cached)
    sectors = []
    etf_list = list(SECTOR_ETFS.keys())
    try:
        # Fetch 1-month history for all ETFs at once for efficiency
        raw = yf.download(etf_list, period="1mo", progress=False, auto_adjust=True)
        close_df = raw["Close"] if "Close" in raw else raw
    except Exception:
        close_df = None

    for etf, sector_name in SECTOR_ETFS.items():
        try:
            info  = yf.Ticker(etf).info or {}
            price = info.get("regularMarketPrice") or info.get("previousClose") or 0
            prev  = info.get("previousClose") or price
            day_chg_p = ((price - prev) / prev * 100) if prev else 0

            # Compute 5d and 1mo change from history
            five_d_pct = None
            one_mo_pct = None
            try:
                if close_df is not None and etf in close_df.columns:
                    col = close_df[etf].dropna()
                else:
                    col = yf.Ticker(etf).history(period="1mo")["Close"].dropna()
                if len(col) >= 2:
                    one_mo_pct = _safe_round((col.iloc[-1] / col.iloc[0] - 1) * 100)
                if len(col) >= 6:
                    five_d_pct = _safe_round((col.iloc[-1] / col.iloc[-6] - 1) * 100)
            except Exception:
                pass

            sectors.append({
                "etf":          etf,
                "sector":       sector_name,
                "price":        _safe_round(price),
                "day_change_pct":   _safe_round(day_chg_p),
                "5d_change_pct":    five_d_pct,
                "1mo_change_pct":   one_mo_pct,
            })
        except Exception as e:
            sectors.append({"etf": etf, "sector": sector_name, "error": str(e)})

    result = {"sectors": sectors}
    cache_set(ck, result)
    return jsonify(result)


# ---------------------
# /api/alerts  (auth required)
# ---------------------

@app.route('/api/alerts', methods=['GET', 'POST', 'DELETE'])
def api_alerts():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    try:
        if request.method == 'GET':
            rows = db.execute(
                "SELECT id, ticker, condition, price, enabled, triggered, created_at "
                "FROM alerts WHERE user_id = ? ORDER BY created_at DESC",
                [user["id"]]
            ).fetchall()
            alerts = [dict(r) for r in rows]
            return jsonify({"alerts": alerts})

        elif request.method == 'POST':
            body = request.get_json() or {}
            ticker    = (body.get("ticker") or "").strip().upper()
            condition = (body.get("condition") or "").strip().lower()
            price_val = body.get("price")
            enabled   = 1 if body.get("enabled", True) else 0
            if not ticker or condition not in ("above", "below") or price_val is None:
                return jsonify({"error": "ticker, condition ('above'|'below'), and price are required"}), 400
            try:
                price_val = float(price_val)
            except (TypeError, ValueError):
                return jsonify({"error": "price must be a number"}), 400
            cursor = db.execute(
                "INSERT INTO alerts (user_id, ticker, condition, price, enabled) VALUES (?, ?, ?, ?, ?)",
                [user["id"], ticker, condition, price_val, enabled]
            )
            db.commit()
            return jsonify({"ok": True, "id": cursor.lastrowid}), 201

        else:  # DELETE
            body      = request.get_json() or {}
            alert_id  = body.get("id") or request.args.get("id")
            if not alert_id:
                return jsonify({"error": "id required"}), 400
            result = db.execute(
                "DELETE FROM alerts WHERE id = ? AND user_id = ?",
                [alert_id, user["id"]]
            )
            db.commit()
            if result.rowcount == 0:
                return jsonify({"error": "Alert not found"}), 404
            return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ---------------------
# /api/saved_screens  (auth required)
# ---------------------

@app.route('/api/saved_screens', methods=['GET', 'POST', 'DELETE'])
def api_saved_screens():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    try:
        if request.method == 'GET':
            rows = db.execute(
                "SELECT id, name, filters, created_at FROM saved_screens "
                "WHERE user_id = ? ORDER BY created_at DESC",
                [user["id"]]
            ).fetchall()
            screens = []
            for r in rows:
                d = dict(r)
                try:
                    d["filters"] = json.loads(d["filters"])
                except Exception:
                    pass
                screens.append(d)
            return jsonify({"saved_screens": screens})

        elif request.method == 'POST':
            body    = request.get_json() or {}
            name    = (body.get("name") or "").strip()
            filters = body.get("filters", {})
            if not name:
                return jsonify({"error": "name is required"}), 400
            cursor = db.execute(
                "INSERT INTO saved_screens (user_id, name, filters) VALUES (?, ?, ?)",
                [user["id"], name, json.dumps(filters)]
            )
            db.commit()
            return jsonify({"ok": True, "id": cursor.lastrowid}), 201

        else:  # DELETE
            body      = request.get_json() or {}
            screen_id = body.get("id") or request.args.get("id")
            if not screen_id:
                return jsonify({"error": "id required"}), 400
            result = db.execute(
                "DELETE FROM saved_screens WHERE id = ? AND user_id = ?",
                [screen_id, user["id"]]
            )
            db.commit()
            if result.rowcount == 0:
                return jsonify({"error": "Screen not found"}), 404
            return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ---------------------
# Health check (for Cloud Run)
# ---------------------

@app.route('/healthz')
def healthz():
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
