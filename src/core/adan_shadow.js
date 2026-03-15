// src/core/adan_shadow.js
// Concept #15: ADAN-SHADOW — Adversarial Twin
// Takes the OPPOSITE bet on every trade ADAN makes.
// If Shadow wins > 55%, ADAN has a systematic bias.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const SHADOW_PATH = path.join(DIR, 'shadow_stats.json');

class AdanShadow {
  constructor() {
    this.trades = [];      // [{id, adanSide, shadowSide, asset, timeframe, hour, stake, resolved, adanWon}]
    this.stats = {
      total: 0, shadowWins: 0, shadowLosses: 0,
      perAsset: {},        // { btc: {total, shadowWins}, eth: {...} }
      perTimeframe: {},    // { '5min': {total, shadowWins}, '15min': {...} }
      perHour: {},         // { '0': {total, shadowWins}, '1': {...} }
      perDirection: { yes: { total: 0, shadowWins: 0 }, no: { total: 0, shadowWins: 0 } },
    };
    this._load();
  }

  // ── Record when ADAN places a bet ──
  recordTrade(adanSide, market, stake, asset, timeframe, hour) {
    const shadowSide = adanSide === 'YES' ? 'NO' : 'YES';
    const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
    const trade = {
      id,
      marketId: market?.id || market?.conditionId || 'unknown',
      marketTitle: (market?.title || '').slice(0, 60),
      adanSide,
      shadowSide,
      asset: (asset || 'unknown').toLowerCase(),
      timeframe: timeframe || '5min',
      hour: typeof hour === 'number' ? hour : new Date().getUTCHours(),
      stake: stake || 300,
      resolved: false,
      adanWon: null,
      ts: new Date().toISOString(),
    };
    this.trades.push(trade);
    // Keep last 1000
    if (this.trades.length > 1000) this.trades = this.trades.slice(-1000);
    this._save();
    return id;
  }

  // ── Resolve when ADAN's trade resolves ──
  resolveTrade(marketId, adanWon) {
    // Find the most recent unresolved trade for this market
    const trade = [...this.trades].reverse().find(t =>
      !t.resolved && (t.marketId === marketId || t.id === marketId)
    );
    if (!trade) return;

    trade.resolved = true;
    trade.adanWon = adanWon;
    const shadowWon = !adanWon; // Shadow always opposite

    // Update stats
    this.stats.total++;
    if (shadowWon) this.stats.shadowWins++;
    else this.stats.shadowLosses++;

    // Per asset
    const asset = trade.asset;
    if (!this.stats.perAsset[asset]) this.stats.perAsset[asset] = { total: 0, shadowWins: 0 };
    this.stats.perAsset[asset].total++;
    if (shadowWon) this.stats.perAsset[asset].shadowWins++;

    // Per timeframe
    const tf = trade.timeframe;
    if (!this.stats.perTimeframe[tf]) this.stats.perTimeframe[tf] = { total: 0, shadowWins: 0 };
    this.stats.perTimeframe[tf].total++;
    if (shadowWon) this.stats.perTimeframe[tf].shadowWins++;

    // Per hour
    const h = trade.hour.toString();
    if (!this.stats.perHour[h]) this.stats.perHour[h] = { total: 0, shadowWins: 0 };
    this.stats.perHour[h].total++;
    if (shadowWon) this.stats.perHour[h].shadowWins++;

    // Per direction (what ADAN bet)
    const dir = trade.adanSide.toLowerCase();
    if (!this.stats.perDirection[dir]) this.stats.perDirection[dir] = { total: 0, shadowWins: 0 };
    this.stats.perDirection[dir].total++;
    if (shadowWon) this.stats.perDirection[dir].shadowWins++;

    this._save();
  }

  // ── Get rolling Shadow WR over last N resolved trades ──
  _rollingWR(n = 100) {
    const resolved = this.trades.filter(t => t.resolved).slice(-n);
    if (resolved.length < 10) return { wr: 0.5, n: resolved.length };
    const shadowWins = resolved.filter(t => !t.adanWon).length;
    return { wr: shadowWins / resolved.length, n: resolved.length };
  }

  // ── Bias detection: find where ADAN is worst ──
  getBiasReport() {
    if (this.stats.total < 30) return null;

    const report = { hasBias: false, overallShadowWR: 0, biases: [] };
    report.overallShadowWR = this.stats.total > 0 ? this.stats.shadowWins / this.stats.total : 0.5;
    report.hasBias = report.overallShadowWR > 0.55;

    // Find worst asset
    for (const [asset, s] of Object.entries(this.stats.perAsset)) {
      if (s.total >= 15) {
        const wr = s.shadowWins / s.total;
        if (wr > 0.55) {
          report.biases.push({ type: 'asset', key: asset.toUpperCase(), shadowWR: wr, n: s.total });
        }
      }
    }

    // Find worst timeframe
    for (const [tf, s] of Object.entries(this.stats.perTimeframe)) {
      if (s.total >= 15) {
        const wr = s.shadowWins / s.total;
        if (wr > 0.55) {
          report.biases.push({ type: 'timeframe', key: tf, shadowWR: wr, n: s.total });
        }
      }
    }

    // Find worst hours
    for (const [h, s] of Object.entries(this.stats.perHour)) {
      if (s.total >= 10) {
        const wr = s.shadowWins / s.total;
        if (wr > 0.60) {
          report.biases.push({ type: 'hour', key: h + ':00 UTC', shadowWR: wr, n: s.total });
        }
      }
    }

    // Direction bias
    for (const [dir, s] of Object.entries(this.stats.perDirection)) {
      if (s.total >= 20) {
        const wr = s.shadowWins / s.total;
        if (wr > 0.55) {
          report.biases.push({ type: 'direction', key: `ADAN bets ${dir.toUpperCase()}`, shadowWR: wr, n: s.total });
        }
      }
    }

    // Sort by severity
    report.biases.sort((a, b) => b.shadowWR - a.shadowWR);
    report.worstArea = report.biases[0] || null;

    return report;
  }

  // ── Prompt warning for the LLM brain ──
  getPromptWarning() {
    const rolling = this._rollingWR(50);
    if (rolling.n < 30) return '';

    const report = this.getBiasReport();
    if (!report) return '';

    let ctx = `Shadow WR (last ${rolling.n}): ${(rolling.wr * 100).toFixed(1)}% — `;
    if (rolling.wr > 0.60) {
      ctx += 'CRITICAL BIAS! Shadow is destroying ADAN. Consider FLIPPING direction.';
    } else if (rolling.wr > 0.55) {
      ctx += 'WARNING: Shadow is winning. ADAN has a systematic bias.';
    } else if (rolling.wr < 0.45) {
      ctx += 'GOOD: ADAN is outperforming Shadow. No bias detected.';
    } else {
      ctx += 'Neutral — no significant bias.';
    }

    if (report.biases.length > 0) {
      ctx += '\nBias hotspots: ' + report.biases.slice(0, 3).map(b =>
        `${b.type}=${b.key} (Shadow ${(b.shadowWR * 100).toFixed(0)}% WR, n=${b.n})`
      ).join(' | ');
    }

    return ctx;
  }

  // ── Should ADAN flip its direction for a specific asset+timeframe? ──
  shouldFlip(asset, timeframe) {
    const a = this.stats.perAsset[(asset || '').toLowerCase()];
    if (!a || a.total < 20) return false;
    const wr = a.shadowWins / a.total;
    return wr > 0.60; // Shadow wins 60%+ → ADAN should consider flipping
  }

  // ── Full status ──
  getStatus() {
    const rolling = this._rollingWR(100);
    return {
      totalTrades: this.stats.total,
      shadowWR: this.stats.total > 0 ? (this.stats.shadowWins / this.stats.total * 100).toFixed(1) + '%' : '?',
      rolling50: (this._rollingWR(50).wr * 100).toFixed(1) + '%',
      rolling100: (rolling.wr * 100).toFixed(1) + '%',
      biasReport: this.getBiasReport(),
    };
  }

  // ── Persistence ──
  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = { trades: this.trades.slice(-1000), stats: this.stats };
      const tmp = SHADOW_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, SHADOW_PATH);
    } catch (e) {
      console.error('[SHADOW] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(SHADOW_PATH)) {
        const data = JSON.parse(fs.readFileSync(SHADOW_PATH, 'utf8'));
        this.trades = data.trades || [];
        if (data.stats) this.stats = { ...this.stats, ...data.stats };
        if (this.stats.total > 0) {
          console.log(`[SHADOW] Loaded: ${this.stats.total} trades, Shadow WR: ${(this.stats.shadowWins / this.stats.total * 100).toFixed(1)}%`);
        }
      }
    } catch (e) {
      console.error('[SHADOW] Load error:', e.message);
    }
  }
}

export const adanShadow = new AdanShadow();
