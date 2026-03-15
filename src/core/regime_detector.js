// src/core/regime_detector.js
// K-Means Regime Detector (Concept #12D)
// Classifies market into 3 regimes from 5 features: TRENDING / RANGING / EVENT
// Runs every cycle, updates ~/.adan-pred/market_regime.json

import fs from 'fs';
import path from 'path';

const STATE_DIR = path.join(process.env.HOME, '.adan-pred');
const REGIME_PATH = path.join(STATE_DIR, 'market_regime.json');

class KMeansRegimeDetector {
  constructor() {
    this.centroids = null;
    this.labelMap = null;
    this.history = []; // rolling window of feature vectors
    this.maxHistory = 200;
    this.labels = ['RANGING', 'TRENDING', 'EVENT'];
    this.lastResult = null;

    // Ensure state dir exists
    try { if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}
  }

  // Features: [bb_width, vol_ratio, rsi_14, funding_rate, vwap_deviation]
  // All normalized 0-1 before clustering

  _distance(a, b) {
    return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
  }

  _kmeans(data, k = 3, maxIter = 50) {
    if (data.length < k) return null;

    // Initialize centroids via k-means++ style: pick spread-out points
    const centroids = [];
    const used = new Set();
    // First centroid: random
    let idx = Math.floor(Math.random() * data.length);
    used.add(idx);
    centroids.push([...data[idx]]);

    // Remaining centroids: pick farthest from existing
    for (let i = 1; i < k; i++) {
      let bestIdx = 0, bestDist = -1;
      for (let j = 0; j < data.length; j++) {
        if (used.has(j)) continue;
        const minD = centroids.reduce((m, c) => Math.min(m, this._distance(data[j], c)), Infinity);
        if (minD > bestDist) { bestDist = minD; bestIdx = j; }
      }
      used.add(bestIdx);
      centroids.push([...data[bestIdx]]);
    }

    let assignments = new Array(data.length).fill(0);

    for (let iter = 0; iter < maxIter; iter++) {
      // Assign each point to nearest centroid
      const newAssignments = data.map(point => {
        let minDist = Infinity, minIdx = 0;
        centroids.forEach((c, i) => {
          const d = this._distance(point, c);
          if (d < minDist) { minDist = d; minIdx = i; }
        });
        return minIdx;
      });

      // Check convergence
      if (JSON.stringify(newAssignments) === JSON.stringify(assignments)) break;
      assignments = newAssignments;

      // Update centroids
      for (let i = 0; i < k; i++) {
        const members = data.filter((_, idx) => assignments[idx] === i);
        if (members.length === 0) continue;
        for (let f = 0; f < centroids[i].length; f++) {
          centroids[i][f] = members.reduce((s, m) => s + m[f], 0) / members.length;
        }
      }
    }

    return { centroids, assignments };
  }

  // Label clusters based on centroid characteristics:
  // TRENDING: high vol_ratio, directional RSI (far from 50)
  // RANGING: low bb_width, low vol_ratio, RSI near 50
  // EVENT: extreme bb_width or extreme vol_ratio
  _labelClusters(centroids) {
    // centroid features: [bb_width, vol_ratio, rsi_14_norm, funding_rate_scaled, vwap_dev]
    const scored = centroids.map((c, i) => ({
      idx: i,
      bb_width: c[0],
      vol_ratio: c[1],
      rsi_distance_from_50: Math.abs(c[2] - 0.5),
      volatility_score: c[0] * c[1] // combined volatility
    }));

    // Sort by volatility_score ascending
    scored.sort((a, b) => a.volatility_score - b.volatility_score);

    const labelMap = {};
    labelMap[scored[0].idx] = 'RANGING';    // lowest volatility
    labelMap[scored[1].idx] = 'TRENDING';   // medium
    labelMap[scored[2].idx] = 'EVENT';      // highest volatility

    return labelMap;
  }

  addSample(features) {
    // features: { bb_width, vol_ratio, rsi_14, funding_rate, vwap_deviation }
    const vec = [
      Math.min(1, Math.max(0, features.bb_width || 0)),
      Math.min(1, Math.max(0, (features.vol_ratio || 1) / 5)),  // normalize: ratio/5 clamped to 0-1
      (features.rsi_14 || 50) / 100,                             // normalize to 0-1
      Math.min(1, Math.abs(features.funding_rate || 0) * 1000),  // scale funding, clamp
      Math.min(1, Math.max(0, Math.abs(features.vwap_deviation || 0) / 2)) // normalize pct
    ];
    this.history.push(vec);
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  detect(currentFeatures) {
    this.addSample(currentFeatures);

    // Need at least 20 samples to cluster meaningfully
    if (this.history.length < 20) {
      this.lastResult = { regime: 'UNKNOWN', confidence: 0, retrain: false, samples: this.history.length };
      return this.lastResult;
    }

    // Retrain every 50 samples or if no centroids exist
    if (!this.centroids || this.history.length % 50 === 0) {
      const result = this._kmeans(this.history, 3);
      if (result) {
        this.centroids = result.centroids;
        this.labelMap = this._labelClusters(result.centroids);
      }
    }

    if (!this.centroids) {
      this.lastResult = { regime: 'UNKNOWN', confidence: 0, samples: this.history.length };
      return this.lastResult;
    }

    // Classify current point
    const currentVec = this.history[this.history.length - 1];
    let minDist = Infinity, cluster = 0;
    this.centroids.forEach((c, i) => {
      const d = this._distance(currentVec, c);
      if (d < minDist) { minDist = d; cluster = i; }
    });

    const regime = this.labelMap[cluster] || 'UNKNOWN';

    // Confidence: inverse of distance to nearest centroid (normalized)
    const maxDist = 2.0; // rough max distance in normalized 5D space
    const confidence = Math.max(0, Math.min(1, 1 - minDist / maxDist));

    // Build state
    const state = {
      regime,
      confidence: parseFloat(confidence.toFixed(3)),
      cluster,
      timestamp: new Date().toISOString(),
      features: currentFeatures,
      samples: this.history.length
    };

    // Persist to file
    try {
      fs.writeFileSync(REGIME_PATH, JSON.stringify(state, null, 2));
    } catch {}

    this.lastResult = state;
    return state;
  }

  // Get Kelly multiplier based on current regime
  // RANGING  → conservative (0.5x Kelly, need 8% edge min)
  // TRENDING → full Kelly (1.0x, need 5% edge min)
  // EVENT    → skip entirely (0x Kelly, infinite edge required)
  getKellyMultiplier() {
    try {
      const state = this.lastResult || JSON.parse(fs.readFileSync(REGIME_PATH, 'utf8'));
      switch (state.regime) {
        case 'RANGING':   return { mult: 0.5, minEdge: 0.08, regime: 'RANGING' };
        case 'TRENDING':  return { mult: 1.0, minEdge: 0.05, regime: 'TRENDING' };
        case 'EVENT':     return { mult: 0,   minEdge: 999,  regime: 'EVENT' };
        default:          return { mult: 0.8, minEdge: 0.06, regime: state.regime || 'UNKNOWN' };
      }
    } catch {
      return { mult: 0.8, minEdge: 0.06, regime: 'UNKNOWN' };
    }
  }

  // Prompt context for LLM injection
  getPromptContext() {
    const s = this.lastResult;
    if (!s || s.regime === 'UNKNOWN') return '';
    return `\n━━━ K-MEANS REGIME (Concept #12D) ━━━
Regime: ${s.regime} | Confidence: ${(s.confidence * 100).toFixed(0)}% | Samples: ${s.samples}
Kelly adjustment: ${s.regime === 'RANGING' ? '0.5x (conservative)' : s.regime === 'TRENDING' ? '1.0x (full)' : s.regime === 'EVENT' ? '0x (SKIP ALL BETS)' : '0.8x (default)'}
RULE: If regime=EVENT, do NOT bet. If regime=RANGING, require higher edge (>8%). If regime=TRENDING, trust momentum signals.\n`;
  }
}

export const kmeansRegime = new KMeansRegimeDetector();
