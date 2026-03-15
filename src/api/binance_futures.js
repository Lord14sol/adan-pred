/**
 * BINANCE FUTURES INTELLIGENCE — Leading Indicators Module
 * Fetches Open Interest, Taker Buy/Sell Ratio, Long/Short Account Ratio
 * from Binance Futures API (free, no API key needed).
 *
 * Signals:
 *   OI Delta + Price  → trend confirmation / squeeze detection
 *   Taker Ratio       → aggressive buying/selling (1-5 min leading)
 *   L/S Account Ratio → contrarian crowding signal
 *   Liquidation Est.  → cascade/magnet risk
 */

import { G, Y, R, D, BOLD, X } from '../core/config.js';

const FAPI = 'https://fapi.binance.com';
const CACHE_TTL_MS = 30_000; // 30-second cache to avoid spamming Binance

class FuturesIntelligence {
  constructor() {
    this.cache = {};   // { [symbol]: { data, ts } }
    this.history = {}; // { [symbol]: { oi: [], taker: [], longShort: [], prices: [] } }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _ensureHistory(symbol) {
    if (!this.history[symbol]) {
      this.history[symbol] = { oi: [], taker: [], longShort: [], prices: [] };
    }
    return this.history[symbol];
  }

  _isCacheValid(symbol) {
    const c = this.cache[symbol];
    return c && (Date.now() - c.ts) < CACHE_TTL_MS;
  }

  async _fetch(url, label = '') {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      // Graceful degradation — symbol may not exist on futures (e.g. SOLUSDT periods)
      return null;
    }
  }

  // ── 1. Open Interest Delta ─────────────────────────────────────────────────

  async getOpenInterestDelta(symbol) {
    const [currentOI, oiHist] = await Promise.all([
      this._fetch(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`, 'OI-current'),
      this._fetch(`${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=12`, 'OI-hist'),
    ]);

    const hist = this._ensureHistory(symbol);

    if (!currentOI || !currentOI.openInterest) {
      return { oiCurrent: 0, delta5m: 0, delta15m: 0, delta30m: 0, signal: 'NO_DATA' };
    }

    const oiVal = parseFloat(currentOI.openInterest);

    // Store current reading
    hist.oi.push({ val: oiVal, ts: Date.now() });
    if (hist.oi.length > 12) hist.oi.shift(); // keep last hour (12 x 5min)

    // Also ingest historical bins if available
    if (Array.isArray(oiHist) && oiHist.length > 0) {
      // Use hist data for delta calculations when we don't have enough local readings
      const histVals = oiHist.map(h => ({
        val: parseFloat(h.sumOpenInterest || h.openInterest || 0),
        ts: h.timestamp || 0
      }));

      // Compute deltas from historical data
      const latest = histVals[histVals.length - 1]?.val || oiVal;
      const ago5m = histVals.length >= 2 ? histVals[histVals.length - 2].val : latest;
      const ago15m = histVals.length >= 4 ? histVals[histVals.length - 4].val : latest;
      const ago30m = histVals.length >= 7 ? histVals[histVals.length - 7].val : latest;

      const delta5m = ago5m > 0 ? ((latest - ago5m) / ago5m) * 100 : 0;
      const delta15m = ago15m > 0 ? ((latest - ago15m) / ago15m) * 100 : 0;
      const delta30m = ago30m > 0 ? ((latest - ago30m) / ago30m) * 100 : 0;

      return { oiCurrent: oiVal, delta5m, delta15m, delta30m, signal: 'OK' };
    }

    // Fallback: use local history
    const len = hist.oi.length;
    const delta5m = len >= 2 ? ((oiVal - hist.oi[len - 2].val) / hist.oi[len - 2].val) * 100 : 0;
    const delta15m = len >= 4 ? ((oiVal - hist.oi[len - 4].val) / hist.oi[len - 4].val) * 100 : 0;
    const delta30m = len >= 7 ? ((oiVal - hist.oi[len - 7].val) / hist.oi[len - 7].val) * 100 : 0;

    return { oiCurrent: oiVal, delta5m, delta15m, delta30m, signal: 'OK' };
  }

  /**
   * Classify OI + Price movement into a directional signal
   */
  classifyOISignal(oiDelta, priceDelta) {
    const oiRising = oiDelta > 0.1;
    const oiFalling = oiDelta < -0.1;
    const priceUp = priceDelta > 0.05;
    const priceDown = priceDelta < -0.05;

    if (oiRising && priceUp) return 'TREND_CONFIRMED';     // genuine momentum
    if (oiRising && priceDown) return 'SHORT_BUILDUP';      // squeeze incoming → bullish
    if (oiFalling && priceUp) return 'SHORT_COVERING';      // weak rally → bearish reversal
    if (oiFalling && priceDown) return 'LONG_LIQUIDATION';  // panic → potential bounce
    return 'NEUTRAL';
  }

  // ── 2. Taker Buy/Sell Ratio ────────────────────────────────────────────────

  async getTakerRatio(symbol) {
    const data = await this._fetch(
      `${FAPI}/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=6`,
      'taker-ratio'
    );

    if (!Array.isArray(data) || data.length === 0) {
      return { ratio: 1, signal: 'NO_DATA', momentum: false, roc: 0, history: [] };
    }

    const hist = this._ensureHistory(symbol);
    const ratios = data.map(d => parseFloat(d.buySellRatio || 1));
    hist.taker = ratios.slice(); // store for trending analysis

    const latest = ratios[ratios.length - 1];
    const prev = ratios.length >= 2 ? ratios[ratios.length - 2] : latest;
    const roc = prev > 0 ? ((latest - prev) / prev) * 100 : 0; // rate of change (acceleration)

    // Signal classification
    let signal = 'NEUTRAL';
    if (latest > 1.3) signal = 'AGGRESSIVE_BUYING';
    else if (latest < 0.7) signal = 'AGGRESSIVE_SELLING';
    else if (latest >= 0.85 && latest <= 1.15) signal = 'NEUTRAL';
    else if (latest > 1.15) signal = 'MILD_BUYING';
    else if (latest < 0.85) signal = 'MILD_SELLING';

    // Momentum: 3+ consecutive same-direction readings
    let momentum = false;
    if (ratios.length >= 3) {
      const last3 = ratios.slice(-3);
      const allBuy = last3.every(r => r > 1.05);
      const allSell = last3.every(r => r < 0.95);
      momentum = allBuy || allSell;
      if (momentum) {
        signal = allBuy ? 'MOMENTUM_BUYING' : 'MOMENTUM_SELLING';
      }
    }

    return { ratio: latest, signal, momentum, roc, history: ratios };
  }

  // ── 3. Long/Short Account Ratio ───────────────────────────────────────────

  async getLongShortRatio(symbol) {
    const data = await this._fetch(
      `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=6`,
      'long-short-ratio'
    );

    if (!Array.isArray(data) || data.length === 0) {
      return { ratio: 1, signal: 'NO_DATA', history: [] };
    }

    const hist = this._ensureHistory(symbol);
    const ratios = data.map(d => parseFloat(d.longShortRatio || 1));
    hist.longShort = ratios.slice();

    const latest = ratios[ratios.length - 1];

    let signal = 'BALANCED';
    if (latest > 2.0) signal = 'CROWDED_LONGS';       // contrarian bearish
    else if (latest < 0.5) signal = 'CROWDED_SHORTS';  // contrarian bullish (squeeze risk)
    else if (latest > 1.5) signal = 'LEANING_LONG';
    else if (latest < 0.7) signal = 'LEANING_SHORT';

    return { ratio: latest, signal, history: ratios };
  }

  // ── 4. Liquidation Cluster Estimator ──────────────────────────────────────

  estimateLiquidationClusters(symbol, price, fundingRate, oi) {
    if (!price || price <= 0) {
      return { clusters: [], nearestDist: null, nearestDir: null, signal: 'NO_DATA' };
    }

    // Common leverage levels and their liquidation distances
    const leverages = [
      { leverage: 10, liqPct: 0.10 },
      { leverage: 20, liqPct: 0.05 },
      { leverage: 50, liqPct: 0.02 },
      { leverage: 100, liqPct: 0.01 },
    ];

    // Funding rate hints at positioning: positive = longs pay shorts (more longs)
    // Negative = shorts pay longs (more shorts)
    const isLongDominant = (fundingRate || 0) > 0;

    const clusters = [];
    for (const { leverage, liqPct } of leverages) {
      // If longs dominate, long liquidations are below price
      // If shorts dominate, short liquidations are above price
      const longLiq = price * (1 - liqPct);
      const shortLiq = price * (1 + liqPct);

      clusters.push({
        leverage,
        longLiqPrice: Math.round(longLiq * 100) / 100,
        shortLiqPrice: Math.round(shortLiq * 100) / 100,
        longDist: liqPct * 100,
        shortDist: liqPct * 100,
      });
    }

    // Find nearest liquidation cluster
    let nearestDist = Infinity;
    let nearestPrice = 0;
    let nearestDir = 'NONE';
    let nearestLev = 0;

    for (const c of clusters) {
      const longDistAbs = Math.abs(price - c.longLiqPrice) / price * 100;
      const shortDistAbs = Math.abs(c.shortLiqPrice - price) / price * 100;

      if (longDistAbs < nearestDist) {
        nearestDist = longDistAbs;
        nearestPrice = c.longLiqPrice;
        nearestDir = 'BELOW';
        nearestLev = c.leverage;
      }
      if (shortDistAbs < nearestDist) {
        nearestDist = shortDistAbs;
        nearestPrice = c.shortLiqPrice;
        nearestDir = 'ABOVE';
        nearestLev = c.leverage;
      }
    }

    // LIQUIDATION_MAGNET: price within 1% of a cluster
    let signal = 'NORMAL';
    if (nearestDist <= 1.0) {
      signal = 'LIQUIDATION_MAGNET';
    } else if (nearestDist <= 2.0) {
      signal = 'LIQUIDATION_PROXIMITY';
    }

    return {
      clusters,
      nearestDist: Math.round(nearestDist * 100) / 100,
      nearestPrice: Math.round(nearestPrice * 100) / 100,
      nearestDir,
      nearestLev,
      signal,
    };
  }

  // ── Main fetch: all indicators in parallel ────────────────────────────────

  async fetchAll(symbol = 'BTCUSDT') {
    // Check cache first
    if (this._isCacheValid(symbol)) {
      return this.cache[symbol].data;
    }

    const [oiData, takerData, lsData] = await Promise.all([
      this.getOpenInterestDelta(symbol),
      this.getTakerRatio(symbol),
      this.getLongShortRatio(symbol),
    ]);

    // We need current price for OI signal classification and liquidation estimation
    // Price will be injected externally via enrichWithPrice()
    const result = {
      symbol,
      ts: Date.now(),
      openInterest: oiData,
      takerRatio: takerData,
      longShortRatio: lsData,
      liquidation: null, // filled by enrichWithPrice
      oiSignal: null,    // filled by enrichWithPrice
      compositeSignal: null,
    };

    this.cache[symbol] = { data: result, ts: Date.now() };
    return result;
  }

  /**
   * Enrich fetched data with price-dependent calculations (OI signal + liquidation clusters).
   * Call this after fetchAll() when you have the current price available.
   */
  enrichWithPrice(data, price, priceDelta5m, fundingRate) {
    if (!data || !price) return data;

    // Classify OI + price
    data.oiSignal = this.classifyOISignal(
      data.openInterest?.delta5m || 0,
      priceDelta5m || 0
    );

    // Estimate liquidation clusters
    data.liquidation = this.estimateLiquidationClusters(
      data.symbol, price, fundingRate, data.openInterest?.oiCurrent || 0
    );

    // Composite signal: combine all signals into a single strength indicator
    data.compositeSignal = this._computeComposite(data);

    return data;
  }

  _computeComposite(data) {
    let bullScore = 0;
    let bearScore = 0;

    // OI signal
    const oi = data.oiSignal;
    if (oi === 'TREND_CONFIRMED') bullScore += 2;
    else if (oi === 'SHORT_BUILDUP') bullScore += 1.5;  // squeeze = bullish
    else if (oi === 'SHORT_COVERING') bearScore += 1.5; // weak rally
    else if (oi === 'LONG_LIQUIDATION') bearScore += 1; // panic but potential bounce

    // Taker ratio
    const taker = data.takerRatio?.signal || '';
    if (taker === 'AGGRESSIVE_BUYING' || taker === 'MOMENTUM_BUYING') bullScore += 2;
    else if (taker === 'MILD_BUYING') bullScore += 0.5;
    else if (taker === 'AGGRESSIVE_SELLING' || taker === 'MOMENTUM_SELLING') bearScore += 2;
    else if (taker === 'MILD_SELLING') bearScore += 0.5;

    // Long/Short ratio (contrarian)
    const ls = data.longShortRatio?.signal || '';
    if (ls === 'CROWDED_LONGS') bearScore += 1.5;     // contrarian
    else if (ls === 'CROWDED_SHORTS') bullScore += 1.5; // contrarian
    else if (ls === 'LEANING_LONG') bearScore += 0.5;
    else if (ls === 'LEANING_SHORT') bullScore += 0.5;

    // Liquidation magnet
    const liq = data.liquidation;
    if (liq && liq.signal === 'LIQUIDATION_MAGNET') {
      if (liq.nearestDir === 'BELOW') bearScore += 1; // price attracted downward
      else if (liq.nearestDir === 'ABOVE') bullScore += 1; // price attracted upward
    }

    const net = bullScore - bearScore;
    let direction = 'NEUTRAL';
    let strength = 'WEAK';

    if (net >= 3) { direction = 'BULLISH'; strength = 'STRONG'; }
    else if (net >= 1.5) { direction = 'BULLISH'; strength = 'MODERATE'; }
    else if (net >= 0.5) { direction = 'BULLISH'; strength = 'WEAK'; }
    else if (net <= -3) { direction = 'BEARISH'; strength = 'STRONG'; }
    else if (net <= -1.5) { direction = 'BEARISH'; strength = 'MODERATE'; }
    else if (net <= -0.5) { direction = 'BEARISH'; strength = 'WEAK'; }

    return { direction, strength, bullScore, bearScore, net };
  }

  // ── Prompt Context: formatted string for LLM injection ────────────────────

  getPromptContext(symbol) {
    const c = this.cache[symbol]?.data;
    if (!c) return '';

    const parts = [];

    // OI Delta
    const oi = c.openInterest;
    if (oi && oi.signal !== 'NO_DATA') {
      parts.push(`OI Delta: ${oi.delta5m >= 0 ? '+' : ''}${oi.delta5m.toFixed(2)}% (5m), ${oi.delta15m >= 0 ? '+' : ''}${oi.delta15m.toFixed(2)}% (15m) → ${c.oiSignal || 'N/A'}`);
    }

    // Taker ratio
    const tk = c.takerRatio;
    if (tk && tk.signal !== 'NO_DATA') {
      parts.push(`Taker: ${tk.ratio.toFixed(2)}x ${tk.signal}${tk.momentum ? ' [MOMENTUM]' : ''} (RoC: ${tk.roc >= 0 ? '+' : ''}${tk.roc.toFixed(1)}%)`);
    }

    // Long/Short ratio
    const ls = c.longShortRatio;
    if (ls && ls.signal !== 'NO_DATA') {
      parts.push(`L/S: ${ls.ratio.toFixed(2)} ${ls.signal}`);
    }

    // Liquidation clusters
    const liq = c.liquidation;
    if (liq && liq.signal !== 'NO_DATA') {
      const dirLabel = liq.nearestDir === 'BELOW' ? 'below' : 'above';
      parts.push(`Liq cluster: $${liq.nearestPrice.toLocaleString()} (${liq.nearestDist.toFixed(1)}% ${dirLabel}, ${liq.nearestLev}x) ${liq.signal}`);
    }

    // Composite
    const comp = c.compositeSignal;
    if (comp) {
      parts.push(`Composite: ${comp.direction} ${comp.strength} (bull=${comp.bullScore.toFixed(1)} bear=${comp.bearScore.toFixed(1)})`);
    }

    return parts.join(' | ');
  }

  // ── Structured Signals: for feature vector ────────────────────────────────

  getSignals(symbol) {
    const c = this.cache[symbol]?.data;
    if (!c) {
      return {
        oiDelta5m: 0, oiDelta15m: 0, oiDelta30m: 0, oiSignal: 'NO_DATA',
        takerRatio: 1, takerSignal: 'NEUTRAL', takerMomentum: false, takerRoC: 0,
        longShortRatio: 1, crowdSignal: 'BALANCED',
        liqDistance: 0, liqDirection: 'NONE', liqSignal: 'NO_DATA',
        compositeDirection: 'NEUTRAL', compositeStrength: 'WEAK', compositeNet: 0,
      };
    }

    const oi = c.openInterest || {};
    const tk = c.takerRatio || {};
    const ls = c.longShortRatio || {};
    const liq = c.liquidation || {};
    const comp = c.compositeSignal || {};

    return {
      oiDelta5m: oi.delta5m || 0,
      oiDelta15m: oi.delta15m || 0,
      oiDelta30m: oi.delta30m || 0,
      oiSignal: c.oiSignal || 'NEUTRAL',
      takerRatio: tk.ratio || 1,
      takerSignal: tk.signal || 'NEUTRAL',
      takerMomentum: tk.momentum || false,
      takerRoC: tk.roc || 0,
      longShortRatio: ls.ratio || 1,
      crowdSignal: ls.signal || 'BALANCED',
      liqDistance: liq.nearestDist || 0,
      liqDirection: liq.nearestDir || 'NONE',
      liqSignal: liq.signal || 'NO_DATA',
      compositeDirection: comp.direction || 'NEUTRAL',
      compositeStrength: comp.strength || 'WEAK',
      compositeNet: comp.net || 0,
    };
  }
}

export const futuresIntel = new FuturesIntelligence();
