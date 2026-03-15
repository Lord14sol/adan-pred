// PIN Score — Order Flow Toxicity (Concept #14)
// Measures probability of informed trading in order flow
// Source: Easley & O'Hara Market Microstructure

import fs from 'fs';
import path from 'path';

const STATE_DIR = path.join(process.env.HOME, '.adan-pred');
const PIN_PATH = path.join(STATE_DIR, 'pin_scores.json');

class PINTracker {
  constructor() {
    this.windows = {}; // per-market rolling windows
    this.windowSize = 5 * 60 * 1000; // 5 minutes in ms
  }

  // Record a trade/bet observation
  recordTrade(marketId, { side, volume, timestamp }) {
    if (!this.windows[marketId]) {
      this.windows[marketId] = { buys: [], sells: [], avgTotal: 0, history: [] };
    }
    const w = this.windows[marketId];
    const now = timestamp || Date.now();
    const entry = { vol: volume, ts: now };

    if (side === 'YES' || side === 'BUY') w.buys.push(entry);
    else w.sells.push(entry);

    // Prune old entries
    const cutoff = now - this.windowSize;
    w.buys = w.buys.filter(e => e.ts > cutoff);
    w.sells = w.sells.filter(e => e.ts > cutoff);
  }

  // Calculate PIN proxy from order book snapshot
  // bids = buy orders (YES side), asks = sell orders (NO side)
  calculateFromOrderBook(marketId, bids, asks) {
    if (!bids?.length || !asks?.length) return { pin_score: 0, signal: 'NONE' };

    const buyVolume = bids.reduce((s, b) => s + (b.size || b.amount || b.qty || b[1] || 0), 0);
    const sellVolume = asks.reduce((s, a) => s + (a.size || a.amount || a.qty || a[1] || 0), 0);
    const total = buyVolume + sellVolume;

    if (total === 0) return { pin_score: 0, signal: 'NONE' };

    const orderImbalance = (buyVolume - sellVolume) / total;

    // Track rolling average
    if (!this.windows[marketId]) {
      this.windows[marketId] = { avgTotal: total, history: [] };
    }
    const w = this.windows[marketId];
    w.history = w.history || [];
    w.history.push({ total, imbalance: orderImbalance, ts: Date.now() });
    if (w.history.length > 60) w.history.shift(); // keep 60 snapshots

    const avgTotal = w.history.reduce((s, h) => s + h.total, 0) / w.history.length;

    // PIN proxy = |order_imbalance| * (total / avg_total)
    const pin_score = Math.abs(orderImbalance) * (total / (avgTotal || total));
    const clampedPIN = Math.min(1, pin_score);

    // Momentum detection: consecutive same-direction imbalances
    const recentImbalances = w.history.slice(-5).map(h => h.imbalance);
    const allPositive = recentImbalances.length >= 3 && recentImbalances.every(i => i > 0.1);
    const allNegative = recentImbalances.length >= 3 && recentImbalances.every(i => i < -0.1);

    let momentum_direction = 'NONE';
    if (allPositive) momentum_direction = 'YES';
    if (allNegative) momentum_direction = 'NO';

    // Signal classification
    let signal = 'NOISE';
    if (clampedPIN > 0.6) signal = 'STRONG_INFORMED';
    else if (clampedPIN > 0.3) signal = 'MODERATE';

    const result = {
      pin_score: parseFloat(clampedPIN.toFixed(4)),
      order_imbalance: parseFloat(orderImbalance.toFixed(4)),
      buy_volume: buyVolume,
      sell_volume: sellVolume,
      signal,
      momentum_direction,
      consecutive_same: recentImbalances.length,
      timestamp: new Date().toISOString()
    };

    // Save per-market
    this._save(marketId, result);
    return result;
  }

  // Get prompt context string for Gemini
  getPromptContext(marketId) {
    const score = this.getScore(marketId);
    if (!score || score.pin_score === 0) return '';
    return `PIN Score: ${score.pin_score} (${score.signal}) | Imbalance: ${(score.order_imbalance * 100).toFixed(1)}% | Momentum: ${score.momentum_direction}`;
  }

  _save(marketId, data) {
    try {
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      let all = {};
      try { all = JSON.parse(fs.readFileSync(PIN_PATH, 'utf8')); } catch {}
      all[marketId] = data;
      // Keep only last 20 markets
      const keys = Object.keys(all);
      if (keys.length > 20) {
        const oldest = keys.sort((a, b) => new Date(all[a].timestamp) - new Date(all[b].timestamp));
        delete all[oldest[0]];
      }
      fs.writeFileSync(PIN_PATH, JSON.stringify(all, null, 2));
    } catch {}
  }

  getScore(marketId) {
    try {
      const all = JSON.parse(fs.readFileSync(PIN_PATH, 'utf8'));
      return all[marketId] || { pin_score: 0, signal: 'NONE' };
    } catch {
      return { pin_score: 0, signal: 'NONE' };
    }
  }
}

export const pinTracker = new PINTracker();
