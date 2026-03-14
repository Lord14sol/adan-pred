// src/ml/ensemble.js
// Ensemble System — Combines 3 voters with learned weights
// 1. Statistical Model (logistic regression)
// 2. LLM Advisor (Gemma/Gemini brain)
// 3. Rule-Based signals (hour filter, soul memory, feature importance)
//
// Uses log-linear pooling (geometric mean in probability space)
// Weights are updated after each trade resolves via gradient descent on log-loss

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const ENSEMBLE_PATH = path.join(DIR, 'ensemble_weights.json');
const ENSEMBLE_LOG_PATH = path.join(DIR, 'ensemble_log.jsonl');

export class Ensemble {

  constructor() {
    this.weights = { stat: 0.5, llm: 0.3, rules: 0.2 };
    this.lr = 0.05; // Weight learning rate
    this.minWeight = 0.05; // Minimum weight per component
    this.history = []; // Last 100 predictions for weight learning
    this.stats = { totalPredictions: 0, statWins: 0, llmWins: 0, rulesWins: 0 };
    this._load();
  }

  // ── COMBINE: Get ensemble probability ──
  // statProb: logistic regression P(win)
  // llmProb: LLM brain's probability estimate (0-1)
  // rulesProb: rule-based signals probability (0-1)
  combine(statProb, llmProb, rulesProb) {
    // Clip probabilities to avoid log(0)
    const clip = (p) => Math.max(0.01, Math.min(0.99, p));
    const ps = clip(statProb);
    const pl = clip(llmProb);
    const pr = clip(rulesProb);

    // Log-linear pooling: weighted geometric mean
    const logP = this.weights.stat * Math.log(ps) +
                 this.weights.llm * Math.log(pl) +
                 this.weights.rules * Math.log(pr);
    const logQ = this.weights.stat * Math.log(1 - ps) +
                 this.weights.llm * Math.log(1 - pl) +
                 this.weights.rules * Math.log(1 - pr);

    // Normalize
    const pRaw = Math.exp(logP);
    const qRaw = Math.exp(logQ);
    const ensembleProb = pRaw / (pRaw + qRaw);

    // Disagreement detection
    const probs = [statProb, llmProb, rulesProb];
    const maxDisagreement = Math.max(...probs) - Math.min(...probs);
    const anyVeto = (statProb < 0.35 && llmProb > 0.6) || (statProb > 0.65 && llmProb < 0.35);

    this.stats.totalPredictions++;

    const result = {
      probability: parseFloat(ensembleProb.toFixed(4)),
      components: {
        stat: parseFloat(statProb.toFixed(3)),
        llm: parseFloat(llmProb.toFixed(3)),
        rules: parseFloat(rulesProb.toFixed(3)),
      },
      weights: { ...this.weights },
      disagreement: parseFloat(maxDisagreement.toFixed(3)),
      veto: anyVeto,
      decision: ensembleProb >= 0.55 ? 'BET' : ensembleProb <= 0.42 ? 'SKIP' : 'MARGINAL',
    };

    return result;
  }

  // ── BUILD rule-based probability ──
  // Converts existing signals into a 0-1 probability
  buildRulesProb({ hourWR, hourTrades, soulRecommendation, soulConfidence, featureScore }) {
    let prob = 0.5; // Start neutral

    // Hour filter: strong signal if enough data
    if (hourTrades >= 20) {
      prob += (hourWR - 0.5) * 0.3; // Scale hour WR contribution
    }

    // Soul Memory recommendation
    if (soulRecommendation === 'STRONG_AVOID') prob -= 0.15;
    else if (soulRecommendation === 'CAUTION') prob -= 0.08;
    else if (soulRecommendation === 'FAVOR') prob += 0.10;

    // Feature importance score (if available)
    if (featureScore != null) {
      prob += (featureScore - 50) / 200; // Normalize 0-100 to small adjustment
    }

    return Math.max(0.1, Math.min(0.9, prob));
  }

  // ── UPDATE WEIGHTS after trade resolves ──
  // Each component's weight is updated based on its calibration
  updateWeights(statProb, llmProb, rulesProb, actualWon) {
    const actual = actualWon ? 1 : 0;

    // Store in history
    this.history.push({ stat: statProb, llm: llmProb, rules: rulesProb, actual });
    if (this.history.length > 100) this.history.shift();

    // Compute log-loss for each component
    const clip = (p) => Math.max(1e-7, Math.min(1 - 1e-7, p));
    const logLoss = (p, y) => -(y * Math.log(clip(p)) + (1 - y) * Math.log(clip(1 - p)));

    const statLoss = logLoss(statProb, actual);
    const llmLoss = logLoss(llmProb, actual);
    const rulesLoss = logLoss(rulesProb, actual);

    // Better loss → increase weight (use inverse loss as signal)
    // Gradient: move weight towards components with lower loss
    const totalLoss = statLoss + llmLoss + rulesLoss;
    if (totalLoss < 0.001) return; // All perfect (shouldn't happen)

    const targetStat = 1 - (statLoss / totalLoss);
    const targetLlm = 1 - (llmLoss / totalLoss);
    const targetRules = 1 - (rulesLoss / totalLoss);

    // Smooth update towards target
    this.weights.stat += this.lr * (targetStat - this.weights.stat);
    this.weights.llm += this.lr * (targetLlm - this.weights.llm);
    this.weights.rules += this.lr * (targetRules - this.weights.rules);

    // Enforce minimum weights + normalize to sum=1
    this.weights.stat = Math.max(this.minWeight, this.weights.stat);
    this.weights.llm = Math.max(this.minWeight, this.weights.llm);
    this.weights.rules = Math.max(this.minWeight, this.weights.rules);

    const sum = this.weights.stat + this.weights.llm + this.weights.rules;
    this.weights.stat /= sum;
    this.weights.llm /= sum;
    this.weights.rules /= sum;

    // Round for cleanliness
    this.weights.stat = parseFloat(this.weights.stat.toFixed(4));
    this.weights.llm = parseFloat(this.weights.llm.toFixed(4));
    this.weights.rules = parseFloat(this.weights.rules.toFixed(4));

    // Track which component "won" this prediction
    const bestPred = statLoss <= llmLoss && statLoss <= rulesLoss ? 'stat'
                   : llmLoss <= rulesLoss ? 'llm' : 'rules';
    this.stats[bestPred + 'Wins'] = (this.stats[bestPred + 'Wins'] || 0) + 1;

    // Log
    try {
      const entry = {
        ts: new Date().toISOString(),
        actual,
        preds: { stat: parseFloat(statProb.toFixed(3)), llm: parseFloat(llmProb.toFixed(3)), rules: parseFloat(rulesProb.toFixed(3)) },
        losses: { stat: parseFloat(statLoss.toFixed(3)), llm: parseFloat(llmLoss.toFixed(3)), rules: parseFloat(rulesLoss.toFixed(3)) },
        weights: { ...this.weights },
        bestComponent: bestPred,
      };
      fs.appendFileSync(ENSEMBLE_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {}

    this._save();
  }

  // ── Prompt context for LLM ──
  getPromptContext(ensembleResult) {
    if (!ensembleResult) return '';
    const lines = ['━━━ ENSEMBLE SYSTEM ━━━'];
    lines.push(`Ensemble P(win): ${(ensembleResult.probability * 100).toFixed(1)}% → ${ensembleResult.decision}`);
    lines.push(`Components: STAT=${(ensembleResult.components.stat * 100).toFixed(0)}% (w=${(ensembleResult.weights.stat * 100).toFixed(0)}%) | LLM=${(ensembleResult.components.llm * 100).toFixed(0)}% (w=${(ensembleResult.weights.llm * 100).toFixed(0)}%) | RULES=${(ensembleResult.components.rules * 100).toFixed(0)}% (w=${(ensembleResult.weights.rules * 100).toFixed(0)}%)`);
    if (ensembleResult.veto) lines.push('⚠ VETO: Major disagreement between stat model and LLM');
    if (ensembleResult.disagreement > 0.3) lines.push(`⚠ High disagreement: ${(ensembleResult.disagreement * 100).toFixed(0)}% spread`);
    return lines.join('\n');
  }

  // ── Persistence ──
  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    const data = { weights: this.weights, stats: this.stats, historySize: this.history.length };
    fs.writeFileSync(ENSEMBLE_PATH, JSON.stringify(data, null, 2));
  }

  _load() {
    try {
      if (fs.existsSync(ENSEMBLE_PATH)) {
        const data = JSON.parse(fs.readFileSync(ENSEMBLE_PATH, 'utf8'));
        if (data.weights) this.weights = data.weights;
        if (data.stats) this.stats = data.stats;
      }
    } catch {}
  }

  getStatus() {
    return {
      weights: { ...this.weights },
      stats: { ...this.stats },
      historySize: this.history.length,
    };
  }
}

export const ensemble = new Ensemble();
