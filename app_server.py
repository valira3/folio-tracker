#!/usr/bin/env python3
"""
Folio Portfolio Tracker — Flask Server
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
# Health check (for Cloud Run)
# ---------------------

@app.route('/healthz')
def healthz():
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
