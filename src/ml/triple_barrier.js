// src/ml/triple_barrier.js
// Concept #20A: Triple Barrier Labeling (López de Prado)
// Labels trades with 3 barriers: take-profit (upper), stop-loss (lower), time-expiry (vertical).
// Richer than binary win/loss: {1=TP hit, 0=timed out, -1=SL hit}

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const STATE_PATH = path.join(DIR, 'triple_barrier.json');

class TripleBarrier {
  constructor() {
    this.tpMult = 2.0;    // TP = entry ± tpMult × volatility
    this.slMult = 2.0;    // SL = entry ± slMult × volatility
    this.maxBars = 20;    // Vertical barrier: max bars before expiry

    this.activeBarriers = {};  // {id: barrier}
    this.stats = {
      tp: 0, sl: 0, time: 0,
      pnlByLabel: { '1': 0, '0': 0, '-1': 0 },
      countByLabel: { '1': 0, '0': 0, '-1': 0 },
    };
    this.history = [];  // last 500 resolved barriers

    this._load();
  }

  createBarrier(entryPrice, side, volatility, id) {
    if (!entryPrice || !volatility) return null;
    const barrId = id || Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
    const vol = Math.max(volatility, 0.001); // minimum vol

    const isLong = side === 'YES' || side === 'BUY' || side === 'LONG';

    const barrier = {
      id: barrId,
      entry: entryPrice,
      side: isLong ? 'LONG' : 'SHORT',
      upper: entryPrice * (1 + this.tpMult * vol / 100),
      lower: entryPrice * (1 - this.slMult * vol / 100),
      maxBars: this.maxBars,
      barsElapsed: 0,
      volatility: vol,
      ts: Date.now(),
    };

    this.activeBarriers[barrId] = barrier;
    return barrier;
  }

  updateBarrier(id, currentPrice) {
    const b = this.activeBarriers[id];
    if (!b) return { hit: null, label: null, pnl: 0 };

    b.barsElapsed++;

    const isLong = b.side === 'LONG';
    const pnl = isLong
      ? (currentPrice - b.entry) / b.entry * 100
      : (b.entry - currentPrice) / b.entry * 100;

    let hit = null;
    let label = null;

    // Check upper barrier (TP for longs, SL for shorts)
    if (currentPrice >= b.upper) {
      hit = isLong ? 'tp' : 'sl';
      label = isLong ? 1 : -1;
    }
    // Check lower barrier (SL for longs, TP for shorts)
    else if (currentPrice <= b.lower) {
      hit = isLong ? 'sl' : 'tp';
      label = isLong ? -1 : 1;
    }
    // Check vertical barrier (time expiry)
    else if (b.barsElapsed >= b.maxBars) {
      hit = 'time';
      label = 0;
    }

    if (hit) {
      // Record
      this._recordResult(hit, label, pnl);
      delete this.activeBarriers[id];
    }

    return { hit, label, pnl, barsElapsed: b.barsElapsed };
  }

  // Post-hoc labeling for historical trades
  labelTrade(entryPrice, exitPrice, side, barsHeld, volatility) {
    if (!entryPrice || !exitPrice) return { label: 0, hit: 'time' };

    const vol = Math.max(volatility || 1, 0.001);
    const isLong = side === 'YES' || side === 'BUY' || side === 'LONG';
    const upper = entryPrice * (1 + this.tpMult * vol / 100);
    const lower = entryPrice * (1 - this.slMult * vol / 100);

    const pnl = isLong
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;

    let result;
    if (exitPrice >= upper && isLong) result = { label: 1, hit: 'tp', pnl };
    else if (exitPrice <= lower && isLong) result = { label: -1, hit: 'sl', pnl };
    else if (exitPrice <= lower && !isLong) result = { label: 1, hit: 'tp', pnl };
    else if (exitPrice >= upper && !isLong) result = { label: -1, hit: 'sl', pnl };
    else result = { label: 0, hit: 'time', pnl };

    this._recordResult(result.hit, result.label, result.pnl);
    return result;
  }

  _recordResult(hit, label, pnl) {
    if (hit === 'tp') this.stats.tp++;
    else if (hit === 'sl') this.stats.sl++;
    else this.stats.time++;

    const key = label.toString();
    this.stats.pnlByLabel[key] = (this.stats.pnlByLabel[key] || 0) + pnl;
    this.stats.countByLabel[key] = (this.stats.countByLabel[key] || 0) + 1;

    this.history.push({ ts: Date.now(), hit, label, pnl });
    if (this.history.length > 500) this.history = this.history.slice(-500);

    this._save();
  }

  getStats() {
    const total = this.stats.tp + this.stats.sl + this.stats.time;
    return {
      total,
      tp: this.stats.tp,
      sl: this.stats.sl,
      time: this.stats.time,
      tpRate: total > 0 ? (this.stats.tp / total * 100).toFixed(1) + '%' : '?',
      slRate: total > 0 ? (this.stats.sl / total * 100).toFixed(1) + '%' : '?',
      timeRate: total > 0 ? (this.stats.time / total * 100).toFixed(1) + '%' : '?',
      avgPnlTP: this.stats.countByLabel['1'] > 0 ? (this.stats.pnlByLabel['1'] / this.stats.countByLabel['1']).toFixed(3) + '%' : '?',
      avgPnlSL: this.stats.countByLabel['-1'] > 0 ? (this.stats.pnlByLabel['-1'] / this.stats.countByLabel['-1']).toFixed(3) + '%' : '?',
      activeBarriers: Object.keys(this.activeBarriers).length,
    };
  }

  getOptimalRatio() {
    const avgTP = this.stats.countByLabel['1'] > 0 ? this.stats.pnlByLabel['1'] / this.stats.countByLabel['1'] : 0;
    const avgSL = this.stats.countByLabel['-1'] > 0 ? Math.abs(this.stats.pnlByLabel['-1'] / this.stats.countByLabel['-1']) : 0;
    if (avgSL === 0) return { ratio: this.tpMult / this.slMult, suggestion: 'Not enough data' };

    const ratio = avgTP / avgSL;
    let suggestion = 'balanced';
    if (ratio > 2.0) suggestion = 'TP too wide — tighten for more wins';
    if (ratio < 0.5) suggestion = 'SL too tight — widen to avoid noise stops';
    return { ratio: ratio.toFixed(2), suggestion };
  }

  getPromptContext() {
    const total = this.stats.tp + this.stats.sl + this.stats.time;
    if (total < 20) return '';

    const s = this.getStats();
    const opt = this.getOptimalRatio();
    return `TRIPLE-BARRIER: TP:${s.tpRate} SL:${s.slRate} TIME:${s.timeRate} (n=${total}) | Avg TP PnL: ${s.avgPnlTP} | Avg SL PnL: ${s.avgPnlSL} | Ratio: ${opt.ratio} (${opt.suggestion})`;
  }

  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = { stats: this.stats, history: this.history.slice(-500), activeBarriers: this.activeBarriers };
      const tmp = STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
      console.error('[TRIPLE-BARRIER] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (d.stats) this.stats = { ...this.stats, ...d.stats };
        this.history = d.history || [];
        this.activeBarriers = d.activeBarriers || {};
        const total = this.stats.tp + this.stats.sl + this.stats.time;
        if (total > 0) console.log(`[TRIPLE-BARRIER] Loaded: ${total} labels (TP:${this.stats.tp} SL:${this.stats.sl} TIME:${this.stats.time})`);
      }
    } catch (e) {
      console.error('[TRIPLE-BARRIER] Load error:', e.message);
    }
  }
}

export const tripleBarrier = new TripleBarrier();
