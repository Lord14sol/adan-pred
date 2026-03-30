// ── Kalshi API Adapter for ADAN-PRED ─────────────────────────────────────────
// Paper trading only — fetches real market data from Kalshi for training
// Polymarket remains untouched as primary source

const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

// Crypto series on Kalshi
const CRYPTO_SERIES = [
  { series: 'KXBTC', asset: 'btc', type: 'range', name: 'Bitcoin Range' },
  { series: 'KXBTCD', asset: 'btc', type: 'direction', name: 'Bitcoin Direction' },
  { series: 'KXETH', asset: 'eth', type: 'range', name: 'Ethereum Range' },
  { series: 'KXETHD', asset: 'eth', type: 'direction', name: 'Ethereum Direction' },
  { series: 'KXSOLD', asset: 'sol', type: 'direction', name: 'SOL Direction' },
];

async function kalshiFetch(endpoint) {
  try {
    const r = await fetch(KALSHI_API + endpoint, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Fetch all open crypto events from Kalshi ────────────────────────────────
async function fetchKalshiMarkets() {
  const all = [];
  const seen = new Set();

  await Promise.all(CRYPTO_SERIES.map(async ({ series, asset, type }) => {
    const data = await kalshiFetch(`/events?limit=20&status=open&series_ticker=${series}`);
    const events = data?.events || [];

    for (const ev of events) {
      // Skip events too far out (>72h)
      const strikeMs = new Date(ev.strike_date).getTime();
      if (strikeMs - Date.now() > 72 * 3600 * 1000) continue;

      // Fetch nested markets for this event
      const evData = await kalshiFetch(`/events/${ev.event_ticker}?with_nested_markets=true`);
      const markets = evData?.event?.markets || [];

      for (const m of markets) {
        if (seen.has(m.ticker)) continue;
        seen.add(m.ticker);

        // Parse yes price from bid/ask
        const yesBid = parseFloat(m.yes_bid_dollars || '0');
        const yesAsk = parseFloat(m.yes_ask_dollars || '0');
        const lastPrice = parseFloat(m.last_price_dollars || '0');
        const yesPrice = lastPrice > 0 ? lastPrice : (yesBid + yesAsk) / 2 || 0.5;

        // Skip already-decided markets
        if (yesPrice >= 0.95 || yesPrice <= 0.05) continue;

        // Build normalized market object (compatible with ADAN's internal format)
        const floor = m.floor_strike || 0;
        const cap = m.cap_strike || 0;
        const subtitle = m.subtitle || '';
        const strikeLabel = cap ? `$${Math.round(floor)}-$${Math.round(cap)}` : subtitle;

        const normalized = {
          id: m.ticker,
          title: `${ev.title} ${strikeLabel}`.trim(),
          yesPrice,
          liquidity: parseFloat(m.liquidity_dollars || '0'),
          closesAt: m.close_time || ev.strike_date,
          asset,
          targetPrice: cap || floor || null,
          roughEdge: null, // Will be calculated downstream
          priceData: null, // Will be injected by adan-pred
          windowMin: null, // Calculated below
          _isUpDown: type === 'direction',
          _isKalshi: true,
          _kalshiTicker: m.ticker,
          _kalshiEvent: ev.event_ticker,
          _kalshiType: type,
          _category: 'crypto',
          clobTokenIds: null,
        };

        // Calculate window from event frequency
        const hoursToClose = (strikeMs - Date.now()) / 3600000;
        if (hoursToClose <= 0.5) normalized.windowMin = 15;
        else if (hoursToClose <= 2) normalized.windowMin = 60;
        else if (hoursToClose <= 6) normalized.windowMin = 240;
        else normalized.windowMin = 1440;

        all.push(normalized);
      }
    }
  }));

  // Sort by closest to expiry first
  all.sort((a, b) => new Date(a.closesAt) - new Date(b.closesAt));

  console.log(`[KALSHI] Fetched ${all.length} crypto markets (BTC/ETH/SOL)`);
  return all;
}

// ── Check if a Kalshi market has resolved ───────────────────────────────────
async function checkKalshiResolution(ticker) {
  try {
    // Extract series from ticker (e.g., KXBTCD-26MAR1721-T64000 -> KXBTCD)
    const seriesMatch = ticker.match(/^(KX\w+?)-/);
    if (!seriesMatch) return null;
    const series = seriesMatch[1];

    const data = await kalshiFetch(`/markets/${ticker}`);
    if (!data) return null;

    const m = data.market || data;
    if (!m) return null;
    return {
      resolved: m.result !== '' && m.result != null,
      resolution: m.result === 'yes' ? 'YES' : m.result === 'no' ? 'NO' : null,
      resolvedAt: m.expiration_time || null,
      closed: m.status === 'closed' || m.status === 'settled' || m.status === 'finalized',
    };
  } catch { return null; }
}

export { fetchKalshiMarkets, checkKalshiResolution, kalshiFetch, KALSHI_API };
