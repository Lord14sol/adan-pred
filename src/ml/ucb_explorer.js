// src/ml/ucb_explorer.js
// Concept #8C: UCB (Upper Confidence Bound) Market Explorer
// Uses multi-armed bandit UCB1 formula to balance exploitation vs exploration
// UCB = edge_estimate + C * sqrt(log(N) / n_market)
// Markets with fewer trades get an exploration bonus, encouraging diversification.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const UCB_PATH = path.join(DIR, 'market_explorer.json');
const C = 2.0; // Exploration constant — higher = more exploration
const BLACKLIST_DAYS = 30;
const BLACKLIST_MIN_TRADES = 15;
const BLACKLIST_WR_THRESHOLD = 0.40;
const EXPLORATION_FUND_CAP = 0.03; // Max 3% of fund on exploration markets

export class UCBExplorer {

  constructor() {
    this.markets = {};       // { marketKey: { trades, wins, total_edge, avg_edge, ucb_score, last_trade } }
    this.blacklist = {};     // { marketKey: { until: ISO, reason, wr, trades } }
    this.totalTrades = 0;
    this._load();
  }

  // ── Get a stable key for a market ──
  _marketKey(market) {
    // Use conditionId or id, fallback to slug from title + asset
    if (market.conditionId) return market.conditionId;
    if (market.id) return market.id;
    const asset = (market.asset || 'unknown').toLowerCase();
    const title = (market.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    return `${asset}_${title}`;
  }

  // ── Compute UCB score for a single market ──
  computeUCB(marketKey) {
    const stats = this.markets[marketKey];
    const N = Math.max(this.totalTrades, 1);

    if (!stats || stats.trades === 0) {
      // Never traded — maximum exploration bonus
      return { ucb_score: Infinity, edge_estimate: 0, exploration_bonus: Infinity, trades: 0, wins: 0, is_exploration: true };
    }

    const n = stats.trades;
    const edge_estimate = stats.avg_edge || 0;
    const exploration_bonus = C * Math.sqrt(Math.log(N) / n);
    const ucb_score = edge_estimate + exploration_bonus;

    return {
      ucb_score: parseFloat(ucb_score.toFixed(6)),
      edge_estimate: parseFloat(edge_estimate.toFixed(6)),
      exploration_bonus: parseFloat(exploration_bonus.toFixed(6)),
      trades: n,
      wins: stats.wins,
      wr: n > 0 ? parseFloat((stats.wins / n).toFixed(4)) : 0,
      is_exploration: n < 5, // Fewer than 5 trades = still exploring
    };
  }

  // ── Score and rank an array of markets ──
  // Returns markets sorted by UCB score (descending), with UCB metadata attached
  rankMarkets(markets) {
    const now = new Date();
    const scored = [];

    for (const m of markets) {
      const key = this._marketKey(m);

      // Check blacklist
      if (this.blacklist[key]) {
        const until = new Date(this.blacklist[key].until);
        if (now < until) {
          continue; // Skip blacklisted market
        } else {
          // Blacklist expired — remove it
          delete this.blacklist[key];
        }
      }

      const ucb = this.computeUCB(key);
      scored.push({
        market: m,
        _ucb: ucb,
        _ucbKey: key,
      });
    }

    // Sort by UCB score descending (Infinity = never tried = highest priority)
    scored.sort((a, b) => {
      // Infinity handling: both Infinity => random tiebreak, one Infinity wins
      if (a._ucb.ucb_score === Infinity && b._ucb.ucb_score === Infinity) return Math.random() - 0.5;
      if (a._ucb.ucb_score === Infinity) return -1;
      if (b._ucb.ucb_score === Infinity) return 1;
      return b._ucb.ucb_score - a._ucb.ucb_score;
    });

    return scored;
  }

  // ── Check if a market is an exploration trade (low data) ──
  isExploration(market) {
    const key = this._marketKey(market);
    const stats = this.markets[key];
    return !stats || stats.trades < 5;
  }

  // ── Check exploration budget: returns true if we can still explore ──
  canExplore(currentFund, explorationSpentThisCycle) {
    const maxExploration = currentFund * EXPLORATION_FUND_CAP;
    return explorationSpentThisCycle < maxExploration;
  }

  // ── Get max exploration stake for a single trade ──
  getExplorationMaxStake(currentFund) {
    return currentFund * EXPLORATION_FUND_CAP;
  }

  // ── Check if a market is blacklisted ──
  isBlacklisted(market) {
    const key = this._marketKey(market);
    if (!this.blacklist[key]) return false;
    const until = new Date(this.blacklist[key].until);
    if (new Date() >= until) {
      delete this.blacklist[key];
      return false;
    }
    return true;
  }

  // ── Record a trade outcome ──
  recordTrade(market, won, edge) {
    const key = this._marketKey(market);
    if (!this.markets[key]) {
      this.markets[key] = {
        trades: 0, wins: 0, total_edge: 0, avg_edge: 0, ucb_score: 0,
        first_trade: new Date().toISOString(),
        last_trade: null,
        title: (market.title || '').slice(0, 80),
        asset: (market.asset || '').toLowerCase(),
      };
    }

    const stats = this.markets[key];
    stats.trades++;
    stats.wins += won ? 1 : 0;
    stats.total_edge += (edge || 0);
    stats.avg_edge = stats.total_edge / stats.trades;
    stats.last_trade = new Date().toISOString();

    this.totalTrades++;

    // Recompute UCB score
    const ucb = this.computeUCB(key);
    stats.ucb_score = ucb.ucb_score === Infinity ? 999 : ucb.ucb_score;

    // Check blacklist condition: WR < 40% after 15+ trades
    if (stats.trades >= BLACKLIST_MIN_TRADES) {
      const wr = stats.wins / stats.trades;
      if (wr < BLACKLIST_WR_THRESHOLD) {
        const until = new Date();
        until.setDate(until.getDate() + BLACKLIST_DAYS);
        this.blacklist[key] = {
          until: until.toISOString(),
          reason: `WR ${(wr * 100).toFixed(1)}% < ${BLACKLIST_WR_THRESHOLD * 100}% after ${stats.trades} trades`,
          wr: parseFloat((wr * 100).toFixed(1)),
          trades: stats.trades,
          blacklisted_at: new Date().toISOString(),
        };
        console.log(`[UCB EXPLORER] ⛔ BLACKLISTED "${(market.title || key).slice(0, 40)}" for ${BLACKLIST_DAYS}d — WR ${(wr * 100).toFixed(1)}% over ${stats.trades} trades`);
      }
    }

    this._save();
  }

  // ── Bootstrap from historical closed trades ──
  bootstrap(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return;

    // Reset
    this.markets = {};
    this.blacklist = {};
    this.totalTrades = 0;

    for (const t of closedTrades) {
      const won = t.won === true || t.result === 'WIN';
      const fakeMarket = {
        id: t.marketId || t.id,
        conditionId: t.conditionId,
        title: t.title || t.marketTitle || '',
        asset: t.asset || 'unknown',
      };
      this.recordTrade(fakeMarket, won, t.edge || 0);
    }

    console.log(`[UCB EXPLORER] Bootstrapped from ${closedTrades.length} trades across ${Object.keys(this.markets).length} markets`);
    this._printTop();
  }

  // ── Print top and bottom markets ──
  _printTop() {
    const entries = Object.entries(this.markets)
      .filter(([, v]) => v.trades >= 3)
      .sort((a, b) => (b[1].avg_edge || 0) - (a[1].avg_edge || 0));

    if (entries.length === 0) return;

    console.log('[UCB EXPLORER] Top markets by avg edge:');
    for (const [key, v] of entries.slice(0, 5)) {
      const wr = v.trades > 0 ? (v.wins / v.trades * 100).toFixed(1) : '0.0';
      console.log(`  ${(v.title || key).slice(0, 35)} | trades:${v.trades} WR:${wr}% avg_edge:${(v.avg_edge * 100).toFixed(2)}% UCB:${v.ucb_score?.toFixed(3) || 'N/A'}`);
    }

    const blacklisted = Object.keys(this.blacklist).length;
    if (blacklisted > 0) {
      console.log(`[UCB EXPLORER] ${blacklisted} market(s) currently blacklisted`);
    }
  }

  // ── Status for dashboard ──
  getStatus() {
    const totalMarkets = Object.keys(this.markets).length;
    const explorationMarkets = Object.values(this.markets).filter(m => m.trades < 5).length;
    const blacklisted = Object.keys(this.blacklist).length;
    const topByUCB = Object.entries(this.markets)
      .map(([k, v]) => ({ key: k, ...v, ...this.computeUCB(k) }))
      .sort((a, b) => (b.ucb_score === Infinity ? 999 : b.ucb_score) - (a.ucb_score === Infinity ? 999 : a.ucb_score))
      .slice(0, 5);

    return {
      totalMarkets,
      totalTrades: this.totalTrades,
      explorationMarkets,
      blacklisted,
      explorationConstant: C,
      fundCap: `${EXPLORATION_FUND_CAP * 100}%`,
      topByUCB,
    };
  }

  // ── Persistence ──
  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(UCB_PATH, JSON.stringify({
        markets: this.markets,
        blacklist: this.blacklist,
        totalTrades: this.totalTrades,
        lastUpdated: new Date().toISOString(),
        concept: '8C',
        version: 1,
      }, null, 2));
    } catch (e) {
      console.log('[UCB EXPLORER] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (fs.existsSync(UCB_PATH)) {
        const data = JSON.parse(fs.readFileSync(UCB_PATH, 'utf8'));
        if (data.markets) this.markets = data.markets;
        if (data.blacklist) this.blacklist = data.blacklist;
        this.totalTrades = data.totalTrades || 0;
      }
    } catch (e) {
      console.log('[UCB EXPLORER] Load error:', e.message);
    }
  }
}

export const ucbExplorer = new UCBExplorer();
