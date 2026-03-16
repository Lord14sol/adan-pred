// src/ml/vpin.js
// Concept #20F: VPIN — Volume-Synchronized Probability of Informed Trading
// (López de Prado) Estimates toxic flow using volume buckets.
// High VPIN = informed traders dominating = danger for ADAN.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const STATE_PATH = path.join(DIR, 'vpin_state.json');

class VPINTracker {
  constructor() {
    this.nBuckets = 50;           // Buckets for VPIN calc
    this.bucketSize = 0;          // Auto-calibrated
    this.rollingVolWindow = 200;  // Trades to calibrate bucket size

    // Current bucket accumulator
    this.currentBuyVol = 0;
    this.currentSellVol = 0;
    this.currentVol = 0;

    // Completed buckets
    this.buckets = [];  // [{buyVol, sellVol, totalVol}]

    // For tick rule
    this.lastPrice = 0;

    // Rolling volume for auto-calibration
    this.recentVolumes = [];

    // Stats
    this.totalTrades = 0;
    this.vpinHistory = [];  // last 100 VPIN values

    this._load();
  }

  update(price, volume, side) {
    if (!price || !volume || volume <= 0) return;

    this.totalTrades++;

    // Tick rule if side unknown
    if (!side || (side !== 'buy' && side !== 'sell')) {
      side = price > this.lastPrice ? 'buy' : price < this.lastPrice ? 'sell' : (Math.random() > 0.5 ? 'buy' : 'sell');
    }
    this.lastPrice = price;

    // Track volume for bucket size calibration
    this.recentVolumes.push(volume);
    if (this.recentVolumes.length > this.rollingVolWindow) {
      this.recentVolumes = this.recentVolumes.slice(-this.rollingVolWindow);
    }

    // Auto-calibrate bucket size: average volume × 10
    if (this.bucketSize === 0 && this.recentVolumes.length >= 20) {
      const avgVol = this.recentVolumes.reduce((a, b) => a + b, 0) / this.recentVolumes.length;
      this.bucketSize = avgVol * 10;
    }
    if (this.bucketSize === 0) {
      // Save calibration progress every 10 trades
      if (this.totalTrades % 10 === 0) this._save();
      return;
    }

    // Accumulate into current bucket
    if (side === 'buy') this.currentBuyVol += volume;
    else this.currentSellVol += volume;
    this.currentVol += volume;

    // Check if bucket is full
    while (this.currentVol >= this.bucketSize) {
      const overflow = this.currentVol - this.bucketSize;
      const ratio = this.bucketSize / (this.currentVol || 1);

      this.buckets.push({
        buyVol: this.currentBuyVol * ratio,
        sellVol: this.currentSellVol * ratio,
        totalVol: this.bucketSize,
      });

      // Keep remainder
      const remainRatio = 1 - ratio;
      this.currentBuyVol *= remainRatio;
      this.currentSellVol *= remainRatio;
      this.currentVol = overflow;

      // Keep last nBuckets × 2
      if (this.buckets.length > this.nBuckets * 2) {
        this.buckets = this.buckets.slice(-this.nBuckets * 2);
      }

      // Compute VPIN
      if (this.buckets.length >= this.nBuckets) {
        const vpin = this._computeVPIN();
        this.vpinHistory.push({ ts: Date.now(), vpin });
        if (this.vpinHistory.length > 100) this.vpinHistory = this.vpinHistory.slice(-100);

        if (vpin > 0.7) {
          console.log(`[VPIN] ⚠️ TOXIC FLOW: ${(vpin * 100).toFixed(1)}% — informed traders dominating`);
        }
      }
    }

    // Periodic save
    if (this.totalTrades % 50 === 0) this._save();
  }

  _computeVPIN() {
    const recent = this.buckets.slice(-this.nBuckets);
    if (recent.length < this.nBuckets) return 0;

    let sum = 0;
    for (const b of recent) {
      sum += Math.abs(b.buyVol - b.sellVol) / (b.totalVol || 1);
    }
    return sum / this.nBuckets;
  }

  getVPIN() {
    if (this.buckets.length < this.nBuckets) return 0;
    return this._computeVPIN();
  }

  isToxic() {
    return this.getVPIN() > 0.7;
  }

  getTrend() {
    if (this.vpinHistory.length < 5) return 'UNKNOWN';
    const recent = this.vpinHistory.slice(-5).map(v => v.vpin);
    const old = this.vpinHistory.slice(-10, -5).map(v => v.vpin);
    if (old.length === 0) return 'UNKNOWN';
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const oldAvg = old.reduce((a, b) => a + b, 0) / old.length;
    if (recentAvg > oldAvg * 1.2) return 'RISING';
    if (recentAvg < oldAvg * 0.8) return 'FALLING';
    return 'STABLE';
  }

  getPromptContext() {
    const vpin = this.getVPIN();
    if (this.buckets.length < this.nBuckets) return '';

    const trend = this.getTrend();
    let ctx = `VPIN: ${(vpin * 100).toFixed(1)}%`;
    if (vpin > 0.7) ctx += ' ⚠️ TOXIC — reduce exposure, informed traders dominating';
    else if (vpin > 0.5) ctx += ' ELEVATED — caution, moderate informed flow';
    else if (vpin > 0.3) ctx += ' NORMAL — healthy market';
    else ctx += ' LOW — retail-dominated, safe to trade';
    ctx += ` | Trend: ${trend}`;
    return ctx;
  }

  getStatus() {
    return {
      vpin: (this.getVPIN() * 100).toFixed(1) + '%',
      toxic: this.isToxic(),
      trend: this.getTrend(),
      buckets: this.buckets.length,
      bucketSize: this.bucketSize.toFixed(2),
      totalTrades: this.totalTrades,
    };
  }

  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = {
        bucketSize: this.bucketSize, nBuckets: this.nBuckets,
        currentBuyVol: this.currentBuyVol, currentSellVol: this.currentSellVol,
        currentVol: this.currentVol, lastPrice: this.lastPrice,
        buckets: this.buckets.slice(-this.nBuckets * 2),
        recentVolumes: this.recentVolumes.slice(-this.rollingVolWindow),
        totalTrades: this.totalTrades,
        vpinHistory: this.vpinHistory.slice(-100),
      };
      const tmp = STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
      console.error('[VPIN] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        this.bucketSize = d.bucketSize || 0;
        this.currentBuyVol = d.currentBuyVol || 0;
        this.currentSellVol = d.currentSellVol || 0;
        this.currentVol = d.currentVol || 0;
        this.lastPrice = d.lastPrice || 0;
        this.buckets = d.buckets || [];
        this.recentVolumes = d.recentVolumes || [];
        this.totalTrades = d.totalTrades || 0;
        this.vpinHistory = d.vpinHistory || [];
        if (this.totalTrades > 0) console.log(`[VPIN] Loaded: ${this.totalTrades} trades, VPIN: ${(this.getVPIN() * 100).toFixed(1)}%`);
      }
    } catch (e) {
      console.error('[VPIN] Load error:', e.message);
    }
  }
}

export const vpinTracker = new VPINTracker();
