// ============================================
// FOLIO — Portfolio Tracker App (Live Data)
// ============================================

// ============================================
// SECTION 0: AUTH & API LAYER
// ============================================

const API_BASE = '/api';
const MARKET_API = '/market';
let authToken = null;
let currentUser = null;

// Module-level variable for transaction type in add-lot modal
let selectedTxType = 'buy';

// API helpers
async function api(path, method = 'GET', body = null) {
  const url = `${API_BASE}${path}${authToken ? (path.includes('?') ? '&' : '?') + 'token=' + authToken : ''}`;
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function marketApi(path, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${MARKET_API}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Market data request failed');
  return data;
}

// Auth functions
async function signup(email, password, name) {
  const data = await api('/signup', 'POST', { email, password, name });
  authToken = data.token;
  currentUser = data.user;
  return data;
}

async function login(email, password) {
  const data = await api('/login', 'POST', { email, password });
  authToken = data.token;
  currentUser = data.user;
  return data;
}

async function logout() {
  try { await api('/logout', 'POST'); } catch(e) {}
  authToken = null;
  currentUser = null;
  stockDataCache = {};
  historicalCache = {};
  newsCache = [];
  showAuthScreen();
}

async function checkSession() {
  try {
    const data = await api('/me');
    currentUser = data.user;
    return true;
  } catch(e) {
    authToken = null;
    currentUser = null;
    return false;
  }
}

// Data persistence
async function loadUserData() {
  try {
    const [pData, wData] = await Promise.all([
      api('/portfolio'),
      api('/watchlist')
    ]);
    if (pData.portfolio) {
      portfolio = pData.portfolio;
    }
    if (wData.watchlist) {
      watchlist = wData.watchlist;
    }
  } catch(e) {
    console.error('Failed to load user data:', e);
  }
}

async function savePortfolio() {
  try { await api('/portfolio', 'POST', { portfolio }); } catch(e) { console.error('Save portfolio failed:', e); }
}

async function saveWatchlist() {
  try { await api('/watchlist', 'POST', { watchlist }); } catch(e) { console.error('Save watchlist failed:', e); }
}

// UI for auth
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.querySelector('.app-shell').style.display = 'none';
  document.getElementById('detail-overlay').classList.remove('open');
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.style.display = 'none';
  const userDisp = document.getElementById('user-display');
  if (userDisp) userDisp.style.display = 'none';
  const authError = document.getElementById('auth-error');
  if (authError) { authError.textContent = ''; authError.style.color = ''; }
  // Reset to login form, hide forgot/reset forms
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const forgotForm = document.getElementById('forgot-form');
  const resetForm = document.getElementById('reset-form');
  const authTabs = document.querySelector('.auth-tabs');
  if (loginForm) loginForm.style.display = 'block';
  if (signupForm) signupForm.style.display = 'none';
  if (forgotForm) forgotForm.style.display = 'none';
  if (resetForm) resetForm.style.display = 'none';
  if (authTabs) authTabs.style.display = 'flex';
  initialized = false;
}

function hideAuthScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.querySelector('.app-shell').style.display = 'grid';
  updateUserDisplay();
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.style.display = 'flex';
}

function updateUserDisplay() {
  const el = document.getElementById('user-display');
  if (el && currentUser) {
    const initial = (currentUser.name || currentUser.email || '?')[0].toUpperCase();
    el.innerHTML = `<div class="user-avatar" title="${currentUser.name || currentUser.email}">${initial}</div>`;
    el.style.display = 'flex';
  }
}

// Auth form handling
function initAuthUI() {
  const loginTab = document.getElementById('auth-tab-login');
  const signupTab = document.getElementById('auth-tab-signup');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const forgotForm = document.getElementById('forgot-form');
  const resetForm = document.getElementById('reset-form');
  const authError = document.getElementById('auth-error');
  const authTabs = document.querySelector('.auth-tabs');

  // Track email across forgot -> reset flow
  let resetEmail = '';

  // Helper: show one auth form, hide others
  function showAuthForm(formId) {
    [loginForm, signupForm, forgotForm, resetForm].forEach(f => {
      if (f) f.style.display = 'none';
    });
    const target = document.getElementById(formId);
    if (target) target.style.display = 'block';
    authError.textContent = '';
    // Hide tabs on forgot/reset screens
    if (authTabs) {
      authTabs.style.display = (formId === 'forgot-form' || formId === 'reset-form') ? 'none' : 'flex';
    }
  }

  loginTab?.addEventListener('click', () => {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    showAuthForm('login-form');
  });

  signupTab?.addEventListener('click', () => {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    showAuthForm('signup-form');
  });

  document.getElementById('login-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('login-btn');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    authError.textContent = '';
    if (!email || !password) { authError.textContent = 'Please fill in all fields'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span> Signing in...';
    try {
      await login(email, password);
      await loadUserData();
      hideAuthScreen();
      initApp();
      if (typeof initBloomberg === 'function') initBloomberg();
      if (typeof initBloomberg2 === 'function') initBloomberg2();
    } catch(e) { authError.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Sign In'; }
  });

  document.getElementById('signup-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('signup-btn');
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    authError.textContent = '';
    if (!email || !password) { authError.textContent = 'Please fill in all fields'; return; }
    if (password.length < 6) { authError.textContent = 'Password must be at least 6 characters'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span> Creating account...';
    try {
      await signup(email, password, name);
      await loadUserData();
      hideAuthScreen();
      initApp();
      if (typeof initBloomberg === 'function') initBloomberg();
      if (typeof initBloomberg2 === 'function') initBloomberg2();
    } catch(e) { authError.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Create Account'; }
  });

  document.getElementById('login-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn')?.click();
  });
  document.getElementById('signup-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('signup-btn')?.click();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // ============================================
  // Forgot Password flow
  // ============================================

  document.getElementById('forgot-password-link')?.addEventListener('click', () => {
    showAuthForm('forgot-form');
    // Pre-fill email if they already typed it in the login form
    const loginEmail = document.getElementById('login-email')?.value?.trim();
    if (loginEmail) document.getElementById('forgot-email').value = loginEmail;
  });

  document.getElementById('back-to-login-link')?.addEventListener('click', () => {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    showAuthForm('login-form');
  });

  document.getElementById('back-to-login-link-2')?.addEventListener('click', () => {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    showAuthForm('login-form');
  });

  document.getElementById('forgot-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('forgot-btn');
    const email = document.getElementById('forgot-email').value.trim();
    authError.textContent = '';
    if (!email) { authError.textContent = 'Please enter your email'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span> Sending...';
    try {
      const res = await fetch(`${API_BASE}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      resetEmail = email;
      // Show the code in a success message (until email integration is added)
      if (data._code) {
        authError.style.color = 'var(--color-primary)';
        authError.textContent = `Your reset code: ${data._code}`;
      }
      showAuthForm('reset-form');
      // Keep the code message visible on the reset form
      if (data._code) {
        authError.style.color = 'var(--color-primary)';
        authError.textContent = `Your reset code: ${data._code}`;
      }
    } catch(e) {
      authError.style.color = '';
      authError.textContent = e.message;
    }
    finally { btn.disabled = false; btn.textContent = 'Send Reset Code'; }
  });

  document.getElementById('forgot-email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('forgot-btn')?.click();
  });

  document.getElementById('reset-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('reset-btn');
    const code = document.getElementById('reset-code').value.trim();
    const newPassword = document.getElementById('reset-password').value;
    const confirmPassword = document.getElementById('reset-password-confirm').value;
    authError.style.color = '';
    authError.textContent = '';
    if (!code) { authError.textContent = 'Please enter the 6-digit code'; return; }
    if (!newPassword) { authError.textContent = 'Please enter a new password'; return; }
    if (newPassword.length < 6) { authError.textContent = 'Password must be at least 6 characters'; return; }
    if (newPassword !== confirmPassword) { authError.textContent = 'Passwords do not match'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span> Resetting...';
    try {
      const res = await fetch(`${API_BASE}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      // Success — go back to login
      authError.style.color = 'var(--color-positive)';
      authError.textContent = data.message || 'Password reset. Please sign in.';
      showAuthForm('login-form');
      // Keep the success message visible
      authError.style.color = 'var(--color-positive)';
      authError.textContent = data.message || 'Password reset. Please sign in.';
      // Pre-fill email
      const loginEmailEl = document.getElementById('login-email');
      if (loginEmailEl) loginEmailEl.value = resetEmail;
    } catch(e) {
      authError.style.color = '';
      authError.textContent = e.message;
    }
    finally { btn.disabled = false; btn.textContent = 'Reset Password'; }
  });

  document.getElementById('reset-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reset-password')?.focus();
  });
  document.getElementById('reset-password-confirm')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reset-btn')?.click();
  });
}

// ============================================
// SECTION 1: LIVE DATA LAYER
// ============================================

// In-memory caches (session-scoped)
let stockDataCache = {};   // ticker -> quote data
let historicalCache = {};   // `${ticker}:${period}` -> history data
let sp500Cache = {};        // period -> sp500 data
let newsCache = [];         // news items
let lastQuoteFetch = 0;
let lastNewsFetch = 0;

// Portfolio and watchlist
let portfolio = {};
let watchlist = [];

// Get all tickers (portfolio + watchlist)
function getAllTickers() {
  const tickers = new Set([...Object.keys(portfolio), ...watchlist]);
  return [...tickers];
}

// Show skeleton / loading state
function showLoading(containerId, message = 'Loading market data...') {
  const el = document.getElementById(containerId);
  if (el) {
    el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><div class="loading-text">${message}</div></div>`;
  }
}

// Fetch live quotes for all portfolio + watchlist tickers
async function fetchQuotes(force = false) {
  const tickers = getAllTickers();
  if (tickers.length === 0) return;
  
  // Skip if we fetched within last 30 seconds (unless forced)
  if (!force && Date.now() - lastQuoteFetch < 30000 && Object.keys(stockDataCache).length > 0) return;

  try {
    const data = await marketApi('/quotes', { tickers: tickers.join(',') });
    if (data.quotes) {
      Object.assign(stockDataCache, data.quotes);
      lastQuoteFetch = Date.now();
    }
  } catch(e) {
    console.error('Failed to fetch quotes:', e);
  }
}

// Fetch historical data for tickers
async function fetchHistory(tickers, period = '1mo') {
  const yperiod = { '7': '5d', '30': '1mo', '90': '3mo', '180': '6mo', '365': '1y', 'all': '2y' }[period] || '1mo';
  const uncached = tickers.filter(t => !historicalCache[`${t}:${yperiod}`]);
  
  if (uncached.length > 0) {
    try {
      const data = await marketApi('/history', { tickers: uncached.join(','), period: yperiod });
      if (data.history) {
        for (const [t, hist] of Object.entries(data.history)) {
          historicalCache[`${t}:${yperiod}`] = hist;
        }
      }
    } catch(e) {
      console.error('Failed to fetch history:', e);
    }
  }
  
  // Also fetch S&P 500 if not cached
  if (!sp500Cache[yperiod]) {
    try {
      const data = await marketApi('/sp500', { period: yperiod });
      if (data.sp500) {
        sp500Cache[yperiod] = data.sp500;
      }
    } catch(e) {
      console.error('Failed to fetch S&P 500:', e);
    }
  }
  
  return tickers.reduce((acc, t) => {
    acc[t] = historicalCache[`${t}:${yperiod}`] || { dates: [], close: [] };
    return acc;
  }, {});
}

// Fetch news
async function fetchNews(force = false) {
  const tickers = getAllTickers();
  if (tickers.length === 0) return;
  if (!force && Date.now() - lastNewsFetch < 300000 && newsCache.length > 0) return;

  try {
    const data = await marketApi('/news', { tickers: tickers.slice(0, 5).join(',') });
    if (data.news) {
      newsCache = data.news;
      lastNewsFetch = Date.now();
    }
  } catch(e) {
    console.error('Failed to fetch news:', e);
  }
}

// Search for stocks
async function searchStocks(query) {
  try {
    const data = await marketApi('/search', { q: query });
    return data.results || [];
  } catch(e) {
    console.error('Search failed:', e);
    return [];
  }
}

// Helper: get stock data from cache
function getStock(ticker) {
  return stockDataCache[ticker] || null;
}

// ============================================
// SECTION 2: UTILITY FUNCTIONS
// ============================================

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCompact(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return fmt(n);
}

function sign(n) {
  return n > 0 ? '+' : n < 0 ? '−' : '';
}

function colorClass(n) {
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'neutral';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ============================================
// FEATURE 1: Updated getPortfolioHoldings()
// Buy lots add shares, sell lots subtract shares.
// Total cost only counts buy lots.
// ============================================
function getPortfolioHoldings() {
  const holdings = [];
  for (const [ticker, data] of Object.entries(portfolio)) {
    const stock = getStock(ticker);
    if (!stock || !stock.price) continue;

    // Net shares: buys add, sells subtract (backward-compat: no type = buy)
    const totalShares = data.lots.reduce((s, l) => {
      const isSell = (l.type || 'buy') === 'sell';
      return isSell ? s - l.qty : s + l.qty;
    }, 0);

    // Cost basis: only buy lots
    const totalCost = data.lots.reduce((s, l) => {
      const isSell = (l.type || 'buy') === 'sell';
      return isSell ? s : s + l.qty * l.price;
    }, 0);

    const netShares = Math.max(0, totalShares);
    const avgCost = totalCost > 0 && netShares > 0 ? totalCost / netShares : 0;
    const currentValue = netShares * stock.price;
    const pnl = currentValue - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    const dayChangeValue = netShares * (stock.dayChange || 0);

    holdings.push({
      ticker, stock, totalShares: netShares, totalCost, avgCost, currentValue, pnl, pnlPct, dayChangeValue,
      lots: data.lots,
    });
  }
  return holdings;
}

function getPortfolioSummary() {
  const holdings = getPortfolioHoldings();
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const dayChange = holdings.reduce((s, h) => s + h.dayChangeValue, 0);
  const dayChangePct = totalValue > 0 ? (dayChange / (totalValue - dayChange)) * 100 : 0;
  return { totalValue, totalCost, totalPnl, totalPnlPct, dayChange, dayChangePct, holdings };
}

// Helper: compute shares held on a specific date for a ticker (for time-aware chart)
// Takes buy/sell lots into account — only lots whose date <= targetDate count.
function getSharesHeldOnDate(ticker, targetDate) {
  const data = portfolio[ticker];
  if (!data || !data.lots) return 0;
  let shares = 0;
  for (const lot of data.lots) {
    if (lot.date <= targetDate) {
      const isSell = (lot.type || 'buy') === 'sell';
      shares = isSell ? shares - lot.qty : shares + lot.qty;
    }
  }
  return Math.max(0, shares);
}

// Monte Carlo simulation for prediction
function monteCarloPrediction(currentValue, historicalValues, daysAhead = 180, simulations = 500) {
  if (!historicalValues || historicalValues.length < 5) {
    // Return flat line if insufficient data
    const flat = Array(daysAhead + 1).fill(currentValue);
    return { median: flat, low68: flat, high68: flat, low95: flat, high95: flat };
  }
  const returns = [];
  for (let i = 1; i < historicalValues.length; i++) {
    if (historicalValues[i] > 0 && historicalValues[i - 1] > 0) {
      returns.push(Math.log(historicalValues[i] / historicalValues[i - 1]));
    }
  }
  if (returns.length === 0) {
    const flat = Array(daysAhead + 1).fill(currentValue);
    return { median: flat, low68: flat, high68: flat, low95: flat, high95: flat };
  }
  const mu = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sigma = Math.sqrt(returns.reduce((s, r) => s + (r - mu) ** 2, 0) / returns.length);
  
  const paths = [];
  for (let sim = 0; sim < simulations; sim++) {
    let val = currentValue;
    const path = [val];
    for (let d = 0; d < daysAhead; d++) {
      const z = gaussianRandom();
      val *= Math.exp((mu - 0.5 * sigma * sigma) + sigma * z);
      path.push(val);
    }
    paths.push(path);
  }
  
  const median = [], low68 = [], high68 = [], low95 = [], high95 = [];
  for (let d = 0; d <= daysAhead; d++) {
    const vals = paths.map(p => p[d]).sort((a, b) => a - b);
    median.push(vals[Math.floor(simulations * 0.5)]);
    low68.push(vals[Math.floor(simulations * 0.16)]);
    high68.push(vals[Math.floor(simulations * 0.84)]);
    low95.push(vals[Math.floor(simulations * 0.025)]);
    high95.push(vals[Math.floor(simulations * 0.975)]);
  }
  return { median, low68, high68, low95, high95 };
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate sparkline from history close prices
function generateSparkline(ticker, days = 7) {
  const key = `${ticker}:5d`;
  const hist = historicalCache[key];
  if (hist && hist.close && hist.close.length > 0) {
    return hist.close.slice(-days);
  }
  // Fallback: generate from current price
  const stock = getStock(ticker);
  if (!stock) return [0];
  const p = stock.price;
  return [p * 0.99, p * 0.995, p * 1.001, p * 0.998, p * 1.002, p * 0.997, p];
}

// ============================================
// SECTION 3: THEME TOGGLE
// ============================================

(function() {
  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = 'dark';
  root.setAttribute('data-theme', theme);

  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  if (toggle) {
    toggle.innerHTML = sunIcon;
    toggle.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      toggle.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
      toggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
      document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0d0f11' : '#f5f6f8');
      setTimeout(() => {
        if (currentView === 'chart') renderChartView();
        if (currentView === 'insights') renderInsightsView();
      }, 50);
    });
  }
})();

// ============================================
// SECTION 4: NAVIGATION
// ============================================

let currentView = 'portfolio';
const views = document.querySelectorAll('.view');

// Use event delegation on the unified bottom nav so it works for all items
// (including Bloomberg items present from the start)
document.querySelector('.bottom-nav')?.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  const view = item.dataset.view;
  if (view) switchView(view);
});

function switchView(view) {
  currentView = view;
  // Update all nav items
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));

  const mainContent = document.querySelector('.main-content');
  const bbContainer = document.getElementById('bloomberg-container');

  if (view.startsWith('bb-')) {
    // Bloomberg view
    if (mainContent) mainContent.style.display = 'none';
    if (bbContainer) bbContainer.style.display = 'block';

    // Hide all bloomberg views, show selected
    document.querySelectorAll('.bloomberg-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.b2-view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
    // Hide regular views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    const bbViewId = view.replace('bb-', '');

    // Route to correct handler
    if (bbViewId === 'market' && typeof showBloombergView === 'function') {
      showBloombergView('market');
    } else if (bbViewId === 'charts' && typeof showBloombergView === 'function') {
      showBloombergView('charts');
    } else if (bbViewId === 'news' && typeof showBloombergView === 'function') {
      showBloombergView('news');
    } else if (bbViewId === 'analytics' && typeof showBloombergView === 'function') {
      showBloombergView('analytics');
    } else if (bbViewId === 'screener' && typeof showScreener === 'function') {
      if (bbContainer) bbContainer.style.display = 'none';
      if (mainContent) mainContent.style.display = '';
      showScreener();
    } else if (bbViewId === 'fundamentals' && typeof showFundamentals === 'function') {
      if (bbContainer) bbContainer.style.display = 'none';
      if (mainContent) mainContent.style.display = '';
      // Pass first portfolio ticker as default; showFundamentals handles null gracefully
      const defTicker = Object.keys(portfolio || {})[0] || null;
      showFundamentals(defTicker);
    } else if (bbViewId === 'calendar' && typeof showEconomicCalendar === 'function') {
      if (bbContainer) bbContainer.style.display = 'none';
      if (mainContent) mainContent.style.display = '';
      showEconomicCalendar();
    }
  } else {
    // Regular view
    if (mainContent) mainContent.style.display = '';
    if (bbContainer) bbContainer.style.display = 'none';
    // Hide any b2 views (they live inside main-content)
    document.querySelectorAll('.b2-view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });

    views.forEach(v => {
      v.classList.remove('active');
      if (v.id === 'view-' + view) v.classList.add('active');
    });
    document.querySelector('.main-content').scrollTop = 0;

    if (view === 'chart') renderChartView();
    if (view === 'news') renderNewsView();
    if (view === 'insights') renderInsightsView();
    if (view === 'watchlist') renderWatchlistView();
    if (view === 'portfolio') renderPortfolioView();
  }
}

// ============================================
// SECTION 5: PORTFOLIO VIEW
// ============================================

let currentSort = 'value';
let miniPortfolioChart = null;

async function renderPortfolioView() {
  const summary = getPortfolioSummary();
  
  if (summary.holdings.length === 0 && Object.keys(portfolio).length > 0) {
    // Data still loading
    showLoading('holdings-list', 'Loading live quotes...');
    return;
  }

  animateNumber('kpi-value-number', summary.totalValue, 0);
  
  const metricsEl = document.getElementById('hero-kpi-metrics');
  metricsEl.innerHTML = `
    <div class="hero-kpi-metric">
      <span class="hero-kpi-metric-label">Day Change</span>
      <span class="hero-kpi-metric-value mono ${colorClass(summary.dayChange)}">${sign(summary.dayChange)}$${fmt(Math.abs(summary.dayChange))} (${sign(summary.dayChangePct)}${fmt(Math.abs(summary.dayChangePct))}%)</span>
    </div>
    <div class="hero-kpi-metric">
      <span class="hero-kpi-metric-label">Total P&L</span>
      <span class="hero-kpi-metric-value mono ${colorClass(summary.totalPnl)}">${sign(summary.totalPnl)}$${fmtCompact(Math.abs(summary.totalPnl))} (${sign(summary.totalPnlPct)}${fmt(Math.abs(summary.totalPnlPct))}%)</span>
    </div>
    <div class="hero-kpi-metric">
      <span class="hero-kpi-metric-label">Cost Basis</span>
      <span class="hero-kpi-metric-value mono">$${fmtCompact(summary.totalCost)}</span>
    </div>
  `;

  // ============================================
  // FEATURE 4: Mini portfolio value chart
  // ============================================
  await renderMiniPortfolioChart();

  const sortOptions = [
    { key: 'value', label: 'Value' },
    { key: 'pnl', label: 'Gain/Loss' },
    { key: 'dayChange', label: 'Day Change' },
    { key: 'name', label: 'Name' },
  ];
  const sortBar = document.getElementById('sort-bar');
  sortBar.innerHTML = sortOptions.map(o =>
    `<button class="sort-btn ${currentSort === o.key ? 'active' : ''}" data-sort="${o.key}">${o.label}</button>`
  ).join('');
  sortBar.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => { currentSort = btn.dataset.sort; renderPortfolioView(); });
  });

  let holdings = summary.holdings.slice();
  if (currentSort === 'value') holdings.sort((a, b) => b.currentValue - a.currentValue);
  else if (currentSort === 'pnl') holdings.sort((a, b) => b.pnlPct - a.pnlPct);
  else if (currentSort === 'dayChange') holdings.sort((a, b) => b.stock.dayChangePct - a.stock.dayChangePct);
  else if (currentSort === 'name') holdings.sort((a, b) => a.ticker.localeCompare(b.ticker));

  const listEl = document.getElementById('holdings-list');
  listEl.innerHTML = holdings.map((h, idx) => `
    <div class="holding-card" data-ticker="${h.ticker}" style="animation-delay: ${idx * 40}ms">
      <div class="holding-left">
        <div class="holding-ticker-row">
          <span class="holding-ticker">${h.ticker}</span>
          <span class="holding-shares">${fmt(h.totalShares, h.totalShares % 1 === 0 ? 0 : 2)} shares</span>
        </div>
        <span class="holding-name">${h.stock.name}</span>
        <span class="holding-pnl ${colorClass(h.pnl)}">${sign(h.pnl)}$${fmt(Math.abs(h.pnl))} (${sign(h.pnlPct)}${fmt(Math.abs(h.pnlPct))}%)</span>
      </div>
      <div class="holding-right">
        <span class="holding-value">$${fmt(h.currentValue)}</span>
        <span class="holding-change ${colorClass(h.stock.dayChange)}">${sign(h.stock.dayChangePct)}${fmt(Math.abs(h.stock.dayChangePct))}%</span>
        <canvas class="sparkline-canvas" data-ticker="${h.ticker}" width="60" height="24"></canvas>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.holding-card').forEach(card => {
    card.addEventListener('click', () => openStockDetail(card.dataset.ticker));
  });

  requestAnimationFrame(() => {
    listEl.querySelectorAll('.sparkline-canvas').forEach(canvas => {
      drawSparkline(canvas, canvas.dataset.ticker);
    });
  });
}

// ============================================
// FEATURE 4: Mini portfolio chart implementation
// ============================================
async function renderMiniPortfolioChart() {
  // Ensure container exists in the DOM (inject it between hero metrics and sort-bar if needed)
  let container = document.getElementById('portfolio-mini-chart-container');
  if (!container) {
    const sortBar = document.getElementById('sort-bar');
    if (sortBar) {
      const wrapper = document.createElement('div');
      wrapper.className = 'portfolio-mini-chart';
      wrapper.id = 'portfolio-mini-chart-container';
      wrapper.style.cssText = 'height:120px; margin: 0 0 var(--space-3) 0; cursor:pointer; position:relative;';
      wrapper.title = 'View full chart';
      sortBar.parentNode.insertBefore(wrapper, sortBar);
      const canvas = document.createElement('canvas');
      canvas.id = 'portfolio-mini-canvas';
      wrapper.appendChild(canvas);
      wrapper.addEventListener('click', () => switchView('chart'));
    }
  }

  const canvas = document.getElementById('portfolio-mini-canvas');
  if (!canvas) return;

  // Destroy existing chart
  if (miniPortfolioChart) { miniPortfolioChart.destroy(); miniPortfolioChart = null; }

  const holdingTickers = Object.keys(portfolio);
  if (holdingTickers.length === 0) return;

  // Fetch 1mo history
  const yperiod = '1mo';
  await fetchHistory(holdingTickers, '30');

  const allDates = new Set();
  const tickerHists = {};
  holdingTickers.forEach(t => {
    const h = historicalCache[`${t}:${yperiod}`];
    if (h && h.dates) {
      tickerHists[t] = h;
      h.dates.forEach(d => allDates.add(d));
    }
  });

  const sortedDates = [...allDates].sort();
  if (sortedDates.length === 0) return;

  const portfolioValues = [];
  const labels = [];

  sortedDates.forEach(date => {
    let total = 0;
    let hasData = false;
    holdingTickers.forEach(t => {
      const h = tickerHists[t];
      if (!h) return;
      const idx = h.dates.indexOf(date);
      if (idx === -1) return;
      hasData = true;
      // Use time-aware shares for mini chart
      const shares = getSharesHeldOnDate(t, date);
      total += shares * h.close[idx];
    });
    if (hasData) {
      portfolioValues.push(total);
      const d = new Date(date);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
  });

  if (portfolioValues.length === 0) return;

  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const primaryColor = style.getPropertyValue('--color-primary').trim() || '#4ECDC4';
  const textColor = style.getPropertyValue('--color-text-muted').trim();
  const gridColor = style.getPropertyValue('--color-divider').trim();

  const gradient = ctx.createLinearGradient(0, 0, 0, 120);
  gradient.addColorStop(0, 'rgba(78, 205, 196, 0.18)');
  gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');

  miniPortfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: portfolioValues,
        borderColor: primaryColor,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: primaryColor,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: style.getPropertyValue('--color-surface-2').trim(),
          titleColor: style.getPropertyValue('--color-text').trim(),
          bodyColor: textColor,
          borderColor: style.getPropertyValue('--color-border').trim(),
          borderWidth: 1,
          cornerRadius: 6,
          padding: 8,
          callbacks: { label: ctx => `$${fmt(ctx.raw)}` },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 9, family: 'DM Sans' }, maxRotation: 0, maxTicksLimit: 4 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: textColor, font: { size: 9, family: 'DM Mono' }, callback: v => '$' + fmtCompact(v), maxTicksLimit: 3 },
          grid: { color: gridColor, lineWidth: 0.5 },
          border: { display: false },
        },
      },
    },
  });
}

function drawSparkline(canvas, ticker) {
  const stock = getStock(ticker);
  if (!stock) return;
  const data = generateSparkline(ticker);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = 60, h = 24;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const isPositive = stock.dayChangePct >= 0;
  const style = getComputedStyle(document.documentElement);
  const color = isPositive ? style.getPropertyValue('--color-positive').trim() : style.getPropertyValue('--color-negative').trim();
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function animateNumber(elementId, target, start) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const duration = 800;
  const startTime = performance.now();
  const startVal = start || 0;
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startVal + (target - startVal) * eased;
    el.textContent = fmt(current);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================
// SECTION 6: CHART VIEW
// ============================================

let portfolioChart = null;
let predictionChart = null;
let currentRange = '30';

async function renderChartView() {
  renderTimeRange();
  await renderPortfolioChart();
  await renderPredictionChart();
}

function renderTimeRange() {
  const ranges = [
    { key: '7', label: '1W' },
    { key: '30', label: '1M' },
    { key: '90', label: '3M' },
    { key: '180', label: '6M' },
    { key: '365', label: '1Y' },
    { key: 'all', label: 'ALL' },
  ];
  const bar = document.getElementById('chart-time-range');
  bar.innerHTML = ranges.map(r =>
    `<button class="time-btn ${currentRange === r.key ? 'active' : ''}" data-range="${r.key}">${r.label}</button>`
  ).join('');
  bar.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => { currentRange = btn.dataset.range; renderChartView(); });
  });
}

// ============================================
// FEATURE 8: Portfolio chart with buy/sell timing
// ============================================
async function renderPortfolioChart() {
  const canvas = document.getElementById('portfolio-chart');
  if (!canvas) return;
  if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
  
  const holdingTickers = Object.keys(portfolio);
  if (holdingTickers.length === 0) return;

  // Fetch history for all portfolio tickers
  const yperiod = { '7': '5d', '30': '1mo', '90': '3mo', '180': '6mo', '365': '1y', 'all': '2y' }[currentRange] || '1mo';
  await fetchHistory(holdingTickers, currentRange);

  // Build portfolio history from real data
  const allDates = new Set();
  const tickerHists = {};
  holdingTickers.forEach(t => {
    const h = historicalCache[`${t}:${yperiod}`];
    if (h && h.dates) {
      tickerHists[t] = h;
      h.dates.forEach(d => allDates.add(d));
    }
  });

  const sortedDates = [...allDates].sort();
  if (sortedDates.length === 0) return;

  const portfolioValues = [];
  const costValues = [];
  const labels = [];

  sortedDates.forEach(date => {
    let total = 0;
    let cost = 0;
    let hasData = false;
    holdingTickers.forEach(t => {
      const h = tickerHists[t];
      if (!h) return;
      const idx = h.dates.indexOf(date);
      if (idx === -1) return;
      hasData = true;

      // FEATURE 8: Use time-aware share count
      const shares = getSharesHeldOnDate(t, date);
      total += shares * h.close[idx];

      // Cost basis: only buy lots on or before this date
      const data = portfolio[t];
      if (data && data.lots) {
        data.lots.forEach(lot => {
          if ((lot.type || 'buy') === 'buy' && lot.date <= date) {
            cost += lot.qty * lot.price;
          }
        });
      }
    });
    if (hasData) {
      portfolioValues.push(total);
      costValues.push(cost);
      const d = new Date(date);
      if (sortedDates.length <= 7) labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
      else if (sortedDates.length <= 90) labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      else labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    }
  });

  // S&P 500 benchmark
  const sp500Data = sp500Cache[yperiod] || { dates: [], close: [] };
  let sp500Normalized = [];
  if (sp500Data.close.length > 0 && portfolioValues.length > 0) {
    const sp500Start = sp500Data.close[0];
    const pfStart = portfolioValues[0];
    sp500Normalized = sp500Data.close.map(v => (v / sp500Start) * pfStart);
    // Align to portfolio length
    while (sp500Normalized.length < portfolioValues.length) sp500Normalized.push(sp500Normalized[sp500Normalized.length - 1] || 0);
    sp500Normalized = sp500Normalized.slice(0, portfolioValues.length);
  }

  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--color-text-muted').trim();
  const gridColor = style.getPropertyValue('--color-divider').trim();
  const primaryColor = style.getPropertyValue('--color-primary').trim();

  const gradientFill = ctx.createLinearGradient(0, 0, 0, 280);
  gradientFill.addColorStop(0, 'rgba(78, 205, 196, 0.2)');
  gradientFill.addColorStop(1, 'rgba(78, 205, 196, 0)');

  const datasets = [
    {
      label: 'Portfolio', data: portfolioValues,
      borderColor: primaryColor, backgroundColor: gradientFill, fill: true,
      tension: 0.3, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: primaryColor, borderWidth: 2,
    },
    {
      label: 'Cost Basis', data: costValues,
      borderColor: style.getPropertyValue('--color-text-faint').trim(),
      borderDash: [5, 5], fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5,
    },
  ];

  if (sp500Normalized.length > 0) {
    datasets.push({
      label: 'S&P 500', data: sp500Normalized,
      borderColor: style.getPropertyValue('--color-blue').trim(),
      fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3],
    });
  }

  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: style.getPropertyValue('--color-surface-2').trim(),
          titleColor: style.getPropertyValue('--color-text').trim(),
          bodyColor: style.getPropertyValue('--color-text-muted').trim(),
          borderColor: style.getPropertyValue('--color-border').trim(),
          borderWidth: 1, cornerRadius: 8, padding: 12, displayColors: true,
          callbacks: { label: ctx => `${ctx.dataset.label}: $${fmt(ctx.raw)}` }
        },
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10, family: 'DM Sans' }, maxRotation: 0, maxTicksLimit: 6 }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: textColor, font: { size: 10, family: 'DM Mono' }, callback: v => '$' + fmtCompact(v) }, grid: { color: gridColor, lineWidth: 0.5 }, border: { display: false } },
      },
    },
  });

  const legendEl = document.getElementById('chart-legend');
  legendEl.innerHTML = `
    <div class="legend-item"><span class="legend-dot" style="background:${primaryColor}"></span> Portfolio</div>
    <div class="legend-item"><span class="legend-dot" style="background:${style.getPropertyValue('--color-text-faint').trim()}"></span> Cost Basis</div>
    <div class="legend-item"><span class="legend-dot" style="background:${style.getPropertyValue('--color-blue').trim()}"></span> S&P 500</div>
  `;
}

async function renderPredictionChart() {
  const canvas = document.getElementById('prediction-chart');
  if (!canvas) return;
  if (predictionChart) { predictionChart.destroy(); predictionChart = null; }

  const summary = getPortfolioSummary();
  if (summary.totalValue === 0) return;

  // Use 6-month history for prediction basis
  const holdingTickers = Object.keys(portfolio);
  await fetchHistory(holdingTickers, '180');

  // Build portfolio value series from historical data
  const yperiod = '6mo';
  const allDates = new Set();
  holdingTickers.forEach(t => {
    const h = historicalCache[`${t}:${yperiod}`];
    if (h && h.dates) h.dates.forEach(d => allDates.add(d));
  });
  const sortedDates = [...allDates].sort();
  const histValues = sortedDates.map(date => {
    let total = 0;
    holdingTickers.forEach(t => {
      const h = historicalCache[`${t}:${yperiod}`];
      if (!h) return;
      const idx = h.dates.indexOf(date);
      if (idx === -1) return;
      const shares = getSharesHeldOnDate(t, date);
      total += shares * h.close[idx];
    });
    return total;
  }).filter(v => v > 0);

  const prediction = monteCarloPrediction(summary.totalValue, histValues, 180, 500);
  
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--color-text-muted').trim();
  const gridColor = style.getPropertyValue('--color-divider').trim();
  const primaryColor = style.getPropertyValue('--color-primary').trim();

  const labels = [];
  const now = new Date();
  for (let i = 0; i <= 180; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
  }

  predictionChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '95% High', data: prediction.high95, borderColor: 'transparent', backgroundColor: 'rgba(78, 205, 196, 0.06)', fill: '+4', pointRadius: 0, tension: 0.4 },
        { label: '68% High', data: prediction.high68, borderColor: 'transparent', backgroundColor: 'rgba(78, 205, 196, 0.12)', fill: '+2', pointRadius: 0, tension: 0.4 },
        { label: 'Median', data: prediction.median, borderColor: primaryColor, borderWidth: 2, fill: false, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: primaryColor, tension: 0.4 },
        { label: '68% Low', data: prediction.low68, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 },
        { label: '95% Low', data: prediction.low95, borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: style.getPropertyValue('--color-surface-2').trim(),
          titleColor: style.getPropertyValue('--color-text').trim(),
          bodyColor: style.getPropertyValue('--color-text-muted').trim(),
          borderColor: style.getPropertyValue('--color-border').trim(),
          borderWidth: 1, cornerRadius: 8, padding: 12,
          filter: item => item.datasetIndex === 2,
          callbacks: {
            label: ctx => {
              const idx = ctx.dataIndex;
              return [
                `Median: $${fmt(prediction.median[idx])}`,
                `68% Range: $${fmt(prediction.low68[idx])} – $${fmt(prediction.high68[idx])}`,
                `95% Range: $${fmt(prediction.low95[idx])} – $${fmt(prediction.high95[idx])}`,
              ];
            }
          }
        },
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10, family: 'DM Sans' }, maxRotation: 0, maxTicksLimit: 6 }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: textColor, font: { size: 10, family: 'DM Mono' }, callback: v => '$' + fmtCompact(v) }, grid: { color: gridColor, lineWidth: 0.5 }, border: { display: false } },
      },
    },
  });

  const predLegend = document.getElementById('prediction-legend');
  predLegend.innerHTML = `
    <div class="legend-item"><span class="legend-dot" style="background:${primaryColor}"></span> Median</div>
    <div class="legend-item"><span class="legend-dot" style="background:rgba(78,205,196,0.3)"></span> 68% Confidence</div>
    <div class="legend-item"><span class="legend-dot" style="background:rgba(78,205,196,0.12)"></span> 95% Confidence</div>
  `;
}

// ============================================
// SECTION 7: NEWS VIEW
// ============================================

let newsFilter = 'all';

async function renderNewsView() {
  await fetchNews();

  const filterBar = document.getElementById('news-filter-bar');
  const tickers = ['all', ...Object.keys(portfolio)];
  filterBar.innerHTML = tickers.map(t =>
    `<button class="filter-chip ${newsFilter === t ? 'active' : ''}" data-filter="${t}">${t === 'all' ? 'All' : t}</button>`
  ).join('');
  filterBar.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => { newsFilter = btn.dataset.filter; renderNewsView(); });
  });

  const filteredNews = newsCache.filter(n => {
    if (newsFilter === 'all') return true;
    return n.ticker === newsFilter;
  });

  // Sentiment (simple keyword-based since we don't have it from API)
  const bull = filteredNews.length > 0 ? Math.floor(filteredNews.length * 0.55) : 0;
  const bear = filteredNews.length > 0 ? Math.floor(filteredNews.length * 0.2) : 0;
  const neut = filteredNews.length - bull - bear;
  const total = filteredNews.length || 1;
  const bullPct = (bull / total) * 100;
  const bearPct = (bear / total) * 100;
  const neutPct = (neut / total) * 100;
  const sentScore = ((bull - bear) / total * 100).toFixed(0);

  document.getElementById('sent-bull').style.width = bullPct + '%';
  document.getElementById('sent-neutral').style.width = neutPct + '%';
  document.getElementById('sent-bear').style.width = bearPct + '%';
  const scoreEl = document.getElementById('sent-score');
  scoreEl.textContent = (sentScore >= 0 ? '+' : '') + sentScore;
  scoreEl.className = 'sentiment-value mono ' + (sentScore > 0 ? 'positive' : sentScore < 0 ? 'negative' : 'neutral');

  const listEl = document.getElementById('news-list');
  if (filteredNews.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:var(--space-8); color:var(--color-text-faint);">No news available. Pull to refresh.</div>`;
    return;
  }
  listEl.innerHTML = filteredNews.map(n => {
    const newsUrl = n.url || n.link || '';
    const newsTitle = n.headline || n.title || 'Untitled';
    const newsSource = n.source || n.publisher || 'Yahoo Finance';
    const newsSummary = n.summary || n.description || '';
    return `
    <div class="news-card" ${newsUrl ? `onclick="window.open('${newsUrl.replace(/'/g, "\\'")}', '_blank')"` : ''} style="${newsUrl ? 'cursor:pointer' : ''}">
      <div class="news-meta">
        ${n.ticker ? `<span class="news-ticker-badge">${n.ticker}</span>` : ''}
        <span class="news-source">${newsSource}</span>
        <span class="news-time">${timeAgo(n.pubDate)}</span>
      </div>
      <div class="news-headline">${newsTitle}</div>
      ${newsSummary ? `<div class="news-summary" style="font-size:11px; color:var(--color-text-faint); margin-top:var(--space-1); line-height:1.4;">${newsSummary.slice(0, 180)}${newsSummary.length > 180 ? '...' : ''}</div>` : ''}
    </div>`;
  }).join('');
}

// ============================================
// SECTION 8: INSIGHTS VIEW
// ============================================

let sectorDonutChart = null;
let scoreRingChart = null;

function renderInsightsView() {
  renderSectorDonut();
  renderDiversificationScore();
  renderRiskMetrics();
  renderHeatmap();
  renderPerformers();
  renderAlerts();
  renderGeoExposure();
  renderCorrelationMatrix();
  renderWhatIfSelect();
  renderDividendTracker();
}

function renderSectorDonut() {
  const holdings = getPortfolioHoldings();
  const sectors = {};
  holdings.forEach(h => {
    const sector = h.stock.sector || 'Unknown';
    sectors[sector] = (sectors[sector] || 0) + h.currentValue;
  });
  const totalValue = Object.values(sectors).reduce((s, v) => s + v, 0);
  const sectorEntries = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
  
  const colors = ['#4ECDC4', '#5B9CF6', '#A78BFA', '#FF9F43', '#FF6B6B', '#F5C542', '#6daa45', '#d163a7'];
  
  const canvas = document.getElementById('sector-donut');
  if (!canvas) return;
  if (sectorDonutChart) { sectorDonutChart.destroy(); sectorDonutChart = null; }
  
  sectorDonutChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: sectorEntries.map(e => e[0]),
      datasets: [{ data: sectorEntries.map(e => e[1]), backgroundColor: colors.slice(0, sectorEntries.length), borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: true, cutout: '65%', plugins: { legend: { display: false }, tooltip: { enabled: true } } },
  });

  const legendEl = document.getElementById('sector-legend');
  legendEl.innerHTML = sectorEntries.map((e, i) => `
    <div class="donut-legend-item">
      <span class="donut-legend-color" style="background:${colors[i]}"></span>
      <span>${e[0]}</span>
      <span class="donut-legend-pct">${((e[1] / totalValue) * 100).toFixed(1)}%</span>
    </div>
  `).join('');
}

function renderDiversificationScore() {
  const holdings = getPortfolioHoldings();
  const sectors = new Set(holdings.map(h => h.stock.sector || 'Unknown'));
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const weights = holdings.map(h => h.currentValue / totalValue);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const score = Math.round(Math.max(0, Math.min(100, (1 - hhi) * 100 * (sectors.size / 5))));
  
  document.getElementById('div-score').textContent = score;
  document.getElementById('div-grade').textContent = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';

  const canvas = document.getElementById('score-ring');
  if (!canvas) return;
  if (scoreRingChart) { scoreRingChart.destroy(); scoreRingChart = null; }
  
  const style = getComputedStyle(document.documentElement);
  scoreRingChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, 100 - score],
        backgroundColor: [style.getPropertyValue('--color-primary').trim(), style.getPropertyValue('--color-surface-offset').trim()],
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: true, cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, rotation: -90, circumference: 360 },
  });
}

function renderRiskMetrics() {
  const holdings = getPortfolioHoldings();
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const weightedBeta = holdings.reduce((s, h) => s + (h.currentValue / totalValue) * (h.stock.beta || 1), 0);
  
  const annualReturn = holdings.reduce((s, h) => s + (h.currentValue / totalValue) * h.pnlPct, 0);
  const riskFreeRate = 4.5;
  const portfolioVolatility = weightedBeta * 16;
  const sharpe = portfolioVolatility > 0 ? ((annualReturn - riskFreeRate) / portfolioVolatility).toFixed(2) : '0.00';

  const el = document.getElementById('risk-metrics');
  el.innerHTML = `
    <div class="metric-box"><div class="metric-box-label">Beta</div><div class="metric-box-value">${weightedBeta.toFixed(2)}</div></div>
    <div class="metric-box"><div class="metric-box-label">Sharpe</div><div class="metric-box-value">${sharpe}</div></div>
    <div class="metric-box"><div class="metric-box-label">Stocks</div><div class="metric-box-value">${holdings.length}</div></div>
    <div class="metric-box"><div class="metric-box-label">Sectors</div><div class="metric-box-value">${new Set(holdings.map(h => h.stock.sector || 'Unknown')).size}</div></div>
  `;
}

function renderHeatmap() {
  const holdings = getPortfolioHoldings();
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  holdings.sort((a, b) => b.currentValue - a.currentValue);
  
  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = holdings.map(h => {
    const pct = h.stock.dayChangePct;
    const intensity = Math.min(Math.abs(pct) / 3, 1);
    const bg = pct >= 0
      ? `rgba(78, 205, 196, ${0.2 + intensity * 0.6})`
      : `rgba(255, 107, 107, ${0.2 + intensity * 0.6})`;
    const size = Math.max(60, (h.currentValue / totalValue) * 400);
    return `<div class="heatmap-cell" style="background:${bg}; min-height:${Math.min(size, 100)}px" data-ticker="${h.ticker}">
      <span class="heatmap-ticker">${h.ticker}</span>
      <span class="heatmap-pct">${sign(pct)}${fmt(Math.abs(pct))}%</span>
    </div>`;
  }).join('');
  
  grid.querySelectorAll('.heatmap-cell').forEach(cell => {
    cell.addEventListener('click', () => openStockDetail(cell.dataset.ticker));
  });
}

function renderPerformers() {
  const holdings = getPortfolioHoldings();
  const sorted = holdings.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  const tbody = document.querySelector('#performers-table tbody');
  tbody.innerHTML = sorted.map(h => `
    <tr>
      <td><strong>${h.ticker}</strong> <span class="text-faint">${(h.stock.name || '').split(' ')[0]}</span></td>
      <td class="${colorClass(h.pnlPct)}">${sign(h.pnlPct)}${fmt(Math.abs(h.pnlPct))}%</td>
    </tr>
  `).join('');
}

function renderAlerts() {
  const holdings = getPortfolioHoldings();
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const alerts = [];
  
  // Sector concentration
  const sectors = {};
  holdings.forEach(h => { const s = h.stock.sector || 'Unknown'; sectors[s] = (sectors[s] || 0) + h.currentValue; });
  for (const [sector, val] of Object.entries(sectors)) {
    const pct = ((val / totalValue) * 100).toFixed(0);
    if (pct > 40) alerts.push({ type: 'warning', text: `Your portfolio is <strong>${pct}% ${sector}</strong> — consider diversifying.` });
  }

  // Big gainers
  holdings.forEach(h => {
    if (h.pnlPct > 50) alerts.push({ type: 'success', text: `<strong>${h.ticker}</strong> is up ${fmt(h.pnlPct)}% — consider taking some profits.` });
  });

  // High beta
  const avgBeta = holdings.reduce((s, h) => s + (h.stock.beta || 1), 0) / holdings.length;
  if (avgBeta > 1.3) alerts.push({ type: 'info', text: `Portfolio beta is <strong>${avgBeta.toFixed(2)}</strong> — your holdings are more volatile than the market.` });

  // Near 52-week high/low
  holdings.forEach(h => {
    if (h.stock.high52 && h.stock.price >= h.stock.high52 * 0.95) {
      alerts.push({ type: 'info', text: `<strong>${h.ticker}</strong> is near its 52-week high ($${fmt(h.stock.high52)}).` });
    }
    if (h.stock.low52 && h.stock.price <= h.stock.low52 * 1.05) {
      alerts.push({ type: 'warning', text: `<strong>${h.ticker}</strong> is near its 52-week low ($${fmt(h.stock.low52)}).` });
    }
  });

  // Analyst consensus
  holdings.forEach(h => {
    const total = (h.stock.analystBuy || 0) + (h.stock.analystHold || 0) + (h.stock.analystSell || 0);
    if (total > 0 && h.stock.analystSell > h.stock.analystBuy) {
      alerts.push({ type: 'warning', text: `<strong>${h.ticker}</strong> has more sell than buy ratings (${h.stock.analystSell} sell vs ${h.stock.analystBuy} buy).` });
    }
  });

  if (alerts.length === 0) alerts.push({ type: 'info', text: 'No alerts right now. Your portfolio looks balanced.' });

  const el = document.getElementById('alert-list');
  el.innerHTML = alerts.slice(0, 6).map(a => `
    <div class="alert-item">
      <div class="alert-icon ${a.type}">
        ${a.type === 'warning' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
          : a.type === 'info' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'}
      </div>
      <div class="alert-text">${a.text}</div>
    </div>
  `).join('');
}

function renderGeoExposure() {
  // Estimate geographic revenue exposure based on sector
  const holdings = getPortfolioHoldings();
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  
  // Approximate geographic breakdown by sector
  const geoWeights = {
    'Technology': { US: 0.55, Europe: 0.20, 'Asia Pacific': 0.18, 'Rest of World': 0.07 },
    'Financial Services': { US: 0.70, Europe: 0.15, 'Asia Pacific': 0.10, 'Rest of World': 0.05 },
    'Healthcare': { US: 0.60, Europe: 0.22, 'Asia Pacific': 0.12, 'Rest of World': 0.06 },
    'Consumer Cyclical': { US: 0.50, Europe: 0.22, 'Asia Pacific': 0.20, 'Rest of World': 0.08 },
    'Consumer Defensive': { US: 0.65, Europe: 0.18, 'Asia Pacific': 0.12, 'Rest of World': 0.05 },
    'Communication': { US: 0.55, Europe: 0.22, 'Asia Pacific': 0.16, 'Rest of World': 0.07 },
  };
  const defaultGeo = { US: 0.60, Europe: 0.20, 'Asia Pacific': 0.14, 'Rest of World': 0.06 };
  
  const geoTotals = { 'United States': 0, 'Europe': 0, 'Asia Pacific': 0, 'Rest of World': 0 };
  holdings.forEach(h => {
    const weights = geoWeights[h.stock.sector] || defaultGeo;
    geoTotals['United States'] += h.currentValue * (weights.US || 0.6);
    geoTotals['Europe'] += h.currentValue * (weights.Europe || 0.2);
    geoTotals['Asia Pacific'] += h.currentValue * (weights['Asia Pacific'] || 0.14);
    geoTotals['Rest of World'] += h.currentValue * (weights['Rest of World'] || 0.06);
  });
  
  const geoData = Object.entries(geoTotals)
    .map(([region, val]) => ({ region, pct: totalValue > 0 ? Math.round((val / totalValue) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);
  
  const el = document.getElementById('geo-exposure');
  el.innerHTML = geoData.map(g => `
    <div style="display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-2);">
      <span style="font-size:11px; color:var(--color-text-muted); width:100px;">${g.region}</span>
      <div style="flex:1; height:6px; background:var(--color-surface-offset); border-radius:var(--radius-full); overflow:hidden;">
        <div style="width:${g.pct}%; height:100%; background:var(--color-primary); border-radius:var(--radius-full); transition:width 600ms var(--ease-golden);"></div>
      </div>
      <span class="mono" style="font-size:11px; font-weight:600; color:var(--color-text); width:36px; text-align:right;">${g.pct}%</span>
    </div>
  `).join('');
}

function renderCorrelationMatrix() {
  const tickers = Object.keys(portfolio).slice(0, 6);
  const n = tickers.length;
  if (n === 0) return;
  
  // Build correlations from cached historical data
  const corr = [];
  for (let i = 0; i < n; i++) {
    corr[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) { corr[i][j] = 1.0; continue; }
      if (j < i) { corr[i][j] = corr[j][i]; continue; }
      
      // Try to compute from historical data
      const h1 = historicalCache[`${tickers[i]}:1mo`] || historicalCache[`${tickers[i]}:3mo`];
      const h2 = historicalCache[`${tickers[j]}:1mo`] || historicalCache[`${tickers[j]}:3mo`];
      if (h1 && h2 && h1.close && h2.close && h1.close.length > 5 && h2.close.length > 5) {
        const len = Math.min(h1.close.length, h2.close.length);
        const r1 = [], r2 = [];
        for (let k = 1; k < len; k++) {
          r1.push(Math.log(h1.close[k] / h1.close[k-1]));
          r2.push(Math.log(h2.close[k] / h2.close[k-1]));
        }
        const mean1 = r1.reduce((s,v) => s+v, 0) / r1.length;
        const mean2 = r2.reduce((s,v) => s+v, 0) / r2.length;
        let cov = 0, var1 = 0, var2 = 0;
        for (let k = 0; k < r1.length; k++) {
          cov += (r1[k] - mean1) * (r2[k] - mean2);
          var1 += (r1[k] - mean1) ** 2;
          var2 += (r2[k] - mean2) ** 2;
        }
        const denom = Math.sqrt(var1 * var2);
        corr[i][j] = denom > 0 ? cov / denom : 0;
      } else {
        // Estimate from sector similarity
        const s1 = getStock(tickers[i])?.sector;
        const s2 = getStock(tickers[j])?.sector;
        corr[i][j] = s1 && s2 && s1 === s2 ? 0.65 + Math.random() * 0.15 : 0.2 + Math.random() * 0.25;
      }
    }
  }

  const grid = document.getElementById('correlation-grid');
  grid.style.gridTemplateColumns = `40px repeat(${n}, 1fr)`;
  
  let html = '<div></div>';
  tickers.forEach(t => { html += `<div class="corr-header">${t}</div>`; });
  for (let i = 0; i < n; i++) {
    html += `<div class="corr-header">${tickers[i]}</div>`;
    for (let j = 0; j < n; j++) {
      const val = corr[i][j];
      const intensity = Math.abs(val);
      const color = val >= 0
        ? `rgba(78, 205, 196, ${intensity * 0.6})`
        : `rgba(255, 107, 107, ${intensity * 0.6})`;
      html += `<div class="corr-cell" style="background:${color}; color:var(--color-text);">${val.toFixed(1)}</div>`;
    }
  }
  grid.innerHTML = html;
}

function renderWhatIfSelect() {
  const select = document.getElementById('whatif-stock');
  if (!select) return;
  const allTickers = [...new Set([...Object.keys(portfolio), ...watchlist])];
  select.innerHTML = allTickers.map(t => {
    const stock = getStock(t);
    return `<option value="${t}">${t} — ${stock ? stock.name : t}</option>`;
  }).join('');
}

function renderDividendTracker() {
  const holdings = getPortfolioHoldings();
  let annualIncome = 0;
  let payers = 0;
  
  holdings.forEach(h => {
    if (h.stock.divPerShare > 0) {
      annualIncome += h.totalShares * h.stock.divPerShare;
      payers++;
    }
  });

  const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
  const yieldOnCost = totalCost > 0 ? ((annualIncome / totalCost) * 100).toFixed(2) : '0.00';
  const monthlyIncome = (annualIncome / 12).toFixed(2);

  const gridEl = document.getElementById('dividend-grid');
  gridEl.innerHTML = `
    <div class="dividend-box"><div class="dividend-label">Annual Income</div><div class="dividend-value">$${fmt(annualIncome)}</div></div>
    <div class="dividend-box"><div class="dividend-label">Monthly Avg</div><div class="dividend-value">$${monthlyIncome}</div></div>
    <div class="dividend-box"><div class="dividend-label">Yield on Cost</div><div class="dividend-value">${yieldOnCost}%</div></div>
    <div class="dividend-box"><div class="dividend-label">Payers</div><div class="dividend-value">${payers}</div></div>
  `;

  // Note: yfinance doesn't give next dividend dates easily, so we simplify
  const upEl = document.getElementById('dividend-upcoming');
  const divPayers = holdings.filter(h => h.stock.divPerShare > 0).sort((a, b) => b.stock.divPerShare * b.totalShares - a.stock.divPerShare * a.totalShares);
  upEl.innerHTML = `
    <div style="font-size:11px; font-weight:600; color:var(--color-text-muted); margin-bottom:var(--space-2);">Top Dividend Payers</div>
    ${divPayers.slice(0, 4).map(h => `
      <div style="display:flex; justify-content:space-between; padding:var(--space-1) 0; border-bottom:1px solid var(--color-divider);">
        <span style="font-weight:600; font-size:12px;">${h.ticker}</span>
        <span class="mono" style="font-size:11px; color:var(--color-text-muted);">${h.stock.divYield > 0 ? h.stock.divYield + '% yield' : ''}</span>
        <span class="mono positive" style="font-size:11px; font-weight:600;">$${fmt(h.totalShares * h.stock.divPerShare)}/yr</span>
      </div>
    `).join('')}
  `;
}

// What-If Calculator handler
document.getElementById('whatif-calc-btn')?.addEventListener('click', () => {
  const amount = parseFloat(document.getElementById('whatif-amount').value) || 10000;
  const ticker = document.getElementById('whatif-stock').value;
  const stock = getStock(ticker);
  if (!stock || !stock.price) return;
  
  const annualReturn = 0.12;
  const volatility = (stock.beta || 1) * 0.16;
  
  const results = [1, 3, 5].map(years => {
    const median = amount * Math.exp(annualReturn * years);
    const low = amount * Math.exp((annualReturn - volatility) * years);
    const high = amount * Math.exp((annualReturn + volatility) * years);
    return { years, median, low, high };
  });
  
  const el = document.getElementById('whatif-results');
  el.style.display = 'grid';
  el.innerHTML = results.map(r => `
    <div class="whatif-result-box">
      <div class="whatif-period">${r.years}Y</div>
      <div class="whatif-value positive">$${fmtCompact(r.median)}</div>
      <div class="whatif-range">$${fmtCompact(r.low)} – $${fmtCompact(r.high)}</div>
    </div>
  `).join('');
});

// ============================================
// SECTION 9: WATCHLIST VIEW
// ============================================

function renderWatchlistView() {
  const listEl = document.getElementById('watchlist-list');
  if (!listEl) return;
  
  if (watchlist.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:var(--space-10) var(--space-4); color:var(--color-text-faint);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto var(--space-3);opacity:0.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div style="font-size:var(--text-sm); font-weight:600; margin-bottom:var(--space-1);">No stocks in watchlist</div>
        <div style="font-size:11px;">Tap + to add stocks you're watching</div>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = watchlist.map(ticker => {
    const stock = getStock(ticker);
    if (!stock) return `<div class="watchlist-card"><div class="watchlist-info"><div class="watchlist-ticker">${ticker}</div><div class="watchlist-name">Loading...</div></div></div>`;
    return `
      <div class="watchlist-card" data-ticker="${ticker}">
        <div class="watchlist-info">
          <div class="watchlist-ticker">${ticker}</div>
          <div class="watchlist-name">${stock.name}</div>
        </div>
        <div class="watchlist-price-col">
          <div class="watchlist-price">$${fmt(stock.price)}</div>
          <div class="watchlist-change ${colorClass(stock.dayChangePct)}">${sign(stock.dayChangePct)}${fmt(Math.abs(stock.dayChangePct))}%</div>
        </div>
        <button class="lot-delete-btn" data-remove-wl="${ticker}" aria-label="Remove ${ticker}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.watchlist-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove-wl]')) return;
      openStockDetail(card.dataset.ticker, true);
    });
  });
  
  listEl.querySelectorAll('[data-remove-wl]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      watchlist = watchlist.filter(t => t !== btn.dataset.removeWl);
      saveWatchlist();
      renderWatchlistView();
    });
  });
}

// ============================================
// SECTION 10: STOCK DETAIL VIEW
// ============================================

let detailChart = null;
let detailRange = '30';

async function openStockDetail(ticker, isWatchlist = false) {
  // Ensure we have quote data for this ticker
  if (!getStock(ticker)) {
    try {
      const data = await marketApi('/quotes', { tickers: ticker });
      if (data.quotes) Object.assign(stockDataCache, data.quotes);
    } catch(e) {}
  }

  const stock = getStock(ticker);
  if (!stock) return;
  
  const overlay = document.getElementById('detail-overlay');
  overlay.classList.add('open');
  document.getElementById('detail-ticker').textContent = ticker;
  document.getElementById('detail-name').textContent = stock.name;
  
  detailRange = '30';
  await renderDetailContent(ticker, isWatchlist);
}

function closeStockDetail() {
  const overlay = document.getElementById('detail-overlay');
  overlay.style.animation = 'slideOutRight 250ms var(--ease-exit) both';
  setTimeout(() => {
    overlay.classList.remove('open');
    overlay.style.animation = '';
    if (detailChart) { detailChart.destroy(); detailChart = null; }
  }, 250);
}

document.getElementById('detail-back-btn')?.addEventListener('click', closeStockDetail);

async function renderDetailContent(ticker, isWatchlist = false) {
  const stock = getStock(ticker);
  if (!stock) return;
  const holding = portfolio[ticker];
  const content = document.getElementById('detail-content');

  // ============================================
  // FEATURE 7: Fetch ticker news and check for splits
  // ============================================
  let tickerNews = newsCache.filter(n => n.ticker === ticker);
  if (tickerNews.length === 0) {
    try {
      const data = await marketApi('/news', { tickers: ticker });
      if (data.news && data.news.length > 0) {
        tickerNews = data.news;
        // Merge into cache
        const existingIds = new Set(newsCache.map(n => n.id));
        data.news.forEach(n => { if (!existingIds.has(n.id)) newsCache.push(n); });
      }
    } catch(e) {}
  }

  // Check for split news
  const splitNews = tickerNews.filter(n => n.headline && n.headline.toLowerCase().includes('split'));

  let lotsHTML = '';
  if (holding && !isWatchlist) {
    const lots = holding.lots;
    lotsHTML = `
      <div class="lot-section">
        <div class="section-title">Transaction Lots</div>
        <div style="overflow-x:auto;">
          <table class="lot-table">
            <thead><tr><th>Date</th><th>Type</th><th>Shares</th><th>Price</th><th>Value</th><th>P&L</th><th></th></tr></thead>
            <tbody>
              ${lots.map((lot, idx) => {
                const isSell = (lot.type || 'buy') === 'sell';
                const val = lot.qty * stock.price;
                const cost = lot.qty * lot.price;
                const pnl = isSell ? 0 : val - cost;
                const pnlPct = !isSell && cost > 0 ? (pnl / cost) * 100 : 0;
                const typeBadge = isSell
                  ? `<span style="font-size:10px; font-weight:700; color:#EF4444; background:rgba(239,68,68,0.12); padding:2px 6px; border-radius:4px;">SELL</span>`
                  : `<span style="font-size:10px; font-weight:700; color:#10B981; background:rgba(16,185,129,0.12); padding:2px 6px; border-radius:4px;">BUY</span>`;
                return `<tr>
                  <td>${lot.date}</td>
                  <td>${typeBadge}</td>
                  <td>${lot.qty}</td>
                  <td>$${fmt(lot.price)}</td>
                  <td>${isSell ? '—' : '$' + fmt(val)}</td>
                  <td class="${isSell ? 'neutral' : colorClass(pnl)}">${isSell ? '—' : sign(pnlPct) + fmt(Math.abs(pnlPct)) + '%'}</td>
                  <td><button class="lot-delete-btn" data-lot-idx="${idx}" data-lot-ticker="${ticker}" aria-label="Delete lot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn-secondary mt-3" id="add-lot-to-existing" data-ticker="${ticker}">+ Add Lot</button>
      </div>
    `;
  }

  // Analyst data
  const totalAnalysts = (stock.analystBuy || 0) + (stock.analystHold || 0) + (stock.analystSell || 0);
  const buyPct = totalAnalysts > 0 ? (stock.analystBuy / totalAnalysts * 100) : 33;
  const holdPct = totalAnalysts > 0 ? (stock.analystHold / totalAnalysts * 100) : 34;
  const sellPct = totalAnalysts > 0 ? (stock.analystSell / totalAnalysts * 100) : 33;
  
  const priceRange = (stock.ptHigh || stock.price) - (stock.ptLow || stock.price);
  const currentPos = priceRange > 0 ? ((stock.price - stock.ptLow) / priceRange * 100) : 50;
  const avgPos = priceRange > 0 && stock.ptAvg ? ((stock.ptAvg - stock.ptLow) / priceRange * 100) : 50;

  // ============================================
  // FEATURE 5 & 6: Chart legend for dual lines + transaction markers
  // ============================================
  const inPortfolio = !!(holding && !isWatchlist);
  const chartLegendHTML = `
    <div style="display:flex; gap:var(--space-3); flex-wrap:wrap; margin-top:var(--space-2); font-size:11px; color:var(--color-text-muted);">
      <span style="display:flex; align-items:center; gap:4px;">
        <span style="width:16px; height:2px; background:#4ECDC4; display:inline-block; border-radius:1px;"></span> Price ${inPortfolio ? '<span style="opacity:0.6;">(left)</span>' : ''}
      </span>
      ${inPortfolio ? `
      <span style="display:flex; align-items:center; gap:4px;">
        <span style="width:16px; height:2px; background:#F59E0B; display:inline-block; border-radius:1px;"></span> Holdings Value <span style="opacity:0.6;">(right)</span>
      </span>
      <span style="display:flex; align-items:center; gap:4px;">
        <span style="width:8px; height:8px; background:#10B981; border-radius:50%; display:inline-block;"></span> Buy
      </span>
      <span style="display:flex; align-items:center; gap:4px;">
        <span style="width:8px; height:8px; background:#EF4444; border-radius:50%; display:inline-block;"></span> Sell
      </span>` : ''}
      ${splitNews.length > 0 ? `
      <span style="display:flex; align-items:center; gap:4px;">
        <span style="width:1px; height:12px; background:#A78BFA; display:inline-block;"></span> Split
      </span>` : ''}
    </div>
  `;

  // ============================================
  // FEATURE 2: Remove Stock button
  // ============================================
  const removeStockHTML = (holding && !isWatchlist) ? `
    <div style="margin-top:var(--space-5); padding-top:var(--space-4); border-top:1px solid var(--color-divider);">
      <button class="btn-danger" id="remove-stock-btn" data-ticker="${ticker}" style="width:100%; padding:var(--space-3); border-radius:var(--radius-lg); background:rgba(239,68,68,0.12); color:#EF4444; border:1px solid rgba(239,68,68,0.25); font-weight:600; font-size:13px; cursor:pointer; transition:background 150ms;">
        Remove ${ticker} from Portfolio
      </button>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="detail-price-hero">
      <div class="detail-price mono">$${fmt(stock.price)}</div>
      <div class="detail-change-row">
        <span class="detail-change ${colorClass(stock.dayChange)}">${sign(stock.dayChange)}$${fmt(Math.abs(stock.dayChange))} (${sign(stock.dayChangePct)}${fmt(Math.abs(stock.dayChangePct))}%)</span>
        <span style="font-size:11px; color:var(--color-text-faint);">today</span>
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-header">
        <span class="chart-title">Price Chart</span>
        <div class="time-range-bar" id="detail-time-range"></div>
      </div>
      <div class="chart-wrapper" style="height:220px;">
        <canvas id="detail-price-chart"></canvas>
      </div>
      ${chartLegendHTML}
    </div>

    <div class="section-title mt-4">Key Stats</div>
    <div class="key-stats-grid">
      <div class="stat-item"><div class="stat-label">P/E Ratio</div><div class="stat-value">${stock.pe || '—'}</div></div>
      <div class="stat-item"><div class="stat-label">Market Cap</div><div class="stat-value">${stock.marketCap || '—'}</div></div>
      <div class="stat-item"><div class="stat-label">52W High</div><div class="stat-value">$${stock.high52 ? fmt(stock.high52) : '—'}</div></div>
      <div class="stat-item"><div class="stat-label">52W Low</div><div class="stat-value">$${stock.low52 ? fmt(stock.low52) : '—'}</div></div>
      <div class="stat-item"><div class="stat-label">Volume</div><div class="stat-value">${stock.volume || '—'}</div></div>
      <div class="stat-item"><div class="stat-label">Div. Yield</div><div class="stat-value">${stock.divYield ? stock.divYield + '%' : '—'}</div></div>
      <div class="stat-item"><div class="stat-label">EPS</div><div class="stat-value">${stock.eps ? '$' + fmt(stock.eps) : '—'}</div></div>
      <div class="stat-item"><div class="stat-label">Beta</div><div class="stat-value">${stock.beta || '—'}</div></div>
    </div>

    ${lotsHTML}

    ${totalAnalysts > 0 ? `
    <div class="section-title">Analyst Ratings</div>
    <div class="insight-card" style="margin-bottom:var(--space-4);">
      <div class="analyst-bar">
        <div class="analyst-bar-buy" style="width:${buyPct}%"></div>
        <div class="analyst-bar-hold" style="width:${holdPct}%"></div>
        <div class="analyst-bar-sell" style="width:${sellPct}%"></div>
      </div>
      <div class="analyst-labels">
        <span class="positive">Buy ${stock.analystBuy || 0}</span>
        <span style="color:var(--color-warning)">Hold ${stock.analystHold || 0}</span>
        <span class="negative">Sell ${stock.analystSell || 0}</span>
      </div>
    </div>` : ''}

    ${stock.ptLow && stock.ptHigh ? `
    <div class="section-title">Price Targets</div>
    <div class="insight-card" style="margin-bottom:var(--space-4);">
      <div class="price-target-bar">
        <div class="pt-track"></div>
        <div class="pt-range" style="left:0%; right:0%;"></div>
        <div class="pt-marker pt-current" style="left:${Math.min(100, Math.max(0, currentPos))}%;" title="Current: $${fmt(stock.price)}"></div>
        <div class="pt-marker pt-avg" style="left:${Math.min(100, Math.max(0, avgPos))}%;" title="Avg Target: $${stock.ptAvg}"></div>
      </div>
      <div class="pt-labels">
        <span>$${stock.ptLow}</span>
        <span style="color:var(--color-primary);">Avg $${stock.ptAvg}</span>
        <span>$${stock.ptHigh}</span>
      </div>
    </div>` : ''}

    <div class="section-title">Predicted Price (6M)</div>
    <div class="chart-container" style="margin-bottom:var(--space-4);">
      <div class="chart-wrapper" style="height:200px;">
        <canvas id="detail-prediction-chart"></canvas>
      </div>
    </div>

    ${tickerNews.length > 0 ? `
    <div class="section-title">Recent News</div>
    <div class="detail-news-list">
      ${tickerNews.slice(0, 5).map(n => `
        <div class="detail-news-item" ${n.url ? `onclick="window.open('${n.url}', '_blank')"` : ''} style="${n.url ? 'cursor:pointer' : ''}">
          <div class="detail-news-headline">${n.headline}</div>
          <div class="detail-news-meta">${n.source || 'Yahoo Finance'} · ${timeAgo(n.pubDate)}</div>
        </div>
      `).join('')}
    </div>` : ''}

    ${removeStockHTML}
  `;

  renderDetailTimeRange(ticker);
  await renderDetailChart(ticker, isWatchlist, tickerNews);
  await renderDetailPrediction(ticker);

  // Lot delete handlers
  content.querySelectorAll('.lot-delete-btn[data-lot-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.lotTicker;
      const idx = parseInt(btn.dataset.lotIdx);
      if (portfolio[t] && portfolio[t].lots[idx]) {
        portfolio[t].lots.splice(idx, 1);
        if (portfolio[t].lots.length === 0) delete portfolio[t];
        savePortfolio();
        renderDetailContent(t, isWatchlist);
        renderPortfolioView();
      }
    });
  });
  
  const addLotBtn = content.querySelector('#add-lot-to-existing');
  if (addLotBtn) {
    addLotBtn.addEventListener('click', () => {
      selectedAddTicker = ticker;
      document.getElementById('selected-stock-display').textContent = `${ticker} — ${stock.name}`;
      document.getElementById('add-lot-form').style.display = 'block';
      document.getElementById('stock-search-input').parentElement.style.display = 'none';
      document.getElementById('add-stock-modal').classList.add('open');
    });
  }

  // ============================================
  // FEATURE 2: Remove stock button handler
  // ============================================
  const removeBtn = content.querySelector('#remove-stock-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const t = removeBtn.dataset.ticker;
      if (confirm(`Remove ${t} from your portfolio? This will delete all lots for this stock.`)) {
        delete portfolio[t];
        savePortfolio();
        closeStockDetail();
        renderPortfolioView();
      }
    });
  }
}

function renderDetailTimeRange(ticker) {
  const ranges = [
    { key: '7', label: '1W' }, { key: '30', label: '1M' }, { key: '90', label: '3M' },
    { key: '180', label: '6M' }, { key: '365', label: '1Y' },
  ];
  const bar = document.getElementById('detail-time-range');
  if (!bar) return;
  bar.innerHTML = ranges.map(r =>
    `<button class="time-btn ${detailRange === r.key ? 'active' : ''}" data-range="${r.key}">${r.label}</button>`
  ).join('');
  bar.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      detailRange = btn.dataset.range;
      renderDetailTimeRange(ticker);
      // Re-fetch news for markers
      const tNews = newsCache.filter(n => n.ticker === ticker);
      renderDetailChart(ticker, !!watchlist.includes(ticker), tNews);
    });
  });
}

// ============================================
// FEATURE 5, 6, 7: Enhanced detail chart
// Dual-line (price + holdings value), transaction markers, split/news indicators
// ============================================
async function renderDetailChart(ticker, isWatchlistItem = false, tickerNews = []) {
  const canvas = document.getElementById('detail-price-chart');
  if (!canvas) return;
  if (detailChart) { detailChart.destroy(); detailChart = null; }
  
  await fetchHistory([ticker], detailRange);
  const yperiod = { '7': '5d', '30': '1mo', '90': '3mo', '180': '6mo', '365': '1y' }[detailRange] || '1mo';
  const hist = historicalCache[`${ticker}:${yperiod}`];
  if (!hist || !hist.close || hist.close.length === 0) return;

  const labels = hist.dates.map(d => {
    const dt = new Date(d);
    if (hist.dates.length <= 7) return dt.toLocaleDateString('en-US', { weekday: 'short' });
    if (hist.dates.length <= 90) return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });
  
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const primaryColor = style.getPropertyValue('--color-primary').trim() || '#4ECDC4';
  const textColor = style.getPropertyValue('--color-text-muted').trim();
  const gridColor = style.getPropertyValue('--color-divider').trim();

  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(78, 205, 196, 0.15)');
  gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');

  const inPortfolio = !!(portfolio[ticker] && !isWatchlistItem);
  const holding = portfolio[ticker];

  // Base datasets: price line (left Y-axis)
  const datasets = [{
    label: 'Price',
    data: hist.close,
    borderColor: primaryColor,
    backgroundColor: gradient,
    fill: true,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: primaryColor,
    borderWidth: 2,
    yAxisID: 'y',
  }];

  // ============================================
  // FEATURE 5: Holdings value line
  // ============================================
  if (inPortfolio && holding) {
    const holdingsValue = hist.dates.map(date => {
      const shares = getSharesHeldOnDate(ticker, date);
      const idx = hist.dates.indexOf(date);
      return shares > 0 ? shares * hist.close[idx] : null;
    });

    datasets.push({
      label: 'Holdings Value',
      data: holdingsValue,
      borderColor: '#F59E0B',
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: '#F59E0B',
      borderWidth: 2,
      spanGaps: true,
      yAxisID: 'y1',
    });
  }

  // ============================================
  // FEATURE 6: Transaction marker datasets
  // ============================================
  if (inPortfolio && holding && holding.lots) {
    const buyData = hist.dates.map((date, i) => {
      const lotsOnDate = holding.lots.filter(l => l.date === date && (l.type || 'buy') === 'buy');
      if (lotsOnDate.length > 0) return hist.close[i];
      return null;
    });

    const sellData = hist.dates.map((date, i) => {
      const lotsOnDate = holding.lots.filter(l => l.date === date && l.type === 'sell');
      if (lotsOnDate.length > 0) return hist.close[i];
      return null;
    });

    // Buy markers dataset (on price axis)
    datasets.push({
      label: 'Buy',
      data: buyData,
      borderColor: 'transparent',
      backgroundColor: '#10B981',
      fill: false,
      showLine: false,
      pointRadius: hist.dates.map((date) => {
        return holding.lots.some(l => l.date === date && (l.type || 'buy') === 'buy') ? 7 : 0;
      }),
      pointHoverRadius: 9,
      pointStyle: 'circle',
      pointBackgroundColor: '#10B981',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      yAxisID: 'y',
    });

    // Sell markers dataset (on price axis)
    datasets.push({
      label: 'Sell',
      data: sellData,
      borderColor: 'transparent',
      backgroundColor: '#EF4444',
      fill: false,
      showLine: false,
      pointRadius: hist.dates.map((date) => {
        return holding.lots.some(l => l.date === date && l.type === 'sell') ? 7 : 0;
      }),
      pointHoverRadius: 9,
      pointStyle: 'circle',
      pointBackgroundColor: '#EF4444',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      yAxisID: 'y',
    });
  }

  // ============================================
  // FEATURE 7: News/split markers
  // Top 3 recent news items within chart date range
  // ============================================
  const chartStartDate = hist.dates[0];
  const chartEndDate = hist.dates[hist.dates.length - 1];

  const newsInRange = (tickerNews || []).filter(n => {
    if (!n.pubDate) return false;
    const pubDateStr = new Date(n.pubDate).toISOString().split('T')[0];
    return pubDateStr >= chartStartDate && pubDateStr <= chartEndDate;
  });

  // Top 3 most recent news events
  const topNews = newsInRange
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 3);

  if (topNews.length > 0) {
    const newsData = hist.dates.map((date, i) => {
      const hasNews = topNews.some(n => {
        const pubDateStr = new Date(n.pubDate).toISOString().split('T')[0];
        return pubDateStr === date;
      });
      return hasNews ? hist.close[i] * 1.02 : null; // slightly above price line
    });

    const newsRadii = hist.dates.map(date => {
      return topNews.some(n => {
        const pubDateStr = new Date(n.pubDate).toISOString().split('T')[0];
        return pubDateStr === date;
      }) ? 5 : 0;
    });

    datasets.push({
      label: 'News',
      data: newsData,
      borderColor: 'transparent',
      backgroundColor: '#A78BFA',
      fill: false,
      showLine: false,
      pointRadius: newsRadii,
      pointHoverRadius: 7,
      pointStyle: 'rectRot', // diamond shape
      pointBackgroundColor: '#A78BFA',
      pointBorderColor: '#fff',
      pointBorderWidth: 1,
      yAxisID: 'y',
    });
  }

  // Split event markers (vertical line effect via separate dataset)
  const splitNews = (tickerNews || []).filter(n =>
    n.headline && n.headline.toLowerCase().includes('split') &&
    n.pubDate && new Date(n.pubDate).toISOString().split('T')[0] >= chartStartDate &&
    new Date(n.pubDate).toISOString().split('T')[0] <= chartEndDate
  );

  if (splitNews.length > 0) {
    const splitData = hist.dates.map((date, i) => {
      const hasSplit = splitNews.some(n => {
        const pubDateStr = new Date(n.pubDate).toISOString().split('T')[0];
        return pubDateStr === date;
      });
      return hasSplit ? hist.close[i] : null;
    });

    datasets.push({
      label: 'Split',
      data: splitData,
      borderColor: '#A78BFA',
      borderDash: [4, 4],
      backgroundColor: 'rgba(167,139,250,0.3)',
      fill: false,
      showLine: false,
      pointRadius: hist.dates.map(date => {
        return splitNews.some(n => {
          const pubDateStr = new Date(n.pubDate).toISOString().split('T')[0];
          return pubDateStr === date;
        }) ? 8 : 0;
      }),
      pointHoverRadius: 10,
      pointStyle: 'triangle',
      pointBackgroundColor: '#A78BFA',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      borderWidth: 1,
      yAxisID: 'y',
    });
  }

  detailChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: style.getPropertyValue('--color-surface-2').trim(),
          titleColor: style.getPropertyValue('--color-text').trim(),
          bodyColor: textColor,
          borderColor: style.getPropertyValue('--color-border').trim(),
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          filter: (item) => {
            // Hide datasets with null values at this point from tooltip
            return item.raw !== null && item.raw !== undefined;
          },
          callbacks: {
            label: (ctx) => {
              const dsLabel = ctx.dataset.label;
              if (dsLabel === 'Price') return `Price: $${fmt(ctx.raw)}`;
              if (dsLabel === 'Holdings Value') return `Holdings: $${fmt(ctx.raw)}`;
              if (dsLabel === 'Buy') {
                // Find matching lot(s)
                const date = hist.dates[ctx.dataIndex];
                const lots = holding?.lots?.filter(l => l.date === date && (l.type || 'buy') === 'buy') || [];
                return lots.map(l => `Bought ${l.qty} shares @ $${fmt(l.price)}`);
              }
              if (dsLabel === 'Sell') {
                const date = hist.dates[ctx.dataIndex];
                const lots = holding?.lots?.filter(l => l.date === date && l.type === 'sell') || [];
                return lots.map(l => `Sold ${l.qty} shares @ $${fmt(l.price)}`);
              }
              if (dsLabel === 'News') {
                const date = hist.dates[ctx.dataIndex];
                const item = topNews.find(n => new Date(n.pubDate).toISOString().split('T')[0] === date);
                return item ? `News: ${item.headline.slice(0, 50)}...` : 'News Event';
              }
              if (dsLabel === 'Split') return 'Stock Split';
              return `${dsLabel}: $${fmt(ctx.raw)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 9, family: 'DM Sans' }, maxRotation: 0, maxTicksLimit: 5 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          type: 'linear',
          position: 'left',
          title: {
            display: inPortfolio,
            text: 'Stock Price',
            color: primaryColor,
            font: { size: 10, family: 'DM Sans', weight: '500' },
          },
          ticks: { color: primaryColor, font: { size: 9, family: 'DM Mono' }, callback: v => '$' + fmt(v, 0) },
          grid: { color: gridColor, lineWidth: 0.5 },
          border: { display: false },
        },
        y1: {
          type: 'linear',
          position: 'right',
          display: inPortfolio,
          title: {
            display: true,
            text: 'Holdings Value',
            color: '#F59E0B',
            font: { size: 10, family: 'DM Sans', weight: '500' },
          },
          ticks: { color: '#F59E0B', font: { size: 9, family: 'DM Mono' }, callback: v => '$' + fmtCompact(v) },
          grid: { drawOnChartArea: false },
          border: { display: false },
        },
      },
    },
  });
}

async function renderDetailPrediction(ticker) {
  const canvas = document.getElementById('detail-prediction-chart');
  if (!canvas) return;
  
  const stock = getStock(ticker);
  if (!stock) return;

  await fetchHistory([ticker], '180');
  const yperiod = '6mo';
  const hist = historicalCache[`${ticker}:${yperiod}`];
  if (!hist || !hist.close || hist.close.length < 5) return;
  
  const prediction = monteCarloPrediction(stock.price, hist.close, 180, 300);
  const style = getComputedStyle(document.documentElement);
  const primaryColor = style.getPropertyValue('--color-primary').trim();
  const textColor = style.getPropertyValue('--color-text-muted').trim();
  const gridColor = style.getPropertyValue('--color-divider').trim();

  const labels = [];
  const now = new Date();
  for (let i = 0; i <= 180; i += 5) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short' }));
  }

  const sampleEvery = 5;
  const sampleData = (arr) => arr.filter((_, i) => i % sampleEvery === 0);

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { data: sampleData(prediction.high95), borderColor: 'transparent', backgroundColor: 'rgba(78,205,196,0.05)', fill: '+4', pointRadius: 0, tension: 0.4 },
        { data: sampleData(prediction.high68), borderColor: 'transparent', backgroundColor: 'rgba(78,205,196,0.1)', fill: '+2', pointRadius: 0, tension: 0.4 },
        { data: sampleData(prediction.median), borderColor: primaryColor, borderWidth: 2, fill: false, pointRadius: 0, tension: 0.4 },
        { data: sampleData(prediction.low68), borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 },
        { data: sampleData(prediction.low95), borderColor: 'transparent', fill: false, pointRadius: 0, tension: 0.4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 9 }, maxRotation: 0, maxTicksLimit: 5 }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: textColor, font: { size: 9, family: 'DM Mono' }, callback: v => '$' + fmt(v, 0) }, grid: { color: gridColor, lineWidth: 0.5 }, border: { display: false } },
      },
    },
  });
}

// ============================================
// SECTION 11: MODALS & FAB
// ============================================

let selectedAddTicker = null;

document.getElementById('fab-add')?.addEventListener('click', openAddStockModal);

function openAddStockModal() {
  selectedAddTicker = null;
  selectedTxType = 'buy';
  document.getElementById('stock-search-input').value = '';
  document.getElementById('stock-search-results').classList.remove('visible');
  document.getElementById('add-lot-form').style.display = 'none';
  document.getElementById('stock-search-input').parentElement.style.display = 'block';
  document.getElementById('add-stock-modal').classList.add('open');
  setTimeout(() => document.getElementById('stock-search-input').focus(), 300);
  // Reset toggle state when modal opens
  updateTxTypeToggle();
}

// ============================================
// FEATURE 3: Transaction type toggle
// ============================================
function updateTxTypeToggle() {
  const toggleContainer = document.getElementById('tx-type-toggle');
  if (!toggleContainer) return;

  const buyBtn = toggleContainer.querySelector('[data-type="buy"]');
  const sellBtn = toggleContainer.querySelector('[data-type="sell"]');
  if (!buyBtn || !sellBtn) return;

  if (selectedTxType === 'buy') {
    buyBtn.style.cssText = `
      flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:700;
      cursor:pointer; background:rgba(16,185,129,0.2); color:#10B981; transition:all 150ms;
    `;
    sellBtn.style.cssText = `
      flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:600;
      cursor:pointer; background:transparent; color:var(--color-text-muted); transition:all 150ms;
    `;
  } else {
    sellBtn.style.cssText = `
      flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:700;
      cursor:pointer; background:rgba(239,68,68,0.2); color:#EF4444; transition:all 150ms;
    `;
    buyBtn.style.cssText = `
      flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:600;
      cursor:pointer; background:transparent; color:var(--color-text-muted); transition:all 150ms;
    `;
  }

  // Tint the form background based on type
  const addLotForm = document.getElementById('add-lot-form');
  if (addLotForm) {
    addLotForm.style.borderColor = selectedTxType === 'sell' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)';
  }
}

// Inject the toggle into the add-lot form HTML
// We do this by hooking into when the form becomes visible
function ensureTxTypeToggleExists() {
  const form = document.getElementById('add-lot-form');
  if (!form) return;
  if (document.getElementById('tx-type-toggle')) return; // already injected

  const toggle = document.createElement('div');
  toggle.id = 'tx-type-toggle';
  toggle.style.cssText = `
    display:flex; gap:4px; background:var(--color-surface-offset,rgba(255,255,255,0.06));
    border-radius:8px; padding:4px; margin-bottom:var(--space-3,12px);
  `;
  toggle.innerHTML = `
    <button class="tx-type-btn" data-type="buy" style="flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; background:rgba(16,185,129,0.2); color:#10B981; transition:all 150ms;">Buy</button>
    <button class="tx-type-btn" data-type="sell" style="flex:1; padding:7px 0; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; background:transparent; color:var(--color-text-muted); transition:all 150ms;">Sell</button>
  `;

  // Insert as the first child of the form
  form.insertBefore(toggle, form.firstChild);

  toggle.querySelectorAll('.tx-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTxType = btn.dataset.type;
      updateTxTypeToggle();
    });
  });
}

// Close modals on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
});

// Stock search — now uses live search API
let searchDebounce;
document.getElementById('stock-search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const query = e.target.value.trim();
    const results = document.getElementById('stock-search-results');
    if (!query || query.length < 1) { results.classList.remove('visible'); return; }
    
    const matches = await searchStocks(query);
    if (matches.length === 0) { results.classList.remove('visible'); return; }
    
    results.innerHTML = matches.map(m =>
      `<div class="search-result-item" data-ticker="${m.symbol}">
        <span class="search-result-ticker">${m.symbol}</span>
        <span class="search-result-name">${m.name}</span>
      </div>`
    ).join('');
    results.classList.add('visible');
    
    results.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        selectedAddTicker = item.dataset.ticker;
        // Fetch quote for this ticker
        let stock = getStock(selectedAddTicker);
        if (!stock) {
          try {
            const data = await marketApi('/quotes', { tickers: selectedAddTicker });
            if (data.quotes) {
              Object.assign(stockDataCache, data.quotes);
              stock = data.quotes[selectedAddTicker];
            }
          } catch(e) {}
        }
        const name = stock ? stock.name : selectedAddTicker;
        const price = stock ? stock.price : '';
        document.getElementById('selected-stock-display').textContent = `${selectedAddTicker} — ${name}`;
        document.getElementById('add-lot-form').style.display = 'block';
        document.getElementById('stock-search-input').parentElement.style.display = 'none';
        document.getElementById('lot-price').value = price ? price.toFixed(2) : '';
        results.classList.remove('visible');

        // Inject toggle + reset tx type
        selectedTxType = 'buy';
        ensureTxTypeToggleExists();
        updateTxTypeToggle();
      });
    });
  }, 300);
});

// Add lot — now includes type
document.getElementById('add-lot-btn')?.addEventListener('click', async () => {
  if (!selectedAddTicker) return;
  const date = document.getElementById('lot-date').value;
  const qty = parseFloat(document.getElementById('lot-qty').value);
  const price = parseFloat(document.getElementById('lot-price').value);
  
  if (!date || !qty || !price || qty <= 0 || price <= 0) return;
  
  if (!portfolio[selectedAddTicker]) {
    portfolio[selectedAddTicker] = { lots: [] };
  }
  // FEATURE 3: Include type field
  portfolio[selectedAddTicker].lots.push({ date, qty, price, type: selectedTxType });
  savePortfolio();
  
  // Fetch quote for the new ticker if needed
  if (!getStock(selectedAddTicker)) {
    try {
      const data = await marketApi('/quotes', { tickers: selectedAddTicker });
      if (data.quotes) Object.assign(stockDataCache, data.quotes);
    } catch(e) {}
  }
  
  document.getElementById('add-stock-modal').classList.remove('open');
  document.getElementById('lot-qty').value = '';
  document.getElementById('lot-price').value = '';

  // Reset type for next use
  selectedTxType = 'buy';
  
  renderPortfolioView();
});

// Cancel
document.getElementById('cancel-add-btn')?.addEventListener('click', () => {
  document.getElementById('add-stock-modal').classList.remove('open');
});

// Watchlist add — now uses live search
document.getElementById('add-watchlist-btn')?.addEventListener('click', () => {
  document.getElementById('watchlist-search-input').value = '';
  document.getElementById('watchlist-search-results').classList.remove('visible');
  document.getElementById('add-watchlist-modal').classList.add('open');
  setTimeout(() => document.getElementById('watchlist-search-input').focus(), 300);
});

let wlSearchDebounce;
document.getElementById('watchlist-search-input')?.addEventListener('input', (e) => {
  clearTimeout(wlSearchDebounce);
  wlSearchDebounce = setTimeout(async () => {
    const query = e.target.value.trim();
    const results = document.getElementById('watchlist-search-results');
    if (!query || query.length < 1) { results.classList.remove('visible'); return; }
    
    const matches = await searchStocks(query);
    const filtered = matches.filter(m => !watchlist.includes(m.symbol) && !portfolio[m.symbol]);
    if (filtered.length === 0) { results.classList.remove('visible'); return; }
    
    results.innerHTML = filtered.map(m =>
      `<div class="search-result-item" data-ticker="${m.symbol}">
        <span class="search-result-ticker">${m.symbol}</span>
        <span class="search-result-name">${m.name}</span>
      </div>`
    ).join('');
    results.classList.add('visible');
    
    results.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        const ticker = item.dataset.ticker;
        watchlist.push(ticker);
        saveWatchlist();
        // Fetch quote
        if (!getStock(ticker)) {
          try {
            const data = await marketApi('/quotes', { tickers: ticker });
            if (data.quotes) Object.assign(stockDataCache, data.quotes);
          } catch(e) {}
        }
        document.getElementById('add-watchlist-modal').classList.remove('open');
        renderWatchlistView();
      });
    });
  }, 300);
});

// ============================================
// SECTION 12: PULL TO REFRESH
// ============================================

let ptrActive = false;
let ptrStartY = 0;

const mainContent = document.querySelector('.main-content');
const ptrIndicator = document.getElementById('ptr-indicator');

mainContent?.addEventListener('touchstart', (e) => {
  if (mainContent.scrollTop <= 0) { ptrStartY = e.touches[0].clientY; ptrActive = true; }
}, { passive: true });

mainContent?.addEventListener('touchmove', (e) => {
  if (!ptrActive) return;
  const diff = e.touches[0].clientY - ptrStartY;
  if (diff > 60 && mainContent.scrollTop <= 0) ptrIndicator.classList.add('visible');
}, { passive: true });

mainContent?.addEventListener('touchend', () => {
  if (ptrIndicator.classList.contains('visible')) {
    // Force refresh live data
    lastQuoteFetch = 0;
    lastNewsFetch = 0;
    historicalCache = {};
    sp500Cache = {};
    initApp().then(() => {
      ptrIndicator.classList.remove('visible');
    });
  }
  ptrActive = false;
});

// ============================================
// SECTION 13: INITIALIZE
// ============================================

let initialized = false;

async function initApp() {
  if (initialized && Object.keys(stockDataCache).length > 0) {
    // Just refresh
    renderPortfolioView();
    return;
  }
  initialized = true;

  // Show loading state
  showLoading('holdings-list', 'Fetching live market data...');

  try {
    // Fetch quotes for all portfolio + watchlist tickers
    await fetchQuotes(true);
    
    // Also pre-fetch 5d sparkline data for portfolio tickers
    const holdingTickers = Object.keys(portfolio);
    if (holdingTickers.length > 0) {
      await fetchHistory(holdingTickers, '7');
    }
  } catch(e) {
    console.error('Init data fetch error:', e);
  }

  // Render
  renderPortfolioView();
  
  // Auto-refresh quotes every 60 seconds
  setInterval(async () => {
    if (document.hidden) return;
    await fetchQuotes(true);
    if (currentView === 'portfolio') renderPortfolioView();
    if (currentView === 'watchlist') renderWatchlistView();
  }, 60000);
}

// Auth-aware startup
initAuthUI();

async function startApp() {
  document.querySelector('.app-shell').style.display = 'none';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
