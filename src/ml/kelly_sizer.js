// src/ml/kelly_sizer.js
// Model-Aware Kelly Sizing — bet proportional to real edge
// Replaces flat $100-300 bets with mathematically optimal sizing
// Uses statistical model probability as the edge estimate

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const KELLY_LOG_PATH = path.join(DIR, 'kelly_log.jsonl');

// Safety limits
const MIN_BET = 50;           // Never bet less than $50
const MAX_FUND_PCT = 0.05;    // Never bet more than 5% of fund
const BASE_FRACTION = 0.25;   // Quarter-Kelly (conservative)

export class KellySizer {

  constructor() {
    this.recentSizes = [];     // Track last 50 bet sizes for stats
    this.stats = { totalBets: 0, avgSize: 0, maxSize: 0, minSize: Infinity };
  }

  // ── COMPUTE optimal bet size ──
  // modelProb: statistical model's win probability (0-1)
  // marketPrice: price of the side we're buying (0-1)
  // fund: current fund value
  // oosWR: out-of-sample WR from walk-forward (affects confidence)
  compute({ modelProb, marketPrice, fund, oosWR = 0.5 }) {
    fund = fund || 10000;

    // Edge = our probability - market probability
    const edge = modelProb - marketPrice;

    // No edge → no bet
    if (edge <= 0) {
      return { stake: 0, reason: 'NO_EDGE', kellyFraction: 0, edge: 0 };
    }

    // Kelly formula: f* = (p * b - q) / b
    // where b = odds = (1/marketPrice) - 1, p = modelProb, q = 1 - modelProb
    const odds = (1 / marketPrice) - 1;
    if (odds <= 0) {
      return { stake: MIN_BET, reason: 'ODDS_INVALID', kellyFraction: 0, edge };
    }

    const q = 1 - modelProb;
    const kellyFull = (modelProb * odds - q) / odds;

    // Fractional Kelly — adjusted by model confidence
    // Better OOS WR → higher fraction (but capped at 0.5)
    const confidenceMultiplier = oosWR > 0.55 ? 1.0 :
                                  oosWR > 0.53 ? 0.8 :
                                  oosWR > 0.50 ? 0.5 : 0.3;
    const fraction = BASE_FRACTION * confidenceMultiplier;
    const kellyFraction = kellyFull * fraction;

    // Compute stake
    let stake = Math.round(fund * Math.max(0, kellyFraction));

    // Apply limits
    const maxBet = Math.round(fund * MAX_FUND_PCT);
    stake = Math.min(stake, maxBet);
    stake = Math.max(stake, MIN_BET);

    // Track stats
    this.recentSizes.push(stake);
    if (this.recentSizes.length > 50) this.recentSizes.shift();
    this.stats.totalBets++;
    this.stats.maxSize = Math.max(this.stats.maxSize, stake);
    this.stats.minSize = Math.min(this.stats.minSize, stake);
    this.stats.avgSize = this.recentSizes.reduce((a, b) => a + b, 0) / this.recentSizes.length;

    // Log
    try {
      const entry = {
        ts: new Date().toISOString(),
        stake, fund, modelProb: parseFloat(modelProb.toFixed(3)),
        marketPrice: parseFloat(marketPrice.toFixed(3)),
        edge: parseFloat(edge.toFixed(4)),
        kellyFull: parseFloat(kellyFull.toFixed(4)),
        kellyFraction: parseFloat(kellyFraction.toFixed(4)),
        fraction: parseFloat(fraction.toFixed(3)),
        oosWR: parseFloat(oosWR.toFixed(3)),
      };
      fs.appendFileSync(KELLY_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {}

    return {
      stake,
      edge: parseFloat(edge.toFixed(4)),
      kellyFull: parseFloat(kellyFull.toFixed(4)),
      kellyFraction: parseFloat(kellyFraction.toFixed(4)),
      fraction: parseFloat(fraction.toFixed(3)),
      reason: stake === MIN_BET ? 'MIN_BET' : stake === maxBet ? 'MAX_BET' : 'KELLY',
    };
  }

  getStatus() {
    return {
      totalBets: this.stats.totalBets,
      avgSize: Math.round(this.stats.avgSize),
      maxSize: this.stats.maxSize,
      minSize: this.stats.minSize === Infinity ? 0 : this.stats.minSize,
    };
  }
}

export const kellySizer = new KellySizer();
