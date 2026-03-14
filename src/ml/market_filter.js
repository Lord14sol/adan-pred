// src/ml/market_filter.js
// Market Quality Filter — only bet where ADAN has proven edge
// Combines historical WR by asset, hour, window, liquidity, price bucket
// Uses Bayesian shrinkage: more data = trust historical rate, less data = closer to 0.5

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const FILTER_PATH = path.join(DIR, 'market_filter_stats.json');

const PRIOR_STRENGTH = 20; // Bayesian prior: 20 virtual "coin flip" trades

export class MarketFilter {

  constructor() {
    this.stats = {
      byAsset: {},      // { btc: { wins, total }, eth: ... }
      byHour: {},       // { "14": { wins, total } }
      byWindow: {},     // { "5": { wins, total }, "15": ..., "60": ... }
      byLiqBucket: {},  // { "low": ..., "mid": ..., "high": ... }
      byPriceBucket: {},// { "low": ..., "mid50": ..., "high": ... }
      byAssetWindow: {},// { "btc-5": ..., "sol-60": ... } — interaction
    };
    this.totalFiltered = 0;
    this.totalPassed = 0;
    this._load();
  }

  // ── Compute market quality score ──
  // Returns { score: 0-1, pass: bool, components: {...}, reason: string }
  evaluate({ asset, hour, windowMin, liquidity, yesPrice, side }) {
    const components = {};

    // 1. Asset WR (Bayesian)
    const assetKey = (asset || 'other').toLowerCase();
    components.asset = this._bayesianWR(this.stats.byAsset[assetKey]);

    // 2. Hour WR
    const hourKey = (hour ?? new Date().getUTCHours()).toString();
    components.hour = this._bayesianWR(this.stats.byHour[hourKey]);

    // 3. Window type WR
    const winKey = (windowMin || 5).toString();
    components.window = this._bayesianWR(this.stats.byWindow[winKey]);

    // 4. Liquidity bucket WR
    const liqBucket = liquidity >= 5000 ? 'high' : liquidity >= 1000 ? 'mid' : 'low';
    components.liquidity = this._bayesianWR(this.stats.byLiqBucket[liqBucket]);

    // 5. Price bucket WR (is it coin-flip territory?)
    const price = side === 'YES' ? (yesPrice || 0.5) : (1 - (yesPrice || 0.5));
    const priceBucket = price > 0.65 ? 'favorable' : price > 0.45 ? 'mid50' : 'unfavorable';
    components.price = this._bayesianWR(this.stats.byPriceBucket[priceBucket]);

    // 6. Asset × Window interaction (most informative)
    const awKey = `${assetKey}-${windowMin || 5}`;
    components.assetWindow = this._bayesianWR(this.stats.byAssetWindow[awKey]);

    // Weighted composite score
    // Asset×Window gets highest weight because it captures the most specific pattern
    const score = (
      0.10 * components.asset +
      0.15 * components.hour +
      0.10 * components.window +
      0.10 * components.liquidity +
      0.15 * components.price +
      0.40 * components.assetWindow
    );

    // Pass/fail: need composite > 0.47 to bet
    const pass = score >= 0.47;
    let reason = '';
    if (!pass) {
      // Find worst component
      const worst = Object.entries(components).sort((a, b) => a[1] - b[1])[0];
      reason = `${worst[0]}=${(worst[1]*100).toFixed(0)}% dragging score to ${(score*100).toFixed(1)}%`;
    }

    if (pass) this.totalPassed++;
    else this.totalFiltered++;

    return { score: parseFloat(score.toFixed(4)), pass, components, reason };
  }

  // Bayesian WR with shrinkage toward 0.5
  _bayesianWR(bucket) {
    if (!bucket || !bucket.total) return 0.5;
    return (bucket.wins + PRIOR_STRENGTH * 0.5) / (bucket.total + PRIOR_STRENGTH);
  }

  // ── Record trade result ──
  recordTrade({ asset, hour, windowMin, liquidity, yesPrice, side, won }) {
    const w = won ? 1 : 0;

    const update = (obj, key) => {
      if (!obj[key]) obj[key] = { wins: 0, total: 0 };
      obj[key].total++;
      obj[key].wins += w;
    };

    update(this.stats.byAsset, (asset || 'other').toLowerCase());
    update(this.stats.byHour, (hour ?? new Date().getUTCHours()).toString());
    update(this.stats.byWindow, (windowMin || 5).toString());

    const liqBucket = (liquidity || 0) >= 5000 ? 'high' : (liquidity || 0) >= 1000 ? 'mid' : 'low';
    update(this.stats.byLiqBucket, liqBucket);

    const price = side === 'YES' ? (yesPrice || 0.5) : (1 - (yesPrice || 0.5));
    const priceBucket = price > 0.65 ? 'favorable' : price > 0.45 ? 'mid50' : 'unfavorable';
    update(this.stats.byPriceBucket, priceBucket);

    const awKey = `${(asset || 'other').toLowerCase()}-${windowMin || 5}`;
    update(this.stats.byAssetWindow, awKey);

    // Save every 10 trades
    if ((this.totalPassed + this.totalFiltered) % 10 === 0) this._save();
  }

  // ── Bootstrap from historical trades ──
  bootstrap(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return;

    // Reset stats
    this.stats = { byAsset: {}, byHour: {}, byWindow: {}, byLiqBucket: {}, byPriceBucket: {}, byAssetWindow: {} };

    for (const t of closedTrades) {
      const won = t.won === true || t.result === 'WIN';
      const hour = t.entryTime ? new Date(t.entryTime).getUTCHours() : null;
      this.recordTrade({
        asset: t.asset,
        hour,
        windowMin: t.windowMin || 5,
        liquidity: t.marketLiquidity || 0,
        yesPrice: t.marketPrice || 0.5,
        side: t.side || 'YES',
        won,
      });
    }

    this._save();
    console.log(`[MKT-FILTER] Bootstrapped from ${closedTrades.length} trades`);
    this._printSummary();
  }

  _printSummary() {
    console.log('[MKT-FILTER] Asset WRs:');
    for (const [k, v] of Object.entries(this.stats.byAsset)) {
      console.log(`  ${k}: ${(v.wins/v.total*100).toFixed(1)}% (${v.total} trades)`);
    }
    console.log('[MKT-FILTER] Window WRs:');
    for (const [k, v] of Object.entries(this.stats.byWindow)) {
      console.log(`  ${k}min: ${(v.wins/v.total*100).toFixed(1)}% (${v.total} trades)`);
    }
  }

  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILTER_PATH, JSON.stringify({
        stats: this.stats,
        totalFiltered: this.totalFiltered,
        totalPassed: this.totalPassed,
      }, null, 2));
    } catch {}
  }

  _load() {
    try {
      if (fs.existsSync(FILTER_PATH)) {
        const data = JSON.parse(fs.readFileSync(FILTER_PATH, 'utf8'));
        if (data.stats) this.stats = data.stats;
        this.totalFiltered = data.totalFiltered || 0;
        this.totalPassed = data.totalPassed || 0;
      }
    } catch {}
  }

  getStatus() {
    return {
      totalPassed: this.totalPassed,
      totalFiltered: this.totalFiltered,
      filterRate: this.totalPassed + this.totalFiltered > 0
        ? ((this.totalFiltered / (this.totalPassed + this.totalFiltered)) * 100).toFixed(1) + '%'
        : '0%',
      assetStats: this.stats.byAsset,
      windowStats: this.stats.byWindow,
    };
  }
}

export const marketFilter = new MarketFilter();
