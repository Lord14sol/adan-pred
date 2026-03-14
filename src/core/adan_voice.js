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
