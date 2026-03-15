// src/ml/online_learner.js
// Concept #16: Online Learning — Stochastic Gradient Descent per resolved trade
// Independent model that learns incrementally with exponential decay on old samples.
// Compares itself against the batch logistic regression and flags for promotion when winning.

import fs from 'fs';
import path from 'path';
import { ALL_FEATURES, N_FEATURES } from './logistic_regression.js';

const DIR = path.join(process.env.HOME, '.adan-pred');
const MODEL_PATH = path.join(DIR, 'online_model.json');

// ── Feature sets (same partition as logistic_regression.js) ──
const BINARY_FEATURES = ['sellWallTrap', 'buyWallTrap', 'side_is_yes'];
const CYCLICAL_FEATURES = ['hour_sin', 'hour_cos'];

// ── Math helpers ──
function sigmoid(z) {
  if (z > 500) return 1;
  if (z < -500) return 0;
  return 1 / (1 + Math.exp(-z));
}

function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

export class OnlineLearner {

  constructor() {
    // SGD hyperparameters
    this.eta0 = 0.01;          // Initial learning rate
    this.lrDecay = 0.001;      // Adaptive LR decay: eta_t = eta0 / (1 + decay * t)
    this.lambda = 0.01;        // L2 regularization (same as walk_forward)
    this.sampleDecay = 0.995;  // Exponential decay: weight_t = lambda^(T-t)

    // Model parameters
    this.weights = new Float64Array(N_FEATURES).fill(0);
    this.bias = 0;

    // Running normalization (Welford online mean/variance)
    this.mean = new Float64Array(N_FEATURES).fill(0);
    this.std = new Float64Array(N_FEATURES).fill(1);
    this.m2 = new Float64Array(N_FEATURES).fill(0);  // Running sum of squares of diffs
    this.nSamples = 0;

    // Performance tracking (online metrics)
    this.totalUpdates = 0;
    this.onlineCorrect = 0;     // Correct predictions (before update)
    this.onlineTotal = 0;       // Total predictions evaluated
    this.brierSum = 0;          // Running Brier score sum
    this.logLossSum = 0;        // Running log-loss sum
    this.recentResults = [];    // Last 100 trades: { predicted, actual, won }

    // Comparison with batch model
    this.batchCorrectRecent = 0;  // Batch model correct in last 100
    this.batchTotalRecent = 0;

    this._load();
  }

  // ── Convert feature object to array (same as logistic_regression.js) ──
  _toArray(features) {
    return ALL_FEATURES.map(f => features[f] ?? 0);
  }

  // ── Online normalization update (Welford's algorithm) ──
  _updateNormalization(x) {
    this.nSamples++;
    for (let i = 0; i < N_FEATURES; i++) {
      const name = ALL_FEATURES[i];
      if (BINARY_FEATURES.includes(name) || CYCLICAL_FEATURES.includes(name)) continue;
      const delta = x[i] - this.mean[i];
      this.mean[i] += delta / this.nSamples;
      const delta2 = x[i] - this.mean[i];
      this.m2[i] += delta * delta2;
      this.std[i] = this.nSamples > 1 ? Math.sqrt(this.m2[i] / (this.nSamples - 1)) : 1;
      if (this.std[i] < 1e-8) this.std[i] = 1;
    }
  }

  // ── Z-score normalize ──
  _normalize(x) {
    const z = new Float64Array(N_FEATURES);
    for (let i = 0; i < N_FEATURES; i++) {
      const name = ALL_FEATURES[i];
      if (BINARY_FEATURES.includes(name) || CYCLICAL_FEATURES.includes(name)) {
        z[i] = x[i];
      } else {
        z[i] = this.std[i] > 1e-8 ? (x[i] - this.mean[i]) / this.std[i] : 0;
      }
    }
    return z;
  }

  // ── PREDICT: Get win probability from online model ──
  predict(features) {
    if (this.totalUpdates < 30) {
      return { probability: 0.5, rawScore: 0, confident: false, ready: false };
    }

    const x = this._toArray(features);
    const xn = this._normalize(x);

    let z = this.bias;
    for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * xn[j];
    const probability = sigmoid(z);

    return {
      probability: parseFloat(probability.toFixed(4)),
      rawScore: parseFloat(z.toFixed(4)),
      confident: Math.abs(probability - 0.5) > 0.08,
      ready: true,
    };
  }

  // ── UPDATE: Single-sample SGD with exponential decay ──
  // Called after every resolved trade
  // features: feature object (same format as logistic_regression extractFeatures output)
  // outcome: boolean (true = win, false = loss)
  // batchProb: optional — batch model's prediction for comparison tracking
  update(features, outcome, batchProb) {
    const x = this._toArray(features);
    const y = outcome ? 1 : 0;

    // Update normalization stats BEFORE normalizing
    this._updateNormalization(x);
    const xn = this._normalize(x);

    // Forward pass (prediction BEFORE update — for honest performance tracking)
    let z = this.bias;
    for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * xn[j];
    const pBefore = sigmoid(z);

    // Track online performance (pre-update prediction vs actual)
    if (this.totalUpdates >= 30) {
      const predictedWin = pBefore >= 0.5;
      const actualWin = y === 1;
      const correct = predictedWin === actualWin;
      this.onlineCorrect += correct ? 1 : 0;
      this.onlineTotal++;

      // Brier score: (predicted - actual)^2
      this.brierSum += Math.pow(pBefore - y, 2);

      // Log-loss
      const pClipped = clip(pBefore, 1e-7, 1 - 1e-7);
      this.logLossSum += -(y * Math.log(pClipped) + (1 - y) * Math.log(1 - pClipped));

      // Recent results window (last 100)
      this.recentResults.push({ predicted: pBefore, actual: y, correct });
      if (this.recentResults.length > 100) this.recentResults.shift();

      // Batch model comparison tracking
      if (batchProb != null) {
        const batchCorrect = (batchProb >= 0.5) === actualWin;
        this.batchCorrectRecent++;
        this.batchTotalRecent++;
        if (!batchCorrect) this.batchCorrectRecent--;
        // Keep in sync with recentResults window
        if (this.batchTotalRecent > 100) {
          // Approximate: can't perfectly reconstruct, so use rolling ratio
          this.batchCorrectRecent = Math.round(this.batchCorrectRecent * 100 / this.batchTotalRecent);
          this.batchTotalRecent = 100;
        }
      }
    }

    // Adaptive learning rate: eta_t = eta0 / (1 + decay * t)
    const eta = this.eta0 / (1 + this.lrDecay * this.totalUpdates);

    // Exponential decay: apply weight decay to all previous sample influence
    // This is implemented as a scaling on the regularization term — more recent
    // samples have full gradient, old ones are implicitly decayed through the
    // accumulated weight drift toward zero from regularization.
    // For explicit decay, we scale the gradient's contribution:
    const sampleWeight = 1.0; // Current sample always has full weight

    // SGD update with L2 regularization
    const err = pBefore - y;
    for (let j = 0; j < N_FEATURES; j++) {
      // Gradient = error * feature + L2 penalty
      // Apply exponential decay via weight shrinkage: w *= sampleDecay each step
      this.weights[j] *= this.sampleDecay; // Exponential decay on old contributions
      this.weights[j] -= eta * (sampleWeight * err * xn[j] + 2 * this.lambda * this.weights[j]);
    }
    this.bias *= this.sampleDecay;
    this.bias -= eta * sampleWeight * err;

    this.totalUpdates++;

    // Persist every 10 updates
    if (this.totalUpdates % 10 === 0) {
      this._save();
    }
  }

  // ── ONLINE METRICS ──
  get onlineWR() {
    return this.onlineTotal > 0 ? this.onlineCorrect / this.onlineTotal : 0;
  }

  get onlineBrier() {
    return this.onlineTotal > 0 ? this.brierSum / this.onlineTotal : 0.25;
  }

  get onlineLogLoss() {
    return this.onlineTotal > 0 ? this.logLossSum / this.onlineTotal : 0.693;
  }

  // Recent window (last 100 trades) WR
  get recentWR() {
    if (this.recentResults.length < 10) return 0;
    const wins = this.recentResults.filter(r => r.correct).length;
    return wins / this.recentResults.length;
  }

  // Batch model recent WR (from tracked comparisons)
  get batchRecentWR() {
    return this.batchTotalRecent > 0 ? this.batchCorrectRecent / this.batchTotalRecent : 0;
  }

  // ── SHOULD PROMOTE: Is online model beating batch by 2%+ over last 100? ──
  shouldPromote() {
    if (this.recentResults.length < 100) return false;
    if (this.batchTotalRecent < 50) return false;

    const onlineRecentWR = this.recentWR;
    const batchRecentWR = this.batchRecentWR;
    const delta = onlineRecentWR - batchRecentWR;

    return delta >= 0.02; // 2%+ advantage
  }

  // ── STATUS REPORT ──
  getStatus() {
    const recentLen = this.recentResults.length;
    const recentCorrect = recentLen > 0 ? this.recentResults.filter(r => r.correct).length : 0;

    return {
      totalUpdates: this.totalUpdates,
      ready: this.totalUpdates >= 30,
      onlineWR: parseFloat((this.onlineWR * 100).toFixed(1)),
      onlineBrier: parseFloat(this.onlineBrier.toFixed(4)),
      onlineLogLoss: parseFloat(this.onlineLogLoss.toFixed(4)),
      recentWR: parseFloat((this.recentWR * 100).toFixed(1)),
      recentWindow: recentLen,
      recentCorrect,
      batchRecentWR: parseFloat((this.batchRecentWR * 100).toFixed(1)),
      shouldPromote: this.shouldPromote(),
      promotionDelta: parseFloat(((this.recentWR - this.batchRecentWR) * 100).toFixed(1)),
      eta: parseFloat((this.eta0 / (1 + this.lrDecay * this.totalUpdates)).toFixed(6)),
      nSamples: this.nSamples,
    };
  }

  // ── COMPARISON DASHBOARD ──
  getComparisonDashboard() {
    const status = this.getStatus();
    const lines = [
      '━━━ ONLINE vs BATCH MODEL COMPARISON ━━━',
      `Online Updates: ${status.totalUpdates} | Ready: ${status.ready ? 'YES' : 'NO (need 30+)'}`,
      `Online WR:  ${status.onlineWR}% (all-time) | ${status.recentWR}% (last ${status.recentWindow})`,
      `Batch WR:   ${status.batchRecentWR}% (last ${this.batchTotalRecent} tracked)`,
      `Brier:      ${status.onlineBrier} | LogLoss: ${status.onlineLogLoss}`,
      `Current LR: ${status.eta}`,
    ];
    if (status.shouldPromote) {
      lines.push(`*** PROMOTION FLAG: Online beats batch by ${status.promotionDelta}% over 100 trades ***`);
    } else if (status.recentWindow >= 100) {
      lines.push(`Delta: ${status.promotionDelta}% (need +2.0% for promotion)`);
    }
    return lines.join('\n');
  }

  // ── Feature importance ──
  _getTopWeights() {
    const pairs = ALL_FEATURES.map((name, i) => ({ name, w: this.weights[i] }));
    pairs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    return pairs.slice(0, 5).map(p => `${p.name}:${p.w > 0 ? '+' : ''}${p.w.toFixed(3)}`);
  }

  // ── PERSISTENCE ──
  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    const data = {
      weights: Array.from(this.weights),
      bias: this.bias,
      mean: Array.from(this.mean),
      std: Array.from(this.std),
      m2: Array.from(this.m2),
      nSamples: this.nSamples,
      totalUpdates: this.totalUpdates,
      onlineCorrect: this.onlineCorrect,
      onlineTotal: this.onlineTotal,
      brierSum: this.brierSum,
      logLossSum: this.logLossSum,
      recentResults: this.recentResults,
      batchCorrectRecent: this.batchCorrectRecent,
      batchTotalRecent: this.batchTotalRecent,
      featureNames: ALL_FEATURES,
      hyperparams: {
        eta0: this.eta0,
        lrDecay: this.lrDecay,
        lambda: this.lambda,
        sampleDecay: this.sampleDecay,
      },
    };
    const tmp = MODEL_PATH + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, MODEL_PATH);
  }

  _load() {
    try {
      if (!fs.existsSync(MODEL_PATH)) return;
      const data = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
      if (!data.weights || data.weights.length !== N_FEATURES) {
        console.log(`[ONLINE-LEARNER] Feature count mismatch (${data.weights?.length} vs ${N_FEATURES}), resetting`);
        return;
      }
      this.weights = new Float64Array(data.weights);
      this.bias = data.bias || 0;
      this.mean = new Float64Array(data.mean || new Array(N_FEATURES).fill(0));
      this.std = new Float64Array(data.std || new Array(N_FEATURES).fill(1));
      this.m2 = new Float64Array(data.m2 || new Array(N_FEATURES).fill(0));
      this.nSamples = data.nSamples || 0;
      this.totalUpdates = data.totalUpdates || 0;
      this.onlineCorrect = data.onlineCorrect || 0;
      this.onlineTotal = data.onlineTotal || 0;
      this.brierSum = data.brierSum || 0;
      this.logLossSum = data.logLossSum || 0;
      this.recentResults = data.recentResults || [];
      this.batchCorrectRecent = data.batchCorrectRecent || 0;
      this.batchTotalRecent = data.batchTotalRecent || 0;
      if (this.totalUpdates > 0) {
        console.log(`[ONLINE-LEARNER] Loaded: ${this.totalUpdates} updates, WR=${(this.onlineWR * 100).toFixed(1)}%, Brier=${this.onlineBrier.toFixed(4)}`);
      }
    } catch (e) {
      console.log('[ONLINE-LEARNER] Could not load saved model:', e.message);
    }
  }
}

export const onlineLearner = new OnlineLearner();
