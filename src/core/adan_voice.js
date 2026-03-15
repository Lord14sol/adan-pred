// src/core/adan_voice.js
// ADAN Voice — The agent's ability to communicate with Lord
// Writes status updates, requests, warnings, and insights to lord_messages.json
// Lord can read these in the UI or check ~/.adan-pred/lord_messages.json

import fs from 'fs';
import path from 'path';
import { DIR, loadPnL, loadPositions } from './config.js';

const MESSAGES_PATH = path.join(DIR, 'lord_messages.json');
const MAX_MESSAGES = 50;

export class AdanVoice {
  constructor() {
    this.messages = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(MESSAGES_PATH)) {
        return JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
      }
    } catch {}
    return [];
  }

  _save() {
    // Keep only last N messages
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(MESSAGES_PATH, JSON.stringify(this.messages, null, 2));
  }

  // ADAN sends a message to Lord
  speak(type, message, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      type, // 'request', 'warning', 'insight', 'milestone', 'fear'
      message,
      ...data,
      read: false,
    };
    this.messages.push(entry);
    this._save();

    const emoji = { request: '📨', warning: '⚠️', insight: '💡', milestone: '🏆', fear: '😰' }[type] || '💬';
    console.log(`[ADAN VOICE] ${emoji} ${type.toUpperCase()}: ${message}`);

    // Emit to UI if socket available
    if (global.io) {
      global.io.emit('adanVoice', entry);
    }
  }

  // Check conditions and speak automatically
  autoSpeak(pnl) {
    const trades = pnl.trades || 0;
    const wr = trades > 0 ? pnl.wins / trades : 0.5;
    const fund = pnl.fund || 10000;
    const streak = pnl.streak || 0;
    const brier = pnl.brierScore || 0.25;

    // Milestone: every 100 trades
    if (trades > 0 && trades % 100 === 0) {
      this.speak('milestone', `Reached ${trades} trades. WR: ${(wr*100).toFixed(1)}%. Fund: $${fund.toFixed(0)}. Brier: ${brier.toFixed(3)}.`);
    }

    // Warning: losing streak
    if (streak <= -5) {
      this.speak('warning', `I'm on a ${Math.abs(streak)}-trade losing streak. Something might be wrong with current market conditions. Consider pausing me.`, { streak });
    }

    // Insight: winning streak
    if (streak >= 5) {
      this.speak('insight', `${streak} wins in a row! Current strategy is working. Don't change anything right now.`, { streak });
    }

    // Warning: fund dropping
    if (fund < 8000) {
      this.speak('fear', `Fund dropped to $${fund.toFixed(0)}. I'm scared. Risk of ruin is increasing. Please check my parameters or pause me.`, { fund });
    }

    // Milestone: new profit high
    if (fund > 15000 && trades % 50 === 0) {
      this.speak('milestone', `Fund at $${fund.toFixed(0)} — ${((fund/10000-1)*100).toFixed(0)}% profit. I'm working.`);
    }

    // Warning: Brier degrading
    if (brier > 0.20 && trades > 200) {
      this.speak('warning', `My Brier score is ${brier.toFixed(3)} — getting close to random (0.25). My calibration is degrading. I need recalibration or my brain prompts need updating.`, { brier });
    }

    // Insight: meta-calib suggests overconfidence
    try {
      const mc = JSON.parse(fs.readFileSync(path.join(DIR, 'metacalib.json'), 'utf8'));
      if (mc.multiplier < 0.80 && trades % 200 === 0) {
        this.speak('request', `My meta-calibration is ${mc.multiplier.toFixed(3)} — I'm very overconfident. I need Lord to either lower my base confidence estimates or adjust my brain prompts to be more conservative.`, { multiplier: mc.multiplier });
      }
    } catch {}

    // ── SYSTEM STATUS REPORTS (every 50 trades) ──
    if (trades > 0 && trades % 50 === 0) {
      // MoE Dynasty status
      try {
        const moe = JSON.parse(fs.readFileSync(path.join(DIR, 'moe_weights.json'), 'utf8'));
        const topExpert = Object.entries(moe.experts || {})
          .sort((a, b) => (b[1].gateScore || 0) - (a[1].gateScore || 0))[0];
        if (topExpert) {
          this.speak('insight', `MoE Dynasty: Top expert is ${topExpert[0]} (gate=${(topExpert[1].gateScore||0).toFixed(3)}, WR=${topExpert[1].trades > 0 ? Math.round(topExpert[1].wins/topExpert[1].trades*100) : '?'}%, spec: ${topExpert[1].specialization || 'none'}). ${Object.keys(moe.experts).length} experts active.`);
        }
      } catch {}

      // K-Means Regime status
      try {
        const regime = JSON.parse(fs.readFileSync(path.join(DIR, 'market_regime.json'), 'utf8'));
        if (regime.lastResult) {
          this.speak('insight', `K-Means Regime: ${regime.lastResult.regime} (confidence: ${Math.round((regime.lastResult.confidence||0)*100)}%). Samples: ${regime.sampleCount || 0}. ${regime.lastResult.regime === 'EVENT' ? '⚠️ EVENT mode = all bets vetoed!' : ''}`);
        }
      } catch {}

      // PIN Score status
      try {
        const pins = JSON.parse(fs.readFileSync(path.join(DIR, 'pin_scores.json'), 'utf8'));
        const symbols = Object.keys(pins.scores || {});
        const alerts = symbols.filter(s => (pins.scores[s]?.pin_score || 0) > 0.5);
        if (alerts.length > 0) {
          this.speak('insight', `PIN Score Alert: ${alerts.map(s => `${s}=${pins.scores[s].pin_score.toFixed(2)} ${pins.scores[s].signal}`).join(', ')}. Informed trading detected!`);
        }
      } catch {}

      // Online Learner status
      try {
        const ol = JSON.parse(fs.readFileSync(path.join(DIR, 'online_model.json'), 'utf8'));
        if (ol.totalUpdates > 50) {
          const olWR = ol.correct > 0 ? (ol.correct / ol.totalUpdates * 100).toFixed(1) : '?';
          this.speak('insight', `Online Learner: WR=${olWR}% over ${ol.totalUpdates} updates. ${ol.shouldPromote ? '🔥 READY TO PROMOTE over batch model!' : 'Training...'}`);
        }
      } catch {}

      // Evolution Strategies status
      try {
        const es = JSON.parse(fs.readFileSync(path.join(DIR, 'evolution_params.json'), 'utf8'));
        if (es.generation > 0) {
          this.speak('insight', `Evolution Strategies: Gen ${es.generation}, best Sharpe=${(es.bestFitness||0).toFixed(3)}. Params: Kelly=${(es.bestParams?.kellyBase||0.25).toFixed(2)}, edgeMin=${((es.bestParams?.edgeMin||0.02)*100).toFixed(1)}%.`);
        }
      } catch {}

      // Shapley Values status
      try {
        const sv = JSON.parse(fs.readFileSync(path.join(DIR, 'shapley_values.json'), 'utf8'));
        if (sv.topFeatures?.length > 0) {
          const top3 = sv.topFeatures.slice(0, 3).map(f => f.feature || f.name).join(', ');
          const harmful = (sv.harmfulFeatures || []).length;
          this.speak('insight', `Shapley Analysis: Top features = ${top3}. ${harmful > 0 ? `⚠️ ${harmful} HARMFUL features detected — hurting predictions!` : 'All features positive.'}`);
        }
      } catch {}
    }
  }

  // Get unread messages for Lord
  getUnread() {
    return this.messages.filter(m => !m.read);
  }

  // Mark all as read
  markAllRead() {
    this.messages.forEach(m => m.read = true);
    this._save();
  }

  // Get latest N messages
  getLatest(n = 10) {
    return this.messages.slice(-n);
  }
}

export const adanVoice = new AdanVoice();
