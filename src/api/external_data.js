// src/api/external_data.js
// ADAN v4.1 — External Data Sources for Non-Crypto Categories
// Google News RSS, ESPN, FRED, Hacker News, GDELT, Polygon.io
// GDELT + Google News = free, no auth. FRED + Polygon = free tier with key.

const RSS_BASE = 'https://news.google.com/rss/search?q=';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
const POLYGON_BASE = 'https://api.polygon.io';

// ── Helper: fetch with timeout ──────────────────────────────────────────────
async function safeFetch(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json, text/xml, */*' }
    });
    if (!r.ok) return null;
    return r;
  } catch { return null; }
}

// ── Parse RSS XML to extract titles (lightweight, no XML parser needed) ─────
function parseRssTitles(xml, limit = 5) {
  const items = [];
  const re = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<\/item>/gi;
  let match;
  while ((match = re.exec(xml)) !== null && items.length < limit) {
    items.push(match[1].trim());
  }
  // Fallback: try without CDATA
  if (items.length === 0) {
    const re2 = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/item>/gi;
    while ((match = re2.exec(xml)) !== null && items.length < limit) {
      items.push(match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
    }
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GDELT DOC 2.0 API — Global event monitoring + tone analysis (FREE, no auth)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch GDELT articles + average tone for a query
 * Returns { articles: [{title, tone, domain, date}], avgTone, volume }
 */
async function fetchGDELT(query, maxRecords = 10) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `${GDELT_BASE}?query=${encoded}&mode=artlist&maxrecords=${maxRecords}&format=json&sort=datedesc`;
    const r = await safeFetch(url, 10000); // GDELT can be slow
    if (!r) return null;

    const data = await r.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title || '',
      tone: parseFloat(a.tone) || 0, // negative = bad, positive = good
      domain: a.domain || '',
      date: a.seendate || '',
      language: a.language || 'English',
    }));

    if (articles.length === 0) return null;

    const tones = articles.map(a => a.tone);
    const avgTone = tones.reduce((s, t) => s + t, 0) / tones.length;

    return {
      articles,
      avgTone: parseFloat(avgTone.toFixed(2)),
      volume: articles.length,
      sentiment: avgTone > 2 ? 'VERY_POSITIVE' : avgTone > 0.5 ? 'POSITIVE' : avgTone < -2 ? 'VERY_NEGATIVE' : avgTone < -0.5 ? 'NEGATIVE' : 'NEUTRAL',
    };
  } catch { return null; }
}

/**
 * Format GDELT data into context string for LLM children
 */
function formatGDELTContext(gdeltData, label = 'Global') {
  if (!gdeltData) return '';

  let ctx = `\n${label} Sentiment Analysis (GDELT — ${gdeltData.volume} articles):\n`;
  ctx += `- Average Tone: ${gdeltData.avgTone} (${gdeltData.sentiment})\n`;

  // Top 5 articles with tone
  const top = gdeltData.articles.slice(0, 5);
  for (const a of top) {
    const toneIcon = a.tone > 1 ? '+' : a.tone < -1 ? '-' : '~';
    ctx += `  [${toneIcon}${a.tone.toFixed(1)}] ${a.title.slice(0, 80)}\n`;
  }

  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLYGON.IO — Stocks, earnings, company data (FREE tier, needs API key)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch stock ticker data from Polygon.io
 * Returns { price, change, changePct, volume, prevClose }
 */
async function fetchPolygonTicker(ticker) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return null;

  try {
    const r = await safeFetch(
      `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`
    );
    if (!r) return null;
    const data = await r.json();
    const result = data.results?.[0];
    if (!result) return null;

    return {
      ticker,
      close: result.c,
      open: result.o,
      high: result.h,
      low: result.l,
      volume: result.v,
      change: parseFloat((result.c - result.o).toFixed(2)),
      changePct: parseFloat(((result.c - result.o) / result.o * 100).toFixed(2)),
    };
  } catch { return null; }
}

/**
 * Fetch recent news for a ticker from Polygon.io
 */
async function fetchPolygonNews(ticker, limit = 5) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return null;

  try {
    const r = await safeFetch(
      `${POLYGON_BASE}/v2/reference/news?ticker=${ticker}&limit=${limit}&apiKey=${apiKey}`
    );
    if (!r) return null;
    const data = await r.json();
    return (data.results || []).map(n => ({
      title: n.title || '',
      publisher: n.publisher?.name || '',
      date: n.published_utc || '',
    }));
  } catch { return null; }
}

// Stock ticker detection from market title
const TICKER_PATTERNS = {
  // Tech
  apple: 'AAPL', aapl: 'AAPL', iphone: 'AAPL',
  google: 'GOOGL', googl: 'GOOGL', alphabet: 'GOOGL',
  microsoft: 'MSFT', msft: 'MSFT',
  amazon: 'AMZN', amzn: 'AMZN',
  tesla: 'TSLA', tsla: 'TSLA', elon: 'TSLA',
  nvidia: 'NVDA', nvda: 'NVDA',
  meta: 'META', facebook: 'META',
  netflix: 'NFLX', nflx: 'NFLX',
  // Finance
  'jpmorgan': 'JPM', 'goldman': 'GS',
  // Misc
  disney: 'DIS', boeing: 'BA', intel: 'INTC',
  amd: 'AMD', coinbase: 'COIN', robinhood: 'HOOD',
};

function detectTicker(marketTitle) {
  const text = (marketTitle || '').toLowerCase();
  for (const [keyword, ticker] of Object.entries(TICKER_PATTERNS)) {
    if (text.includes(keyword)) return ticker;
  }
  // Try to find $TICKER pattern
  const tickerMatch = marketTitle?.match(/\$([A-Z]{2,5})/);
  if (tickerMatch) return tickerMatch[1];
  return null;
}

/**
 * Format Polygon data into context string
 */
function formatPolygonContext(tickerData, newsData) {
  if (!tickerData && (!newsData || newsData.length === 0)) return '';

  let ctx = '';
  if (tickerData) {
    const dir = tickerData.changePct >= 0 ? '+' : '';
    ctx += `\nStock Data (${tickerData.ticker}):\n`;
    ctx += `- Last Close: $${tickerData.close} (${dir}${tickerData.changePct}%)\n`;
    ctx += `- Range: $${tickerData.low} - $${tickerData.high} | Volume: ${(tickerData.volume / 1e6).toFixed(1)}M\n`;
  }
  if (newsData && newsData.length > 0) {
    ctx += `Recent ${newsData[0]?.ticker || ''} News:\n`;
    for (const n of newsData.slice(0, 3)) {
      ctx += `- ${n.title.slice(0, 80)} (${n.publisher})\n`;
    }
  }
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY CONTEXT FETCHERS (upgraded with GDELT + Polygon)
// ═══════════════════════════════════════════════════════════════════════════════

// ── POLITICS: Google News RSS + GDELT tone analysis ─────────────────────────
async function fetchPoliticsContext(marketTitle) {
  const keywords = extractKeywords(marketTitle, ['election', 'president', 'trump', 'biden', 'congress', 'senate', 'vote', 'tariff', 'poll', 'supreme', 'court', 'governor']);
  const query = keywords.join('+') || 'US politics election';

  // Parallel: Google News + GDELT
  const [rssResult, gdeltData] = await Promise.all([
    (async () => {
      const r = await safeFetch(`${RSS_BASE}${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
      if (!r) return '';
      const xml = await r.text();
      const titles = parseRssTitles(xml, 5);
      if (titles.length === 0) return '';
      return `Recent politics headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    })(),
    fetchGDELT(query + ' politics', 15),
  ]);

  let context = rssResult || '';
  context += formatGDELTContext(gdeltData, 'Political');

  return context || 'No politics context available.';
}

// ── SPORTS: ESPN Public API + Google News + GDELT ────────────────────────────
const SPORT_MAP = {
  nfl: { sport: 'football', league: 'nfl' },
  nba: { sport: 'basketball', league: 'nba' },
  mlb: { sport: 'baseball', league: 'mlb' },
  nhl: { sport: 'hockey', league: 'nhl' },
  soccer: { sport: 'soccer', league: 'eng.1' },
  mma: { sport: 'mma', league: 'ufc' },
};

async function fetchSportsContext(marketTitle) {
  const text = (marketTitle || '').toLowerCase();

  // Try to detect which sport
  let sportKey = null;
  for (const [key] of Object.entries(SPORT_MAP)) {
    if (text.includes(key)) { sportKey = key; break; }
  }
  // Broader detection
  if (!sportKey) {
    if (/football|super bowl/.test(text)) sportKey = 'nfl';
    else if (/basketball/.test(text)) sportKey = 'nba';
    else if (/baseball/.test(text)) sportKey = 'mlb';
    else if (/hockey/.test(text)) sportKey = 'nhl';
    else if (/soccer|world cup|premier league|champions league/.test(text)) sportKey = 'soccer';
    else if (/ufc|boxing|mma/.test(text)) sportKey = 'mma';
  }

  let context = '';

  // ESPN scoreboard if sport detected
  if (sportKey && SPORT_MAP[sportKey]) {
    const { sport, league } = SPORT_MAP[sportKey];
    const r = await safeFetch(`${ESPN_BASE}/${sport}/${league}/scoreboard`);
    if (r) {
      try {
        const data = await r.json();
        const events = (data.events || []).slice(0, 5);
        if (events.length > 0) {
          context += `Recent ${sportKey.toUpperCase()} games:\n`;
          for (const ev of events) {
            const name = ev.name || ev.shortName || 'Game';
            const status = ev.status?.type?.shortDetail || '';
            context += `- ${name} ${status}\n`;
          }
        }
      } catch { /* parse error */ }
    }
  }

  // Google News for broader context
  const keywords = extractKeywords(marketTitle, ['nfl', 'nba', 'mlb', 'nhl', 'soccer', 'ufc', 'championship', 'playoffs']);
  const query = encodeURIComponent(keywords.join('+') || 'sports');
  const r2 = await safeFetch(`${RSS_BASE}${query}&hl=en-US&gl=US&ceid=US:en`);
  if (r2) {
    const xml = await r2.text();
    const titles = parseRssTitles(xml, 3);
    if (titles.length > 0) {
      context += `\nSports headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    }
  }

  return context || 'No sports context available.';
}

// ── MACRO: FRED API + Google News + GDELT tone ───────────────────────────────
async function fetchMacroContext(marketTitle) {
  const fredKey = process.env.FRED_API_KEY;
  let context = '';

  // Detect which macro indicator
  const text = (marketTitle || '').toLowerCase();
  let seriesId = null;
  if (/cpi|inflation/.test(text)) seriesId = 'CPIAUCSL';
  else if (/unemployment|jobs|nonfarm|payroll/.test(text)) seriesId = 'UNRATE';
  else if (/gdp/.test(text)) seriesId = 'GDP';
  else if (/fed|interest rate|fomc/.test(text)) seriesId = 'FEDFUNDS';
  else if (/housing|home/.test(text)) seriesId = 'HOUST';
  else if (/retail/.test(text)) seriesId = 'RSXFS';

  const keywords = extractKeywords(marketTitle, ['fed', 'inflation', 'cpi', 'gdp', 'unemployment', 'interest rate', 'fomc', 'recession', 'tariff', 'trade']);
  const query = keywords.join('+') || 'economy macro';

  // Parallel: FRED + Google News + GDELT
  const [fredCtx, rssCtx, gdeltData] = await Promise.all([
    // FRED data
    (async () => {
      if (!fredKey || !seriesId) return '';
      const r = await safeFetch(
        `${FRED_BASE}?series_id=${seriesId}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=5`
      );
      if (!r) return '';
      try {
        const data = await r.json();
        const obs = (data.observations || []).slice(0, 5);
        if (obs.length === 0) return '';
        let ctx = `FRED ${seriesId} recent values:\n`;
        for (const o of obs) ctx += `- ${o.date}: ${o.value}\n`;
        // Calculate trend
        const vals = obs.map(o => parseFloat(o.value)).filter(v => !isNaN(v));
        if (vals.length >= 2) {
          const trend = ((vals[0] - vals[vals.length - 1]) / vals[vals.length - 1] * 100).toFixed(2);
          ctx += `- Trend: ${trend > 0 ? '+' : ''}${trend}% over ${vals.length} periods\n`;
        }
        return ctx;
      } catch { return ''; }
    })(),
    // Google News
    (async () => {
      const r = await safeFetch(`${RSS_BASE}${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
      if (!r) return '';
      const xml = await r.text();
      const titles = parseRssTitles(xml, 5);
      if (titles.length === 0) return '';
      return `\nMacro headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    })(),
    // GDELT tone
    fetchGDELT(query + ' economy', 15),
  ]);

  context = fredCtx + rssCtx;
  context += formatGDELTContext(gdeltData, 'Economic');

  return context || 'No macro context available.';
}

// ── EVENTS: Hacker News + Google News + GDELT + Polygon ──────────────────────
async function fetchEventsContext(marketTitle) {
  const ticker = detectTicker(marketTitle);
  const keywords = extractKeywords(marketTitle, ['launch', 'spacex', 'oscar', 'iphone', 'earnings', 'ipo', 'netflix', 'weather', 'ai', 'openai']);
  const query = keywords.join('+') || 'tech events';

  // Parallel: HN + Google News + GDELT + Polygon (if ticker found)
  const [hnCtx, rssCtx, gdeltData, polygonTicker, polygonNews] = await Promise.all([
    // Hacker News
    (async () => {
      const r = await safeFetch(`${HN_BASE}/topstories.json`);
      if (!r) return '';
      try {
        const ids = (await r.json()).slice(0, 10);
        const stories = await Promise.all(
          ids.slice(0, 5).map(async id => {
            const sr = await safeFetch(`${HN_BASE}/item/${id}.json`);
            if (!sr) return null;
            const s = await sr.json();
            return s?.title || null;
          })
        );
        const valid = stories.filter(Boolean);
        if (valid.length === 0) return '';
        return `Top Hacker News:\n${valid.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`;
      } catch { return ''; }
    })(),
    // Google News
    (async () => {
      const r = await safeFetch(`${RSS_BASE}${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
      if (!r) return '';
      const xml = await r.text();
      const titles = parseRssTitles(xml, 5);
      if (titles.length === 0) return '';
      return `\nEvent headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    })(),
    // GDELT
    fetchGDELT(query, 10),
    // Polygon ticker data
    ticker ? fetchPolygonTicker(ticker) : Promise.resolve(null),
    // Polygon news
    ticker ? fetchPolygonNews(ticker, 3) : Promise.resolve(null),
  ]);

  let context = hnCtx + rssCtx;
  context += formatGDELTContext(gdeltData, 'Event');
  context += formatPolygonContext(polygonTicker, polygonNews);

  return context || 'No events context available.';
}

// ── EARNINGS: Specialized Polygon.io context for stock/earnings markets ──────
async function fetchEarningsContext(marketTitle) {
  const ticker = detectTicker(marketTitle);
  let context = '';

  if (ticker) {
    const [tickerData, newsData] = await Promise.all([
      fetchPolygonTicker(ticker),
      fetchPolygonNews(ticker, 5),
    ]);
    context += formatPolygonContext(tickerData, newsData);
  }

  // GDELT for broader company/earnings sentiment
  const keywords = extractKeywords(marketTitle, ['earnings', 'revenue', 'stock', 'share', 'quarterly', 'profit', 'loss']);
  const query = keywords.join('+') || marketTitle;
  const gdeltData = await fetchGDELT(query + ' earnings stock', 10);
  context += formatGDELTContext(gdeltData, 'Earnings');

  // Google News fallback
  const r = await safeFetch(`${RSS_BASE}${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
  if (r) {
    const xml = await r.text();
    const titles = parseRssTitles(xml, 3);
    if (titles.length > 0) {
      context += `\nEarnings headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    }
  }

  return context || 'No earnings context available.';
}

// ── Router: fetch context by category ───────────────────────────────────────
async function fetchContextForCategory(category, marketTitle) {
  // Auto-detect if this is an earnings/stock market regardless of category
  const ticker = detectTicker(marketTitle);
  const isEarnings = /earnings|revenue|stock price|share/i.test(marketTitle || '');

  if (ticker && isEarnings) return fetchEarningsContext(marketTitle);

  switch (category) {
    case 'politics': return fetchPoliticsContext(marketTitle);
    case 'sports':   return fetchSportsContext(marketTitle);
    case 'macro':    return fetchMacroContext(marketTitle);
    case 'events':   return fetchEventsContext(marketTitle);
    default:         return fetchEventsContext(marketTitle);
  }
}

// ── Extract relevant keywords from market title ─────────────────────────────
function extractKeywords(title, seedWords) {
  const words = (title || '').toLowerCase().split(/[\s,\-?!.]+/).filter(w => w.length > 2);
  const relevant = words.filter(w => seedWords.some(s => w.includes(s)));
  if (relevant.length > 0) return relevant.slice(0, 4);
  // Fallback: use longest meaningful words from title
  return words
    .filter(w => !['the', 'will', 'and', 'for', 'this', 'that', 'with', 'from', 'have', 'are', 'was', 'been'].includes(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

export const externalData = {
  fetchPoliticsContext,
  fetchSportsContext,
  fetchMacroContext,
  fetchEventsContext,
  fetchEarningsContext,
  fetchContextForCategory,
  // Expose raw fetchers for direct use
  fetchGDELT,
  fetchPolygonTicker,
  fetchPolygonNews,
  detectTicker,
};
