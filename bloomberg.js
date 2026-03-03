// ============================================
// BLOOMBERG.JS — Bloomberg-Style Features Module
// For Folio Portfolio Tracker
// ============================================
//
// INTEGRATION: Add to app.js after successful login:
//   initBloomberg();
//
// Also add to index.html (before closing </body>):
//   <link rel="stylesheet" href="./bloomberg.css">
//   <script src="./bloomberg.js"></script>
//
// This module is completely self-contained and additive.
// It uses the following globals from app.js:
//   - marketApi(path, params)  — fetch /market/* endpoints
//   - api(path, method, body)  — fetch /api/* with auth
//   - portfolio                — object of ticker -> { lots: [...] }
//   - watchlist                — array of ticker strings
//   - stockDataCache           — cache of quote data
//   - authToken                — current auth token
// ============================================

'use strict';

// ============================================
// SECTION 0: MODULE STATE
// ============================================

const BB = {
  // Current active view
  activeView: null,

  // Interval handles
  indicesInterval: null,

  // Alerts stored locally
  alerts: [],
  alertIdCounter: 1,

  // Chart instances (Chart.js)
  techChart: null,
  rsiChart: null,
  macdChart: null,
  sectorDonutChart: null,
  analyticsLineChart: null,
  divScoreChart: null,

  // Technical chart state
  techTicker: null,
  techPeriod: '3mo',
  techChartType: 'line',   // 'line' | 'candlestick'
  techIndicators: new Set(), // active indicator keys

  // Cached data
  indicesCache: null,
  heatmapCache: null,
  techDataCache: {},       // `${ticker}:${period}` -> OHLCV data
  techIndicatorCache: {},  // `${ticker}:${period}:${indicator}` -> data

  // News filter state
  newsFilterTicker: 'all',
  newsFilterKeyword: '',
  newsFilterSource: 'all',
};

// ============================================
// SECTION 1: MARKET MONITOR & INDICES TICKER BAR
// ============================================

const INDICES = [
  { symbol: 'SPY',  label: 'S&P 500' },
  { symbol: 'DIA',  label: 'Dow' },
  { symbol: 'QQQ',  label: 'Nasdaq' },
  { symbol: 'IWM',  label: 'Russell 2K' },
  { symbol: 'VIXY', label: 'VIX' },
  { symbol: 'TLT',  label: 'T-Bond' },
  { symbol: 'GLD',  label: 'Gold' },
  { symbol: 'USO',  label: 'Oil' },
];

async function initMarketMonitor() {
  // Create the ticker bar DOM element right after the top-bar header
  const appShell = document.querySelector('.app-shell');
  const mainContent = document.querySelector('.main-content');
  if (!appShell || !mainContent) return;

  // Only insert if not already present
  if (document.getElementById('indices-ticker-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'indices-ticker-bar';
  bar.innerHTML = `<div class="ticker-track-wrapper"><div class="ticker-track" id="indices-ticker-track"><span class="bb-spinner" style="margin:auto;"></span></div></div>`;
  appShell.insertBefore(bar, mainContent);

  // Initial load
  await refreshIndices();

  // Auto-refresh every 120 seconds
  if (BB.indicesInterval) clearInterval(BB.indicesInterval);
  BB.indicesInterval = setInterval(refreshIndices, 120000);
}

async function refreshIndices() {
  try {
    const symbols = INDICES.map(i => i.symbol).join(',');
    const data = await marketApi('/quotes', { tickers: symbols });
    if (data && data.quotes) {
      BB.indicesCache = data.quotes;
      renderIndicesBar(data.quotes);
    }
  } catch (e) {
    console.warn('[Bloomberg] indices fetch failed:', e);
    // Show static fallback
    const track = document.getElementById('indices-ticker-track');
    if (track) {
      track.innerHTML = `<span style="font-size:11px;color:var(--color-text-faint);padding:0 16px;">Market data unavailable</span>`;
    }
  }
}

function renderIndicesBar(quotes) {
  const track = document.getElementById('indices-ticker-track');
  if (!track) return;

  // Build items × 2 for seamless loop
  let html = '';
  const buildItems = () => INDICES.map(idx => {
    const q = quotes[idx.symbol];
    if (!q) return '';
    const price = q.price != null ? fmtPrice(q.price) : '--';
    const chg   = q.change != null ? (q.change >= 0 ? '+' : '') + fmtPrice(q.change) : '--';
    const pct   = q.changePercent != null ? (q.changePercent >= 0 ? '+' : '') + q.changePercent.toFixed(2) + '%' : '--';
    const cls   = q.change >= 0 ? 'positive' : 'negative';
    return `
      <div class="ticker-item" title="${idx.label}">
        <span class="ticker-name">${idx.label}</span>
        <span class="ticker-price">${price}</span>
        <span class="ticker-change ${cls}">${chg} (${pct})</span>
      </div>`;
  }).join('');

  // Double the content so we can loop seamlessly
  html = buildItems() + buildItems();
  track.innerHTML = html;

  // Update animation duration based on number of items
  const itemCount = INDICES.length;
  const duration = Math.max(30, itemCount * 8);
  track.style.animationDuration = duration + 's';
}

// ============================================
// SECTION 2: SECTOR HEATMAP
// ============================================

const SECTORS = [
  { name: 'Technology',      ticker: 'XLK',  short: 'Tech'     },
  { name: 'Healthcare',      ticker: 'XLV',  short: 'Health'   },
  { name: 'Financials',      ticker: 'XLF',  short: 'Finance'  },
  { name: 'Consumer Disc.',  ticker: 'XLY',  short: 'Cons.D'   },
  { name: 'Industrials',     ticker: 'XLI',  short: 'Indust.'  },
  { name: 'Communication',   ticker: 'XLC',  short: 'Comm.'    },
  { name: 'Consumer Staples',ticker: 'XLP',  short: 'Cons.S'   },
  { name: 'Energy',          ticker: 'XLE',  short: 'Energy'   },
  { name: 'Utilities',       ticker: 'XLU',  short: 'Util.'    },
  { name: 'Real Estate',     ticker: 'XLRE', short: 'RE'       },
  { name: 'Materials',       ticker: 'XLB',  short: 'Matl.'    },
];

async function showHeatmap(container) {
  container.innerHTML = `
    <div class="market-view-header">
      <div>
        <div class="market-view-title">Sector Performance</div>
        <div class="market-view-subtitle">Day change % for major S&P 500 sectors</div>
      </div>
      <button class="market-refresh-btn" id="heatmap-refresh-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        Refresh
      </button>
    </div>
    <div class="heatmap-section">
      <div class="heatmap-section-title">Sectors (click to filter)</div>
      <div class="heatmap-grid" id="sector-heatmap-grid">
        ${SECTORS.map(() => `<div class="heatmap-cell" style="background:#1a1d20;"><div class="bb-spinner" style="width:14px;height:14px;margin:auto;"></div></div>`).join('')}
      </div>
      <div class="heatmap-legend">
        <span>-3%+</span>
        <div class="heatmap-legend-bar"></div>
        <span>+3%+</span>
      </div>
    </div>`;

  document.getElementById('heatmap-refresh-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('heatmap-refresh-btn');
    if (btn) btn.classList.add('spinning');
    BB.heatmapCache = null;
    await loadAndRenderHeatmap();
    if (btn) btn.classList.remove('spinning');
  });

  await loadAndRenderHeatmap();
}

async function loadAndRenderHeatmap() {
  if (BB.heatmapCache) {
    renderHeatmapGrid(BB.heatmapCache);
    return;
  }
  try {
    const tickers = SECTORS.map(s => s.ticker).join(',');
    const data = await marketApi('/quotes', { tickers });
    if (data && data.quotes) {
      BB.heatmapCache = data.quotes;
      renderHeatmapGrid(data.quotes);
    }
  } catch (e) {
    console.warn('[Bloomberg] heatmap fetch failed:', e);
    const grid = document.getElementById('sector-heatmap-grid');
    if (grid) grid.innerHTML = `<div class="bb-error" style="grid-column:1/-1;">Sector data unavailable</div>`;
  }
}

function renderHeatmapGrid(quotes) {
  const grid = document.getElementById('sector-heatmap-grid');
  if (!grid) return;

  grid.innerHTML = SECTORS.map(sector => {
    const q = quotes[sector.ticker];
    const pct = q && q.changePercent != null ? q.changePercent : null;
    const bg  = pct != null ? heatColor(pct) : '#1a1d20';
    const pctStr = pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '--';
    return `
      <div class="heatmap-cell" style="background:${bg};"
           data-ticker="${sector.ticker}" data-name="${sector.name}"
           onclick="onHeatmapCellClick('${sector.ticker}','${sector.name}')">
        <div class="heatmap-cell-ticker">${sector.ticker}</div>
        <div class="heatmap-cell-name">${sector.short}</div>
        <div class="heatmap-cell-pct">${pctStr}</div>
      </div>`;
  }).join('');
}

function onHeatmapCellClick(ticker, name) {
  // Navigate to technical chart for this sector ETF
  showBloombergView('charts');
  setTimeout(() => loadTechnicalChart(ticker), 100);
}

// Map a percent change to a color on a red-neutral-green gradient
function heatColor(pct) {
  const maxPct = 3;
  const clamped = Math.max(-maxPct, Math.min(maxPct, pct));
  const t = (clamped + maxPct) / (2 * maxPct); // 0..1

  // Color stops: red (#c0392b) → dark neutral (#1e2428) → green (#27ae60)
  if (t < 0.5) {
    const u = t / 0.5;
    return lerpColor('#c0392b', '#1e2428', u);
  } else {
    const u = (t - 0.5) / 0.5;
    return lerpColor('#1e2428', '#27ae60', u);
  }
}

function lerpColor(hex1, hex2, t) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substr(0,2),16),
    parseInt(h.substr(2,2),16),
    parseInt(h.substr(4,2),16),
  ];
}

// ============================================
// SECTION 3: ADVANCED INTERACTIVE CHARTING
// ============================================

const INDICATORS = [
  { key: 'sma20',   label: 'SMA 20',        color: '#F5C542', panel: 'main' },
  { key: 'sma50',   label: 'SMA 50',        color: '#FF9F43', panel: 'main' },
  { key: 'sma200',  label: 'SMA 200',       color: '#A78BFA', panel: 'main' },
  { key: 'ema12',   label: 'EMA 12',        color: '#5B9CF6', panel: 'main' },
  { key: 'ema26',   label: 'EMA 26',        color: '#4ECDC4', panel: 'main' },
  { key: 'bb',      label: 'Bollinger',     color: 'rgba(78,205,196,0.25)', panel: 'main' },
  { key: 'rsi',     label: 'RSI 14',        color: '#F5C542', panel: 'rsi'  },
  { key: 'macd',    label: 'MACD',          color: '#5B9CF6', panel: 'macd' },
];

function renderChartsView(container) {
  const tickers = [...Object.keys(portfolio || {}), ...(watchlist || [])];
  const defaultTicker = tickers[0] || 'SPY';

  container.innerHTML = `
    <div class="tech-chart-container">
      <!-- Ticker selector -->
      <div class="chart-ticker-select-bar">
        <input type="text" class="chart-ticker-input" id="tech-ticker-input"
               placeholder="AAPL" value="${defaultTicker}" maxlength="10">
        <button class="chart-ticker-search-btn" id="tech-load-btn">Load Chart</button>
        ${tickers.length > 0 ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
            ${tickers.slice(0, 8).map(t => `
              <button class="news-filter-chip" onclick="loadTechnicalChart('${t}')">
                ${t}
              </button>`).join('')}
          </div>` : ''}
      </div>

      <!-- Chart header -->
      <div class="tech-chart-header" id="tech-chart-header">
        <div class="tech-chart-ticker-group">
          <span class="tech-chart-ticker" id="tech-chart-ticker-label">--</span>
          <span class="tech-chart-price" id="tech-chart-price-label">
            <span id="tech-price-val">--</span>
            <span class="tech-chart-change" id="tech-change-val"></span>
          </span>
        </div>
        <div class="tech-chart-controls">
          <!-- Period -->
          <div class="period-selector" id="tech-period-selector">
            ${['5d','1mo','3mo','6mo','1y','2y'].map(p => `
              <button class="period-btn ${p === BB.techPeriod ? 'active' : ''}"
                      data-period="${p}" onclick="onTechPeriodChange('${p}')">${p}</button>`).join('')}
          </div>
          <!-- Chart type -->
          <div class="chart-type-toggle">
            <button class="chart-type-btn ${BB.techChartType === 'line' ? 'active' : ''}"
                    onclick="onChartTypeChange('line')">Line</button>
            <button class="chart-type-btn ${BB.techChartType === 'candlestick' ? 'active' : ''}"
                    onclick="onChartTypeChange('candlestick')">OHLC</button>
          </div>
          <!-- Indicators -->
          <div class="indicator-dropdown-wrap">
            <button class="indicator-btn" id="indicator-toggle-btn"
                    onclick="toggleIndicatorDropdown()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Indicators
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:9px;height:9px;"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="indicator-dropdown" id="indicator-dropdown">
              ${INDICATORS.map(ind => `
                <div class="indicator-option" id="ind-opt-${ind.key}"
                     onclick="toggleIndicator('${ind.key}')">
                  <div class="indicator-check"></div>
                  <span style="color:${ind.color};margin-right:4px;font-weight:700;">—</span>
                  ${ind.label}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Active indicator chips -->
      <div class="active-indicators" id="active-indicators"></div>

      <!-- Main chart -->
      <div class="tech-main-chart-wrap" id="tech-main-chart-wrap">
        <div class="tech-main-chart-canvas-wrap" id="tech-main-canvas-wrap">
          <canvas id="tech-line-chart" height="280"></canvas>
          <div id="tech-candlestick-wrap" style="display:none;"></div>
          <div class="chart-crosshair-tooltip" id="tech-crosshair"></div>
        </div>
      </div>

      <!-- Sub-panels (RSI, MACD) -->
      <div id="tech-sub-panels"></div>
    </div>`;

  // Wire up ticker input
  document.getElementById('tech-load-btn')?.addEventListener('click', () => {
    const val = document.getElementById('tech-ticker-input')?.value.trim().toUpperCase();
    if (val) loadTechnicalChart(val);
  });
  document.getElementById('tech-ticker-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim().toUpperCase();
      if (val) loadTechnicalChart(val);
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('indicator-dropdown');
    const btn = document.getElementById('indicator-toggle-btn');
    if (dd && !dd.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
      dd.classList.remove('open');
    }
  }, { capture: false });

  // Auto-load chart for default ticker
  if (defaultTicker) {
    loadTechnicalChart(defaultTicker);
  } else {
    showChartPlaceholder();
  }
}

function showChartPlaceholder() {
  const wrap = document.getElementById('tech-main-canvas-wrap');
  if (wrap) {
    wrap.innerHTML = `
      <div class="bb-empty" style="height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <svg class="bb-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <div class="bb-empty-title">No chart loaded</div>
        <div class="bb-empty-desc">Enter a ticker and click Load Chart</div>
      </div>`;
  }
}

async function loadTechnicalChart(ticker) {
  ticker = ticker.toUpperCase();
  BB.techTicker = ticker;

  // Update UI label
  const tickerLabel = document.getElementById('tech-chart-ticker-label');
  if (tickerLabel) tickerLabel.textContent = ticker;

  // Update ticker input
  const input = document.getElementById('tech-ticker-input');
  if (input) input.value = ticker;

  // Show loading
  const mainWrap = document.getElementById('tech-main-chart-wrap');
  if (mainWrap) {
    mainWrap.innerHTML = `<div class="bb-loading"><div class="bb-spinner"></div>Loading chart data…</div>`;
  }

  try {
    // Fetch OHLCV data
    const cacheKey = `${ticker}:${BB.techPeriod}`;
    let ohlcvData;

    if (BB.techDataCache[cacheKey]) {
      ohlcvData = BB.techDataCache[cacheKey];
    } else {
      const periodMap = {
        '5d': '5d', '1mo': '1mo', '3mo': '3mo',
        '6mo': '6mo', '1y': '1y', '2y': '2y'
      };
      const data = await marketApi('/history', {
        tickers: ticker,
        period: periodMap[BB.techPeriod] || '3mo'
      });
      if (data && data.history && data.history[ticker]) {
        ohlcvData = data.history[ticker];
        BB.techDataCache[cacheKey] = ohlcvData;
      } else {
        throw new Error('No data returned');
      }
    }

    // Fetch latest quote for header
    try {
      const qData = await marketApi('/quotes', { tickers: ticker });
      if (qData && qData.quotes && qData.quotes[ticker]) {
        const q = qData.quotes[ticker];
        const priceEl = document.getElementById('tech-price-val');
        const changeEl = document.getElementById('tech-change-val');
        if (priceEl) priceEl.textContent = '$' + fmtPrice(q.price);
        if (changeEl) {
          const isPos = q.change >= 0;
          changeEl.textContent = (isPos ? '+' : '') + fmtPrice(q.change) +
            ' (' + (isPos ? '+' : '') + q.changePercent.toFixed(2) + '%)';
          changeEl.className = 'tech-chart-change ' + (isPos ? 'positive' : 'negative');
        }
      }
    } catch (_) {}

    // Restore chart wrapper
    if (mainWrap) {
      mainWrap.innerHTML = `
        <div class="tech-main-chart-canvas-wrap" id="tech-main-canvas-wrap">
          <canvas id="tech-line-chart" height="280"></canvas>
          <div id="tech-candlestick-wrap" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;"></div>
          <div class="chart-crosshair-tooltip" id="tech-crosshair"></div>
        </div>`;
    }

    // Render the chart
    await renderTechnicalChart(ticker, ohlcvData);

    // Render any active indicators
    refreshActiveIndicatorChips();
    await renderSubPanels(ticker, ohlcvData);

  } catch (e) {
    console.warn('[Bloomberg] chart load failed:', e);
    if (mainWrap) {
      mainWrap.innerHTML = `<div class="bb-error">Failed to load chart for ${ticker}: ${e.message}</div>`;
    }
  }
}

async function renderTechnicalChart(ticker, ohlcvData) {
  const { dates, close, open, high, low, volume } = ohlcvData;

  if (BB.techChartType === 'candlestick') {
    renderCandlestickChart(
      document.getElementById('tech-main-canvas-wrap'),
      { dates, open, high, low, close, volume }
    );
    return;
  }

  // --- Line chart (Chart.js) ---
  destroyChart('techChart');

  const canvas = document.getElementById('tech-line-chart');
  if (!canvas) return;
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  const labels = dates.map(d => {
    const dt = new Date(d);
    if (BB.techPeriod === '5d') return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (BB.techPeriod === '1mo') return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  });

  // Build gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(78,205,196,0.18)');
  gradient.addColorStop(1, 'rgba(78,205,196,0)');

  const datasets = [{
    label: ticker,
    data: close,
    borderColor: '#4ECDC4',
    backgroundColor: gradient,
    borderWidth: 2,
    fill: true,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: '#4ECDC4',
  }];

  // Add overlay indicators
  for (const key of BB.techIndicators) {
    const ind = INDICATORS.find(i => i.key === key);
    if (!ind || ind.panel !== 'main') continue;

    const indData = await fetchIndicatorData(ticker, key);
    if (!indData) continue;

    if (key === 'bb') {
      // Bollinger upper/lower as shaded area
      datasets.push({
        label: 'BB Upper',
        data: indData.upper,
        borderColor: 'rgba(78,205,196,0.4)',
        backgroundColor: 'rgba(78,205,196,0.07)',
        borderWidth: 1,
        fill: '+1',
        tension: 0.3,
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Lower',
        data: indData.lower,
        borderColor: 'rgba(78,205,196,0.4)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Mid',
        data: indData.mid,
        borderColor: 'rgba(78,205,196,0.5)',
        borderWidth: 1,
        borderDash: [4, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        backgroundColor: 'transparent',
      });
    } else {
      datasets.push({
        label: ind.label,
        data: indData.values || indData,
        borderColor: ind.color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      });
    }
  }

  BB.techChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(26,29,32,0.97)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleColor: '#8b8f94',
          bodyColor: '#e8eaed',
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return ` ${ctx.dataset.label}: $${fmtPrice(v)}`;
            }
          }
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#545b65',
            font: { family: 'DM Mono', size: 9 },
            maxRotation: 0,
            maxTicksLimit: 8,
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        },
        y: {
          position: 'right',
          ticks: {
            color: '#545b65',
            font: { family: 'DM Mono', size: 9 },
            callback: (v) => '$' + fmtPrice(v),
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        }
      }
    }
  });
}

function renderCandlestickChart(container, data) {
  // Hide the canvas, show the SVG wrapper
  const canvas = document.getElementById('tech-line-chart');
  if (canvas) canvas.style.display = 'none';

  let wrap = document.getElementById('tech-candlestick-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';

  const { dates, open, high, low, close } = data;
  const n = dates ? dates.length : 0;
  if (n === 0) {
    wrap.innerHTML = `<div class="bb-empty">No OHLC data available</div>`;
    return;
  }

  const W = wrap.clientWidth || 320;
  const H = 280;
  const PAD_L = 8;
  const PAD_R = 52;
  const PAD_T = 12;
  const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const allPrices = [...(high || []), ...(low || [])].filter(v => v != null);
  const minP = Math.min(...allPrices) * 0.999;
  const maxP = Math.max(...allPrices) * 1.001;
  const priceRange = maxP - minP || 1;

  const scaleY = (p) => PAD_T + chartH - ((p - minP) / priceRange) * chartH;
  const candleW = Math.max(2, Math.min(12, Math.floor(chartW / n) - 1));
  const step = chartW / n;

  let svgBody = '';

  // Grid lines
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const p = minP + (priceRange * i / yTicks);
    const y = scaleY(p);
    svgBody += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"
                      stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
    svgBody += `<text x="${W - PAD_R + 4}" y="${y + 3}" font-family="DM Mono" font-size="9"
                      fill="#545b65">${'$' + fmtPrice(p)}</text>`;
  }

  // Candles
  for (let i = 0; i < n; i++) {
    if (open[i] == null || close[i] == null) continue;
    const x = PAD_L + i * step + step / 2;
    const o = scaleY(open[i]);
    const c = scaleY(close[i]);
    const h = high[i] != null ? scaleY(high[i]) : Math.min(o, c);
    const l = low[i]  != null ? scaleY(low[i])  : Math.max(o, c);
    const isUp = close[i] >= open[i];
    const color = isUp ? '#00D68F' : '#FF6B6B';
    const bodyTop = Math.min(o, c);
    const bodyH  = Math.max(1, Math.abs(c - o));

    // Wick
    svgBody += `<line x1="${x}" y1="${h}" x2="${x}" y2="${l}"
                      stroke="${color}" stroke-width="1.2" opacity="0.8"/>`;
    // Body
    svgBody += `<rect x="${x - candleW / 2}" y="${bodyTop}"
                      width="${candleW}" height="${bodyH}"
                      fill="${color}" rx="1" opacity="0.9"/>`;
  }

  // X-axis labels
  const labelEvery = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += labelEvery) {
    if (!dates[i]) continue;
    const x = PAD_L + i * step + step / 2;
    const dt = new Date(dates[i]);
    const lbl = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    svgBody += `<text x="${x}" y="${H - 6}" font-family="DM Mono" font-size="9"
                      fill="#545b65" text-anchor="middle">${lbl}</text>`;
  }

  wrap.innerHTML = `
    <svg width="${W}" height="${H}" style="width:100%;height:${H}px;">
      ${svgBody}
    </svg>`;
}

function onTechPeriodChange(period) {
  BB.techPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  // Clear cache for ticker+period and reload
  if (BB.techTicker) {
    delete BB.techDataCache[`${BB.techTicker}:${period}`];
    loadTechnicalChart(BB.techTicker);
  }
}

function onChartTypeChange(type) {
  BB.techChartType = type;
  document.querySelectorAll('.chart-type-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase().trim() === type ||
                                  (type === 'candlestick' && b.textContent.includes('OHLC')));
  });
  if (BB.techTicker) loadTechnicalChart(BB.techTicker);
}

function toggleIndicatorDropdown() {
  const dd = document.getElementById('indicator-dropdown');
  if (dd) dd.classList.toggle('open');
}

function toggleIndicator(key) {
  if (BB.techIndicators.has(key)) {
    BB.techIndicators.delete(key);
  } else {
    BB.techIndicators.add(key);
  }
  // Update option UI
  const opt = document.getElementById(`ind-opt-${key}`);
  if (opt) opt.classList.toggle('active', BB.techIndicators.has(key));

  refreshActiveIndicatorChips();
  if (BB.techTicker) loadTechnicalChart(BB.techTicker);
}

function refreshActiveIndicatorChips() {
  const container = document.getElementById('active-indicators');
  if (!container) return;
  if (BB.techIndicators.size === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = [...BB.techIndicators].map(key => {
    const ind = INDICATORS.find(i => i.key === key);
    if (!ind) return '';
    return `<span class="indicator-chip" style="color:${ind.color};border-color:${ind.color};"
                  onclick="toggleIndicator('${key}')">
              ${ind.label}<span class="indicator-chip-remove">×</span>
            </span>`;
  }).join('');
}

async function fetchIndicatorData(ticker, key) {
  const cacheKey = `${ticker}:${BB.techPeriod}:${key}`;
  if (BB.techIndicatorCache[cacheKey]) return BB.techIndicatorCache[cacheKey];

  try {
    const periodMap = {
      '5d': '5d', '1mo': '1mo', '3mo': '3mo',
      '6mo': '6mo', '1y': '1y', '2y': '2y'
    };
    const data = await marketApi('/technicals', {
      ticker,
      period: periodMap[BB.techPeriod] || '3mo',
      indicators: key
    });
    if (data && data.indicators && data.indicators[key]) {
      BB.techIndicatorCache[cacheKey] = data.indicators[key];
      return data.indicators[key];
    }
  } catch (e) {
    // If the endpoint doesn't exist, compute locally from cached price data
    return computeLocalIndicator(ticker, key);
  }
  return null;
}

function computeLocalIndicator(ticker, key) {
  const cacheKey = `${ticker}:${BB.techPeriod}`;
  const ohlcv = BB.techDataCache[cacheKey];
  if (!ohlcv || !ohlcv.close) return null;
  const prices = ohlcv.close;

  switch (key) {
    case 'sma20':  return { values: calcSMA(prices, 20) };
    case 'sma50':  return { values: calcSMA(prices, 50) };
    case 'sma200': return { values: calcSMA(prices, 200) };
    case 'ema12':  return { values: calcEMA(prices, 12) };
    case 'ema26':  return { values: calcEMA(prices, 26) };
    case 'bb':     return calcBollingerBands(prices, 20);
    case 'rsi':    return { values: calcRSI(prices, 14) };
    case 'macd': {
      const ema12 = calcEMA(prices, 12);
      const ema26 = calcEMA(prices, 26);
      const macdLine = ema12.map((v, i) => v != null && ema26[i] != null ? v - ema26[i] : null);
      const signal   = calcEMA(macdLine.filter(v => v != null), 9);
      const signalFull = new Array(macdLine.length).fill(null);
      let si = 0;
      for (let i = 0; i < macdLine.length; i++) {
        if (macdLine[i] != null) signalFull[i] = signal[si++] || null;
      }
      const histogram = macdLine.map((v, i) =>
        v != null && signalFull[i] != null ? v - signalFull[i] : null);
      return { line: macdLine, signal: signalFull, histogram };
    }
    default: return null;
  }
}

function calcSMA(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  const result = new Array(prices.length).fill(null);
  let prev = null;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] == null) continue;
    if (prev == null) {
      // Seed with SMA
      if (i >= period - 1) {
        const slice = prices.slice(i - period + 1, i + 1).filter(v => v != null);
        if (slice.length === period) {
          prev = slice.reduce((a, b) => a + b, 0) / period;
          result[i] = prev;
        }
      }
    } else {
      prev = prices[i] * k + prev * (1 - k);
      result[i] = prev;
    }
  }
  return result;
}

function calcRSI(prices, period = 14) {
  const changes = prices.map((p, i) => i === 0 ? 0 : p - prices[i - 1]);
  const result = new Array(prices.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    avgGain += Math.max(0, changes[i]);
    avgLoss += Math.max(0, -changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = 100 - (100 / (1 + avgGain / (avgLoss || 0.0001)));

  for (let i = period + 1; i < prices.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
    result[i] = 100 - (100 / (1 + avgGain / (avgLoss || 0.0001)));
  }
  return result;
}

function calcBollingerBands(prices, period = 20) {
  const mid   = calcSMA(prices, period);
  const upper = [];
  const lower = [];
  prices.forEach((_, i) => {
    if (i < period - 1) { upper.push(null); lower.push(null); return; }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const std  = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper.push(mean + 2 * std);
    lower.push(mean - 2 * std);
  });
  return { mid, upper, lower };
}

async function renderSubPanels(ticker, ohlcvData) {
  const subContainer = document.getElementById('tech-sub-panels');
  if (!subContainer) return;
  subContainer.innerHTML = '';

  const panels = [...BB.techIndicators].filter(k => {
    const ind = INDICATORS.find(i => i.key === k);
    return ind && ind.panel !== 'main';
  });

  for (const key of panels) {
    const data = await fetchIndicatorData(ticker, key);
    if (!data) continue;

    if (key === 'rsi') await renderRSIPanel(subContainer, ticker, ohlcvData, data);
    if (key === 'macd') await renderMACDPanel(subContainer, ticker, ohlcvData, data);
  }
}

async function renderRSIPanel(container, ticker, ohlcvData, rsiData) {
  const div = document.createElement('div');
  div.className = 'tech-sub-panel';
  div.id = 'rsi-sub-panel';
  div.innerHTML = `
    <div class="tech-sub-panel-header">
      <span class="tech-sub-panel-title">RSI (14)</span>
      <span class="tech-sub-panel-close" onclick="closeSubPanel('rsi')">×</span>
    </div>
    <div class="tech-sub-canvas-wrap" style="height:90px;">
      <canvas id="rsi-canvas"></canvas>
    </div>`;
  container.appendChild(div);

  const canvas = div.querySelector('#rsi-canvas');
  if (!canvas) return;

  destroyChart('rsiChart');
  const values = rsiData.values || rsiData;
  const labels = ohlcvData.dates ? ohlcvData.dates.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }) : [];

  BB.rsiChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'RSI',
        data: values,
        borderColor: '#F5C542',
        borderWidth: 1.5,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        backgroundColor: 'transparent',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` RSI: ${ctx.parsed.y?.toFixed(1)}`
          }
        },
        annotation: {
          annotations: {
            line70: {
              type: 'line',
              yMin: 70, yMax: 70,
              borderColor: 'rgba(255,107,107,0.4)',
              borderWidth: 1,
              borderDash: [4, 4],
            },
            line30: {
              type: 'line',
              yMin: 30, yMax: 30,
              borderColor: 'rgba(78,205,196,0.4)',
              borderWidth: 1,
              borderDash: [4, 4],
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#545b65', font: { family: 'DM Mono', size: 8 }, maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        },
        y: {
          min: 0, max: 100,
          position: 'right',
          ticks: {
            color: '#545b65',
            font: { family: 'DM Mono', size: 8 },
            callback: v => v,
            stepSize: 30,
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        }
      }
    }
  });

  // Draw 70/30 reference lines with CSS overlay
  addRSIReferenceLines(div.querySelector('.tech-sub-canvas-wrap'), 90);
}

function addRSIReferenceLines(wrap, height) {
  if (!wrap) return;
  const line70 = document.createElement('div');
  line70.className = 'rsi-ref-line rsi-ref-70';
  line70.style.top = `${((100 - 70) / 100) * height}px`;
  line70.textContent = '70';
  wrap.appendChild(line70);

  const line30 = document.createElement('div');
  line30.className = 'rsi-ref-line rsi-ref-30';
  line30.style.top = `${((100 - 30) / 100) * height}px`;
  line30.textContent = '30';
  wrap.appendChild(line30);
}

async function renderMACDPanel(container, ticker, ohlcvData, macdData) {
  const div = document.createElement('div');
  div.className = 'tech-sub-panel';
  div.id = 'macd-sub-panel';
  div.innerHTML = `
    <div class="tech-sub-panel-header">
      <span class="tech-sub-panel-title">MACD (12,26,9)</span>
      <span class="tech-sub-panel-close" onclick="closeSubPanel('macd')">×</span>
    </div>
    <div class="tech-sub-canvas-wrap" style="height:90px;">
      <canvas id="macd-canvas"></canvas>
    </div>`;
  container.appendChild(div);

  const canvas = div.querySelector('#macd-canvas');
  if (!canvas) return;

  destroyChart('macdChart');

  const labels = ohlcvData.dates ? ohlcvData.dates.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }) : [];

  const { line, signal, histogram } = macdData;

  BB.macdChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Histogram',
          data: histogram,
          backgroundColor: histogram.map(v =>
            v == null ? 'transparent' :
            v >= 0 ? 'rgba(0,214,143,0.5)' : 'rgba(255,107,107,0.5)'
          ),
          borderWidth: 0,
          order: 2,
        },
        {
          type: 'line',
          label: 'MACD',
          data: line,
          borderColor: '#5B9CF6',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          order: 1,
          backgroundColor: 'transparent',
        },
        {
          type: 'line',
          label: 'Signal',
          data: signal,
          borderColor: '#FF9F43',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          order: 1,
          backgroundColor: 'transparent',
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(4)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#545b65', font: { family: 'DM Mono', size: 8 }, maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        },
        y: {
          position: 'right',
          ticks: {
            color: '#545b65',
            font: { family: 'DM Mono', size: 8 },
            maxTicksLimit: 4,
            callback: v => fmtPrice(v, 3),
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { display: false },
        }
      }
    }
  });
}

function closeSubPanel(type) {
  BB.techIndicators.delete(type === 'rsi' ? 'rsi' : 'macd');
  const panel = document.getElementById(`${type}-sub-panel`);
  if (panel) panel.remove();
  const opt = document.getElementById(`ind-opt-${type}`);
  if (opt) opt.classList.remove('active');
  refreshActiveIndicatorChips();
}

// ============================================
// SECTION 4: NEWS FEED WITH FILTERS & ALERTS
// ============================================

function renderNewsView(container) {
  const tickers = [...Object.keys(portfolio || {}), ...(watchlist || [])];

  container.innerHTML = `
    <div class="news-bb-container">
      <!-- Filter bar -->
      <div class="news-bb-filter-bar">
        <input class="news-bb-search" id="news-bb-search" type="text"
               placeholder="Search headlines…" value="${BB.newsFilterKeyword}">
        <div class="news-bb-filter-chips" id="news-bb-chips">
          <button class="news-filter-chip ${BB.newsFilterTicker === 'all' ? 'active' : ''}"
                  onclick="setNewsTicker('all')">All</button>
          ${tickers.map(t => `
            <button class="news-filter-chip ${BB.newsFilterTicker === t ? 'active' : ''}"
                    onclick="setNewsTicker('${t}')">${t}</button>`).join('')}
        </div>
      </div>

      <!-- News list -->
      <div id="news-bb-feed" class="news-bb-list">
        <div class="bb-loading"><div class="bb-spinner"></div>Loading news…</div>
      </div>

      <!-- Alerts section -->
      <div class="alerts-section">
        <div class="alerts-section-title">Price Alerts</div>
        <div class="alert-create-form">
          <div class="alert-form-title">Create New Alert</div>
          <div class="alert-form-row">
            <div class="alert-form-group">
              <label class="alert-form-label">Ticker</label>
              <input class="alert-form-input" id="alert-ticker-input" type="text"
                     placeholder="AAPL" maxlength="10" style="text-transform:uppercase">
            </div>
            <div class="alert-form-group" style="max-width:120px;">
              <label class="alert-form-label">Condition</label>
              <select class="alert-form-select" id="alert-condition-select">
                <option value="above">Price Above</option>
                <option value="below">Price Below</option>
                <option value="change_up">Change % ≥</option>
                <option value="change_down">Change % ≤</option>
              </select>
            </div>
            <div class="alert-form-group" style="max-width:100px;">
              <label class="alert-form-label">Value</label>
              <input class="alert-form-input" id="alert-price-input" type="number"
                     placeholder="150.00" step="0.01">
            </div>
            <button class="alert-form-btn" onclick="createAlertFromForm()">+ Alert</button>
          </div>
          <div id="alert-form-msg" style="font-size:11px;margin-top:6px;"></div>
        </div>
        <div class="alerts-list" id="alerts-list-container">
          <!-- Rendered by renderAlertsPanel -->
        </div>
      </div>
    </div>`;

  // Search input wiring
  document.getElementById('news-bb-search')?.addEventListener('input', (e) => {
    BB.newsFilterKeyword = e.target.value.toLowerCase();
    renderNewsItems();
  });

  // Pre-fill alert ticker from portfolio
  if (tickers.length > 0) {
    const inp = document.getElementById('alert-ticker-input');
    if (inp) inp.value = tickers[0];
  }

  loadAndRenderNews();
  renderAlertsPanel();
}

async function showNewsFeed(tickers) {
  renderNewsView(document.getElementById('bb-news-view'));
}

async function loadAndRenderNews() {
  try {
    const tickers = [...Object.keys(portfolio || {}), ...(watchlist || [])];
    const queryTickers = tickers.length > 0 ? tickers.slice(0, 8).join(',') : 'SPY,AAPL,MSFT';
    const data = await marketApi('/news', { tickers: queryTickers });
    if (data && data.news) {
      BB._newsItems = data.news;
    } else {
      BB._newsItems = [];
    }
  } catch (e) {
    console.warn('[Bloomberg] news fetch failed:', e);
    BB._newsItems = [];
  }
  renderNewsItems();
}

function renderNewsItems() {
  const container = document.getElementById('news-bb-feed');
  if (!container) return;

  let items = BB._newsItems || [];

  // Filter by ticker
  if (BB.newsFilterTicker !== 'all') {
    items = items.filter(n =>
      n.tickers && n.tickers.some(t => t.toUpperCase() === BB.newsFilterTicker.toUpperCase())
    );
  }

  // Filter by keyword
  if (BB.newsFilterKeyword) {
    const kw = BB.newsFilterKeyword.toLowerCase();
    items = items.filter(n =>
      (n.title && n.title.toLowerCase().includes(kw)) ||
      (n.summary && n.summary.toLowerCase().includes(kw))
    );
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="bb-empty">
        <svg class="bb-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/></svg>
        <div class="bb-empty-title">No news found</div>
        <div class="bb-empty-desc">Try changing your filters</div>
      </div>`;
    return;
  }

  container.innerHTML = items.map((n, idx) => renderNewsItem(n, idx)).join('');
}

function renderNewsItem(n, idx) {
  const badges = (n.tickers || []).slice(0, 3).map(t =>
    `<span class="news-bb-badge">${t}</span>`).join('');

  const timeAgo = n.publishedAt ? getTimeAgo(n.publishedAt) : '';
  const source  = n.source || n.publisher || '';
  const sentiment = n.sentiment;
  const sentBadge = sentiment
    ? `<span class="news-bb-sentiment ${sentiment}">${sentiment}</span>`
    : '';

  const summary = n.summary || n.description || '';
  const url = n.url || n.link || '#';

  return `
    <div class="news-bb-item" id="news-item-${idx}" onclick="toggleNewsItem(${idx})">
      <div class="news-bb-item-top">
        <div class="news-bb-badges">${badges}</div>
        <div class="news-bb-content">
          <div class="news-bb-title">${escHtml(n.title || 'Untitled')}</div>
          <div class="news-bb-meta">
            <span class="news-bb-source">${escHtml(source)}</span>
            ${timeAgo ? `<span class="news-bb-dot"></span><span class="news-bb-time">${timeAgo}</span>` : ''}
            ${sentBadge ? `<span class="news-bb-dot"></span>${sentBadge}` : ''}
          </div>
        </div>
        <div class="news-bb-expand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      ${summary ? `
        <div class="news-bb-summary">
          ${escHtml(summary)}
          ${url !== '#' ? `<br><a class="news-bb-link" href="${url}" target="_blank" rel="noopener">
            Read more →
          </a>` : ''}
        </div>` : ''}
    </div>`;
}

function toggleNewsItem(idx) {
  const el = document.getElementById(`news-item-${idx}`);
  if (el) el.classList.toggle('expanded');
}

function setNewsTicker(ticker) {
  BB.newsFilterTicker = ticker;
  document.querySelectorAll('.news-bb-filter-chips .news-filter-chip').forEach(b => {
    b.classList.toggle('active',
      (ticker === 'all' && b.textContent === 'All') ||
      b.textContent === ticker);
  });
  renderNewsItems();
}

function renderNewsFeed(container, news, filters) {
  BB._newsItems = news;
  if (filters) {
    BB.newsFilterTicker  = filters.ticker  || 'all';
    BB.newsFilterKeyword = filters.keyword || '';
  }
  renderNewsItems();
}

// --- ALERTS ---

function initAlerts() {
  // Load from localStorage
  try {
    const saved = localStorage.getItem('bb_alerts');
    if (saved) {
      BB.alerts = JSON.parse(saved);
      BB.alertIdCounter = BB.alerts.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1;
    }
  } catch (_) {}
  // Start polling
  setInterval(checkAlerts, 30000);
}

function saveAlerts() {
  try { localStorage.setItem('bb_alerts', JSON.stringify(BB.alerts)); } catch (_) {}
}

async function createAlert(ticker, condition, price) {
  const id = BB.alertIdCounter++;
  const alert = {
    id,
    ticker: ticker.toUpperCase(),
    condition,
    price: parseFloat(price),
    createdAt: new Date().toISOString(),
    triggered: false,
  };
  BB.alerts.unshift(alert);
  saveAlerts();
  renderAlertsPanel();
  return alert;
}

async function loadAlerts() {
  try {
    const saved = localStorage.getItem('bb_alerts');
    if (saved) BB.alerts = JSON.parse(saved);
  } catch (_) {}
}

function renderAlertsPanel(alerts) {
  const container = document.getElementById('alerts-list-container');
  if (!container) return;

  const list = alerts || BB.alerts;

  if (list.length === 0) {
    container.innerHTML = `<div class="alerts-empty">No active alerts. Create one above.</div>`;
    return;
  }

  container.innerHTML = list.map(a => {
    const condLabel = {
      above: 'above', below: 'below',
      change_up: 'up ≥', change_down: 'down ≤'
    }[a.condition] || a.condition;
    const condSuffix = ['change_up','change_down'].includes(a.condition) ? '%' : '';
    const statusClass = a.triggered ? 'triggered' : 'active';
    return `
      <div class="alert-item ${a.triggered ? 'triggered' : ''}">
        <div class="alert-item-left">
          <div class="alert-status-dot ${statusClass}"></div>
          <div>
            <span class="alert-item-ticker">${escHtml(a.ticker)}</span>
            <span class="alert-item-desc"> price ${condLabel} </span>
            <span class="alert-item-price">${fmtPrice(a.price)}${condSuffix}</span>
          </div>
        </div>
        <button class="alert-delete-btn" onclick="deleteAlert(${a.id})" aria-label="Delete alert">×</button>
      </div>`;
  }).join('');
}

function deleteAlert(id) {
  BB.alerts = BB.alerts.filter(a => a.id !== id);
  saveAlerts();
  renderAlertsPanel();
}

function createAlertFromForm() {
  const ticker    = document.getElementById('alert-ticker-input')?.value.trim().toUpperCase();
  const condition = document.getElementById('alert-condition-select')?.value;
  const price     = parseFloat(document.getElementById('alert-price-input')?.value);
  const msgEl     = document.getElementById('alert-form-msg');

  if (!ticker) { if (msgEl) { msgEl.style.color = 'var(--color-negative)'; msgEl.textContent = 'Enter a ticker symbol.'; } return; }
  if (isNaN(price) || price <= 0) { if (msgEl) { msgEl.style.color = 'var(--color-negative)'; msgEl.textContent = 'Enter a valid price/percent.'; } return; }

  createAlert(ticker, condition, price);
  if (msgEl) {
    msgEl.style.color = 'var(--color-positive)';
    msgEl.textContent = `Alert created for ${ticker}`;
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  }
  // Clear inputs
  const priceInp = document.getElementById('alert-price-input');
  if (priceInp) priceInp.value = '';
}

async function checkAlerts() {
  const activeAlerts = BB.alerts.filter(a => !a.triggered);
  if (activeAlerts.length === 0) return;

  try {
    const tickers = [...new Set(activeAlerts.map(a => a.ticker))].join(',');
    const data = await marketApi('/quotes', { tickers });
    if (!data || !data.quotes) return;

    let anyTriggered = false;
    for (const alert of activeAlerts) {
      const q = data.quotes[alert.ticker];
      if (!q) continue;
      const price = q.price;
      const pct   = q.changePercent;
      let triggered = false;

      switch (alert.condition) {
        case 'above':      triggered = price >= alert.price; break;
        case 'below':      triggered = price <= alert.price; break;
        case 'change_up':  triggered = pct   >= alert.price; break;
        case 'change_down':triggered = pct   <= -alert.price; break;
      }

      if (triggered && !alert.triggered) {
        alert.triggered = true;
        anyTriggered = true;
        // Show browser notification if permission granted
        showAlertNotification(alert, price);
      }
    }

    if (anyTriggered) {
      saveAlerts();
      renderAlertsPanel();
    }
  } catch (_) {}
}

function showAlertNotification(alert, currentPrice) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`Folio Alert: ${alert.ticker}`, {
      body: `Price is now $${fmtPrice(currentPrice)} — alert triggered!`,
      icon: '/favicon.ico',
    });
  }
}

// ============================================
// SECTION 5: PORTFOLIO ANALYTICS & RISK TOOLS
// ============================================

async function showPortfolioAnalytics() {
  const container = document.getElementById('bb-analytics-view');
  if (!container) return;

  container.innerHTML = `<div class="bb-loading"><div class="bb-spinner"></div>Computing analytics…</div>`;

  try {
    const tickers = Object.keys(portfolio || {});
    if (tickers.length === 0) {
      container.innerHTML = `
        <div class="analytics-container">
          <div class="bb-empty">
            <svg class="bb-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <div class="bb-empty-title">No holdings to analyze</div>
            <div class="bb-empty-desc">Add stocks to your portfolio first</div>
          </div>
        </div>`;
      return;
    }

    // Fetch quotes
    const quotesData = await marketApi('/quotes', { tickers: tickers.join(',') });
    const quotes = quotesData?.quotes || {};

    // Fetch historical data (6 months) for volatility/beta
    const histData = await marketApi('/history', {
      tickers: tickers.join(','),
      period: '6mo'
    });
    const history = histData?.history || {};

    // Fetch S&P 500 history
    let sp500History = [];
    try {
      const spData = await marketApi('/sp500', { period: '6mo' });
      sp500History = spData?.sp500 || [];
    } catch (_) {}

    const metrics = computePortfolioMetrics(portfolio, quotes, history, sp500History);
    renderAnalyticsDashboard(container, metrics, quotes);

  } catch (e) {
    console.warn('[Bloomberg] analytics error:', e);
    container.innerHTML = `<div class="bb-error">Analytics unavailable: ${escHtml(e.message)}</div>`;
  }
}

function computePortfolioMetrics(port, quotes, history, sp500History) {
  const tickers = Object.keys(port);

  // --- Total value & cost ---
  let totalValue = 0;
  let totalCost  = 0;
  const holdingData = {};

  for (const ticker of tickers) {
    const lots  = (port[ticker]?.lots || []).filter(l => l.qty > 0);
    const quote = quotes[ticker] || {};
    const price = quote.price || 0;
    const shares= lots.reduce((s, l) => s + (l.qty || 0), 0);
    const cost  = lots.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0);
    const value = shares * price;
    totalValue += value;
    totalCost  += cost;

    holdingData[ticker] = {
      shares, cost, value,
      price, quote,
      return: value - cost,
      returnPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    };
  }

  const totalReturn    = totalValue - totalCost;
  const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;

  // --- Weights ---
  for (const ticker of tickers) {
    holdingData[ticker].weight = totalValue > 0
      ? holdingData[ticker].value / totalValue
      : 0;
  }

  // --- Daily returns for volatility ---
  const portfolioDailyReturns = computePortfolioDailyReturns(holdingData, history);

  // --- S&P 500 daily returns ---
  const sp500Returns = computeDailyReturns(
    (Array.isArray(sp500History) ? sp500History : sp500History?.close) || []
  );

  // --- Beta (weighted avg) ---
  const beta = computeWeightedBeta(holdingData, portfolioDailyReturns, sp500Returns);

  // --- Annualized volatility ---
  const vol = annualizedVolatility(portfolioDailyReturns);

  // --- Sharpe Ratio (rf = 5% / 252) ---
  const rfDaily   = 0.05 / 252;
  const meanDaily = portfolioDailyReturns.length > 0
    ? portfolioDailyReturns.reduce((a, b) => a + b, 0) / portfolioDailyReturns.length
    : 0;
  const stdDaily  = portfolioDailyReturns.length > 1
    ? Math.sqrt(portfolioDailyReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) /
                (portfolioDailyReturns.length - 1))
    : 0;
  const sharpe = stdDaily > 0 ? ((meanDaily - rfDaily) / stdDaily) * Math.sqrt(252) : 0;

  // --- Max Drawdown ---
  const maxDD = computeMaxDrawdown(portfolioDailyReturns);

  // --- S&P 500 return for same period ---
  const sp500PctReturn = sp500Returns.length > 0
    ? (sp500Returns.reduce((acc, r) => acc * (1 + r), 1) - 1) * 100
    : 0;

  // --- Sector allocation ---
  const sectorAlloc = computeSectorAllocation(holdingData, quotes);

  // --- Attribution (each holding's contribution) ---
  const attribution = tickers.map(t => ({
    ticker: t,
    weight:      holdingData[t].weight,
    returnPct:   holdingData[t].returnPct,
    contribution: holdingData[t].weight * holdingData[t].returnPct,
    value:        holdingData[t].value,
    return:       holdingData[t].return,
  })).sort((a, b) => b.contribution - a.contribution);

  // --- Diversification score (HHI based) ---
  const hhi = tickers.reduce((s, t) => s + holdingData[t].weight ** 2, 0);
  const numSectors = Object.keys(sectorAlloc).length;
  const divScore = Math.round(Math.max(0, Math.min(100,
    (1 - hhi) * 60 + Math.min(numSectors, 11) / 11 * 40
  )));

  // --- Stress tests ---
  const stressTests = [
    { scenario: 'Market -5%',  factor: -0.05  },
    { scenario: 'Market -10%', factor: -0.10  },
    { scenario: 'Market -20%', factor: -0.20  },
    { scenario: 'Market -30%', factor: -0.30  },
    { scenario: 'Market +10%', factor: +0.10  },
    { scenario: 'Market +20%', factor: +0.20  },
  ].map(st => ({
    ...st,
    impact: totalValue * beta * st.factor,
    impactPct: beta * st.factor * 100,
  }));

  return {
    totalValue, totalCost, totalReturn, totalReturnPct,
    sp500PctReturn,
    beta, vol, sharpe, maxDD,
    sectorAlloc,
    attribution,
    divScore, hhi, numSectors,
    stressTests,
    holdingData,
    portfolioDailyReturns,
  };
}

function computePortfolioDailyReturns(holdingData, history) {
  // Build a matrix of daily returns weighted by portfolio weight
  const tickers = Object.keys(holdingData);
  if (tickers.length === 0) return [];

  // Find shortest history
  let minLen = Infinity;
  for (const t of tickers) {
    const h = history[t];
    if (h && h.close) minLen = Math.min(minLen, h.close.length);
  }
  if (!isFinite(minLen) || minLen < 2) return [];

  const returns = [];
  for (let i = 1; i < minLen; i++) {
    let dayReturn = 0;
    for (const t of tickers) {
      const h = history[t];
      if (!h || !h.close || h.close[i] == null || h.close[i-1] == null) continue;
      const r = (h.close[i] - h.close[i-1]) / h.close[i-1];
      dayReturn += r * holdingData[t].weight;
    }
    returns.push(dayReturn);
  }
  return returns;
}

function computeDailyReturns(prices) {
  if (!prices || prices.length < 2) return [];
  const result = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] == null || prices[i-1] == null || prices[i-1] === 0) continue;
    result.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  return result;
}

function computeWeightedBeta(holdingData, portfolioReturns, sp500Returns) {
  if (portfolioReturns.length < 10 || sp500Returns.length < 10) return 1.0;
  const n = Math.min(portfolioReturns.length, sp500Returns.length);
  const pRet = portfolioReturns.slice(-n);
  const mRet = sp500Returns.slice(-n);
  const pMean = pRet.reduce((a, b) => a + b, 0) / n;
  const mMean = mRet.reduce((a, b) => a + b, 0) / n;
  const cov = pRet.reduce((s, r, i) => s + (r - pMean) * (mRet[i] - mMean), 0) / n;
  const varM = mRet.reduce((s, r) => s + (r - mMean) ** 2, 0) / n;
  return varM > 0 ? cov / varM : 1.0;
}

function annualizedVolatility(dailyReturns) {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

function computeMaxDrawdown(returns) {
  let peak = 1;
  let value = 1;
  let maxDD = 0;
  for (const r of returns) {
    value *= (1 + r);
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function computeSectorAllocation(holdingData, quotes) {
  // Use sector info from quotes if available, else use static mapping
  const sectorMap = {
    AAPL:'Technology', MSFT:'Technology', GOOGL:'Technology', GOOG:'Technology',
    META:'Technology', AMZN:'Consumer Disc.', TSLA:'Consumer Disc.',
    NVDA:'Technology', AMD:'Technology', INTC:'Technology',
    JPM:'Financials', BAC:'Financials', GS:'Financials', MS:'Financials',
    WFC:'Financials', C:'Financials', V:'Financials', MA:'Financials',
    JNJ:'Healthcare', PFE:'Healthcare', UNH:'Healthcare', ABBV:'Healthcare',
    MRK:'Healthcare', ABT:'Healthcare',
    XOM:'Energy', CVX:'Energy', COP:'Energy',
    HD:'Consumer Disc.', NKE:'Consumer Disc.', MCD:'Consumer Staples',
    PG:'Consumer Staples', KO:'Consumer Staples', PEP:'Consumer Staples',
    WMT:'Consumer Staples', COST:'Consumer Staples',
    BA:'Industrials', CAT:'Industrials', GE:'Industrials', MMM:'Industrials',
    VZ:'Communication', T:'Communication', CMCSA:'Communication', DIS:'Communication',
    NEE:'Utilities', DUK:'Utilities', SO:'Utilities',
    AMT:'Real Estate', PLD:'Real Estate', EQIX:'Real Estate',
    LIN:'Materials', APD:'Materials', NEM:'Materials',
    SPY:'Index', QQQ:'Index', DIA:'Index', IWM:'Index',
  };

  const sectors = {};
  for (const [ticker, data] of Object.entries(holdingData)) {
    const q = quotes[ticker] || {};
    const sector = q.sector || sectorMap[ticker] || 'Other';
    sectors[sector] = (sectors[sector] || 0) + data.value;
  }

  // Convert to percentages
  const total = Object.values(sectors).reduce((a, b) => a + b, 0);
  const result = {};
  for (const [s, v] of Object.entries(sectors)) {
    result[s] = { value: v, pct: total > 0 ? (v / total) * 100 : 0 };
  }
  return result;
}

function renderAnalyticsDashboard(container, metrics, quotes) {
  const {
    totalValue, totalCost, totalReturn, totalReturnPct,
    sp500PctReturn, beta, vol, sharpe, maxDD,
    sectorAlloc, attribution, divScore, numSectors,
    stressTests, holdingData
  } = metrics;

  const retCls   = totalReturn >= 0 ? 'positive' : 'negative';
  const retSign  = totalReturn >= 0 ? '+' : '';
  const sp500Cls = sp500PctReturn >= 0 ? 'positive' : 'negative';
  const alphaCls = (totalReturnPct - sp500PctReturn) >= 0 ? 'positive' : 'negative';
  const alpha    = totalReturnPct - sp500PctReturn;

  container.innerHTML = `
    <div class="analytics-container">
      <div class="analytics-header">
        <div class="analytics-title">Portfolio Analytics</div>
        <div class="analytics-subtitle">Risk-adjusted performance metrics & attribution</div>
      </div>

      <!-- KPI Row -->
      <div class="analytics-kpi-row">
        <div class="analytics-kpi-card">
          <div class="analytics-kpi-label">Total Value</div>
          <div class="analytics-kpi-value">$${fmtCompact(totalValue)}</div>
          <div class="analytics-kpi-sub">vs $${fmtCompact(totalCost)} cost</div>
        </div>
        <div class="analytics-kpi-card">
          <div class="analytics-kpi-label">Total Return</div>
          <div class="analytics-kpi-value ${retCls}">${retSign}$${fmtCompact(Math.abs(totalReturn))}</div>
          <div class="analytics-kpi-sub ${retCls}">${retSign}${totalReturnPct.toFixed(2)}%</div>
        </div>
        <div class="analytics-kpi-card">
          <div class="analytics-kpi-label">vs S&P 500</div>
          <div class="analytics-kpi-value ${sp500Cls}">${sp500PctReturn >= 0 ? '+' : ''}${sp500PctReturn.toFixed(2)}%</div>
          <div class="analytics-kpi-sub ${alphaCls}">Alpha: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%</div>
        </div>
        <div class="analytics-kpi-card">
          <div class="analytics-kpi-label">Div. Score</div>
          <div class="analytics-kpi-value">${divScore}</div>
          <div class="analytics-kpi-sub">${getDivGrade(divScore)} — ${numSectors} sectors</div>
        </div>
      </div>

      <!-- Risk Metrics -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Risk Metrics
        </div>
        <div class="risk-metrics-grid" id="analytics-risk-grid">
          ${renderRiskMetrics(metrics)}
        </div>
      </div>

      <!-- Benchmark Comparison -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Benchmark Comparison
        </div>
        <div id="analytics-benchmark">
          ${renderBenchmarkBars(totalReturnPct, sp500PctReturn)}
        </div>
      </div>

      <!-- Sector Allocation -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          Sector Allocation
        </div>
        <div id="analytics-sector"></div>
      </div>

      <!-- Performance Attribution -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Performance Attribution
        </div>
        <div id="analytics-attribution"></div>
      </div>

      <!-- Stress Tests -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          What-If Stress Tests
          <span style="font-size:9px;font-weight:400;color:var(--color-text-faint);margin-left:6px;">(using portfolio beta ${beta.toFixed(2)})</span>
        </div>
        <div class="stress-test-grid" id="analytics-stress"></div>
      </div>

      <!-- Diversification Details -->
      <div class="analytics-section">
        <div class="analytics-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Diversification Analysis
        </div>
        <div id="analytics-div-score"></div>
      </div>
    </div>`;

  // Render sector allocation donut
  renderSectorAllocation(document.getElementById('analytics-sector'), metrics);

  // Render attribution table
  renderPerformanceAttribution(document.getElementById('analytics-attribution'), metrics);

  // Render stress tests
  renderStressTests(document.getElementById('analytics-stress'), metrics);

  // Render diversification
  renderDiversificationScore(document.getElementById('analytics-div-score'), metrics);
}

function renderRiskMetrics(metrics) {
  const { beta, vol, sharpe, maxDD } = metrics;

  const items = [
    { label: 'Beta', value: beta.toFixed(2), desc: 'vs S&P 500 (6mo)' },
    { label: 'Ann. Volatility', value: vol.toFixed(1) + '%', desc: '6-month rolling' },
    { label: 'Sharpe Ratio', value: sharpe.toFixed(2), desc: 'RF rate 5%' },
    { label: 'Max Drawdown', value: '-' + maxDD.toFixed(1) + '%', desc: '6-month period' },
  ];

  return items.map(item => `
    <div class="risk-metric-item">
      <div class="risk-metric-label">${item.label}</div>
      <div class="risk-metric-value">${item.value}</div>
      <div class="risk-metric-desc">${item.desc}</div>
    </div>`).join('');
}

function renderBenchmarkBars(portfolioPct, sp500Pct) {
  const maxPct = Math.max(Math.abs(portfolioPct), Math.abs(sp500Pct), 1);
  const portBarPct = (Math.abs(portfolioPct) / maxPct * 100).toFixed(1);
  const sp500BarPct = (Math.abs(sp500Pct) / maxPct * 100).toFixed(1);
  const portColor   = portfolioPct >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
  const sp500Color  = sp500Pct   >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
  const portSign    = portfolioPct >= 0 ? '+' : '';
  const sp500Sign   = sp500Pct   >= 0 ? '+' : '';

  return `
    <div class="benchmark-bar-wrap">
      <div class="benchmark-bar-row">
        <div class="benchmark-bar-label">Your Portfolio</div>
        <div class="benchmark-bar-track">
          <div class="benchmark-bar-fill" style="width:${portBarPct}%;background:${portColor};"></div>
        </div>
        <div class="benchmark-bar-value" style="color:${portColor};">${portSign}${portfolioPct.toFixed(2)}%</div>
      </div>
      <div class="benchmark-bar-row">
        <div class="benchmark-bar-label">S&P 500</div>
        <div class="benchmark-bar-track">
          <div class="benchmark-bar-fill" style="width:${sp500BarPct}%;background:${sp500Color};"></div>
        </div>
        <div class="benchmark-bar-value" style="color:${sp500Color};">${sp500Sign}${sp500Pct.toFixed(2)}%</div>
      </div>
    </div>`;
}

function renderSectorAllocation(container, metrics) {
  if (!container) return;
  const { sectorAlloc, totalValue } = metrics;
  const sectors = Object.entries(sectorAlloc)
    .sort((a, b) => b[1].value - a[1].value);

  const SECTOR_COLORS = [
    '#4ECDC4','#5B9CF6','#A78BFA','#F5C542','#FF9F43',
    '#FF6B6B','#00D68F','#26C5F3','#FF7EB3','#6FCF97','#828DF8'
  ];

  // Render donut via Chart.js
  const wrapper = document.createElement('div');
  wrapper.className = 'sector-donut-wrapper';
  wrapper.innerHTML = `
    <div class="sector-donut-canvas-wrap">
      <canvas id="analytics-sector-donut"></canvas>
      <div class="sector-donut-center">
        <span class="sector-donut-center-value">$${fmtCompact(totalValue)}</span>
        <span class="sector-donut-center-label">Portfolio</span>
      </div>
    </div>
    <div class="sector-legend-list" id="analytics-sector-legend"></div>`;
  container.appendChild(wrapper);

  const canvas = document.getElementById('analytics-sector-donut');
  if (canvas) {
    destroyChart('sectorDonutChart');
    BB.sectorDonutChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: sectors.map(([s]) => s),
        datasets: [{
          data: sectors.map(([, v]) => v.pct),
          backgroundColor: sectors.map((_, i) => SECTOR_COLORS[i % SECTOR_COLORS.length]),
          borderWidth: 2,
          borderColor: '#161a1e',
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw.toFixed(1)}%`
            }
          }
        }
      }
    });
  }

  // Legend
  const legendEl = document.getElementById('analytics-sector-legend');
  if (legendEl) {
    legendEl.innerHTML = sectors.slice(0, 8).map(([name, data], i) => `
      <div class="sector-legend-item">
        <div class="sector-legend-dot" style="background:${SECTOR_COLORS[i % SECTOR_COLORS.length]};"></div>
        <span class="sector-legend-name">${name}</span>
        <span class="sector-legend-pct">${data.pct.toFixed(1)}%</span>
      </div>`).join('');
  }
}

function renderPerformanceAttribution(container, metrics) {
  if (!container) return;
  const { attribution } = metrics;
  const maxContrib = Math.max(...attribution.map(a => Math.abs(a.contribution)), 0.01);

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="attribution-table">
        <thead>
          <tr>
            <th>Stock</th>
            <th>Value</th>
            <th>Weight</th>
            <th>Return</th>
            <th>Contribution</th>
            <th>Bar</th>
          </tr>
        </thead>
        <tbody>
          ${attribution.map(a => {
            const retCls  = a.returnPct >= 0 ? 'positive' : 'negative';
            const contCls = a.contribution >= 0 ? 'positive' : 'negative';
            const barPct  = (Math.abs(a.contribution) / maxContrib * 100).toFixed(1);
            const barColor = a.contribution >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
            return `
              <tr>
                <td><span class="attribution-ticker-chip">${escHtml(a.ticker)}</span></td>
                <td>$${fmtCompact(a.value)}</td>
                <td>${(a.weight * 100).toFixed(1)}%</td>
                <td style="color:var(--color-${a.returnPct >= 0 ? 'positive' : 'negative'});">
                  ${a.returnPct >= 0 ? '+' : ''}${a.returnPct.toFixed(2)}%
                </td>
                <td style="color:var(--color-${a.contribution >= 0 ? 'positive' : 'negative'});">
                  ${a.contribution >= 0 ? '+' : ''}${a.contribution.toFixed(2)}%
                </td>
                <td class="attribution-bar-cell">
                  <div class="attr-bar-wrap">
                    <div class="attr-bar-track">
                      <div class="attr-bar-fill" style="width:${barPct}%;background:${barColor};"></div>
                    </div>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderStressTests(container, metrics) {
  if (!container) return;
  container.innerHTML = metrics.stressTests.map(st => {
    const isneg = st.impact < 0;
    const sign  = isneg ? '-' : '+';
    const cls   = isneg ? 'negative' : 'positive';
    return `
      <div class="stress-card">
        <div class="stress-card-scenario">${st.scenario}</div>
        <div class="stress-card-impact ${cls}">
          ${sign}$${fmtCompact(Math.abs(st.impact))}
        </div>
        <div class="stress-card-desc">${sign}${Math.abs(st.impactPct).toFixed(1)}% portfolio</div>
      </div>`;
  }).join('');
}

function renderDiversificationScore(container, metrics) {
  if (!container) return;
  const { divScore, hhi, numSectors, holdingData } = metrics;
  const grade = getDivGrade(divScore);
  const gradeColor = divScore >= 70 ? 'var(--color-positive)'
    : divScore >= 40 ? 'var(--color-warning)' : 'var(--color-negative)';

  const topHolding = Object.entries(holdingData)
    .sort((a, b) => b[1].value - a[1].value)[0];
  const topPct = topHolding ? (topHolding[1].weight * 100).toFixed(1) : 0;

  const wrap = document.createElement('div');
  wrap.className = 'diversification-score-wrap';
  wrap.innerHTML = `
    <div class="div-score-ring-wrap">
      <canvas id="analytics-div-ring" width="90" height="90"></canvas>
      <div class="div-score-center">
        <span class="div-score-num">${divScore}</span>
        <span class="div-score-label">/ 100</span>
      </div>
    </div>
    <div class="div-score-details">
      <div style="font-size:16px;font-weight:700;color:${gradeColor};margin-bottom:6px;">${grade}</div>
      <div class="div-score-detail-row">
        <span class="div-score-detail-label">Sectors</span>
        <span class="div-score-detail-value">${numSectors}</span>
      </div>
      <div class="div-score-detail-row">
        <span class="div-score-detail-label">Herfindahl Index</span>
        <span class="div-score-detail-value">${hhi.toFixed(3)}</span>
      </div>
      <div class="div-score-detail-row">
        <span class="div-score-detail-label">Largest Position</span>
        <span class="div-score-detail-value">${topPct}%</span>
      </div>
      <div class="div-score-detail-row">
        <span class="div-score-detail-label">Holdings</span>
        <span class="div-score-detail-value">${Object.keys(holdingData).length}</span>
      </div>
    </div>`;
  container.appendChild(wrap);

  // Draw the ring chart
  const canvas = document.getElementById('analytics-div-ring');
  if (canvas) {
    destroyChart('divScoreChart');
    BB.divScoreChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [divScore, 100 - divScore],
          backgroundColor: [gradeColor, 'rgba(255,255,255,0.05)'],
          borderWidth: 0,
          hoverOffset: 0,
        }]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 800, easing: 'easeOutQuart' },
      }
    });
  }
}

function getDivGrade(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Poor';
  return 'Concentrated';
}

// ============================================
// SECTION 6: GLOBAL NAVIGATION & VIEW SYSTEM
// ============================================

const BB_VIEWS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    external: true,  // Handled by existing app nav
    existingView: 'portfolio',
  },
  {
    id: 'market',
    label: 'Market',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
  },
  {
    id: 'charts',
    label: 'Charts',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  },
  {
    id: 'news',
    label: 'News',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/></svg>',
  },
  {
    id: 'screener',
    label: 'Screener',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    comingSoon: true,
  },
  {
    id: 'fundamentals',
    label: 'Fundamentals',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    comingSoon: true,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    comingSoon: true,
  },
];

function createBloombergNav() {
  // Find existing bottom nav
  const existingNav = document.querySelector('.bottom-nav');
  if (!existingNav) return null;

  // Create Bloomberg nav bar (replaces existing bottom nav conceptually, added below it)
  const nav = document.createElement('nav');
  nav.className = 'bloomberg-nav';
  nav.id = 'bloomberg-nav';
  nav.setAttribute('aria-label', 'Bloomberg navigation');

  nav.innerHTML = BB_VIEWS.map(v => `
    <button class="bloomberg-nav-item ${v.id === 'dashboard' ? 'active' : ''}"
            id="bb-nav-${v.id}"
            data-bbview="${v.id}"
            aria-label="${v.label}"
            ${v.comingSoon ? `title="${v.label} — Coming Soon"` : ''}>
      ${v.icon}
      <span>${v.label}</span>
      ${v.comingSoon ? '<span class="bloomberg-nav-badge" style="background:var(--color-warning);color:#0d0f11;">SOON</span>' : ''}
    </button>`).join('');

  // Wire up nav items
  nav.querySelectorAll('.bloomberg-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.dataset.bbview;
      if (viewId) showBloombergView(viewId);
    });
  });

  // Insert after existing bottom nav
  existingNav.parentNode.insertBefore(nav, existingNav.nextSibling);
  return nav;
}

function createBloombergContainer() {
  // Create the main Bloomberg content container
  const mainContent = document.querySelector('.main-content');
  if (!mainContent || document.getElementById('bloomberg-container')) return;

  const container = document.createElement('div');
  container.id = 'bloomberg-container';
  container.style.display = 'none'; // Hidden until a Bloomberg view is shown

  // Create all view divs
  const views = BB_VIEWS.filter(v => !v.external);
  container.innerHTML = views.map(v => `
    <div class="bloomberg-view" id="bb-${v.id}-view">
      ${v.comingSoon ? `
        <div class="bb-empty" style="padding:60px 20px;">
          ${v.icon.replace('stroke-width="2"', 'width="40" height="40" style="opacity:0.3;margin:0 auto 12px;"')}
          <div class="bb-empty-title">${v.label}</div>
          <div class="bb-empty-desc">Coming in Part 2 — stay tuned</div>
        </div>` : ''}
    </div>`).join('');

  // Insert before the main-content (but after the app shell) — actually inside app shell
  const appShell = document.querySelector('.app-shell');
  const bottomNav = document.querySelector('.bottom-nav');
  if (appShell && bottomNav) {
    appShell.insertBefore(container, bottomNav);
  }
}

async function showBloombergView(viewId) {
  const view = BB_VIEWS.find(v => v.id === viewId);
  if (!view) return;

  // Update nav active state
  document.querySelectorAll('.bloomberg-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bbview === viewId);
  });

  // Also update existing bottom nav for Dashboard
  const existingNav = document.querySelector('.bottom-nav');

  if (view.external) {
    // Show existing app view, hide bloomberg container
    const bbContainer = document.getElementById('bloomberg-container');
    const mainContent = document.querySelector('.main-content');
    if (bbContainer) bbContainer.style.display = 'none';
    if (mainContent) mainContent.style.display = '';

    // Click the corresponding existing nav item
    if (view.existingView) {
      const existingBtn = document.querySelector(`.bottom-nav .nav-item[data-view="${view.existingView}"]`);
      if (existingBtn) existingBtn.click();
    }
    BB.activeView = viewId;
    return;
  }

  // Hide main-content, show bloomberg container
  const mainContent = document.querySelector('.main-content');
  const bbContainer = document.getElementById('bloomberg-container');
  if (mainContent) mainContent.style.display = 'none';
  if (bbContainer) bbContainer.style.display = 'block';

  // Hide all bloomberg views, show selected
  document.querySelectorAll('.bloomberg-view').forEach(v => v.classList.remove('active'));
  const targetView = document.getElementById(`bb-${viewId}-view`);
  if (targetView) targetView.classList.add('active');

  BB.activeView = viewId;

  // Lazy-load content for each view
  if (!view.comingSoon) {
    await loadBloombergViewContent(viewId, targetView);
  }
}

async function loadBloombergViewContent(viewId, viewEl) {
  // Only load if not already loaded (check for sentinel)
  if (viewEl.dataset.loaded === '1') return;

  switch (viewId) {
    case 'market':
      await showHeatmap(viewEl);
      viewEl.dataset.loaded = '1';
      break;

    case 'charts':
      renderChartsView(viewEl);
      viewEl.dataset.loaded = '1';
      break;

    case 'news':
      renderNewsView(viewEl);
      viewEl.dataset.loaded = '1';
      break;

    case 'analytics':
      await showPortfolioAnalytics();
      viewEl.dataset.loaded = '1';
      break;
  }
}

// Force reload a view (e.g. after portfolio changes)
function invalidateBloombergView(viewId) {
  const viewEl = document.getElementById(`bb-${viewId}-view`);
  if (viewEl) {
    viewEl.dataset.loaded = '0';
    // Clear content if view is active
    if (BB.activeView === viewId) {
      loadBloombergViewContent(viewId, viewEl);
    }
  }
}

// ============================================
// SECTION 7: UTILITY FUNCTIONS
// ============================================

function fmtPrice(n, decimals) {
  if (n == null || isNaN(n)) return '--';
  const d = decimals != null ? decimals : (Math.abs(n) < 10 ? 2 : (Math.abs(n) < 1000 ? 2 : 2));
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtCompact(n) {
  if (n == null || isNaN(n)) return '--';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + abs.toFixed(2);
}

function getTimeAgo(isoString) {
  const date = new Date(isoString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)  return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function destroyChart(chartRef) {
  if (BB[chartRef]) {
    try { BB[chartRef].destroy(); } catch (_) {}
    BB[chartRef] = null;
  }
}

// ============================================
// SECTION 8: INIT FUNCTION
// ============================================

function initBloomberg() {
  // 1. Inject bloomberg.css if not already present
  injectBloombergCSS();

  // 2. Create the Bloomberg container div in the DOM
  createBloombergContainer();

  // 3. Create the Bloomberg navigation bar
  createBloombergNav();

  // 4. Initialize market monitor (indices ticker bar)
  initMarketMonitor();

  // 5. Initialize alerts from localStorage
  initAlerts();

  // 6. Sync existing nav — when user clicks existing Portfolio/Charts/News/Insights/Watchlist,
  //    deactivate Bloomberg nav items
  syncExistingNav();

  // 7. Request notification permission for alerts
  if ('Notification' in window && Notification.permission === 'default') {
    // Don't prompt immediately — wait for user to create an alert
  }

  console.log('[Bloomberg] Module initialized ✓');
}

function injectBloombergCSS() {
  if (document.getElementById('bloomberg-css')) return;
  const link = document.createElement('link');
  link.id = 'bloomberg-css';
  link.rel = 'stylesheet';
  link.href = './bloomberg.css';
  document.head.appendChild(link);
}

function syncExistingNav() {
  // When existing bottom nav items are clicked, deactivate Bloomberg nav
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      // Show main content, hide Bloomberg container
      const mainContent = document.querySelector('.main-content');
      const bbContainer = document.getElementById('bloomberg-container');
      if (mainContent) mainContent.style.display = '';
      if (bbContainer) bbContainer.style.display = 'none';

      // Deactivate all Bloomberg nav items, activate Dashboard
      document.querySelectorAll('.bloomberg-nav-item').forEach(b => {
        b.classList.toggle('active', b.dataset.bbview === 'dashboard');
      });
      BB.activeView = 'dashboard';
    });
  });
}

// ============================================
// SECTION 9: EXPOSE GLOBALS FOR HTML ONCLICK
// ============================================
// These functions are called from inline onclick handlers in generated HTML.
// We assign them to window to ensure they are accessible.

window.loadTechnicalChart   = loadTechnicalChart;
window.onTechPeriodChange   = onTechPeriodChange;
window.onChartTypeChange    = onChartTypeChange;
window.toggleIndicatorDropdown = toggleIndicatorDropdown;
window.toggleIndicator      = toggleIndicator;
window.closeSubPanel        = closeSubPanel;
window.setNewsTicker        = setNewsTicker;
window.toggleNewsItem       = toggleNewsItem;
window.createAlertFromForm  = createAlertFromForm;
window.deleteAlert          = deleteAlert;
window.onHeatmapCellClick   = onHeatmapCellClick;
window.showBloombergView    = showBloombergView;
window.invalidateBloombergView = invalidateBloombergView;
window.initBloomberg        = initBloomberg;
