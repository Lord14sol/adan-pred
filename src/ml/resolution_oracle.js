// src/ml/resolution_oracle.js
// Concept #22: Resolution Oracle Filter
// Predicts whether a market will resolve cleanly (clear YES/NO) or ambiguously.
// Ambiguous markets waste capital and distort learning — filter them out.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const STATE_PATH = path.join(DIR, 'resolution_oracle.json');

// Keyword patterns for market type detection
const CRYPTO_PRICE_PATTERNS = [
  /up or down/i, /above/i, /below/i, /higher than/i, /lower than/i,
  /price of/i, /\$[\d,]+/i, /at or above/i, /at or below/i,
];
const EVENT_CLEAR_PATTERNS = [
  /will .+ win/i, /will .+ pass/i, /will .+ happen/i,
  /before .+ \d{4}/i, /by .+ \d{4}/i,
];
const EVENT_VAGUE_PATTERNS = [
  /more than/i, /significant/i, /major/i, /likely/i,
  /approximately/i, /around/i,
];

class ResolutionOracle {
  constructor() {
    this.history = {};   // {marketType: {total, clean, ambiguous}}
    this.totalScored = 0;
    this.totalTraded = 0;
    this.totalAvoided = 0;
    this._load();
  }

  scoreMarket(market) {
    if (!market) return { clarity: 0.5, recommendation: 'CAUTION', reasons: ['No market data'] };

    const title = (market.title || market.question || '').toLowerCase();
    const reasons = [];
    let clarity = 0.5;

    // 1. Market type detection
    const isCryptoPrice = CRYPTO_PRICE_PATTERNS.some(p => p.test(title));
    const isClearEvent = EVENT_CLEAR_PATTERNS.some(p => p.test(title));
    const isVagueEvent = EVENT_VAGUE_PATTERNS.some(p => p.test(title));

    if (isCryptoPrice) {
      clarity += 0.3;
      reasons.push('Crypto price market — binary resolution');
    } else if (isClearEvent) {
      clarity += 0.1;
      reasons.push('Clear event with specific conditions');
    } else if (isVagueEvent) {
      clarity -= 0.15;
      reasons.push('Vague conditions — resolution may be debatable');
    }

    // 2. Time to close
    const closesAt = market.closesAt || market.end_date_iso;
    if (closesAt) {
      const minutesToClose = (new Date(closesAt) - new Date()) / 60000;
      if (minutesToClose <= 15) {
        clarity += 0.15;
        reasons.push('Closes soon — clean resolution likely');
      } else if (minutesToClose <= 60) {
        clarity += 0.1;
        reasons.push('Closes within 1h');
      } else if (minutesToClose > 1440) {
        clarity -= 0.1;
        reasons.push('Long-dated — more uncertainty in resolution');
      }
    }

    // 3. Market price distance from 0.5 (decisive markets resolve cleaner)
    const price = market.yes_price || market.outcomePrices?.[0] || 0.5;
    const priceParsed = typeof price === 'string' ? parseFloat(price) : price;
    const distFrom50 = Math.abs(priceParsed - 0.5);
    if (distFrom50 > 0.3) {
      clarity += 0.1;
      reasons.push(`Market strongly directional (${(priceParsed * 100).toFixed(0)}%)`);
    } else if (distFrom50 < 0.05) {
      clarity -= 0.05;
      reasons.push('Market at 50/50 — uncertain outcome');
    }

    // 4. Title specificity (contains numbers = more specific)
    const hasNumbers = /\d+/.test(title);
    const hasDollar = /\$/.test(title);
    if (hasNumbers && hasDollar) {
      clarity += 0.05;
      reasons.push('Specific price target');
    }

    // 5. Historical resolution rate for this market type
    const type = isCryptoPrice ? 'crypto_price' : isClearEvent ? 'clear_event' : 'other';
    const hist = this.history[type];
    if (hist && hist.total >= 20) {
      const cleanRate = hist.clean / hist.total;
      if (cleanRate > 0.9) {
        clarity += 0.05;
        reasons.push(`Historical: ${(cleanRate * 100).toFixed(0)}% clean resolution`);
      } else if (cleanRate < 0.7) {
        clarity -= 0.1;
        reasons.push(`Historical: only ${(cleanRate * 100).toFixed(0)}% clean resolution`);
      }
    }

    // Clamp
    clarity = Math.max(0, Math.min(1, clarity));

    let recommendation = 'CAUTION';
    if (clarity > 0.6) recommendation = 'TRADE';
    else if (clarity < 0.4) recommendation = 'AVOID';

    this.totalScored++;
    if (recommendation === 'AVOID') this.totalAvoided++;

    return { clarity: parseFloat(clarity.toFixed(3)), recommendation, reasons, type };
  }

  recordResolution(marketId, wasClean, marketType) {
    const type = marketType || 'other';
    if (!this.history[type]) this.history[type] = { total: 0, clean: 0, ambiguous: 0 };
    this.history[type].total++;
    if (wasClean) this.history[type].clean++;
    else this.history[type].ambiguous++;
    this.totalTraded++;
    this._save();
  }

  getPromptContext() {
    if (this.totalScored < 10) return '';
    let ctx = `RES-ORACLE: Scored ${this.totalScored} markets, avoided ${this.totalAvoided}`;
    for (const [type, h] of Object.entries(this.history)) {
      if (h.total >= 10) {
        ctx += ` | ${type}: ${(h.clean / h.total * 100).toFixed(0)}% clean (n=${h.total})`;
      }
    }
    return ctx;
  }

  getStatus() {
    return {
      totalScored: this.totalScored,
      totalAvoided: this.totalAvoided,
      history: this.history,
    };
  }

  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = {
        history: this.history,
        totalScored: this.totalScored,
        totalTraded: this.totalTraded,
        totalAvoided: this.totalAvoided,
      };
      const tmp = STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
      console.error('[RES-ORACLE] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        this.history = d.history || {};
        this.totalScored = d.totalScored || 0;
        this.totalTraded = d.totalTraded || 0;
        this.totalAvoided = d.totalAvoided || 0;
        if (this.totalScored > 0) console.log(`[RES-ORACLE] Loaded: ${this.totalScored} scored, ${this.totalAvoided} avoided`);
      }
    } catch (e) {
      console.error('[RES-ORACLE] Load error:', e.message);
    }
  }
}

export const resolutionOracle = new ResolutionOracle();
