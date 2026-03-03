import { POLYMARKET_API } from '../core/config.js';

// ── Polymarket helpers ───────────────────────────────────────────────────────
async function polyFetch(endpoint) {
  try {
    const r = await fetch(POLYMARKET_API + endpoint, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Keywords that identify crypto price markets
const CRYPTO_RE = /bitcoin|ethereum|solana|btc|eth|sol|crypto|above|below|matic|avax|doge|shib|binance|bnb|ada|dot|link|uni|atom|near/i;

async function fetchPolymarkets(strat) {
  const hoursMax = strat.maxHoursToClose || 168;
  const nowMs = Date.now();
  const maxMs = nowMs + Math.max(hoursMax, 720) * 3600 * 1000;
  const seen = new Set();
  const all = [];

  // ── Priority 1: Live 5M/15M/1H/4H "Up or Down" markets — BTC, ETH, SOL ──
  // Fetch WITHOUT ordering to get ALL active events including live ones
  await Promise.all(['bitcoin', 'ethereum', 'solana'].map(async asset => {
    const data = await polyFetch(`/events?tag_slug=${asset}&limit=200&active=true&closed=false`);
    const events = Array.isArray(data) ? data : (data?.events || data?.data || []);
    for (const ev of events) {
      if (!/up.or.down/i.test(ev.title || '')) continue;
      for (const m of (ev.markets || [])) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const endMs = m.endDate ? new Date(m.endDate).getTime()
          : ev.endDate ? new Date(ev.endDate).getTime() : 0;
        if (endMs <= nowMs || endMs > maxMs) continue;
        if (!m.question) m.question = ev.title;
        m._isUpDown = true;
        m._asset = asset;
        all.push(m);
      }
    }
  }));

  // ── Priority 2: Bulk markets sorted by volume, client-side crypto filter ──
  await Promise.all([0, 100, 200, 300, 400].map(async offset => {
    const data = await polyFetch(`/markets?limit=100&active=true&closed=false&order=volumeNum&ascending=false&offset=${offset}`);
    const list = Array.isArray(data) ? data : (data?.markets || []);
    for (const m of list) {
      if (seen.has(m.id)) continue;
      const title = (m.question || m.title || '');
      seen.add(m.id);
      const endMs = m.endDate ? new Date(m.endDate).getTime() : 0;
      if (endMs <= nowMs || endMs > maxMs) continue;
      all.push(m);
    }
  }));

  // ── Sort: 5M Up/Down first (shortest close), then by time ascending ──
  all.sort((a, b) => {
    // Up/Down markets always float to top
    if (a._isUpDown && !b._isUpDown) return -1;
    if (!a._isUpDown && b._isUpDown) return 1;
    const aMs = a.endDate ? new Date(a.endDate).getTime() : maxMs;
    const bMs = b.endDate ? new Date(b.endDate).getTime() : maxMs;
    return aMs - bMs;
  });

  return all;
}

// ── Particle Filter for Price Smoothing (Real-time updating SMC) ──────────────
const pfStates = {}; // Market ID -> Particle Filter state

function expit(x) { return 1 / (1 + Math.exp(-x)); }
function logit(p) { return Math.log(Math.max(0.001, Math.min(0.999, p)) / (1 - Math.max(0.001, Math.min(0.999, p)))); }

function applyParticleFilter(marketId, obsPrice) {
  if (!pfStates[marketId]) {
    const N = 1000;
    const priorLogit = logit(obsPrice);
    const particles = new Float64Array(N);
    for (let i = 0; i < N; i++) particles[i] = priorLogit + (Math.random() * 0.5 - 0.25);
    const weights = new Float64Array(N);
    weights.fill(1 / N);
    pfStates[marketId] = { particles, weights, N };
    return obsPrice;
  }

  const state = pfStates[marketId];
  const processVol = 0.03; // Random walk process noise
  const obsNoise = 0.03;   // Observation noise tolerance
  let maxLogW = -Infinity;
  const logWeights = new Float64Array(state.N);

  for (let i = 0; i < state.N; i++) {
    // Propagate: random walk in logit space (approx normal with uniform bounds)
    state.particles[i] += (Math.random() * 2 - 1) * processVol;
    const prob = expit(state.particles[i]);
    // Reweight
    const logL = -0.5 * Math.pow((obsPrice - prob) / obsNoise, 2);
    const currLogW = Math.log(Math.max(state.weights[i], 1e-300)) + logL;
    logWeights[i] = currLogW;
    if (currLogW > maxLogW) maxLogW = currLogW;
  }

  let sumW = 0;
  for (let i = 0; i < state.N; i++) {
    state.weights[i] = Math.exp(logWeights[i] - maxLogW);
    sumW += state.weights[i];
  }

  let sumSq = 0;
  let estimate = 0;
  for (let i = 0; i < state.N; i++) {
    state.weights[i] /= sumW;
    sumSq += state.weights[i] * state.weights[i];
    estimate += expit(state.particles[i]) * state.weights[i];
  }

  // Systematic resampling if ESS is too low
  const ess = 1.0 / sumSq;
  if (ess < state.N / 2) {
    const cumsum = new Float64Array(state.N);
    cumsum[0] = state.weights[0];
    for (let i = 1; i < state.N; i++) cumsum[i] = cumsum[i - 1] + state.weights[i];
    const newParticles = new Float64Array(state.N);
    const u0 = Math.random() / state.N;
    let rank = 0;
    for (let j = 0; j < state.N; j++) {
      const u = u0 + j / state.N;
      while (rank < state.N - 1 && cumsum[rank] < u) rank++;
      newParticles[j] = state.particles[rank];
    }
    state.particles = newParticles;
    state.weights.fill(1 / state.N);
  }
  return estimate;
}

function normalizePolymarket(raw, prices = {}) {
  const id = String(raw.id || raw.conditionId || '');
  const title = raw.question || raw.title || raw._eventTitle || 'Unknown';

  // Parse outcome prices — outcomePrices[0] = YES/UP price, [1] = NO/DOWN price
  let yesPrice = 0.5;
  try {
    if (raw.outcomePrices) {
      const op = typeof raw.outcomePrices === 'string' ? JSON.parse(raw.outcomePrices) : raw.outcomePrices;
      if (Array.isArray(op) && op.length >= 2) {
        const p0 = parseFloat(op[0]);
        const p1 = parseFloat(op[1]);
        // Use bestBid if available (more accurate live price)
        if (raw.bestBid != null) yesPrice = parseFloat(raw.bestBid) || 0.5;
        else yesPrice = isNaN(p0) ? 0.5 : p0;
      }
    } else if (raw.bestBid != null) {
      yesPrice = parseFloat(raw.bestBid) || 0.5;
    }
  } catch { }

  // Apply Particle Filter: smooths out noise spikes and tracks true underlying probability
  yesPrice = applyParticleFilter(id, yesPrice);

  // Skip markets that are already decided (price at extreme = resolved/nearly resolved)
  if (yesPrice >= 0.85 || yesPrice <= 0.15) return null;

  const liquidity = parseFloat(raw.liquidityNum || raw.liquidity || raw.volume || 0);
  const closesAt = raw.endDate || null;

  // Detect which asset
  const text = title.toLowerCase();
  let asset = 'other';
  if (/btc|bitcoin/.test(text)) asset = 'btc';
  else if (/eth|ethereum/.test(text)) asset = 'eth';
  else if (/sol|solana/.test(text)) asset = 'sol';
  else if (/bnb|binance/.test(text)) asset = 'bnb';

  // Detect window length from title (5min, 15min, 1h, 4h)
  let windowMin = null;
  const wMatch = title.match(/(\d+):(\d+)\w*[-–](\d+):(\d+)/);
  if (wMatch) {
    const s = parseInt(wMatch[1]) * 60 + parseInt(wMatch[2]);
    const e = parseInt(wMatch[3]) * 60 + parseInt(wMatch[4]);
    windowMin = Math.abs(e - s) || 5;
  } else if (/\b9PM ET\b|\b9pm ET\b/.test(title)) {
    windowMin = 60;
  } else if (/\b4:00PM-8:00PM\b|\b8:00PM-12:00AM\b/.test(title)) {
    windowMin = 240;
  }
  if (raw._isUpDown && !windowMin) windowMin = 5;

  // Extract price target from title if possible
  const targetMatch = title.match(/\$([0-9,]+)/);
  const targetPrice = targetMatch ? parseFloat(targetMatch[1].replace(/,/g, '')) : null;

  // Current price data for this asset
  const symMap = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', bnb: 'BNBUSDT' };
  const sym = symMap[asset];
  const priceData = sym ? prices[sym] : null;

  // Rough edge hint
  let roughEdge = null;
  if (targetPrice && priceData?.price) {
    const dist = (targetPrice - priceData.price) / priceData.price * 100;
    roughEdge = Math.abs(dist) < 1 ? 0.1 : Math.abs(dist) < 2 ? 0.05 : 0;
  } else if (asset === 'other') {
    // For non-crypto markets (politics, sports) during Night Watch, we don't have Binance data.
    // Calculate a basic algorithmic edge based on pure probability asymmetry.
    roughEdge = yesPrice > 0.5 ? yesPrice - 0.5 : 0.5 - yesPrice;
  }

  return { id, title, yesPrice, liquidity, closesAt, asset, targetPrice, roughEdge, priceData, windowMin, _isUpDown: raw._isUpDown || false };
}

export {
  polyFetch, fetchPolymarkets, applyParticleFilter, normalizePolymarket,
  expit, logit
};