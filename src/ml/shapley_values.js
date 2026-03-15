// src/ml/shapley_values.js
// Shapley Value Feature Importance via Monte Carlo Approximation
// Concept #7: Game-theoretic feature attribution for ADAN's ML model.
// Runs once per Dream cycle. Identifies helpful, harmful, and irrelevant features.

import fs from 'fs';
import path from 'path';
import { ALL_FEATURES, N_FEATURES } from './logistic_regression.js';
import { LogisticRegression } from './logistic_regression.js';

const DIR = path.join(process.env.HOME, '.adan-pred');
const SHAPLEY_PATH = path.join(DIR, 'shapley_values.json');

// ── Config ──
const M_PERMUTATIONS = 100;     // Monte Carlo samples per feature
const MAX_TRADES = 500;         // Use last N closed trades with entryVec
const THRESHOLD_HELPFUL = 0.01; // Shapley > this = feature HELPS
const THRESHOLD_NOISE = 0.001;  // |Shapley| < this = irrelevant noise

// ── Fisher-Yates shuffle ──
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Compute accuracy of model on dataset using only a subset of features ──
// Features NOT in `activeSet` are zeroed out (mean-imputed via normalization).
function computeAccuracy(model, Xn, y, activeSet) {
  let correct = 0;
  const n = Xn.length;
  for (let i = 0; i < n; i++) {
    let z = model.bias;
    for (let j = 0; j < N_FEATURES; j++) {
      // Only include features in the active set
      if (activeSet.has(j)) {
        z += model.weights[j] * Xn[i][j];
      }
      // Inactive features contribute 0 (equivalent to mean-imputed after z-score)
    }
    const pred = 1 / (1 + Math.exp(-Math.min(500, Math.max(-500, z)))) >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct++;
  }
  return correct / n;
}

class ShapleyAnalyzer {
  constructor() {
    this.values = null;       // Array of { feature, shapley, stdErr, ci95lo, ci95hi, category }
    this.analyzedAt = null;
    this.tradeCount = 0;
    this.computeTimeMs = 0;
    this._load();
  }

  // ── Main analysis: Monte Carlo Shapley approximation ──
  analyze(trades, model) {
    const startTime = Date.now();

    // Filter trades with valid entryVec, take last MAX_TRADES
    const valid = trades
      .filter(t => t.entryVec && Object.keys(t.entryVec).length >= 5 &&
                   (t.won !== undefined || t.result))
      .slice(-MAX_TRADES);

    if (valid.length < 50) {
      console.log(`[SHAPLEY] Need 50+ trades with entryVec, got ${valid.length} — skipping`);
      return null;
    }

    // Build normalized feature matrix + labels
    const X = [];
    const y = [];
    for (const t of valid) {
      const features = LogisticRegression.extractFeatures(t);
      const vec = ALL_FEATURES.map(f => features[f] ?? 0);
      X.push(vec);
      y.push(t.won === true || t.result === 'WIN' ? 1 : 0);
    }

    // Normalize using model's stored normalization params
    const Xn = X.map(x => {
      const z = new Float64Array(N_FEATURES);
      for (let i = 0; i < N_FEATURES; i++) {
        const std = model.std[i];
        if (std > 1e-8) {
          z[i] = (x[i] - model.mean[i]) / std;
        } else {
          z[i] = 0;
        }
      }
      return z;
    });

    console.log(`[SHAPLEY] Computing Shapley values for ${N_FEATURES} features on ${valid.length} trades (M=${M_PERMUTATIONS})...`);

    // For each feature, collect marginal contributions across M permutations
    const contributions = ALL_FEATURES.map(() => []);
    const featureIndices = Array.from({ length: N_FEATURES }, (_, i) => i);

    for (let m = 0; m < M_PERMUTATIONS; m++) {
      const perm = shuffle(featureIndices);
      const activeSet = new Set();

      // Walk through the permutation, measuring marginal contribution of each feature
      let prevAcc = computeAccuracy(model, Xn, y, activeSet);

      for (const featureIdx of perm) {
        activeSet.add(featureIdx);
        const newAcc = computeAccuracy(model, Xn, y, activeSet);
        const marginal = newAcc - prevAcc;
        contributions[featureIdx].push(marginal);
        prevAcc = newAcc;
      }
    }

    // Compute Shapley value = mean marginal contribution, plus confidence intervals
    const results = ALL_FEATURES.map((name, i) => {
      const vals = contributions[i];
      const n = vals.length;
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
      const stdErr = Math.sqrt(variance / n);
      const ci95 = 1.96 * stdErr;

      let category;
      if (mean > THRESHOLD_HELPFUL) category = 'HELPFUL';
      else if (mean < -THRESHOLD_NOISE) category = 'HARMFUL';
      else if (Math.abs(mean) < THRESHOLD_NOISE) category = 'IRRELEVANT';
      else category = 'MARGINAL';

      return {
        feature: name,
        shapley: parseFloat(mean.toFixed(6)),
        stdErr: parseFloat(stdErr.toFixed(6)),
        ci95lo: parseFloat((mean - ci95).toFixed(6)),
        ci95hi: parseFloat((mean + ci95).toFixed(6)),
        category,
      };
    });

    // Sort by Shapley value descending
    results.sort((a, b) => b.shapley - a.shapley);

    this.values = results;
    this.analyzedAt = new Date().toISOString();
    this.tradeCount = valid.length;
    this.computeTimeMs = Date.now() - startTime;

    // Log summary
    const helpful = results.filter(r => r.category === 'HELPFUL');
    const harmful = results.filter(r => r.category === 'HARMFUL');
    const irrelevant = results.filter(r => r.category === 'IRRELEVANT');

    console.log(`[SHAPLEY] Done in ${this.computeTimeMs}ms`);
    console.log(`[SHAPLEY] HELPFUL (${helpful.length}): ${helpful.slice(0, 5).map(r => `${r.feature}:+${r.shapley.toFixed(4)}`).join(', ')}`);
    if (harmful.length > 0) {
      console.log(`[SHAPLEY] HARMFUL (${harmful.length}): ${harmful.map(r => `${r.feature}:${r.shapley.toFixed(4)}`).join(', ')}`);
    }
    if (irrelevant.length > 0) {
      console.log(`[SHAPLEY] IRRELEVANT (${irrelevant.length}): ${irrelevant.map(r => r.feature).join(', ')}`);
    }

    this._save();
    return results;
  }

  // ── Get top N helpful features ──
  getTopFeatures(n = 5) {
    if (!this.values) return [];
    return this.values
      .filter(v => v.shapley > 0)
      .slice(0, n);
  }

  // ── Get features that hurt prediction accuracy ──
  getHarmfulFeatures() {
    if (!this.values) return [];
    return this.values.filter(v => v.category === 'HARMFUL');
  }

  // ── Get irrelevant features (noise) ──
  getIrrelevantFeatures() {
    if (!this.values) return [];
    return this.values.filter(v => v.category === 'IRRELEVANT');
  }

  // ── Build prompt context for LLM ──
  getPromptContext() {
    if (!this.values || !this.analyzedAt) return '';

    const lines = ['SHAPLEY FEATURE QUALITY (game-theoretic importance)'];
    const top = this.getTopFeatures(5);
    if (top.length > 0) {
      lines.push(`TOP signals: ${top.map(f => `${f.feature}(+${f.shapley.toFixed(4)})`).join(', ')}`);
    }
    const harmful = this.getHarmfulFeatures();
    if (harmful.length > 0) {
      lines.push(`HARMFUL signals (trust LESS): ${harmful.map(f => `${f.feature}(${f.shapley.toFixed(4)})`).join(', ')}`);
    }
    const age = Date.now() - new Date(this.analyzedAt).getTime();
    const hoursAgo = (age / 3600000).toFixed(1);
    lines.push(`Analyzed ${hoursAgo}h ago on ${this.tradeCount} trades`);
    return lines.join('\n');
  }

  // ── Status for dashboard / logging ──
  getStatus() {
    return {
      analyzed: !!this.values,
      analyzedAt: this.analyzedAt,
      tradeCount: this.tradeCount,
      computeTimeMs: this.computeTimeMs,
      totalFeatures: this.values?.length ?? 0,
      helpful: this.values?.filter(v => v.category === 'HELPFUL').length ?? 0,
      harmful: this.values?.filter(v => v.category === 'HARMFUL').length ?? 0,
      irrelevant: this.values?.filter(v => v.category === 'IRRELEVANT').length ?? 0,
      topFeatures: this.getTopFeatures(5).map(f => `${f.feature}:+${f.shapley.toFixed(4)}`),
      harmfulFeatures: this.getHarmfulFeatures().map(f => `${f.feature}:${f.shapley.toFixed(4)}`),
    };
  }

  // ── Persistence ──
  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const data = {
        values: this.values,
        analyzedAt: this.analyzedAt,
        tradeCount: this.tradeCount,
        computeTimeMs: this.computeTimeMs,
      };
      const tmp = SHAPLEY_PATH + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, SHAPLEY_PATH);
    } catch (e) {
      console.log('[SHAPLEY] Save error:', e.message);
    }
  }

  _load() {
    try {
      if (!fs.existsSync(SHAPLEY_PATH)) return;
      const data = JSON.parse(fs.readFileSync(SHAPLEY_PATH, 'utf8'));
      this.values = data.values || null;
      this.analyzedAt = data.analyzedAt || null;
      this.tradeCount = data.tradeCount || 0;
      this.computeTimeMs = data.computeTimeMs || 0;
      if (this.values) {
        console.log(`[SHAPLEY] Loaded: ${this.values.length} features analyzed at ${this.analyzedAt}`);
      }
    } catch (e) {
      console.log('[SHAPLEY] Load error:', e.message);
    }
  }
}

export const shapleyAnalyzer = new ShapleyAnalyzer();
