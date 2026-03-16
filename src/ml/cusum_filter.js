// src/ml/cusum_filter.js
// Concept #20D: CUSUM Filter (López de Prado)
// Detects structural breaks in price series.
// Accumulates deviations from rolling mean; triggers event when cumulative sum > threshold.
// Helps ADAN detect regime changes and avoid trading during transitions.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const STATE_PATH = path.join(DIR, 'cusum_state.json');

class CUSUMFilter {
  constructor() {
    this.sPos = 0;        // Positive cumulative sum
    this.sNeg = 0;        // Negative cumulative sum
    this.returns = [];    // Rolling log returns
    this.prices = [];     // Recent prices
    this.window = 100;    // Rolling window
    this.hMult = 2.0;     // Threshold = hMult × rolling std

    this.events = [];     // [{ts, direction, sValue}]
    this.lastEventTs = 0;
    this.updatesSinceEvent = 0;
    this.totalUpdates = 0;
    this.totalEvents = 0;
    this._load();
  }

  update(price) {
    if (!price || price <= 0) return { event: false, direction: null, s_pos: this.sPos, s_neg: this.sNeg };

    this.prices.push(price);
    if (this.prices.length > this.window + 5) this.prices = this.prices.slice(-this.window - 5);

    if (this.prices.length < 2) return { event: false, direction: null, s_pos: 0, s_neg: 0 };

    // Log return
    const prev = this.prices[this.prices.length - 2];
    const logRet = Math.log(price / prev);
    this.returns.push(logRet);
    if (this.returns.length > this.window) this.returns = this.returns.slice(-this.window);

    this.totalUpdates++;
    this.updatesSinceEvent++;

    // Rolling mean and std
    const n = this.returns.length;
    if (n < 10) return { event: false, direction: null, s_pos: this.sPos, s_neg: this.sNeg };

    const mean = this.returns.reduce((a, b) => a + b, 0) / n;
    const variance = this.returns.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(Math.max(variance, 1e-12));

    // Dynamic threshold
    const h = this.hMult * std;

    // Two-sided CUSUM
    this.sPos = Math.max(0, this.sPos + (logRet - mean - h / 2));
    this.sNeg = Math.min(0, this.sNeg + (logRet - mean + h / 2));

    let event = false;
    let direction = null;

    if (this.sPos > h) {
      event = true;
      direction = 'up';
      this.sPos = 0;
    } else if (this.sNeg < -h) {
      event = true;
      direction = 'down';
      this.sNeg = 0;
    }

    if (event) {
      this.totalEvents++;
      this.lastEventTs = Date.now();
      this.updatesSinceEvent = 0;
      this.events.push({ ts: Date.now(), direction, sValue: direction === 'up' ? this.sPos : this.sNeg });
      if (this.events.length > 200) this.events = this.events.slice(-200);
      console.log(`[CUSUM] Structural break detected: ${direction.toUpperCase()} | events total: ${this.totalEvents}`);
      this._save();
    }

    // Periodic save every 20 updates
    if (this.totalUpdates % 20 === 0) this._save();

    return { event, direction, s_pos: this.sPos, s_neg: this.sNeg, threshold: h };
  }

  isInTransition(windowMs = 60000) {
    return (Date.now() - this.lastEventTs) < windowMs;
  }

  getRegimeAge() {
    return this.updatesSinceEvent;
  }

  getPromptContext() {
    if (this.totalUpdates < 20) return '';
    const inTransition = this.isInTransition();
    const age = this.getRegimeAge();
    const recentEvents = this.events.slice(-5);
    const recentDirs = recentEvents.map(e => e.direction);
    const upCount = recentDirs.filter(d => d === 'up').length;
    const downCount = recentDirs.filter(d => d === 'down').length;

    let ctx = `CUSUM: ${inTransition ? '⚠️ STRUCTURAL BREAK ACTIVE' : `Stable (${age} updates since last break)`}`;
    ctx += ` | Total breaks: ${this.totalEvents}`;
    if (recentEvents.length > 0) {
      ctx += ` | Recent: ${upCount}↑ ${downCount}↓`;
    }
    if (inTransition) {
      ctx += ' | CAUTION: Regime changing — reduce position size or wait for stability.';
    }
    return ctx;
  }

  getStatus() {
    return {
      totalUpdates: this.totalUpdates,
      totalEvents: this.totalEvents,
      inTransition: this.isInTransition(),
      regimeAge: this.getRegimeAge(),
      sPos: this.sPos.toFixed(6),
      sNeg: this.sNeg.toFixed(6),
      recentEvents: this.events.slice(-5),
    };
  }

  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = {
        sPos: this.sPos, sNeg: this.sNeg,
        returns: this.returns.slice(-this.window),
        prices: this.prices.slice(-this.window - 5),
        events: this.events.slice(-200),
        lastEventTs: this.lastEventTs,
        updatesSinceEvent: this.updatesSinceEvent,
        totalUpdates: this.totalUpdates,
        totalEvents: this.totalEvents,
      };
      const tmp = STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
      console.error('[CUSUM] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        this.sPos = d.sPos || 0;
        this.sNeg = d.sNeg || 0;
        this.returns = d.returns || [];
        this.prices = d.prices || [];
        this.events = d.events || [];
        this.lastEventTs = d.lastEventTs || 0;
        this.updatesSinceEvent = d.updatesSinceEvent || 0;
        this.totalUpdates = d.totalUpdates || 0;
        this.totalEvents = d.totalEvents || 0;
        if (this.totalEvents > 0) console.log(`[CUSUM] Loaded: ${this.totalEvents} events, ${this.totalUpdates} updates`);
      }
    } catch (e) {
      console.error('[CUSUM] Load error:', e.message);
    }
  }
}

export const cusumFilter = new CUSUMFilter();
