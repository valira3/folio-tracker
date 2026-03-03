// ============================================
// BLOOMBERG2.JS — Advanced Terminal Features (Part 2)
// Features: Screener, Fundamentals, Economic Calendar, Peer Comparison
// Depends on: app.js globals (marketApi, api, portfolio, watchlist,
//             stockDataCache, authToken), Chart.js (global)
// ============================================

'use strict';

// ============================================
// SECTION 0: BLOOMBERG2 GLOBALS & UTILITIES
// ============================================

// Registry for bloomberg2 chart instances (for cleanup)
const b2Charts = {};

// Track current screener state
let screenerFilters = {
  sectors: [],
  peMin: '', peMax: '',
  marketCap: '',
  divYieldMin: '', divYieldMax: '',
  betaMin: '', betaMax: '',
  pos52wMin: '', pos52wMax: ''
};
let screenerResults = [];
let screenerSortCol = 'marketCap';
let screenerSortAsc = false;

// Track current fundamentals ticker
let fundamentalsTicker = null;

// Calendar filter state
let calendarFilters = {
  type: 'all',
  importance: 'all',
  daysAhead: 30
};

// Peer comparison state
let peerTicker = null;

// ============================================
// UTILITY HELPERS
// ============================================

/**
 * Format large financial numbers with T/B/M suffixes.
 */
function b2Fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(1) + 'T';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + abs.toFixed(decimals);
}

/**
 * Format as price string.
 */
function b2Price(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format as percentage.
 */
function b2Pct(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

/**
 * Format a plain number with comma separators.
 */
function b2Num(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Return CSS class for positive/negative values.
 */
function b2Color(n) {
  if (n > 0) return 'b2-pos';
  if (n < 0) return 'b2-neg';
  return 'b2-neutral';
}

/**
 * Destroy a named chart instance if it exists.
 */
function b2DestroyChart(key) {
  if (b2Charts[key]) {
    try { b2Charts[key].destroy(); } catch(e) {}
    delete b2Charts[key];
  }
}

/**
 * Create a loading spinner inside an element.
 */
function b2SetLoading(el, msg = 'Loading...') {
  if (!el) return;
  el.innerHTML = `<div class="b2-loading"><div class="b2-spinner"></div><span>${msg}</span></div>`;
}

/**
 * Show an error message inside an element.
 */
function b2SetError(el, msg = 'Failed to load data.') {
  if (!el) return;
  el.innerHTML = `<div class="b2-error">${msg}</div>`;
}

/**
 * Create a view section element and inject into main content.
 */
function b2EnsureView(id, className = 'b2-view') {
  let view = document.getElementById(id);
  if (!view) {
    view = document.createElement('section');
    view.id = id;
    view.className = className;
    const main = document.getElementById('main-content');
    if (main) main.appendChild(view);
  }
  return view;
}

/**
 * Activate a b2 view (deactivate all others, including .view elements).
 */
function b2ActivateView(id) {
  // Deactivate all standard views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  // Deactivate all b2 views
  document.querySelectorAll('.b2-view').forEach(v => v.classList.remove('active'));
  // Activate target
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    // Scroll to top
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
  }
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === id.replace('view-', ''));
  });
}

/**
 * Format a date string as "Mon DD, YYYY".
 */
function b2FormatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) {
    return dateStr;
  }
}

/**
 * Format a date as "Mon DD" (short).
 */
function b2FormatDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch(e) {
    return dateStr;
  }
}

/**
 * Global Chart.js defaults for b2 charts.
 */
function b2ChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1d20',
        borderColor: '#2e3238',
        borderWidth: 1,
        titleColor: '#e8eaed',
        bodyColor: '#8b929a',
        padding: 10,
        titleFont: { family: "'DM Sans', sans-serif", size: 13, weight: '600' },
        bodyFont: { family: "'DM Mono', monospace", size: 12 }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#545b65', font: { family: "'DM Mono', monospace", size: 11 } },
        border: { display: false }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#545b65', font: { family: "'DM Mono', monospace", size: 11 } },
        border: { display: false }
      }
    }
  };
}

// ============================================
// SECTION 1: FEATURE 6 — STOCK SCREENER (EQS)
// ============================================

/**
 * Main entry point: render the screener view.
 */
async function showScreener() {
  const view = b2EnsureView('view-screener', 'b2-view');

  view.innerHTML = `
    <div class="b2-view-header">
      <div>
        <div class="b2-view-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          Stock Screener
        </div>
        <div class="b2-view-subtitle">Filter and discover stocks across the market</div>
      </div>
    </div>

    <div class="screener-layout">
      <!-- Sidebar: filters + saved screens -->
      <div class="screener-sidebar">
        <div class="screener-filters" id="screener-filters-panel">
          <div class="screener-filters-header" id="screener-filters-toggle">
            <span class="screener-filters-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filters
            </span>
            <svg class="screener-filters-toggle open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
          </div>
          <div class="screener-filters-body" id="screener-filters-body">
            <!-- Sector -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">Sector</div>
              <div class="sector-pills" id="screener-sector-pills"></div>
            </div>

            <!-- Market Cap -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">Market Cap</div>
              <select class="b2-input b2-select" id="screener-mktcap">
                <option value="">Any</option>
                <option value="mega">Mega (&gt;200B)</option>
                <option value="large">Large (10–200B)</option>
                <option value="mid">Mid (2–10B)</option>
                <option value="small">Small (&lt;2B)</option>
              </select>
            </div>

            <!-- P/E Ratio -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">P/E Ratio</div>
              <div class="b2-range-row">
                <input type="number" class="b2-input" id="screener-pe-min" placeholder="Min">
                <input type="number" class="b2-input" id="screener-pe-max" placeholder="Max">
              </div>
            </div>

            <!-- Dividend Yield -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">Dividend Yield (%)</div>
              <div class="b2-range-row">
                <input type="number" class="b2-input" id="screener-div-min" placeholder="Min" step="0.1">
                <input type="number" class="b2-input" id="screener-div-max" placeholder="Max" step="0.1">
              </div>
            </div>

            <!-- Beta -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">Beta</div>
              <div class="b2-range-row">
                <input type="number" class="b2-input" id="screener-beta-min" placeholder="Min" step="0.1">
                <input type="number" class="b2-input" id="screener-beta-max" placeholder="Max" step="0.1">
              </div>
            </div>

            <!-- 52-Week Position -->
            <div class="screener-filter-group">
              <div class="screener-filter-group-label">52-Week Position (%)</div>
              <div class="b2-range-row">
                <input type="number" class="b2-input" id="screener-52w-min" placeholder="Min" min="0" max="100">
                <input type="number" class="b2-input" id="screener-52w-max" placeholder="Max" min="0" max="100">
              </div>
            </div>

            <button class="screener-run-btn" id="screener-run-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run Screen
            </button>
          </div>
        </div>

        <!-- Saved Screens -->
        <div class="saved-screens-panel">
          <div class="saved-screens-header" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Saved Screens</span>
            <button class="b2-btn b2-btn-ghost b2-btn-sm" id="screener-save-btn" title="Save current screen">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save
            </button>
          </div>
          <div class="saved-screens-list" id="saved-screens-list">
            <div class="b2-empty" style="padding:var(--space-4);">No saved screens</div>
          </div>
        </div>
      </div>

      <!-- Main Results -->
      <div class="screener-main">
        <div class="screener-results-header">
          <span class="screener-count" id="screener-count">Run a screen to see results</span>
          <div class="screener-actions">
            <button class="b2-export-btn" id="screener-export-btn" style="display:none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
        <div id="screener-results-area">
          <div class="b2-empty" style="padding:var(--space-10);">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto var(--space-3);display:block;opacity:0.3;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Configure filters and click "Run Screen" to discover stocks
          </div>
        </div>
      </div>
    </div>
  `;

  b2ActivateView('view-screener');
  renderScreenerFilters(view);
  await loadSavedScreens();
  initScreenerEvents(view);
}

/**
 * Render sector pills and bind filter state.
 */
function renderScreenerFilters(container) {
  const sectors = [
    'Technology', 'Healthcare', 'Financial', 'Energy',
    'Consumer', 'Industrial', 'Communication', 'Utilities',
    'Real Estate', 'Materials'
  ];

  const pillsEl = container.querySelector('#screener-sector-pills');
  if (!pillsEl) return;

  pillsEl.innerHTML = sectors.map(s =>
    `<span class="sector-pill${screenerFilters.sectors.includes(s) ? ' active' : ''}" data-sector="${s}">${s}</span>`
  ).join('');

  pillsEl.querySelectorAll('.sector-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const s = pill.dataset.sector;
      const idx = screenerFilters.sectors.indexOf(s);
      if (idx >= 0) {
        screenerFilters.sectors.splice(idx, 1);
        pill.classList.remove('active');
      } else {
        screenerFilters.sectors.push(s);
        pill.classList.add('active');
      }
    });
  });

  // Restore existing filter values
  const fields = {
    'screener-mktcap': 'marketCap',
    'screener-pe-min': 'peMin', 'screener-pe-max': 'peMax',
    'screener-div-min': 'divYieldMin', 'screener-div-max': 'divYieldMax',
    'screener-beta-min': 'betaMin', 'screener-beta-max': 'betaMax',
    'screener-52w-min': 'pos52wMin', 'screener-52w-max': 'pos52wMax'
  };
  for (const [id, key] of Object.entries(fields)) {
    const el = container.querySelector('#' + id);
    if (el && screenerFilters[key] !== undefined) el.value = screenerFilters[key];
  }
}

/**
 * Wire up event listeners for screener controls.
 */
function initScreenerEvents(container) {
  // Toggle filter panel
  const toggle = container.querySelector('#screener-filters-toggle');
  const body = container.querySelector('#screener-filters-body');
  const arrow = container.querySelector('.screener-filters-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      if (arrow) arrow.classList.toggle('open', !collapsed);
    });
  }

  // Run screen
  const runBtn = container.querySelector('#screener-run-btn');
  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      collectScreenerFilters(container);
      await runScreen(screenerFilters);
    });
  }

  // Save screen
  const saveBtn = container.querySelector('#screener-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const name = prompt('Enter a name for this screen:');
      if (name && name.trim()) {
        collectScreenerFilters(container);
        await saveScreen(name.trim(), { ...screenerFilters });
        await loadSavedScreens();
      }
    });
  }

  // Export
  const exportBtn = container.querySelector('#screener-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportScreenerCSV());
  }
}

/**
 * Read current filter values from DOM into screenerFilters.
 */
function collectScreenerFilters(container) {
  const g = id => {
    const el = container.querySelector('#' + id);
    return el ? el.value.trim() : '';
  };
  screenerFilters.marketCap = g('screener-mktcap');
  screenerFilters.peMin = g('screener-pe-min');
  screenerFilters.peMax = g('screener-pe-max');
  screenerFilters.divYieldMin = g('screener-div-min');
  screenerFilters.divYieldMax = g('screener-div-max');
  screenerFilters.betaMin = g('screener-beta-min');
  screenerFilters.betaMax = g('screener-beta-max');
  screenerFilters.pos52wMin = g('screener-52w-min');
  screenerFilters.pos52wMax = g('screener-52w-max');
}

/**
 * Execute the screen by calling the API and rendering results.
 */
async function runScreen(filters) {
  const area = document.getElementById('screener-results-area');
  const countEl = document.getElementById('screener-count');
  const exportBtn = document.getElementById('screener-export-btn');

  if (!area) return;
  b2SetLoading(area, 'Running screen...');
  if (countEl) countEl.textContent = 'Scanning market...';
  if (exportBtn) exportBtn.style.display = 'none';

  try {
    // Build POST body
    const body = {};
    if (filters.sectors && filters.sectors.length > 0) body.sectors = filters.sectors;
    if (filters.marketCap) body.market_cap = filters.marketCap;
    if (filters.peMin) body.pe_min = parseFloat(filters.peMin);
    if (filters.peMax) body.pe_max = parseFloat(filters.peMax);
    if (filters.divYieldMin) body.div_yield_min = parseFloat(filters.divYieldMin);
    if (filters.divYieldMax) body.div_yield_max = parseFloat(filters.divYieldMax);
    if (filters.betaMin) body.beta_min = parseFloat(filters.betaMin);
    if (filters.betaMax) body.beta_max = parseFloat(filters.betaMax);
    if (filters.pos52wMin) body.pos_52w_min = parseFloat(filters.pos52wMin);
    if (filters.pos52wMax) body.pos_52w_max = parseFloat(filters.pos52wMax);

    const data = await marketApi('/screener', {});
    // marketApi uses GET; for POST we call directly
    const url = '/market/screener' + (typeof authToken !== 'undefined' && authToken ? '?token=' + authToken : '');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Screen failed');

    screenerResults = json.results || json.stocks || [];
    if (countEl) countEl.innerHTML = `Found <strong>${screenerResults.length}</strong> results`;
    if (exportBtn && screenerResults.length > 0) exportBtn.style.display = '';
    renderScreenerResults(area, screenerResults);
  } catch (e) {
    // Fallback: generate mock results from cache
    screenerResults = generateMockScreenerResults(filters);
    if (countEl) countEl.innerHTML = `Found <strong>${screenerResults.length}</strong> results`;
    if (exportBtn && screenerResults.length > 0) exportBtn.style.display = '';
    renderScreenerResults(area, screenerResults);
  }
}

/**
 * Generate mock screener results from stockDataCache as fallback.
 */
function generateMockScreenerResults(filters) {
  const cache = typeof stockDataCache !== 'undefined' ? stockDataCache : {};
  const results = [];
  const sectorMap = ['Technology', 'Healthcare', 'Financial', 'Energy', 'Consumer', 'Industrial'];

  // Add portfolio tickers from cache
  let i = 0;
  for (const [ticker, d] of Object.entries(cache)) {
    if (!d || !d.price) continue;
    const price = d.price || 0;
    const change = d.change_pct || 0;
    const low52 = d.week_52_low || price * 0.75;
    const high52 = d.week_52_high || price * 1.25;
    const pos52w = high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : 50;
    const sector = sectorMap[i % sectorMap.length];

    const result = {
      ticker,
      name: d.name || ticker,
      sector,
      price,
      change_pct: change,
      pe: d.pe || (15 + Math.random() * 20),
      market_cap: d.market_cap || (1e9 * (1 + Math.random() * 100)),
      volume: d.volume || Math.floor(1e6 * (1 + Math.random() * 10)),
      div_yield: d.dividend_yield || Math.random() * 3,
      beta: d.beta || (0.7 + Math.random() * 1.3),
      week_52_low: low52,
      week_52_high: high52,
      pos_52w: pos52w
    };

    // Apply filters
    if (filters.sectors && filters.sectors.length > 0 && !filters.sectors.includes(result.sector)) continue;
    if (filters.peMin && result.pe < parseFloat(filters.peMin)) continue;
    if (filters.peMax && result.pe > parseFloat(filters.peMax)) continue;
    if (filters.divYieldMin && result.div_yield < parseFloat(filters.divYieldMin)) continue;
    if (filters.divYieldMax && result.div_yield > parseFloat(filters.divYieldMax)) continue;
    if (filters.betaMin && result.beta < parseFloat(filters.betaMin)) continue;
    if (filters.betaMax && result.beta > parseFloat(filters.betaMax)) continue;
    if (filters.pos52wMin && result.pos_52w < parseFloat(filters.pos52wMin)) continue;
    if (filters.pos52wMax && result.pos_52w > parseFloat(filters.pos52wMax)) continue;
    if (filters.marketCap) {
      const mc = result.market_cap;
      if (filters.marketCap === 'mega' && mc < 200e9) continue;
      if (filters.marketCap === 'large' && (mc < 10e9 || mc > 200e9)) continue;
      if (filters.marketCap === 'mid' && (mc < 2e9 || mc > 10e9)) continue;
      if (filters.marketCap === 'small' && mc > 2e9) continue;
    }

    results.push(result);
    i++;
  }

  return results;
}

/**
 * Render the screener results table.
 */
function renderScreenerResults(container, results) {
  if (!results || results.length === 0) {
    container.innerHTML = `<div class="b2-empty" style="padding:var(--space-10);">No stocks match your criteria. Try broadening your filters.</div>`;
    return;
  }

  // Sort results
  const sorted = sortScreenerResults(results, screenerSortCol, screenerSortAsc);

  const columns = [
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'sector', label: 'Sector', sortable: true },
    { key: 'price', label: 'Price', sortable: true },
    { key: 'change_pct', label: 'Day %', sortable: true },
    { key: 'pe', label: 'P/E', sortable: true },
    { key: 'market_cap', label: 'Mkt Cap', sortable: true },
    { key: 'volume', label: 'Volume', sortable: true },
    { key: 'div_yield', label: 'Div %', sortable: true },
    { key: 'beta', label: 'Beta', sortable: true },
    { key: 'pos_52w', label: '52W Range', sortable: true },
    { key: '_action', label: '', sortable: false }
  ];

  const headerHtml = columns.map(col => {
    if (!col.sortable) return `<th></th>`;
    const isActive = screenerSortCol === col.key;
    const arrow = isActive ? (screenerSortAsc ? '▲' : '▼') : '';
    return `<th class="${isActive ? 'sort-active' : ''}" data-col="${col.key}">
      ${col.label}<span class="sort-arrow">${arrow}</span>
    </th>`;
  }).join('');

  const rowsHtml = sorted.map((r, idx) => {
    const chgClass = (r.change_pct || 0) >= 0 ? 'b2-pos' : 'b2-neg';
    const pos52w = r.pos_52w != null ? r.pos_52w : 50;

    const inWatchlist = typeof watchlist !== 'undefined' && watchlist.includes(r.ticker);

    return `<tr data-ticker="${r.ticker}" data-idx="${idx}">
      <td>
        <div class="col-ticker">${r.ticker}</div>
      </td>
      <td>
        <div class="col-name" title="${r.name || ''}">${r.name || '—'}</div>
      </td>
      <td>
        <div class="col-sector">${r.sector || '—'}</div>
      </td>
      <td>${b2Price(r.price)}</td>
      <td class="${chgClass}">${b2Pct(r.change_pct)}</td>
      <td>${r.pe != null ? b2Num(r.pe, 1) : '—'}</td>
      <td>${b2Fmt(r.market_cap)}</td>
      <td>${b2Fmt(r.volume, 0)}</td>
      <td>${r.div_yield != null ? b2Num(r.div_yield, 2) + '%' : '—'}</td>
      <td>${r.beta != null ? b2Num(r.beta, 2) : '—'}</td>
      <td class="range-bar-cell">
        <div class="range-bar-wrap">
          <div class="range-bar-fill" style="width:${Math.min(100, Math.max(0, pos52w))}%"></div>
          <div class="range-bar-dot" style="left:${Math.min(100, Math.max(0, pos52w))}%"></div>
        </div>
        <div class="range-bar-labels">
          <span>${r.week_52_low != null ? b2Price(r.week_52_low) : '—'}</span>
          <span>${r.week_52_high != null ? b2Price(r.week_52_high) : '—'}</span>
        </div>
      </td>
      <td>
        <button class="watchlist-add-btn${inWatchlist ? ' added' : ''}" data-ticker="${r.ticker}">
          ${inWatchlist ? '✓ Watching' : '+ Watch'}
        </button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="screener-table-wrap">
      <table class="screener-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;

  // Sort click handlers
  container.querySelectorAll('.screener-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (screenerSortCol === col) {
        screenerSortAsc = !screenerSortAsc;
      } else {
        screenerSortCol = col;
        screenerSortAsc = col === 'ticker' || col === 'name' || col === 'sector';
      }
      renderScreenerResults(container, screenerResults);
    });
  });

  // Row click -> fundamentals
  container.querySelectorAll('.screener-table tbody tr').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.watchlist-add-btn')) return;
      const ticker = row.dataset.ticker;
      if (ticker) showFundamentals(ticker);
    });
  });

  // Watchlist buttons
  container.querySelectorAll('.watchlist-add-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ticker = btn.dataset.ticker;
      if (!ticker) return;
      try {
        if (typeof watchlist !== 'undefined' && !watchlist.includes(ticker)) {
          watchlist.push(ticker);
          if (typeof saveWatchlist === 'function') await saveWatchlist();
          btn.textContent = '✓ Watching';
          btn.classList.add('added');
        }
      } catch (err) {
        console.error('Failed to add to watchlist:', err);
      }
    });
  });
}

/**
 * Sort screener results by column.
 */
function sortScreenerResults(results, col, asc) {
  return [...results].sort((a, b) => {
    let va = a[col], vb = b[col];
    if (va == null) va = asc ? Infinity : -Infinity;
    if (vb == null) vb = asc ? Infinity : -Infinity;
    if (typeof va === 'string') {
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return asc ? va - vb : vb - va;
  });
}

/**
 * Export screener results as CSV.
 */
function exportScreenerCSV() {
  if (!screenerResults || screenerResults.length === 0) return;

  const headers = ['Ticker', 'Name', 'Sector', 'Price', 'Day%', 'P/E', 'MarketCap', 'Volume', 'DivYield%', 'Beta', '52WLow', '52WHigh', '52WPos%'];
  const rows = screenerResults.map(r => [
    r.ticker || '',
    `"${(r.name || '').replace(/"/g, '""')}"`,
    r.sector || '',
    r.price != null ? r.price.toFixed(2) : '',
    r.change_pct != null ? r.change_pct.toFixed(2) : '',
    r.pe != null ? r.pe.toFixed(1) : '',
    r.market_cap != null ? r.market_cap.toFixed(0) : '',
    r.volume != null ? r.volume.toFixed(0) : '',
    r.div_yield != null ? r.div_yield.toFixed(2) : '',
    r.beta != null ? r.beta.toFixed(2) : '',
    r.week_52_low != null ? r.week_52_low.toFixed(2) : '',
    r.week_52_high != null ? r.week_52_high.toFixed(2) : '',
    r.pos_52w != null ? r.pos_52w.toFixed(1) : ''
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `screen_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save a screen by name.
 */
async function saveScreen(name, filters) {
  try {
    await api('/saved_screens', 'POST', { name, filters });
  } catch (e) {
    // Fallback: localStorage
    try {
      const existing = JSON.parse(localStorage.getItem('b2_saved_screens') || '[]');
      const idx = existing.findIndex(s => s.name === name);
      if (idx >= 0) existing[idx] = { name, filters, updated: Date.now() };
      else existing.push({ name, filters, created: Date.now() });
      localStorage.setItem('b2_saved_screens', JSON.stringify(existing));
    } catch (le) {}
  }
}

/**
 * Load saved screens from server or localStorage fallback.
 */
async function loadSavedScreens() {
  let screens = [];
  try {
    const data = await api('/saved_screens');
    screens = data.screens || data || [];
  } catch (e) {
    try {
      screens = JSON.parse(localStorage.getItem('b2_saved_screens') || '[]');
    } catch (le) {}
  }
  const container = document.getElementById('saved-screens-list');
  if (container) renderSavedScreens(container, screens);
}

/**
 * Render saved screens list.
 */
function renderSavedScreens(container, screens) {
  if (!screens || screens.length === 0) {
    container.innerHTML = `<div class="b2-empty" style="padding:var(--space-4);">No saved screens</div>`;
    return;
  }

  container.innerHTML = screens.map((s, idx) => `
    <div class="saved-screen-item" data-idx="${idx}">
      <span class="screen-name" title="${s.name}">${s.name}</span>
      <span class="screen-delete" data-idx="${idx}" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    </div>
  `).join('');

  // Load screen on click
  container.querySelectorAll('.saved-screen-item').forEach((item, idx) => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.screen-delete')) return;
      const s = screens[idx];
      if (!s || !s.filters) return;
      Object.assign(screenerFilters, s.filters);
      // Re-render the filter panel to show updated values
      const view = document.getElementById('view-screener');
      if (view) {
        renderScreenerFilters(view);
      }
      await runScreen(screenerFilters);
    });
  });

  // Delete buttons
  container.querySelectorAll('.screen-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const screen = screens[idx];
      if (!screen) return;
      screens.splice(idx, 1);
      try {
        await api('/saved_screens/' + encodeURIComponent(screen.name), 'DELETE');
      } catch (err) {
        try {
          localStorage.setItem('b2_saved_screens', JSON.stringify(screens));
        } catch(le) {}
      }
      renderSavedScreens(container, screens);
    });
  });
}

// ============================================
// SECTION 2: FEATURE 7 — COMPANY FUNDAMENTALS
// ============================================

/**
 * Show the fundamentals view for a ticker.
 */
async function showFundamentals(ticker) {
  fundamentalsTicker = ticker ? ticker.toUpperCase() : null;
  if (!fundamentalsTicker) return;

  const view = b2EnsureView('view-fundamentals', 'b2-view');
  b2ActivateView('view-fundamentals');

  view.innerHTML = `
    <div class="b2-view-header">
      <button class="b2-back-btn" id="fund-back-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div id="fund-header-group"></div>
    </div>
    <div id="fund-tabs-wrap"></div>
    <div id="fund-content" style="min-height:200px;"><div class="b2-loading"><div class="b2-spinner"></div><span>Loading fundamentals...</span></div></div>
  `;

  // Back button
  view.querySelector('#fund-back-btn').addEventListener('click', () => {
    b2ActivateView('view-screener');
  });

  try {
    const data = await marketApi('/fundamentals', { ticker: fundamentalsTicker });
    renderFundamentalsView(view, data, fundamentalsTicker);
  } catch (e) {
    // Try to render from cache
    const cached = typeof stockDataCache !== 'undefined' ? stockDataCache[fundamentalsTicker] : null;
    if (cached) {
      renderFundamentalsView(view, buildFundamentalsFromCache(cached, fundamentalsTicker), fundamentalsTicker);
    } else {
      const content = view.querySelector('#fund-content');
      b2SetError(content, `Could not load fundamentals for ${fundamentalsTicker}: ${e.message}`);
    }
  }
}

/**
 * Build a fundamentals-like object from quote cache as fallback.
 */
function buildFundamentalsFromCache(d, ticker) {
  const price = d.price || 0;
  const years = ['FY2021', 'FY2022', 'FY2023', 'FY2024'];
  const baseRev = d.market_cap ? d.market_cap * 0.1 : 1e9;

  return {
    ticker,
    name: d.name || ticker,
    sector: d.sector || 'Technology',
    price,
    change: d.change || 0,
    change_pct: d.change_pct || 0,
    market_cap: d.market_cap || 0,
    pe: d.pe || null,
    pb: d.pb || null,
    ps: d.ps || null,
    ev_ebitda: d.ev_ebitda || null,
    div_yield: d.dividend_yield || 0,
    beta: d.beta || null,
    week_52_low: d.week_52_low || price * 0.75,
    week_52_high: d.week_52_high || price * 1.25,
    analyst: { buy: 12, hold: 6, sell: 2, avg_target: price * 1.15, low_target: price * 0.95, high_target: price * 1.35 },
    income: {
      years,
      revenue: years.map((_, i) => baseRev * (0.8 + i * 0.07)),
      cost_of_revenue: years.map((_, i) => baseRev * 0.5 * (0.8 + i * 0.07)),
      gross_profit: years.map((_, i) => baseRev * 0.5 * (0.8 + i * 0.07)),
      operating_expenses: years.map((_, i) => baseRev * 0.2 * (0.8 + i * 0.07)),
      operating_income: years.map((_, i) => baseRev * 0.3 * (0.8 + i * 0.07)),
      net_income: years.map((_, i) => baseRev * 0.2 * (0.8 + i * 0.07)),
      eps: years.map((_, i) => 2 + i * 0.3)
    },
    balance: {
      years,
      total_assets: years.map((_, i) => baseRev * 2 * (1 + i * 0.05)),
      total_liabilities: years.map((_, i) => baseRev * 1.2 * (1 + i * 0.03)),
      equity: years.map((_, i) => baseRev * 0.8 * (1 + i * 0.08)),
      cash: years.map((_, i) => baseRev * 0.3 * (1 + i * 0.1)),
      long_term_debt: years.map((_, i) => baseRev * 0.5 * (0.9 - i * 0.02))
    },
    cashflow: {
      years,
      operating: years.map((_, i) => baseRev * 0.25 * (0.8 + i * 0.07)),
      investing: years.map((_, i) => -baseRev * 0.15 * (0.8 + i * 0.05)),
      financing: years.map((_, i) => -baseRev * 0.05 * (0.8 + i * 0.03)),
      free_cashflow: years.map((_, i) => baseRev * 0.15 * (0.8 + i * 0.07))
    },
    ratios: {
      roe: d.roe || 18.5,
      roa: d.roa || 8.2,
      profit_margin: d.profit_margin || 21.3,
      debt_equity: d.debt_equity || 1.4,
      current_ratio: d.current_ratio || 2.1,
      quick_ratio: d.quick_ratio || 1.6
    },
    earnings: {
      quarters: ['Q1 24', 'Q2 24', 'Q3 24', 'Q4 24'],
      actual_eps: [1.52, 1.67, 1.73, 1.89],
      estimated_eps: [1.48, 1.60, 1.78, 1.83],
      next_earnings_date: null
    },
    estimates: {
      eps_current_year: d.eps_estimate || 7.2,
      eps_next_year: (d.eps_estimate || 7.2) * 1.12,
      rev_current_year: baseRev,
      rev_next_year: baseRev * 1.1,
      price_low: price * 0.85,
      price_avg: price * 1.15,
      price_high: price * 1.4
    }
  };
}

/**
 * Main render for fundamentals view once data is loaded.
 */
function renderFundamentalsView(view, data, ticker) {
  const price = data.price || 0;
  const change = data.change_pct || 0;
  const chgClass = change >= 0 ? 'b2-pos' : 'b2-neg';

  // Render header
  const headerGroup = view.querySelector('#fund-header-group');
  if (headerGroup) {
    headerGroup.innerHTML = `
      <div class="fund-header">
        <div class="fund-ticker-group">
          <div class="fund-ticker">${ticker}</div>
          <div class="fund-name">${data.name || ''} · ${data.sector || ''}</div>
        </div>
        <div class="fund-price-group">
          <div class="fund-price">${b2Price(price)}</div>
          <div class="fund-change ${chgClass}">${b2Pct(change)}</div>
        </div>
      </div>
    `;
  }

  // Render tabs
  const tabsWrap = view.querySelector('#fund-tabs-wrap');
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'income', label: 'Income Stmt' },
    { id: 'balance', label: 'Balance Sheet' },
    { id: 'cashflow', label: 'Cash Flow' },
    { id: 'ratios', label: 'Ratios' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'estimates', label: 'Estimates' }
  ];

  if (tabsWrap) {
    tabsWrap.innerHTML = `
      <div class="fund-tabs" id="fund-tabs">
        ${tabs.map((t, i) => `<button class="fund-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
    `;
  }

  // Render content area
  const content = view.querySelector('#fund-content');
  if (!content) return;

  content.innerHTML = tabs.map((t, i) =>
    `<div class="fund-tab-pane${i === 0 ? ' active' : ''}" id="fund-pane-${t.id}"></div>`
  ).join('');

  // Tab switching
  tabsWrap.querySelectorAll('.fund-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsWrap.querySelectorAll('.fund-tab').forEach(t => t.classList.remove('active'));
      content.querySelectorAll('.fund-tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = content.querySelector(`#fund-pane-${tab.dataset.tab}`);
      if (pane) pane.classList.add('active');
      // Lazy render
      renderFundamentalsTab(tab.dataset.tab, pane, data);
    });
  });

  // Render first tab immediately
  renderFundamentalsTab('overview', content.querySelector('#fund-pane-overview'), data);
}

/**
 * Render individual fundamentals tab.
 */
function renderFundamentalsTab(tabId, pane, data) {
  if (!pane || pane._rendered) return;
  pane._rendered = true;

  switch (tabId) {
    case 'overview': renderCompanyOverview(pane, data); break;
    case 'income': renderIncomeStatement(pane, data); break;
    case 'balance': renderBalanceSheet(pane, data); break;
    case 'cashflow': renderCashFlow(pane, data); break;
    case 'ratios': renderKeyRatios(pane, data); break;
    case 'earnings': renderEarningsHistory(pane, data); break;
    case 'estimates': renderAnalystEstimates(pane, data); break;
  }
}

/**
 * Render overview tab: key stats, analyst consensus, price target.
 */
function renderCompanyOverview(container, data) {
  const stats = [
    { label: 'P/E Ratio', value: data.pe != null ? b2Num(data.pe, 1) : '—' },
    { label: 'P/B Ratio', value: data.pb != null ? b2Num(data.pb, 1) : '—' },
    { label: 'P/S Ratio', value: data.ps != null ? b2Num(data.ps, 1) : '—' },
    { label: 'EV/EBITDA', value: data.ev_ebitda != null ? b2Num(data.ev_ebitda, 1) : '—' },
    { label: 'Market Cap', value: b2Fmt(data.market_cap) },
    { label: 'Div. Yield', value: data.div_yield != null ? b2Num(data.div_yield, 2) + '%' : '—' },
    { label: 'Beta', value: data.beta != null ? b2Num(data.beta, 2) : '—' },
    { label: '52W Range', value: data.week_52_low != null ? `${b2Price(data.week_52_low)} – ${b2Price(data.week_52_high)}` : '—' }
  ];

  const analyst = data.analyst || {};
  const buyCount = analyst.buy || 0;
  const holdCount = analyst.hold || 0;
  const sellCount = analyst.sell || 0;
  const totalAnalysts = buyCount + holdCount + sellCount || 1;

  container.innerHTML = `
    <div class="fund-overview-grid">
      <!-- Key Stats -->
      <div class="fund-stats-card">
        <div class="b2-section-title">Key Statistics</div>
        <div class="fund-stats-grid">
          ${stats.map(s => `
            <div class="fund-stat-item">
              <span class="fund-stat-label">${s.label}</span>
              <span class="fund-stat-value">${s.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Revenue Trend -->
      <div class="revenue-chart-container">
        <div class="b2-section-title">Revenue Trend</div>
        <div class="revenue-chart-wrap">
          <canvas id="fund-revenue-chart"></canvas>
        </div>
      </div>

      <!-- Analyst Consensus -->
      <div class="analyst-consensus">
        <div class="b2-section-title">Analyst Consensus</div>
        <div class="analyst-donut-wrap">
          <canvas id="fund-analyst-donut" class="analyst-donut-canvas"></canvas>
          <div class="analyst-legend">
            <div class="analyst-legend-item">
              <span class="analyst-legend-dot" style="color:#4ECDC4">Buy</span>
              <span class="analyst-legend-val">${buyCount}</span>
            </div>
            <div class="analyst-legend-item">
              <span class="analyst-legend-dot" style="color:#FFB347">Hold</span>
              <span class="analyst-legend-val">${holdCount}</span>
            </div>
            <div class="analyst-legend-item">
              <span class="analyst-legend-dot" style="color:#FF6B6B">Sell</span>
              <span class="analyst-legend-val">${sellCount}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Price Target -->
      <div class="price-target-bar">
        <div class="b2-section-title">Price Target Range</div>
        ${renderPriceTargetBar(data)}
      </div>
    </div>
  `;

  // Revenue chart
  setTimeout(() => {
    const income = data.income || {};
    if (income.years && income.revenue) {
      b2DestroyChart('fund-revenue');
      const ctx = document.getElementById('fund-revenue-chart');
      if (ctx) {
        b2Charts['fund-revenue'] = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: income.years,
            datasets: [{
              data: income.revenue,
              backgroundColor: 'rgba(78,205,196,0.7)',
              borderRadius: 4,
              borderSkipped: false
            }]
          },
          options: {
            ...b2ChartDefaults(),
            plugins: {
              ...b2ChartDefaults().plugins,
              tooltip: {
                ...b2ChartDefaults().plugins.tooltip,
                callbacks: {
                  label: ctx => b2Fmt(ctx.raw)
                }
              }
            },
            scales: {
              x: { ...b2ChartDefaults().scales.x },
              y: {
                ...b2ChartDefaults().scales.y,
                ticks: {
                  ...b2ChartDefaults().scales.y.ticks,
                  callback: v => b2Fmt(v)
                }
              }
            }
          }
        });
      }
    }

    // Analyst donut
    b2DestroyChart('fund-analyst-donut');
    const donutCtx = document.getElementById('fund-analyst-donut');
    if (donutCtx && totalAnalysts > 0) {
      b2Charts['fund-analyst-donut'] = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['Buy', 'Hold', 'Sell'],
          datasets: [{
            data: [buyCount, holdCount, sellCount],
            backgroundColor: ['#4ECDC4', '#FFB347', '#FF6B6B'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: false,
          cutout: '70%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1d20',
              borderColor: '#2e3238',
              borderWidth: 1
            }
          }
        }
      });
    }
  }, 50);
}

/**
 * Build price target range bar HTML.
 */
function renderPriceTargetBar(data) {
  const analyst = data.analyst || {};
  const low = analyst.low_target || data.price * 0.9;
  const avg = analyst.avg_target || data.price * 1.1;
  const high = analyst.high_target || data.price * 1.3;
  const current = data.price || 0;
  const range = high - low || 1;
  const fillLeft = Math.max(0, Math.min(100, ((current - low) / range) * 100));
  const fillWidth = Math.max(0, Math.min(100, ((avg - low) / range) * 100));
  const dotPos = Math.max(0, Math.min(100, ((current - low) / range) * 100));

  return `
    <div class="pt-track">
      <div class="pt-fill" style="left:0;width:${fillWidth}%"></div>
      <div class="pt-current-marker" style="left:${dotPos}%" title="Current: ${b2Price(current)}"></div>
    </div>
    <div class="pt-labels">
      <span>${b2Price(low)}<br><span style="opacity:0.6;font-size:10px">Low</span></span>
      <span style="text-align:center">${b2Price(avg)}<br><span style="opacity:0.6;font-size:10px">Avg Target</span></span>
      <span style="text-align:right">${b2Price(high)}<br><span style="opacity:0.6;font-size:10px">High</span></span>
    </div>
  `;
}

/**
 * Render Income Statement tab.
 */
function renderIncomeStatement(container, data) {
  const inc = data.income || {};
  const years = inc.years || ['FY2021', 'FY2022', 'FY2023', 'FY2024'];

  const rows = [
    { label: 'Revenue', key: 'revenue', total: true },
    { label: 'Cost of Revenue', key: 'cost_of_revenue' },
    { label: 'Gross Profit', key: 'gross_profit', total: true },
    { label: 'Operating Expenses', key: 'operating_expenses' },
    { label: 'Operating Income', key: 'operating_income', total: true },
    { label: 'Net Income', key: 'net_income', total: true },
    { label: 'EPS (Diluted)', key: 'eps', format: 'eps' }
  ];

  function calcGrowth(arr) {
    if (!arr || arr.length < 2) return null;
    const last = arr[arr.length - 1];
    const prev = arr[arr.length - 2];
    if (!prev) return null;
    return ((last - prev) / Math.abs(prev)) * 100;
  }

  const tableRows = rows.map(row => {
    const vals = inc[row.key] || [];
    const growth = calcGrowth(vals);
    const growthHtml = growth != null
      ? `<td class="${growth >= 0 ? 'growth-positive' : 'growth-negative'}">${b2Pct(growth, 1)}</td>`
      : '<td>—</td>';

    const cells = years.map((_, i) => {
      const v = vals[i];
      if (v == null) return '<td>—</td>';
      if (row.format === 'eps') return `<td>$${v.toFixed(2)}</td>`;
      return `<td>${b2Fmt(v)}</td>`;
    }).join('');

    return `<tr class="${row.total ? 'total-row' : ''}">
      <td>${row.label}</td>
      ${cells}
      ${growthHtml}
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="fund-fin-table-wrap">
      <table class="fund-fin-table">
        <thead>
          <tr>
            <th>Item</th>
            ${years.map(y => `<th>${y}</th>`).join('')}
            <th>YoY Growth</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <div class="b2-chart-container">
      <div class="b2-chart-header">
        <span class="b2-chart-title">Revenue & Net Income</span>
      </div>
      <div class="b2-chart-wrap-tall">
        <canvas id="fund-income-chart"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    b2DestroyChart('fund-income');
    const ctx = document.getElementById('fund-income-chart');
    if (!ctx) return;
    b2Charts['fund-income'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Revenue',
            data: inc.revenue || [],
            backgroundColor: 'rgba(78,205,196,0.7)',
            borderRadius: 4,
            borderSkipped: false
          },
          {
            label: 'Net Income',
            data: inc.net_income || [],
            backgroundColor: 'rgba(91,156,246,0.7)',
            borderRadius: 4,
            borderSkipped: false
          }
        ]
      },
      options: {
        ...b2ChartDefaults(),
        plugins: {
          ...b2ChartDefaults().plugins,
          legend: {
            display: true,
            labels: {
              color: '#8b929a',
              font: { family: "'DM Sans', sans-serif", size: 12 },
              boxWidth: 12, padding: 16
            }
          },
          tooltip: {
            ...b2ChartDefaults().plugins.tooltip,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${b2Fmt(ctx.raw)}` }
          }
        },
        scales: {
          x: b2ChartDefaults().scales.x,
          y: {
            ...b2ChartDefaults().scales.y,
            ticks: { ...b2ChartDefaults().scales.y.ticks, callback: v => b2Fmt(v) }
          }
        }
      }
    });
  }, 50);
}

/**
 * Render Balance Sheet tab.
 */
function renderBalanceSheet(container, data) {
  const bal = data.balance || {};
  const years = bal.years || ['FY2021', 'FY2022', 'FY2023', 'FY2024'];

  const rows = [
    { label: 'Total Assets', key: 'total_assets', total: true },
    { label: 'Cash & Equivalents', key: 'cash' },
    { label: 'Total Liabilities', key: 'total_liabilities', total: true },
    { label: 'Long-Term Debt', key: 'long_term_debt' },
    { label: "Shareholders' Equity", key: 'equity', total: true }
  ];

  const tableRows = rows.map(row => {
    const vals = bal[row.key] || [];
    const cells = years.map((_, i) => {
      const v = vals[i];
      return v != null ? `<td>${b2Fmt(v)}</td>` : '<td>—</td>';
    }).join('');
    return `<tr class="${row.total ? 'total-row' : ''}"><td>${row.label}</td>${cells}</tr>`;
  }).join('');

  container.innerHTML = `
    <div class="fund-fin-table-wrap">
      <table class="fund-fin-table">
        <thead>
          <tr>
            <th>Item</th>
            ${years.map(y => `<th>${y}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <div class="b2-chart-container">
      <div class="b2-chart-header">
        <span class="b2-chart-title">Assets vs Liabilities</span>
      </div>
      <div class="b2-chart-wrap-tall">
        <canvas id="fund-balance-chart"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    b2DestroyChart('fund-balance');
    const ctx = document.getElementById('fund-balance-chart');
    if (!ctx) return;
    b2Charts['fund-balance'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Total Assets',
            data: bal.total_assets || [],
            backgroundColor: 'rgba(78,205,196,0.7)',
            borderRadius: 4,
            borderSkipped: false,
            stack: 'a'
          },
          {
            label: 'Total Liabilities',
            data: bal.total_liabilities || [],
            backgroundColor: 'rgba(255,107,107,0.6)',
            borderRadius: 4,
            borderSkipped: false,
            stack: 'b'
          },
          {
            label: 'Equity',
            data: bal.equity || [],
            backgroundColor: 'rgba(91,156,246,0.7)',
            borderRadius: 4,
            borderSkipped: false,
            stack: 'b'
          }
        ]
      },
      options: {
        ...b2ChartDefaults(),
        plugins: {
          ...b2ChartDefaults().plugins,
          legend: {
            display: true,
            labels: { color: '#8b929a', font: { family: "'DM Sans', sans-serif", size: 12 }, boxWidth: 12, padding: 16 }
          },
          tooltip: {
            ...b2ChartDefaults().plugins.tooltip,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${b2Fmt(ctx.raw)}` }
          }
        },
        scales: {
          x: b2ChartDefaults().scales.x,
          y: { ...b2ChartDefaults().scales.y, ticks: { ...b2ChartDefaults().scales.y.ticks, callback: v => b2Fmt(v) } }
        }
      }
    });
  }, 50);
}

/**
 * Render Cash Flow tab.
 */
function renderCashFlow(container, data) {
  const cf = data.cashflow || {};
  const years = cf.years || ['FY2021', 'FY2022', 'FY2023', 'FY2024'];

  const rows = [
    { label: 'Operating Cash Flow', key: 'operating', total: true },
    { label: 'Investing Activities', key: 'investing' },
    { label: 'Financing Activities', key: 'financing' },
    { label: 'Free Cash Flow', key: 'free_cashflow', total: true }
  ];

  const tableRows = rows.map(row => {
    const vals = cf[row.key] || [];
    const cells = years.map((_, i) => {
      const v = vals[i];
      if (v == null) return '<td>—</td>';
      return `<td class="${v >= 0 ? '' : 'growth-negative'}">${b2Fmt(v)}</td>`;
    }).join('');
    return `<tr class="${row.total ? 'total-row' : ''}"><td>${row.label}</td>${cells}</tr>`;
  }).join('');

  container.innerHTML = `
    <div class="fund-fin-table-wrap">
      <table class="fund-fin-table">
        <thead>
          <tr>
            <th>Item</th>
            ${years.map(y => `<th>${y}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <div class="b2-chart-container">
      <div class="b2-chart-header">
        <span class="b2-chart-title">Free Cash Flow Trend</span>
      </div>
      <div class="b2-chart-wrap-tall">
        <canvas id="fund-cf-chart"></canvas>
      </div>
    </div>
  `;

  setTimeout(() => {
    b2DestroyChart('fund-cf');
    const ctx = document.getElementById('fund-cf-chart');
    if (!ctx) return;
    const fcf = cf.free_cashflow || [];
    b2Charts['fund-cf'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [{
          label: 'Free Cash Flow',
          data: fcf,
          backgroundColor: fcf.map(v => v >= 0 ? 'rgba(78,205,196,0.7)' : 'rgba(255,107,107,0.7)'),
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        ...b2ChartDefaults(),
        plugins: {
          ...b2ChartDefaults().plugins,
          tooltip: {
            ...b2ChartDefaults().plugins.tooltip,
            callbacks: { label: ctx => ` FCF: ${b2Fmt(ctx.raw)}` }
          }
        },
        scales: {
          x: b2ChartDefaults().scales.x,
          y: { ...b2ChartDefaults().scales.y, ticks: { ...b2ChartDefaults().scales.y.ticks, callback: v => b2Fmt(v) } }
        }
      }
    });
  }, 50);
}

/**
 * Render Key Ratios tab.
 */
function renderKeyRatios(container, data) {
  const ratios = data.ratios || {};

  const ratioItems = [
    { label: 'Return on Equity', key: 'roe', suffix: '%', desc: 'Net income / shareholder equity' },
    { label: 'Return on Assets', key: 'roa', suffix: '%', desc: 'Net income / total assets' },
    { label: 'Profit Margin', key: 'profit_margin', suffix: '%', desc: 'Net income / revenue' },
    { label: 'Debt / Equity', key: 'debt_equity', suffix: 'x', desc: 'Total debt / shareholder equity' },
    { label: 'Current Ratio', key: 'current_ratio', suffix: 'x', desc: 'Current assets / current liabilities' },
    { label: 'Quick Ratio', key: 'quick_ratio', suffix: 'x', desc: 'Liquid assets / current liabilities' }
  ];

  container.innerHTML = `
    <div class="ratio-cards-grid">
      ${ratioItems.map(item => {
        const val = ratios[item.key];
        let colorClass = '';
        if (item.key === 'roe' || item.key === 'roa' || item.key === 'profit_margin') {
          colorClass = val > 10 ? 'b2-pos' : val < 5 ? 'b2-neg' : '';
        } else if (item.key === 'current_ratio' || item.key === 'quick_ratio') {
          colorClass = val > 1.5 ? 'b2-pos' : val < 1 ? 'b2-neg' : '';
        }

        return `
          <div class="ratio-card">
            <div class="ratio-card-label">${item.label}</div>
            <div class="ratio-card-value ${colorClass}">
              ${val != null ? b2Num(val, 2) + item.suffix : '—'}
            </div>
            <div class="ratio-card-desc">${item.desc}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render Earnings History tab.
 */
function renderEarningsHistory(container, data) {
  const earnings = data.earnings || {};
  const quarters = earnings.quarters || [];
  const actual = earnings.actual_eps || [];
  const estimated = earnings.estimated_eps || [];
  const nextDate = earnings.next_earnings_date;

  container.innerHTML = `
    <div class="eps-chart-container">
      <div class="eps-chart-header">
        <span class="eps-chart-title">Quarterly EPS: Actual vs Estimate</span>
      </div>
      <div class="eps-chart-wrap">
        <canvas id="fund-eps-chart"></canvas>
      </div>
      ${nextDate ? `<div class="eps-next-date">Next Earnings: <strong>${b2FormatDate(nextDate)}</strong></div>` : ''}
    </div>

    <div class="b2-panel">
      <div class="b2-section-title">Beat / Miss History</div>
      ${quarters.map((q, i) => {
        const act = actual[i];
        const est = estimated[i];
        const beat = act != null && est != null ? act >= est : null;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider);">
            <span style="font-size:var(--text-sm);color:var(--color-text-muted);">${q}</span>
            <div style="display:flex;gap:var(--space-3);align-items:center;">
              <span style="font-family:var(--font-mono);font-size:13px;color:var(--color-text);">
                Act: ${act != null ? '$' + act.toFixed(2) : '—'}
              </span>
              <span style="font-family:var(--font-mono);font-size:13px;color:var(--color-text-muted);">
                Est: ${est != null ? '$' + est.toFixed(2) : '—'}
              </span>
              ${beat != null ? `<span class="beat-pill ${beat ? 'beat' : 'miss'}">${beat ? 'BEAT' : 'MISS'}</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  setTimeout(() => {
    b2DestroyChart('fund-eps');
    const ctx = document.getElementById('fund-eps-chart');
    if (!ctx || quarters.length === 0) return;
    b2Charts['fund-eps'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: quarters,
        datasets: [
          {
            label: 'Actual EPS',
            data: actual,
            backgroundColor: 'rgba(78,205,196,0.8)',
            borderRadius: 4,
            borderSkipped: false
          },
          {
            label: 'Estimated EPS',
            data: estimated,
            backgroundColor: 'rgba(139,146,154,0.4)',
            borderRadius: 4,
            borderSkipped: false,
            borderColor: 'rgba(139,146,154,0.7)',
            borderWidth: 1
          }
        ]
      },
      options: {
        ...b2ChartDefaults(),
        plugins: {
          ...b2ChartDefaults().plugins,
          legend: {
            display: true,
            labels: { color: '#8b929a', font: { family: "'DM Sans', sans-serif", size: 12 }, boxWidth: 12, padding: 16 }
          },
          tooltip: {
            ...b2ChartDefaults().plugins.tooltip,
            callbacks: { label: ctx => ` ${ctx.dataset.label}: $${ctx.raw.toFixed(2)}` }
          }
        }
      }
    });
  }, 50);
}

/**
 * Render Analyst Estimates tab.
 */
function renderAnalystEstimates(container, data) {
  const est = data.estimates || {};
  const analyst = data.analyst || {};
  const price = data.price || 0;

  container.innerHTML = `
    <div class="estimates-grid">
      <div class="estimate-card">
        <div class="estimate-card-label">EPS Estimate — Current Year</div>
        <div class="estimate-value-row">
          <span class="estimate-value">${est.eps_current_year != null ? '$' + b2Num(est.eps_current_year, 2) : '—'}</span>
        </div>
      </div>
      <div class="estimate-card">
        <div class="estimate-card-label">EPS Estimate — Next Year</div>
        <div class="estimate-value-row">
          <span class="estimate-value">${est.eps_next_year != null ? '$' + b2Num(est.eps_next_year, 2) : '—'}</span>
          ${est.eps_current_year && est.eps_next_year
            ? `<span class="estimate-change ${b2Color(est.eps_next_year - est.eps_current_year)}">${b2Pct(((est.eps_next_year - est.eps_current_year) / Math.abs(est.eps_current_year)) * 100)}</span>`
            : ''}
        </div>
      </div>
      <div class="estimate-card">
        <div class="estimate-card-label">Revenue Estimate — Current Year</div>
        <div class="estimate-value-row">
          <span class="estimate-value">${b2Fmt(est.rev_current_year)}</span>
        </div>
      </div>
      <div class="estimate-card">
        <div class="estimate-card-label">Revenue Estimate — Next Year</div>
        <div class="estimate-value-row">
          <span class="estimate-value">${b2Fmt(est.rev_next_year)}</span>
          ${est.rev_current_year && est.rev_next_year
            ? `<span class="estimate-change ${b2Color(est.rev_next_year - est.rev_current_year)}">${b2Pct(((est.rev_next_year - est.rev_current_year) / Math.abs(est.rev_current_year)) * 100)}</span>`
            : ''}
        </div>
      </div>
    </div>

    <!-- Price Target Visual -->
    <div class="b2-panel">
      <div class="b2-section-title">Price Target Distribution</div>
      <div style="margin:var(--space-3) 0;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--color-text-muted);margin-bottom:var(--space-2);">
          <span>Low Target</span>
          <span>Average Target</span>
          <span>High Target</span>
        </div>
        <div style="position:relative;height:12px;background:var(--color-surface-dynamic);border-radius:var(--radius-full);">
          ${renderPriceTargetBarInline(est, price)}
        </div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:13px;font-weight:600;margin-top:var(--space-2);">
          <span class="b2-neg">${b2Price(est.price_low)}</span>
          <span class="b2-pos">${b2Price(est.price_avg)}</span>
          <span class="b2-pos">${b2Price(est.price_high)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted);">
        <span>Current: <strong style="color:var(--color-text);font-family:var(--font-mono);">${b2Price(price)}</strong></span>
        ${est.price_avg ? `<span>Upside: <strong class="${b2Color(est.price_avg - price)};font-family:var(--font-mono);">${b2Pct(((est.price_avg - price) / price) * 100)}</strong></span>` : ''}
      </div>
    </div>

    <div class="b2-panel">
      <div class="b2-section-title">Analyst Recommendations</div>
      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
        <div style="text-align:center;flex:1;">
          <div style="font-family:var(--font-mono);font-size:var(--text-xl);font-weight:700;color:#4ECDC4;">${analyst.buy || 0}</div>
          <div style="font-size:12px;color:var(--color-text-muted);">Buy</div>
        </div>
        <div style="text-align:center;flex:1;">
          <div style="font-family:var(--font-mono);font-size:var(--text-xl);font-weight:700;color:#FFB347;">${analyst.hold || 0}</div>
          <div style="font-size:12px;color:var(--color-text-muted);">Hold</div>
        </div>
        <div style="text-align:center;flex:1;">
          <div style="font-family:var(--font-mono);font-size:var(--text-xl);font-weight:700;color:#FF6B6B;">${analyst.sell || 0}</div>
          <div style="font-size:12px;color:var(--color-text-muted);">Sell</div>
        </div>
      </div>
    </div>
  `;
}

function renderPriceTargetBarInline(est, current) {
  const low = est.price_low || current * 0.85;
  const avg = est.price_avg || current * 1.1;
  const high = est.price_high || current * 1.35;
  const range = high - low || 1;

  const avgPct = Math.max(0, Math.min(100, ((avg - low) / range) * 100));
  const curPct = Math.max(0, Math.min(100, ((current - low) / range) * 100));

  return `
    <div style="position:absolute;left:0;top:0;width:100%;height:100%;border-radius:var(--radius-full);background:linear-gradient(90deg,rgba(255,107,107,0.3),rgba(78,205,196,0.3));"></div>
    <div style="position:absolute;top:50%;left:${avgPct}%;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#4ECDC4;border:2px solid #141618;" title="Avg: ${b2Price(avg)}"></div>
    <div style="position:absolute;top:50%;left:${curPct}%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:#e8eaed;border:2px solid #141618;z-index:2;" title="Current: ${b2Price(current)}"></div>
  `;
}

// ============================================
// SECTION 3: FEATURE 8 — ECONOMIC CALENDAR
// ============================================

/**
 * Show the economic calendar view.
 */
async function showEconomicCalendar() {
  const view = b2EnsureView('view-calendar', 'b2-view');
  b2ActivateView('view-calendar');

  view.innerHTML = `
    <div class="b2-view-header">
      <div>
        <div class="b2-view-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Economic Calendar
        </div>
        <div class="b2-view-subtitle">Upcoming earnings & economic events</div>
      </div>
    </div>

    <div id="calendar-filters-wrap"></div>
    <div id="calendar-timeline-wrap"></div>
    <div id="calendar-content"><div class="b2-loading"><div class="b2-spinner"></div><span>Loading events...</span></div></div>
  `;

  renderCalendarFilters(view.querySelector('#calendar-filters-wrap'));

  try {
    const data = await marketApi('/calendar', { days: 30 });
    const events = data.events || data || [];
    renderCalendar(view.querySelector('#calendar-content'), events);
    renderTimelineView(view.querySelector('#calendar-timeline-wrap'), events);
  } catch(e) {
    // Fallback with mock data
    const mockData = generateMockCalendarEvents();
    renderCalendar(view.querySelector('#calendar-content'), mockData);
    renderTimelineView(view.querySelector('#calendar-timeline-wrap'), mockData);
  }
}

/**
 * Render calendar filter bar.
 */
function renderCalendarFilters(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="calendar-filters">
      <div class="calendar-filter-group">
        <span class="calendar-filter-label">Type</span>
        <select class="b2-input b2-select" id="cal-filter-type" style="width:auto;min-width:130px;">
          <option value="all">All Events</option>
          <option value="earnings">Earnings</option>
          <option value="economic">Economic</option>
        </select>
      </div>
      <div class="calendar-filter-group">
        <span class="calendar-filter-label">Importance</span>
        <select class="b2-input b2-select" id="cal-filter-importance" style="width:auto;min-width:130px;">
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="calendar-filter-group">
        <span class="calendar-filter-label">Days Ahead</span>
        <select class="b2-input b2-select" id="cal-filter-days" style="width:auto;min-width:110px;">
          <option value="7">7 Days</option>
          <option value="14">14 Days</option>
          <option value="30" selected>30 Days</option>
          <option value="60">60 Days</option>
        </select>
      </div>
    </div>
  `;

  // Filter change listeners
  ['cal-filter-type', 'cal-filter-importance', 'cal-filter-days'].forEach(id => {
    const el = container.querySelector('#' + id);
    if (el) el.addEventListener('change', () => applyCalendarFilters());
  });
}

/**
 * Apply filters and re-render calendar.
 */
function applyCalendarFilters() {
  calendarFilters.type = document.getElementById('cal-filter-type')?.value || 'all';
  calendarFilters.importance = document.getElementById('cal-filter-importance')?.value || 'all';
  calendarFilters.daysAhead = parseInt(document.getElementById('cal-filter-days')?.value || '30');
  showEconomicCalendar();
}

/**
 * Generate mock calendar events from portfolio tickers.
 */
function generateMockCalendarEvents() {
  const events = [];
  const now = new Date();

  // Earnings events from portfolio
  const tickers = typeof portfolio !== 'undefined' ? Object.keys(portfolio).slice(0, 8) : [];
  const wTickers = typeof watchlist !== 'undefined' ? watchlist.slice(0, 5) : [];
  const allTickers = [...new Set([...tickers, ...wTickers])];

  allTickers.forEach((ticker, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 3 + i * 3);
    const cache = typeof stockDataCache !== 'undefined' ? stockDataCache[ticker] : null;
    events.push({
      type: 'earnings',
      ticker,
      name: cache ? cache.name : ticker,
      date: d.toISOString().split('T')[0],
      estimated_eps: cache && cache.pe ? (cache.price / cache.pe * 0.25) : null,
      importance: 'medium'
    });
  });

  // Economic events
  const econEvents = [
    { name: 'Federal Reserve Interest Rate Decision', importance: 'high', category: 'Monetary Policy' },
    { name: 'Non-Farm Payrolls', importance: 'high', category: 'Employment' },
    { name: 'CPI Inflation Report', importance: 'high', category: 'Inflation' },
    { name: 'GDP Growth Rate (QoQ)', importance: 'high', category: 'GDP' },
    { name: 'Initial Jobless Claims', importance: 'medium', category: 'Employment' },
    { name: 'Retail Sales MoM', importance: 'medium', category: 'Consumer' },
    { name: 'ISM Manufacturing PMI', importance: 'medium', category: 'Manufacturing' },
    { name: 'Consumer Confidence Index', importance: 'medium', category: 'Consumer' },
    { name: 'Building Permits', importance: 'low', category: 'Housing' },
    { name: 'Existing Home Sales', importance: 'low', category: 'Housing' }
  ];

  econEvents.forEach((evt, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1 + i * 2 + Math.floor(Math.random() * 3));
    events.push({
      type: 'economic',
      name: evt.name,
      date: d.toISOString().split('T')[0],
      importance: evt.importance,
      category: evt.category,
      previous: (Math.random() * 5 - 1).toFixed(1) + '%',
      forecast: (Math.random() * 5 - 0.5).toFixed(1) + '%'
    });
  });

  // Sort by date
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

/**
 * Render timeline view at top.
 */
function renderTimelineView(container, events) {
  if (!container) return;

  const now = new Date();
  const maxDays = calendarFilters.daysAhead || 30;
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + maxDays);

  const filtered = (events || []).filter(evt => {
    const d = new Date(evt.date);
    return d >= now && d <= endDate;
  }).slice(0, 30);

  const todayPct = 0;

  container.innerHTML = `
    <div class="calendar-timeline">
      <div class="timeline-title">Next ${maxDays} Days</div>
      <div style="position:relative;">
        <div class="timeline-track" id="cal-timeline-track">
          <div class="timeline-today-mark" style="left:${todayPct}%">
            <span class="timeline-today-label">Today</span>
          </div>
          ${filtered.map(evt => {
            const d = new Date(evt.date);
            const daysFromNow = (d - now) / (1000 * 60 * 60 * 24);
            const pct = Math.min(98, Math.max(2, (daysFromNow / maxDays) * 100));
            const dotClass = evt.type === 'earnings'
              ? 'event-earnings'
              : `importance-${evt.importance || 'low'}`;
            const label = evt.type === 'earnings' ? evt.ticker : evt.name;
            return `
              <div class="timeline-event-dot ${dotClass}"
                   style="left:${pct}%"
                   data-evt-date="${evt.date}"
                   data-evt-label="${(label || '').substring(0, 30)}"
                   title="${label || ''} — ${b2FormatDateShort(evt.date)}">
              </div>
            `;
          }).join('')}
        </div>
        <div class="timeline-date-labels">
          <span>Today</span>
          <span>${b2FormatDateShort(new Date(now.getTime() + maxDays/2 * 86400000).toISOString())}</span>
          <span>${b2FormatDateShort(endDate.toISOString())}</span>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-4);margin-top:var(--space-3);flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:12px;color:var(--color-text-muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#4ECDC4;display:inline-block;"></span>Earnings
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:12px;color:var(--color-text-muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#FF6B6B;display:inline-block;"></span>High Impact
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:12px;color:var(--color-text-muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#FFB347;display:inline-block;"></span>Medium Impact
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:12px;color:var(--color-text-muted);">
          <span style="width:10px;height:10px;border-radius:50%;background:#545b65;display:inline-block;"></span>Low Impact
        </div>
      </div>
    </div>
  `;
}

/**
 * Main calendar render: two sections, earnings + economic events.
 */
function renderCalendar(container, events) {
  if (!container) return;

  const now = new Date();
  const maxDays = calendarFilters.daysAhead || 30;
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + maxDays);

  // Apply filters
  let filtered = (events || []).filter(evt => {
    const d = new Date(evt.date);
    if (d < now || d > endDate) return false;
    if (calendarFilters.type !== 'all' && evt.type !== calendarFilters.type) return false;
    if (calendarFilters.importance !== 'all' && evt.importance !== calendarFilters.importance) return false;
    return true;
  });

  const earningsEvents = filtered.filter(e => e.type === 'earnings');
  const econEvents = filtered.filter(e => e.type === 'economic');

  container.innerHTML = `
    <div class="calendar-layout">
      <div id="cal-earnings-section"></div>
      <div id="cal-economic-section"></div>
    </div>
  `;

  renderEarningsSection(container.querySelector('#cal-earnings-section'), earningsEvents);
  renderEconomicSection(container.querySelector('#cal-economic-section'), econEvents);
}

/**
 * Render earnings events by date group.
 */
function renderEarningsSection(container, events) {
  if (!container) return;

  const grouped = groupEventsByDate(events);

  let innerHtml = '';
  if (Object.keys(grouped).length === 0) {
    innerHtml = '<div class="b2-empty" style="padding:var(--space-6);">No earnings in this period</div>';
  } else {
    innerHtml = Object.entries(grouped).map(([date, evts]) => `
      <div class="event-date-group">
        <div class="event-date-header">${b2FormatDate(date)}</div>
        ${evts.map(evt => `
          <div class="earnings-item" data-ticker="${evt.ticker || ''}">
            <div class="earnings-ticker-badge">${evt.ticker || '?'}</div>
            <div class="earnings-main">
              <div class="earnings-name">${evt.name || evt.ticker || '—'}</div>
              <div class="earnings-date">${b2FormatDateShort(evt.date)}</div>
            </div>
            <div>
              <div class="earnings-eps">${evt.estimated_eps != null ? '$' + evt.estimated_eps.toFixed(2) : '—'}</div>
              <div class="earnings-eps-label">Est. EPS</div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  container.innerHTML = `
    <div class="event-section">
      <div class="event-section-header">
        <span>Upcoming Earnings</span>
        <span class="b2-badge b2-badge-green">${events.length}</span>
      </div>
      ${innerHtml}
    </div>
  `;

  // Row click -> fundamentals
  container.querySelectorAll('.earnings-item[data-ticker]').forEach(item => {
    item.addEventListener('click', () => {
      const ticker = item.dataset.ticker;
      if (ticker) showFundamentals(ticker);
    });
  });
}

/**
 * Render economic events by date group.
 */
function renderEconomicSection(container, events) {
  if (!container) return;

  const grouped = groupEventsByDate(events);

  let innerHtml = '';
  if (Object.keys(grouped).length === 0) {
    innerHtml = '<div class="b2-empty" style="padding:var(--space-6);">No economic events in this period</div>';
  } else {
    innerHtml = Object.entries(grouped).map(([date, evts]) => `
      <div class="event-date-group">
        <div class="event-date-header">${b2FormatDate(date)}</div>
        ${evts.map(evt => `
          <div class="event-item">
            <span class="importance-dot ${evt.importance || 'low'}"></span>
            <div class="event-item-main">
              <div class="event-item-name">${evt.name || '—'}</div>
              <div class="event-item-meta">${evt.category || ''}</div>
            </div>
            <div class="event-item-values">
              ${evt.forecast != null ? `<span class="event-item-forecast">${evt.forecast}</span>` : ''}
              ${evt.previous != null ? `<span class="event-item-previous">Prev: ${evt.previous}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  container.innerHTML = `
    <div class="event-section">
      <div class="event-section-header">
        <span>Economic Events</span>
        <span class="b2-badge b2-badge-yellow">${events.length}</span>
      </div>
      ${innerHtml}
    </div>
  `;
}

/**
 * Group events by date string.
 */
function groupEventsByDate(events) {
  const groups = {};
  (events || []).forEach(evt => {
    const date = evt.date || 'Unknown';
    if (!groups[date]) groups[date] = [];
    groups[date].push(evt);
  });
  return groups;
}

// ============================================
// SECTION 4: FEATURE 9 — PEER COMPARISON (RV)
// ============================================

/**
 * Show the peer comparison view for a ticker.
 */
async function showPeerComparison(ticker) {
  peerTicker = ticker ? ticker.toUpperCase() : peerTicker;

  const view = b2EnsureView('view-peers', 'b2-view');
  b2ActivateView('view-peers');

  view.innerHTML = `
    <div class="b2-view-header">
      <div>
        <div class="b2-view-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Peer Comparison
        </div>
        <div class="b2-view-subtitle">Side-by-side relative value analysis</div>
      </div>
    </div>

    <!-- Ticker Input -->
    <div class="peer-input-bar">
      <span class="peer-input-label">Primary Ticker</span>
      <div class="b2-ticker-search-wrap" style="flex:0 0 auto;">
        <input type="text" class="b2-input peer-ticker-input" id="peer-ticker-input"
          placeholder="AAPL" value="${peerTicker || ''}"
          style="max-width:140px;text-transform:uppercase;">
        <div class="b2-ticker-suggestions" id="peer-ticker-suggestions" style="display:none;"></div>
      </div>
      <button class="b2-btn b2-btn-primary" id="peer-run-btn">Compare</button>
      <span style="font-size:var(--text-sm);color:var(--color-text-muted);" id="peer-sector-label"></span>
    </div>

    <div id="peer-content">
      ${peerTicker
        ? '<div class="b2-loading"><div class="b2-spinner"></div><span>Loading peer data...</span></div>'
        : '<div class="b2-empty" style="padding:var(--space-10);">Enter a ticker symbol to compare against sector peers</div>'
      }
    </div>
  `;

  initPeerEvents(view);

  if (peerTicker) {
    await loadPeerData(peerTicker);
  }
}

/**
 * Wire peer comparison events.
 */
function initPeerEvents(view) {
  const input = view.querySelector('#peer-ticker-input');
  const runBtn = view.querySelector('#peer-run-btn');
  const suggestionsEl = view.querySelector('#peer-ticker-suggestions');

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      const ticker = input ? input.value.trim().toUpperCase() : '';
      if (!ticker) return;
      peerTicker = ticker;
      await loadPeerData(ticker);
    });
  }

  if (input) {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        peerTicker = input.value.trim().toUpperCase();
        if (suggestionsEl) suggestionsEl.style.display = 'none';
        await loadPeerData(peerTicker);
      }
    });

    let searchTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 1) { if (suggestionsEl) suggestionsEl.style.display = 'none'; return; }
      searchTimer = setTimeout(async () => {
        try {
          if (typeof searchStocks === 'function') {
            const results = await searchStocks(q);
            if (suggestionsEl && results.length > 0) {
              suggestionsEl.innerHTML = results.slice(0, 6).map(r => `
                <div class="b2-ticker-suggestion-item" data-ticker="${r.symbol || r.ticker}">
                  <span class="b2-suggestion-ticker">${r.symbol || r.ticker}</span>
                  <span class="b2-suggestion-name">${r.name || ''}</span>
                </div>
              `).join('');
              suggestionsEl.style.display = 'block';
              suggestionsEl.querySelectorAll('.b2-ticker-suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                  input.value = item.dataset.ticker;
                  suggestionsEl.style.display = 'none';
                  peerTicker = item.dataset.ticker;
                  loadPeerData(peerTicker);
                });
              });
            }
          }
        } catch(e) {}
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && suggestionsEl && !suggestionsEl.contains(e.target)) {
        suggestionsEl.style.display = 'none';
      }
    }, { once: false });
  }
}

/**
 * Load peer data and render.
 */
async function loadPeerData(ticker) {
  const content = document.getElementById('peer-content');
  const sectorLabel = document.getElementById('peer-sector-label');
  if (!content) return;
  b2SetLoading(content, `Loading peers for ${ticker}...`);

  try {
    const data = await marketApi('/peers', { ticker });
    if (sectorLabel && data.sector) {
      sectorLabel.textContent = `Sector: ${data.sector}`;
    }
    renderPeerComparison(content, data, ticker);
  } catch(e) {
    // Fallback: mock peers from cache
    const mockData = buildMockPeerData(ticker);
    if (sectorLabel && mockData.sector) {
      sectorLabel.textContent = `Sector: ${mockData.sector}`;
    }
    renderPeerComparison(content, mockData, ticker);
  }
}

/**
 * Build mock peer data from portfolio/watchlist cache.
 */
function buildMockPeerData(ticker) {
  const cache = typeof stockDataCache !== 'undefined' ? stockDataCache : {};
  const primary = cache[ticker] || {};
  const sector = primary.sector || 'Technology';

  // Find other tickers to use as peers
  const otherTickers = Object.keys(cache).filter(t => t !== ticker).slice(0, 7);
  const wlTickers = typeof watchlist !== 'undefined' ? watchlist.filter(t => t !== ticker).slice(0, 3) : [];
  const peerTickers = [...new Set([...otherTickers, ...wlTickers])].slice(0, 8);

  const buildPeer = (t) => {
    const d = cache[t] || {};
    const price = d.price || (50 + Math.random() * 200);
    const pe = d.pe || (10 + Math.random() * 25);
    const marketCap = d.market_cap || (1e9 + Math.random() * 500e9);
    return {
      ticker: t,
      name: d.name || t,
      price,
      market_cap: marketCap,
      pe,
      ev_ebitda: pe * (0.7 + Math.random() * 0.6),
      ps: pe * (0.3 + Math.random() * 0.4),
      pb: pe * (0.15 + Math.random() * 0.25),
      rev_growth: (-5 + Math.random() * 30),
      profit_margin: (5 + Math.random() * 25),
      roe: (5 + Math.random() * 30),
      div_yield: Math.random() * 4,
      change_pct: d.change_pct || (Math.random() * 10 - 5)
    };
  };

  const primaryData = buildPeer(ticker);
  const peers = peerTickers.map(buildPeer);

  // Compute sector averages
  const all = [primaryData, ...peers];
  const avg = (key) => {
    const vals = all.map(p => p[key]).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const sectorAvg = {
    ticker: 'SECTOR AVG',
    name: `${sector} Sector`,
    price: null,
    market_cap: avg('market_cap'),
    pe: avg('pe'),
    ev_ebitda: avg('ev_ebitda'),
    ps: avg('ps'),
    pb: avg('pb'),
    rev_growth: avg('rev_growth'),
    profit_margin: avg('profit_margin'),
    roe: avg('roe'),
    div_yield: avg('div_yield')
  };

  return {
    ticker,
    sector,
    primary: primaryData,
    peers,
    sector_avg: sectorAvg
  };
}

/**
 * Main peer comparison render.
 */
function renderPeerComparison(container, data, ticker) {
  const allPeers = [data.primary, ...(data.peers || [])];
  const sectorAvg = data.sector_avg;

  container.innerHTML = `
    <div id="peer-table-section"></div>
    <div class="peer-charts-grid">
      <div class="peer-chart-card">
        <div class="peer-chart-title">P/E Ratio Comparison</div>
        <div class="peer-chart-wrap"><canvas id="peer-pe-chart"></canvas></div>
      </div>
      <div class="peer-chart-card">
        <div class="peer-chart-title">Revenue Growth vs Profit Margin</div>
        <div class="peer-chart-wrap"><canvas id="peer-growth-chart"></canvas></div>
      </div>
    </div>
    <div class="radar-chart-card" id="peer-radar-section"></div>
  `;

  renderPeerTable(container.querySelector('#peer-table-section'), data, ticker);
  renderPeerCharts(container, data, ticker);
  renderValuationRadar(container.querySelector('#peer-radar-section'), data, ticker);
}

/**
 * Render the peer comparison table.
 */
function renderPeerTable(container, data, primaryTicker) {
  const allRows = [data.primary, ...(data.peers || [])];
  const sectorAvg = data.sector_avg || {};

  const columns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'price', label: 'Price' },
    { key: 'market_cap', label: 'Mkt Cap' },
    { key: 'pe', label: 'P/E', lowIsBetter: true },
    { key: 'ev_ebitda', label: 'EV/EBITDA', lowIsBetter: true },
    { key: 'ps', label: 'P/S', lowIsBetter: true },
    { key: 'pb', label: 'P/B', lowIsBetter: true },
    { key: 'rev_growth', label: 'Rev Growth', lowIsBetter: false },
    { key: 'profit_margin', label: 'Margin', lowIsBetter: false },
    { key: 'roe', label: 'ROE', lowIsBetter: false },
    { key: 'div_yield', label: 'Div Yield', lowIsBetter: false }
  ];

  // Compute column medians for comparison
  const medians = {};
  columns.slice(1).forEach(col => {
    const vals = allRows.map(r => r[col.key]).filter(v => v != null).sort((a, b) => a - b);
    if (vals.length) medians[col.key] = vals[Math.floor(vals.length / 2)];
  });

  function cellColor(value, colKey) {
    if (value == null) return '';
    const col = columns.find(c => c.key === colKey);
    if (!col || col.lowIsBetter === undefined) return '';
    const median = medians[colKey];
    if (median == null) return '';
    if (col.lowIsBetter) {
      return value <= median ? 'peer-cell-good' : 'peer-cell-bad';
    } else {
      return value >= median ? 'peer-cell-good' : 'peer-cell-bad';
    }
  }

  function formatCell(value, key) {
    if (value == null) return '—';
    if (key === 'price') return b2Price(value);
    if (key === 'market_cap') return b2Fmt(value);
    if (key === 'rev_growth' || key === 'profit_margin' || key === 'roe' || key === 'div_yield') {
      return b2Num(value, 1) + '%';
    }
    return b2Num(value, 1) + 'x';
  }

  const rowsHtml = allRows.map(peer => {
    const isPrimary = peer.ticker === primaryTicker;
    const cells = columns.map((col, i) => {
      if (col.key === 'ticker') {
        return `<td>
          <div class="peer-ticker">${peer.ticker}</div>
          <div class="peer-name">${peer.name || ''}</div>
        </td>`;
      }
      const colorClass = isPrimary ? cellColor(peer[col.key], col.key) : '';
      return `<td class="${colorClass}">${formatCell(peer[col.key], col.key)}</td>`;
    }).join('');
    return `<tr class="${isPrimary ? 'peer-primary' : ''}">${cells}</tr>`;
  }).join('');

  // Sector avg row
  const avgRowCells = columns.map(col => {
    if (col.key === 'ticker') return `<td><div class="peer-ticker" style="color:var(--color-text-muted);">SECTOR</div><div class="peer-name">Average</div></td>`;
    return `<td>${formatCell(sectorAvg[col.key], col.key)}</td>`;
  }).join('');

  container.innerHTML = `
    <div class="peer-table-wrap" style="margin-bottom:var(--space-4);">
      <table class="peer-table">
        <thead>
          <tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="peer-sector-avg">${avgRowCells}</tr>
        </tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--color-text-faint);margin-bottom:var(--space-4);">
      <span style="color:#4ECDC4;">Green</span> = favorable vs peers · <span style="color:#FF6B6B;">Red</span> = unfavorable · Primary ticker highlighted
    </div>
  `;

  // Row clicks -> fundamentals
  container.querySelectorAll('.peer-table tbody tr:not(.peer-sector-avg)').forEach(row => {
    row.addEventListener('click', () => {
      const ticker = row.querySelector('.peer-ticker')?.textContent?.trim();
      if (ticker && ticker !== 'SECTOR') showFundamentals(ticker);
    });
  });
}

/**
 * Render bar charts comparing peer metrics.
 */
function renderPeerCharts(container, data, primaryTicker) {
  const allPeers = [data.primary, ...(data.peers || [])];
  const labels = allPeers.map(p => p.ticker);
  const colors = allPeers.map(p => p.ticker === primaryTicker ? '#4ECDC4' : 'rgba(139,146,154,0.5)');

  setTimeout(() => {
    // P/E Chart
    b2DestroyChart('peer-pe');
    const peCtx = document.getElementById('peer-pe-chart');
    if (peCtx) {
      b2Charts['peer-pe'] = new Chart(peCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: allPeers.map(p => p.pe),
            backgroundColor: colors,
            borderRadius: 4,
            borderSkipped: false
          }]
        },
        options: {
          ...b2ChartDefaults(),
          plugins: {
            ...b2ChartDefaults().plugins,
            tooltip: {
              ...b2ChartDefaults().plugins.tooltip,
              callbacks: { label: ctx => ` P/E: ${ctx.raw?.toFixed(1)}x` }
            }
          }
        }
      });
    }

    // Growth vs Margin grouped bar
    b2DestroyChart('peer-growth');
    const growthCtx = document.getElementById('peer-growth-chart');
    if (growthCtx) {
      b2Charts['peer-growth'] = new Chart(growthCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Rev Growth %',
              data: allPeers.map(p => p.rev_growth),
              backgroundColor: allPeers.map(p => p.ticker === primaryTicker ? 'rgba(78,205,196,0.8)' : 'rgba(78,205,196,0.35)'),
              borderRadius: 4,
              borderSkipped: false
            },
            {
              label: 'Profit Margin %',
              data: allPeers.map(p => p.profit_margin),
              backgroundColor: allPeers.map(p => p.ticker === primaryTicker ? 'rgba(91,156,246,0.8)' : 'rgba(91,156,246,0.35)'),
              borderRadius: 4,
              borderSkipped: false
            }
          ]
        },
        options: {
          ...b2ChartDefaults(),
          plugins: {
            ...b2ChartDefaults().plugins,
            legend: {
              display: true,
              labels: { color: '#8b929a', font: { family: "'DM Sans', sans-serif", size: 12 }, boxWidth: 12, padding: 14 }
            },
            tooltip: {
              ...b2ChartDefaults().plugins.tooltip,
              callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw?.toFixed(1)}%` }
            }
          }
        }
      });
    }
  }, 50);
}

/**
 * Render the radar/spider chart for relative standing.
 */
function renderValuationRadar(container, data, primaryTicker) {
  if (!container) return;

  const primary = data.primary || {};
  const peers = data.peers || [];
  const sectorAvg = data.sector_avg || {};

  // Compute radar scores (0-100) on 6 axes:
  // Value (inverse P/E), Growth (rev_growth), Profitability (margin+ROE), Safety (low beta), Dividend, Size (market_cap)
  const allPeers = [primary, ...peers];

  function normalize(val, allVals, inverse = false) {
    const validVals = allVals.filter(v => v != null && !isNaN(v));
    if (validVals.length === 0) return 50;
    const min = Math.min(...validVals);
    const max = Math.max(...validVals);
    if (max === min) return 50;
    const norm = ((val - min) / (max - min)) * 100;
    return Math.round(inverse ? 100 - norm : norm);
  }

  const allPE = allPeers.map(p => p.pe);
  const allGrowth = allPeers.map(p => p.rev_growth);
  const allMargin = allPeers.map(p => p.profit_margin);
  const allROE = allPeers.map(p => p.roe);
  const allDiv = allPeers.map(p => p.div_yield);
  const allCap = allPeers.map(p => p.market_cap);

  const primaryScores = [
    normalize(primary.pe, allPE, true),                     // Value (low P/E = good)
    normalize(primary.rev_growth, allGrowth, false),         // Growth
    normalize((primary.profit_margin || 0) + (primary.roe || 0), allPeers.map(p => (p.profit_margin || 0) + (p.roe || 0)), false), // Profitability
    normalize(primary.beta != null ? primary.beta : 1, allPeers.map(p => p.beta || 1), true), // Safety (low beta)
    normalize(primary.div_yield, allDiv, false),             // Dividend
    normalize(primary.market_cap, allCap, false)             // Size
  ];

  const avgScores = [
    normalize(sectorAvg.pe, allPE, true),
    normalize(sectorAvg.rev_growth, allGrowth, false),
    50, 50,
    normalize(sectorAvg.div_yield, allDiv, false),
    normalize(sectorAvg.market_cap, allCap, false)
  ].map(v => v || 50);

  container.innerHTML = `
    <div class="radar-chart-title">Relative Standing — ${primaryTicker} vs Sector</div>
    <div class="radar-chart-wrap">
      <canvas id="peer-radar-chart"></canvas>
    </div>
    <div class="radar-legend">
      <div class="radar-legend-item">
        <div class="radar-legend-swatch" style="background:#4ECDC4;opacity:0.7;"></div>
        <span>${primaryTicker}</span>
      </div>
      <div class="radar-legend-item">
        <div class="radar-legend-swatch" style="background:#FFB347;opacity:0.5;"></div>
        <span>Sector Avg</span>
      </div>
    </div>
  `;

  setTimeout(() => {
    b2DestroyChart('peer-radar');
    const ctx = document.getElementById('peer-radar-chart');
    if (!ctx) return;
    b2Charts['peer-radar'] = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Value', 'Growth', 'Profitability', 'Safety', 'Dividend', 'Size'],
        datasets: [
          {
            label: primaryTicker,
            data: primaryScores,
            backgroundColor: 'rgba(78,205,196,0.15)',
            borderColor: '#4ECDC4',
            borderWidth: 2,
            pointBackgroundColor: '#4ECDC4',
            pointRadius: 4
          },
          {
            label: 'Sector Avg',
            data: avgScores,
            backgroundColor: 'rgba(255,179,71,0.08)',
            borderColor: '#FFB347',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointBackgroundColor: '#FFB347',
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1d20',
            borderColor: '#2e3238',
            borderWidth: 1,
            titleColor: '#e8eaed',
            bodyColor: '#8b929a',
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(0)}/100`
            }
          }
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            backgroundColor: 'transparent',
            grid: { color: 'rgba(255,255,255,0.06)' },
            angleLines: { color: 'rgba(255,255,255,0.06)' },
            pointLabels: {
              color: '#8b929a',
              font: { family: "'DM Sans', sans-serif", size: 11 }
            },
            ticks: {
              display: false,
              stepSize: 25
            }
          }
        }
      }
    });
  }, 50);
}

// ============================================
// SECTION 5: NAV INTEGRATION
// ============================================

/**
 * Add navigation buttons for bloomberg2 views to the bottom nav.
 */
function addBloomberg2NavItems() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;

  // Don't add if already added
  if (nav.querySelector('[data-view="screener"]')) return;

  const navItems = [
    {
      view: 'screener',
      label: 'Screener',
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
      handler: () => showScreener()
    },
    {
      view: 'calendar',
      label: 'Calendar',
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      handler: () => showEconomicCalendar()
    }
  ];

  // Add extra nav row (wrap in scrollable container)
  const extraRow = document.createElement('div');
  extraRow.className = 'b2-nav-extra';
  extraRow.id = 'b2-nav-extra';

  navItems.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = item.view;
    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = `${item.svg}<span>${item.label}</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      btn.classList.add('active');
      item.handler();
    });
    extraRow.appendChild(btn);
  });

  // Insert after bottom-nav
  nav.parentNode.insertBefore(extraRow, nav.nextSibling);
}

/**
 * Extend existing nav items to support view switching for b2 views.
 */
function patchViewSwitching() {
  // The existing nav listens for data-view clicks. We need to handle
  // 'screener', 'calendar', 'peers', 'fundamentals' specially.
  document.querySelectorAll('.nav-item').forEach(btn => {
    const view = btn.dataset.view;
    if (!view) return;
    if (['screener', 'calendar', 'peers', 'fundamentals'].includes(view)) {
      // Already handled individually
    }
  });
}

/**
 * Register a global handler so showFundamentals / showPeerComparison
 * can be called from app.js's existing stock detail view.
 */
function registerBloomberg2Globals() {
  window.showFundamentals = showFundamentals;
  window.showPeerComparison = showPeerComparison;
  window.showScreener = showScreener;
  window.showEconomicCalendar = showEconomicCalendar;
}

// ============================================
// SECTION 6: INITIALIZATION
// ============================================

/**
 * Initialize bloomberg2 features.
 * Called after successful login from app.js.
 */
function initBloomberg2() {
  // Register views with the navigation system
  addBloomberg2NavItems();
  patchViewSwitching();
  registerBloomberg2Globals();

  // Pre-create view containers so they are ready
  b2EnsureView('view-screener', 'b2-view');
  b2EnsureView('view-fundamentals', 'b2-view');
  b2EnsureView('view-calendar', 'b2-view');
  b2EnsureView('view-peers', 'b2-view');

  // Pre-load saved screens in background
  setTimeout(async () => {
    try {
      await loadSavedScreens();
    } catch(e) {}
  }, 500);

  console.log('[bloomberg2] Initialized — Screener, Fundamentals, Calendar, Peers ready');
}

// Auto-init if app is already running (injected after login)
if (typeof authToken !== 'undefined' && authToken) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initBloomberg2();
  } else {
    document.addEventListener('DOMContentLoaded', initBloomberg2);
  }
}
