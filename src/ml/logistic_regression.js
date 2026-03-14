// src/ml/logistic_regression.js
// Pure JS L2-regularized Logistic Regression with Online SGD
// No external dependencies. Trained on ADAN's own trade history.
// This is ADAN's statistical brain — the LLM becomes advisor, not decider.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const MODEL_PATH = path.join(DIR, 'ml_model.json');

// ── Feature config ──
const NUMERIC_FEATURES = [
  'rsi', 'rsi5m', 'trend1m', 'trend5m', 'trend15m', 'trend1h',
  'bbPct', 'volRatio', 'volAccel', 'vwapPct', 'buyPressure',
  'obRatio', 'volatility', 'edge', 'confidence',
  // v7: Alien Intelligence features
  'macdHist',       // MACD histogram — momentum divergence
  'fundingRate',    // Binance funding rate — extreme = mean-reversion
  'priceDist',      // Distance from price to target (% edge)
  'timeToExpiry',   // Log(minutes to close) — short vs long windows
  'yesPrice',       // Market price itself (0.15-0.85)
  'fearGreed',      // Fear & Greed index (0-100, normalized)
  'rsi1h',          // 1-hour RSI — macro timeframe
  'effRatio',       // Efficiency ratio — trend cleanliness (0-1)
  // v7: Regime interaction features
  'rsi_x_trending',     // RSI signal when trending (momentum)
  'rsi_x_meanrev',      // RSI signal when mean-reverting (oversold bounce)
  'trend5m_x_trending', // Trend strength when trending (ride it)
  'volRatio_x_volatile',// Volume signal when volatile (breakout)
];
const BINARY_FEATURES = ['sellWallTrap', 'buyWallTrap', 'side_is_yes'];
// Cyclical: utcHour → sin + cos
const CYCLICAL_FEATURES = ['hour_sin', 'hour_cos'];

const ALL_FEATURES = [...NUMERIC_FEATURES, ...BINARY_FEATURES, ...CYCLICAL_FEATURES];
const N_FEATURES = ALL_FEATURES.length;

// ── Math helpers ──
function sigmoid(z) {
  if (z > 500) return 1;
  if (z < -500) return 0;
  return 1 / (1 + Math.exp(-z));
}

function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

export class LogisticRegression {

  constructor(options = {}) {
    this.lambda = options.lambda ?? 0.01;     // L2 regularization
    this.lr = options.lr ?? 0.1;              // Learning rate
    this.lrOnline = options.lrOnline ?? 0.01; // Online update LR
    this.epochs = options.epochs ?? 300;
    this.lrDecay = options.lrDecay ?? 0.005;

    // Model params
    this.weights = new Float64Array(N_FEATURES).fill(0);
    this.bias = 0;

    // Normalization: per-feature mean and std
    this.mean = new Float64Array(N_FEATURES).fill(0);
    this.std = new Float64Array(N_FEATURES).fill(1);

    // Metadata
    this.trained = false;
    this.trainedAt = null;
    this.trainSamples = 0;
    this.trainWR = 0;
    this.oosWR = 0;
    this.onlineUpdates = 0;

    // Try to load saved model
    this._load();
  }

  // ── EXTRACT feature vector from trade data ──
  static extractFeatures(trade) {
    const vec = trade.entryVec || {};
    const hour = trade.entryTime ? new Date(trade.entryTime).getUTCHours() : 12;

    const features = {};
    // Numeric features — base
    for (const f of NUMERIC_FEATURES) {
      if (f === 'edge') features[f] = Math.abs(trade.edge || 0);
      else if (f === 'confidence') features[f] = trade.confidence || 50;
      // v7 alien features: pull from vec or defaults
      else if (f === 'macdHist') features[f] = vec.macdHist ?? 0;
      else if (f === 'fundingRate') features[f] = vec.fundingRate ?? 0;
      else if (f === 'priceDist') features[f] = vec.priceDist ?? 0;
      else if (f === 'timeToExpiry') features[f] = vec.timeToExpiry ?? 0;
      else if (f === 'yesPrice') features[f] = vec.yesPrice ?? 0.5;
      else if (f === 'fearGreed') features[f] = vec.fearGreed ?? 50;
      else if (f === 'rsi1h') features[f] = vec.rsi1h ?? 50;
      else if (f === 'effRatio') features[f] = vec.effRatio ?? 0.5;
      // Regime interactions
      else if (f === 'rsi_x_trending') features[f] = vec.rsi_x_trending ?? 0;
      else if (f === 'rsi_x_meanrev') features[f] = vec.rsi_x_meanrev ?? 0;
      else if (f === 'trend5m_x_trending') features[f] = vec.trend5m_x_trending ?? 0;
      else if (f === 'volRatio_x_volatile') features[f] = vec.volRatio_x_volatile ?? 0;
      else features[f] = vec[f] ?? 0;
    }
    // Binary features
    features.sellWallTrap = vec.sellWallTrap ? 1 : 0;
    features.buyWallTrap = vec.buyWallTrap ? 1 : 0;
    features.side_is_yes = trade.side === 'YES' ? 1 : 0;
    // Cyclical hour encoding
    features.hour_sin = Math.sin(2 * Math.PI * hour / 24);
    features.hour_cos = Math.cos(2 * Math.PI * hour / 24);

    return features;
  }

  // ── Convert feature object to array ──
  _toArray(features) {
    return ALL_FEATURES.map(f => features[f] ?? 0);
  }

  // ── Z-score normalize (skip binary and cyclical features) ──
  _normalize(x) {
    const z = new Float64Array(N_FEATURES);
    for (let i = 0; i < N_FEATURES; i++) {
      const name = ALL_FEATURES[i];
      if (BINARY_FEATURES.includes(name) || CYCLICAL_FEATURES.includes(name)) {
        z[i] = x[i]; // Don't normalize binary/cyclical
      } else {
        z[i] = this.std[i] > 1e-8 ? (x[i] - this.mean[i]) / this.std[i] : 0;
      }
    }
    return z;
  }

  // ── Compute normalization stats from data ──
  _computeNormalization(X) {
    const n = X.length;
    if (n === 0) return;

    for (let j = 0; j < N_FEATURES; j++) {
      if (BINARY_FEATURES.includes(ALL_FEATURES[j]) || CYCLICAL_FEATURES.includes(ALL_FEATURES[j])) continue;
      let sum = 0, sumSq = 0;
      for (let i = 0; i < n; i++) {
        sum += X[i][j];
        sumSq += X[i][j] * X[i][j];
      }
      this.mean[j] = sum / n;
      const variance = sumSq / n - this.mean[j] * this.mean[j];
      this.std[j] = Math.sqrt(Math.max(variance, 1e-8));
    }
  }

  // ── TRAIN: Batch gradient descent ──
  train(trades) {
    if (trades.length < 50) {
      console.log(`[STAT-MODEL] Need 50+ trades to train, got ${trades.length}`);
      return false;
    }

    // Build X, y matrices
    const X = [];
    const y = [];
    for (const t of trades) {
      if (!t.entryVec || Object.keys(t.entryVec).length < 5) continue;
      const features = LogisticRegression.extractFeatures(t);
      X.push(this._toArray(features));
      y.push(t.won === true || t.result === 'WIN' ? 1 : 0);
    }

    if (X.length < 50) {
      console.log(`[STAT-MODEL] Only ${X.length} valid feature vectors — need 50+`);
      return false;
    }

    // Compute normalization from training data
    this._computeNormalization(X);

    // Normalize
    const Xn = X.map(x => this._normalize(x));

    // Init weights
    this.weights = new Float64Array(N_FEATURES).fill(0);
    this.bias = 0;

    // Gradient descent
    const n = Xn.length;
    let lr = this.lr;

    for (let epoch = 0; epoch < this.epochs; epoch++) {
      lr = this.lr / (1 + epoch * this.lrDecay);

      // Compute gradients
      const dw = new Float64Array(N_FEATURES).fill(0);
      let db = 0;
      let loss = 0;

      for (let i = 0; i < n; i++) {
        let z = this.bias;
        for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * Xn[i][j];
        const p = sigmoid(z);
        const err = p - y[i];

        for (let j = 0; j < N_FEATURES; j++) {
          dw[j] += err * Xn[i][j];
        }
        db += err;

        // Log-loss
        loss += -(y[i] * Math.log(clip(p, 1e-7, 1 - 1e-7)) +
                  (1 - y[i]) * Math.log(clip(1 - p, 1e-7, 1 - 1e-7)));
      }

      // Average + L2 regularization
      for (let j = 0; j < N_FEATURES; j++) {
        dw[j] = dw[j] / n + 2 * this.lambda * this.weights[j];
      }
      db /= n;

      // Update
      for (let j = 0; j < N_FEATURES; j++) {
        this.weights[j] -= lr * dw[j];
      }
      this.bias -= lr * db;

      // Early stopping check
      if (epoch > 50 && epoch % 50 === 0) {
        const avgLoss = loss / n;
        if (avgLoss < 0.55) break; // Good enough
      }
    }

    // Compute training accuracy
    let correct = 0;
    for (let i = 0; i < n; i++) {
      let z = this.bias;
      for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * Xn[i][j];
      const pred = sigmoid(z) >= 0.5 ? 1 : 0;
      if (pred === y[i]) correct++;
    }

    this.trained = true;
    this.trainedAt = new Date().toISOString();
    this.trainSamples = n;
    this.trainWR = correct / n;

    this._save();

    console.log(`[STAT-MODEL] Trained on ${n} trades. Training accuracy: ${(this.trainWR * 100).toFixed(1)}%`);
    return true;
  }

  // ── PREDICT: Get win probability for a new trade ──
  predict(tradeOrFeatures) {
    if (!this.trained) return { probability: 0.5, rawScore: 0, confident: false };

    const features = tradeOrFeatures.entryVec
      ? LogisticRegression.extractFeatures(tradeOrFeatures)
      : tradeOrFeatures;
    const x = this._toArray(features);
    const xn = this._normalize(x);

    let z = this.bias;
    for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * xn[j];
    const probability = sigmoid(z);

    return {
      probability: parseFloat(probability.toFixed(4)),
      rawScore: parseFloat(z.toFixed(4)),
      confident: Math.abs(probability - 0.5) > 0.08, // >58% or <42%
      weights: this._getTopWeights(),
    };
  }

  // ── ONLINE UPDATE: Single-sample SGD ──
  updateOnline(tradeOrFeatures, won) {
    if (!this.trained) return;

    const features = tradeOrFeatures.entryVec
      ? LogisticRegression.extractFeatures(tradeOrFeatures)
      : tradeOrFeatures;
    const x = this._toArray(features);
    const xn = this._normalize(x);
    const y = won ? 1 : 0;

    let z = this.bias;
    for (let j = 0; j < N_FEATURES; j++) z += this.weights[j] * xn[j];
    const p = sigmoid(z);
    const err = p - y;

    // SGD update
    for (let j = 0; j < N_FEATURES; j++) {
      this.weights[j] -= this.lrOnline * (err * xn[j] + 2 * this.lambda * this.weights[j]);
    }
    this.bias -= this.lrOnline * err;

    this.onlineUpdates++;

    // Re-save every 20 updates
    if (this.onlineUpdates % 20 === 0) {
      this._save();
    }
  }

  // ── Feature importance: top weights by absolute value ──
  _getTopWeights() {
    const pairs = ALL_FEATURES.map((name, i) => ({ name, w: this.weights[i] }));
    pairs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    return pairs.slice(0, 5).map(p => `${p.name}:${p.w > 0 ? '+' : ''}${p.w.toFixed(3)}`);
  }

  getFeatureImportance() {
    const pairs = ALL_FEATURES.map((name, i) => ({ name, weight: this.weights[i], absWeight: Math.abs(this.weights[i]) }));
    pairs.sort((a, b) => b.absWeight - a.absWeight);
    return pairs;
  }

  // ── Prompt context for LLM advisor ──
  getPromptContext(trade) {
    if (!this.trained) return '';
    const pred = this.predict(trade);
    const lines = ['━━━ STATISTICAL MODEL (Logistic Regression) ━━━'];
    lines.push(`Win probability: ${(pred.probability * 100).toFixed(1)}% | Confident: ${pred.confident ? 'YES' : 'NO'}`);
    lines.push(`Top features: ${pred.weights.join(', ')}`);
    lines.push(`Model: trained on ${this.trainSamples} trades, ${this.onlineUpdates} online updates`);
    if (pred.probability < 0.42) lines.push('⚠ MODEL SAYS: HIGH LOSS RISK — consider skipping');
    else if (pred.probability > 0.58) lines.push('✅ MODEL SAYS: FAVORABLE — statistical edge detected');
    return lines.join('\n');
  }

  // ── SERIALIZE / DESERIALIZE ──
  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    const data = {
      weights: Array.from(this.weights),
      bias: this.bias,
      mean: Array.from(this.mean),
      std: Array.from(this.std),
      trained: this.trained,
      trainedAt: this.trainedAt,
      trainSamples: this.trainSamples,
      trainWR: this.trainWR,
      oosWR: this.oosWR,
      onlineUpdates: this.onlineUpdates,
      featureNames: ALL_FEATURES,
      lambda: this.lambda,
    };
    const tmp = MODEL_PATH + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, MODEL_PATH);
  }

  _load() {
    try {
      if (!fs.existsSync(MODEL_PATH)) return;
      const data = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
      if (data.weights) {
        if (data.weights.length === N_FEATURES) {
          // Exact match — load directly
          this.weights = new Float64Array(data.weights);
          this.mean = new Float64Array(data.mean || new Array(N_FEATURES).fill(0));
          this.std = new Float64Array(data.std || new Array(N_FEATURES).fill(1));
          this.trained = data.trained || false;
        } else if (data.featureNames) {
          // Feature count changed — migrate: copy matching features, zero new ones
          console.log(`[STAT-MODEL] Feature count changed ${data.weights.length} → ${N_FEATURES}, will retrain on next dream cycle`);
          this.trained = false; // Force retrain with new features
        }
        this.bias = data.bias || 0;
        this.trainedAt = data.trainedAt;
        this.trainSamples = data.trainSamples || 0;
        this.trainWR = data.trainWR || 0;
        this.oosWR = data.oosWR || 0;
        this.onlineUpdates = data.onlineUpdates || 0;
        if (this.trained) {
          console.log(`[STAT-MODEL] Loaded model: ${this.trainSamples} training samples, OOS WR: ${(this.oosWR * 100).toFixed(1)}%, ${this.onlineUpdates} online updates`);
        }
      }
    } catch (e) {
      console.log('[STAT-MODEL] Could not load saved model:', e.message);
    }
  }

  getStatus() {
    return {
      trained: this.trained,
      trainSamples: this.trainSamples,
      trainWR: parseFloat((this.trainWR * 100).toFixed(1)),
      oosWR: parseFloat((this.oosWR * 100).toFixed(1)),
      onlineUpdates: this.onlineUpdates,
      trainedAt: this.trainedAt,
      topFeatures: this.trained ? this._getTopWeights() : [],
    };
  }
}

export const statModel = new LogisticRegression();
export { ALL_FEATURES, N_FEATURES };
