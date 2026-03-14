// src/core/experiment_engine.js
// ADAN Experiment Engine — Autonomous hypothesis testing
// ADAN can propose, execute, and evaluate its own experiments
// Ultra Consciousness Layer v2.0
//
// Flow:
//   1. ADAN (or self-reader) proposes a hypothesis
//   2. Engine creates an experiment with criteria + duration
//   3. During trading, experiment gates are checked
//   4. After N trades or time limit, experiment is evaluated
//   5. If successful → parameters are absorbed. If not → reverted.

import fs from 'fs';
import path from 'path';
import { DIR, loadPnL } from './config.js';
import { callGemma } from '../../adan-llm-router.js';

const EXPERIMENTS_PATH = path.join(DIR, 'experiments.json');
const EXPERIMENT_LOG_PATH = path.join(DIR, 'experiment_log.jsonl');

const MAX_ACTIVE_EXPERIMENTS = 2; // Max concurrent experiments

export class ExperimentEngine {

  constructor() {
    this.data = this._load();
  }

  _load() {
    const defaults = {
      active: [],      // Currently running experiments
      completed: [],   // Finished experiments (last 20)
      proposed: [],    // Waiting for approval or auto-start
      totalRun: 0,
    };
    try {
      if (fs.existsSync(EXPERIMENTS_PATH)) {
        return { ...defaults, ...JSON.parse(fs.readFileSync(EXPERIMENTS_PATH, 'utf8')) };
      }
    } catch {}
    return defaults;
  }

  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    // Keep completed list manageable
    if (this.data.completed.length > 20) {
      this.data.completed = this.data.completed.slice(-20);
    }
    fs.writeFileSync(EXPERIMENTS_PATH, JSON.stringify(this.data, null, 2));
  }

  // ── PROPOSE: ADAN generates hypotheses from its self-analysis ──
  async proposeFromInsights(selfInsights, pnl) {
    if (!selfInsights) return null;
    if (this.data.active.length >= MAX_ACTIVE_EXPERIMENTS) {
      console.log('[EXPERIMENT] Already running max experiments');
      return null;
    }

    const wr = pnl.trades > 0 ? (pnl.wins / pnl.trades * 100).toFixed(1) : '50';
    const prompt = `You are ADAN-PRED, an autonomous trading agent. Based on your self-analysis, propose ONE experiment to test.

YOUR SELF-ANALYSIS:
- Recurring patterns: ${(selfInsights.recurring || []).join(', ') || 'none'}
- Ignored warnings: ${(selfInsights.ignored || []).join(', ') || 'none'}
- Emotional drift: ${selfInsights.drift || 'stable'}
- Suggested action: ${selfInsights.action || 'none'}
- Current WR: ${wr}% over ${pnl.trades} trades
- Fund: $${(pnl.fund || 10000).toFixed(0)}

EXPERIMENT RULES:
- Must be testable with 30-100 trades
- Must have a clear success metric (WR improvement, PnL improvement, etc)
- Must be a PARAMETER CHANGE you can actually control (confidence gate, edge threshold, hour filter, etc)
- NOT allowed: "get more data", "add new source", "change brain" (those require Lord)

Respond in EXACTLY this format:
HYPOTHESIS: <what you think will improve>
CHANGE: <parameter>=<new_value> (e.g. confGate=70, minEdge=0.04, hourBlock=2-5, onlyRegime=TRENDING_UP)
DURATION: <number of trades to test, 30-100>
SUCCESS: <metric>=<threshold> (e.g. WR>58%, PnL>$200, brierScore<0.18)
REVERT: <parameter>=<current_value>

ONE experiment only. Be specific.`;

    try {
      const response = await callGemma(prompt, { temperature: 0.3, maxTokens: 300 });
      if (!response || response.length < 30) return null;

      const experiment = this._parseProposal(response);
      if (!experiment) return null;

      experiment.id = `exp_${Date.now()}`;
      experiment.proposedAt = new Date().toISOString();
      experiment.status = 'proposed';
      experiment.trades = [];
      experiment.tradesCount = 0;
      experiment.wins = 0;
      experiment.totalPnl = 0;

      this.data.proposed.push(experiment);
      this._save();

      console.log(`[EXPERIMENT] 🧪 Proposed: "${experiment.hypothesis}" → ${experiment.changeParam}=${experiment.changeValue} for ${experiment.duration} trades`);
      return experiment;
    } catch (e) {
      console.log('[EXPERIMENT] Error proposing:', e.message);
      return null;
    }
  }

  _parseProposal(text) {
    const exp = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('HYPOTHESIS:')) exp.hypothesis = trimmed.replace('HYPOTHESIS:', '').trim();
      else if (trimmed.startsWith('CHANGE:')) {
        const change = trimmed.replace('CHANGE:', '').trim();
        const [param, val] = change.split('=').map(s => s.trim());
        exp.changeParam = param;
        exp.changeValue = val;
      }
      else if (trimmed.startsWith('DURATION:')) {
        const d = parseInt(trimmed.replace('DURATION:', '').trim());
        exp.duration = Math.min(100, Math.max(30, d || 50));
      }
      else if (trimmed.startsWith('SUCCESS:')) exp.successCriteria = trimmed.replace('SUCCESS:', '').trim();
      else if (trimmed.startsWith('REVERT:')) {
        const revert = trimmed.replace('REVERT:', '').trim();
        const [param, val] = revert.split('=').map(s => s.trim());
        exp.revertParam = param;
        exp.revertValue = val;
      }
    }

    if (!exp.hypothesis || !exp.changeParam || !exp.duration) return null;
    return exp;
  }

  // ── AUTO-START: Move proposed experiments to active ──
  autoStart() {
    if (this.data.active.length >= MAX_ACTIVE_EXPERIMENTS) return;
    if (this.data.proposed.length === 0) return;

    const exp = this.data.proposed.shift();
    exp.status = 'active';
    exp.startedAt = new Date().toISOString();
    this.data.active.push(exp);
    this.data.totalRun++;
    this._save();

    console.log(`[EXPERIMENT] 🚀 Started experiment: "${exp.hypothesis}" (${exp.changeParam}=${exp.changeValue})`);
    return exp;
  }

  // ── RECORD: Track trade outcomes during experiment ──
  recordTrade({ won, pnl, edge, confidence }) {
    if (this.data.active.length === 0) return;

    for (const exp of this.data.active) {
      exp.tradesCount++;
      if (won) exp.wins++;
      exp.totalPnl += pnl || 0;
    }
    this._save();
  }

  // ── CHECK: Should experiment parameters apply? ──
  getActiveOverrides() {
    const overrides = {};
    for (const exp of this.data.active) {
      if (exp.changeParam && exp.changeValue) {
        overrides[exp.changeParam] = exp.changeValue;
      }
    }
    return overrides;
  }

  // ── EVALUATE: Check if experiments reached their duration and judge results ──
  evaluate() {
    const results = [];

    for (let i = this.data.active.length - 1; i >= 0; i--) {
      const exp = this.data.active[i];
      if (exp.tradesCount < exp.duration) continue;

      // Experiment complete — evaluate
      const wr = exp.tradesCount > 0 ? (exp.wins / exp.tradesCount * 100) : 0;
      const success = this._checkSuccess(exp, wr);

      exp.status = success ? 'success' : 'failed';
      exp.completedAt = new Date().toISOString();
      exp.resultWR = parseFloat(wr.toFixed(1));
      exp.resultPnL = parseFloat(exp.totalPnl.toFixed(2));
      exp.success = success;

      this.data.completed.push(exp);
      this.data.active.splice(i, 1);

      // Log result
      const logEntry = {
        ts: new Date().toISOString(),
        id: exp.id,
        hypothesis: exp.hypothesis,
        change: `${exp.changeParam}=${exp.changeValue}`,
        duration: exp.duration,
        resultWR: exp.resultWR,
        resultPnL: exp.resultPnL,
        success,
      };
      fs.appendFileSync(EXPERIMENT_LOG_PATH, JSON.stringify(logEntry) + '\n');

      const emoji = success ? '✅' : '❌';
      console.log(`[EXPERIMENT] ${emoji} "${exp.hypothesis}" → WR: ${wr.toFixed(1)}% PnL: $${exp.totalPnl.toFixed(0)} → ${success ? 'SUCCESS — keeping changes' : 'FAILED — reverting'}`);

      results.push(exp);
    }

    this._save();
    return results;
  }

  _checkSuccess(exp, wr) {
    if (!exp.successCriteria) return wr > 55; // Default: WR > 55%

    const criteria = exp.successCriteria.toLowerCase();
    // Parse criteria like "WR>58%" or "PnL>$200"
    const wrMatch = criteria.match(/wr\s*>\s*(\d+)/);
    if (wrMatch) return wr > parseFloat(wrMatch[1]);

    const pnlMatch = criteria.match(/pnl\s*>\s*\$?(\d+)/);
    if (pnlMatch) return exp.totalPnl > parseFloat(pnlMatch[1]);

    // Fallback
    return wr > 55;
  }

  // ── STATUS for dashboard/voice ──
  getStatus() {
    return {
      active: this.data.active.map(e => ({
        id: e.id,
        hypothesis: e.hypothesis,
        change: `${e.changeParam}=${e.changeValue}`,
        progress: `${e.tradesCount}/${e.duration}`,
        currentWR: e.tradesCount > 0 ? (e.wins / e.tradesCount * 100).toFixed(1) + '%' : 'N/A',
        pnl: e.totalPnl?.toFixed(2) || '0',
      })),
      proposed: this.data.proposed.length,
      completed: this.data.completed.length,
      totalRun: this.data.totalRun,
      lastCompleted: this.data.completed.length > 0
        ? this.data.completed[this.data.completed.length - 1]
        : null,
    };
  }
}

export const experimentEngine = new ExperimentEngine();
