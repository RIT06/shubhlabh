/**
 * ShubhLabh Live Crypto Interactive Chart Widget & Conversions
 * Uses Binance Klines API for historical hourly trend prices.
 * Uses Binance Ticker API for live price and 24h stats.
 * Uses Coinbase Exchange Rates API for fiat calculations.
 */

(function () {
  'use strict';

  // State variables
  let activeCoin = 'BTC';
  let chart = null;

  const coinColors = {
    BTC: '#FCD535',
    ETH: '#627EEA',
    SOL: '#14F195'
  };

  const currencyMapping = {
    'USDT': 'USD',
    'EURO': 'EUR'
  };

  // Cache configuration
  const CACHE_EXPIRY_MS = 60000; // 60 seconds

  /**
   * Helper to format crypto prices nicely
   */
  function formatPrice(value, symbol) {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    if (num < 1) {
      return num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    } else {
      return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  /**
   * Fetch 24h klines (candlestick data) from Binance
   */
  async function fetchKlines(coin) {
    const symbol = coin === 'USDT' ? 'BTCUSDT' : `${coin}USDT`;
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch klines for ${coin}`);
    const data = await response.json();
    return data.map(item => [
      parseInt(item[0]), // Open time timestamp
      parseFloat(item[4]) // Close price
    ]);
  }

  /**
   * Fetch 24h ticker statistics from Binance
   */
  async function fetchTickerStats(coin) {
    const symbol = coin === 'USDT' ? 'BTCUSDT' : `${coin}USDT`;
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ticker for ${coin}`);
    const data = await response.json();
    return {
      price: parseFloat(data.lastPrice),
      changePercent: parseFloat(data.priceChangePercent),
      high: parseFloat(data.highPrice),
      low: parseFloat(data.lowPrice)
    };
  }

  /**
   * Fetch Coinbase fiat rates relative to USD
   */
  async function fetchCoinbaseData() {
    const url = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch Coinbase rates');
    const json = await response.json();
    return json.data.rates;
  }

  /**
   * Initialize ApexCharts
   */
  function initChart(dataPoints, color) {
    const options = {
      series: [{
        name: 'Price (USD)',
        data: dataPoints
      }],
      chart: {
        type: 'area',
        height: 250,
        toolbar: { show: false },
        sparkline: { enabled: false },
        animations: { enabled: true }
      },
      colors: [color],
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.45,
          opacityTo: 0.05,
          stops: [0, 100]
        }
      },
      stroke: {
        curve: 'smooth',
        width: 2
      },
      dataLabels: { enabled: false },
      grid: {
        borderColor: 'rgba(255,255,255,0.06)',
        strokeDashArray: 3,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } }
      },
      xaxis: {
        type: 'datetime',
        labels: {
          style: { colors: 'rgba(255,255,255,0.6)', fontFamily: 'inherit' },
          datetimeUTC: false
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          style: { colors: 'rgba(255,255,255,0.6)', fontFamily: 'inherit' },
          formatter: (val) => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
      },
      tooltip: {
        theme: 'dark',
        x: { format: 'dd MMM HH:mm' }
      }
    };

    const container = document.querySelector("#live-crypto-chart");
    if (container) {
      chart = new ApexCharts(container, options);
      chart.render();
    }
  }

  /**
   * Update stats header UI
   */
  function updateStatsUI(coin, stats) {
    const priceEl = document.querySelector('#widget-live-price');
    const changeEl = document.querySelector('#widget-price-change');
    const highEl = document.querySelector('#widget-price-high');
    const lowEl = document.querySelector('#widget-price-low');

    if (priceEl) priceEl.textContent = '$' + formatPrice(stats.price, coin);
    if (highEl) highEl.textContent = '$' + formatPrice(stats.high, coin);
    if (lowEl) lowEl.textContent = '$' + formatPrice(stats.low, coin);

    if (changeEl) {
      const sign = stats.changePercent >= 0 ? '+' : '';
      changeEl.textContent = `${sign}${stats.changePercent.toFixed(2)}%`;
      
      changeEl.style.color = stats.changePercent >= 0 ? '#14F195' : '#FF5B5B'; // Neon Green vs Red
    }
  }

  /**
   * Update the conversion cards grid (BTC to fiat)
   */
  function updateConversionsUI(btcPrice, fiatData) {
    const cards = document.querySelectorAll('.conversation__single');
    cards.forEach(card => {
      const spans = card.querySelectorAll('.content-single span');
      if (spans.length >= 2) {
        const base = spans[0].textContent.trim(); // e.g. BTC
        let target = spans[1].textContent.trim(); // e.g. USDT, TRY, EURO, etc.
        const originalTargetSymbol = target;

        if (currencyMapping[target]) {
          target = currencyMapping[target];
        }

        let rate = null;
        if (base === 'BTC') {
          if (target === 'USD') {
            rate = btcPrice;
          } else if (fiatData[target]) {
            rate = btcPrice * parseFloat(fiatData[target]);
          }
        }

        if (rate !== null) {
          const pEl = card.querySelector('p');
          if (pEl) {
            pEl.textContent = `1 ${base} = ${formatPrice(rate, target)} ${originalTargetSymbol}`;
          }
        }
      }
    });
  }

  /**
   * Load coin data and render/update the widget
   */
  async function loadCoinData(coin, forceFetch = false) {
    const loader = document.querySelector('#chart-loader');
    if (loader) loader.style.display = 'block';

    const cacheKeyKlines = `shubhlabh_klines_${coin}`;
    const cacheKeyStats = `shubhlabh_stats_${coin}`;
    const cacheKeyTime = `shubhlabh_time_${coin}`;
    
    let klines = null;
    let stats = null;
    const now = Date.now();
    const cachedTime = sessionStorage.getItem(cacheKeyTime);

    if (!forceFetch && cachedTime && (now - parseInt(cachedTime)) < CACHE_EXPIRY_MS) {
      const cachedKlines = sessionStorage.getItem(cacheKeyKlines);
      const cachedStats = sessionStorage.getItem(cacheKeyStats);
      if (cachedKlines && cachedStats) {
        klines = JSON.parse(cachedKlines);
        stats = JSON.parse(cachedStats);
      }
    }

    try {
      if (!klines || !stats) {
        console.log(`[CryptoLive] Fetching live market data for ${coin}...`);
        const [freshKlines, freshStats] = await Promise.all([
          fetchKlines(coin),
          fetchTickerStats(coin)
        ]);
        klines = freshKlines;
        stats = freshStats;

        // Save cache
        sessionStorage.setItem(cacheKeyKlines, JSON.stringify(klines));
        sessionStorage.setItem(cacheKeyStats, JSON.stringify(stats));
        sessionStorage.setItem(cacheKeyTime, now.toString());
      }

      // Update UI Header Stats
      updateStatsUI(coin, stats);

      // Render or Update Chart
      const color = coinColors[coin] || '#FCD535';
      if (!chart) {
        initChart(klines, color);
      } else {
        chart.updateOptions({
          colors: [color]
        });
        chart.updateSeries([{
          name: 'Price (USD)',
          data: klines
        }]);
      }

      // Update the conversions grid using cached or fresh BTC price
      const btcCacheStats = sessionStorage.getItem('shubhlabh_stats_BTC');
      let btcPrice = null;
      if (btcCacheStats) {
        btcPrice = JSON.parse(btcCacheStats).price;
      } else if (coin === 'BTC') {
        btcPrice = stats.price;
      }

      if (btcPrice) {
        const cachedFiat = sessionStorage.getItem('shubhlabh_fiat_data');
        const cachedFiatTime = sessionStorage.getItem('shubhlabh_fiat_time');
        let fiatData = null;

        if (cachedFiatTime && (now - parseInt(cachedFiatTime)) < CACHE_EXPIRY_MS && cachedFiat) {
          fiatData = JSON.parse(cachedFiat);
        } else {
          try {
            fiatData = await fetchCoinbaseData();
            sessionStorage.setItem('shubhlabh_fiat_data', JSON.stringify(fiatData));
            sessionStorage.setItem('shubhlabh_fiat_time', now.toString());
          } catch (e) {
            console.error('[CryptoLive] Coinbase fetch failed, using cache if available', e);
            if (cachedFiat) fiatData = JSON.parse(cachedFiat);
          }
        }

        if (fiatData) {
          updateConversionsUI(btcPrice, fiatData);
        }
      }

    } catch (e) {
      console.error(`[CryptoLive] Error loading data for ${coin}:`, e);
    } finally {
      if (loader) loader.style.display = 'none';
    }
  }

  /**
   * Setup event listeners and tabs
   */
  function setupTabs() {
    const buttons = document.querySelectorAll('.coin-tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const symbol = btn.getAttribute('data-symbol');
        if (symbol === activeCoin) return;

        // Deactivate old tab
        buttons.forEach(b => {
          b.classList.remove('active');
          b.style.background = 'rgba(255,255,255,0.05)';
          b.style.border = '1px solid rgba(255,255,255,0.1)';
          b.style.color = '#fff';
        });

        // Activate new tab
        btn.classList.add('active');
        activeCoin = symbol;
        const color = coinColors[symbol];
        btn.style.background = color;
        btn.style.border = 'none';
        btn.style.color = '#1e1b39';

        // Load data
        loadCoinData(symbol);
      });
    });
  }

  // Initial trigger
  document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    // Load initial coin BTC
    loadCoinData(activeCoin);

    // Fetch update in background every 30 seconds for active coin
    setInterval(() => {
      loadCoinData(activeCoin, true);
    }, 30000);
  });

})();
