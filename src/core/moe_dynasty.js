// src/core/moe_dynasty.js
// Mixture of Experts (MoE) Dynasty — Concept #10
// Each child becomes a specialized expert with a gating weight.
// Gating network uses softmax over performance metrics.
// Combined prediction: sum(gate_weight_i * expert_prediction_i)

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';
const DIR = process.env.ADAN_DIR || path.join(HOME, '.adan-pred');
const MOE_PATH = path.join(DIR, 'moe_weights.json');

const LEARNING_RATE = 0.05;
const MIN_TRADES_FOR_SPECIALIZATION = 50;

// ═══ SOFTMAX ═══
function softmax(values) {
  if (!values || values.length === 0) return [];
  const maxVal = Math.max(...values);
  const exps = values.map(v => Math.exp(v - maxVal)); // numerical stability
  const sumExp = exps.reduce((s, e) => s + e, 0);
  return exps.map(e => e / sumExp);
}

class MoEDynasty {
  constructor() {
    this.experts = {};
    // experts[childId] = {
    //   gateScore: number,        // raw score (before softmax)
    //   trades: number,
    //   wins: number,
    //   wr: number,               // win rate 0-1
    //   brierSum: number,         // cumulative Brier score (lower = better)
    //   brierCount: number,
    //   edgeHits: number,         // correct edge calls
    //   edgeMisses: number,
    //   specialization: null | { type, value },  // e.g. { type: 'asset', value: 'btc' }
    //   perAsset: { btc: {w,l}, eth: {w,l}, ... },
    //   perTimeframe: { '5': {w,l}, '15': {w,l}, '60': {w,l} },
    //   lastUpdated: ISO string,
    // }
    this._load();
  }

  // ═══ CORE: Combine child predictions using MoE gating ═══

  /**
   * Combine child predictions into a single probability.
   * @param {Array} childPredictions - [{ childId, direction, confidence, asset?, timeframe? }, ...]
   *   direction: 'UP' or 'DOWN' (or 'YES'/'NO')
   *   confidence: 0-100
   * @returns {{ direction, probability, weightedConfidence, gateWeights, details }}
   */
  combine(childPredictions) {
    if (!childPredictions || childPredictions.length === 0) {
      return { direction: 'NEUTRAL', probability: 0.5, weightedConfidence: 50, gateWeights: {}, details: [] };
    }

    // Ensure all experts exist
    for (const cp of childPredictions) {
      if (!this.experts[cp.childId]) {
        this._initExpert(cp.childId);
      }
    }

    // Compute gate weights via softmax over performance scores
    const activeIds = childPredictions.map(cp => cp.childId);
    const gateWeights = this._computeGateWeights(activeIds);

    // Convert each child prediction to a probability (0-1 scale where >0.5 = UP, <0.5 = DOWN)
    let combinedProb = 0;
    const details = [];

    for (const cp of childPredictions) {
      const dir = (cp.direction === 'UP' || cp.direction === 'YES') ? 'UP' : 'DOWN';
      const conf = Math.max(0, Math.min(100, cp.confidence || 50));
      // Convert to probability: UP@70% => 0.70, DOWN@70% => 0.30
      const expertProb = dir === 'UP' ? conf / 100 : 1 - (conf / 100);

      const gw = gateWeights[cp.childId] || (1 / activeIds.length);
      combinedProb += gw * expertProb;

      const expert = this.experts[cp.childId];
      details.push({
        childId: cp.childId,
        direction: dir,
        confidence: conf,
        expertProb: parseFloat(expertProb.toFixed(4)),
        gateWeight: parseFloat(gw.toFixed(4)),
        contribution: parseFloat((gw * expertProb).toFixed(4)),
        trades: expert.trades,
        wr: parseFloat((expert.wr * 100).toFixed(1)),
        specialization: expert.specialization,
      });
    }

    // Clamp combined probability
    combinedProb = Math.max(0.01, Math.min(0.99, combinedProb));

    const direction = combinedProb > 0.5 ? 'UP' : combinedProb < 0.5 ? 'DOWN' : 'NEUTRAL';
    const weightedConfidence = Math.round(Math.abs(combinedProb - 0.5) * 200);

    // Sort details by gate weight descending
    details.sort((a, b) => b.gateWeight - a.gateWeight);

    return {
      direction,
      probability: parseFloat(combinedProb.toFixed(4)),
      weightedConfidence,
      gateWeights,
      details,
    };
  }

  // ═══ WEIGHT UPDATE after trade resolution ═══

  /**
   * Update gate weights for a child after a resolved trade.
   * @param {string} childId
   * @param {boolean} correct - whether the child's prediction was correct
   * @param {object} [meta] - optional: { asset, timeframe, confidence, actualProb }
   */
  updateWeights(childId, correct, meta = {}) {
    if (!this.experts[childId]) {
      this._initExpert(childId);
    }

    const expert = this.experts[childId];
    expert.trades++;

    if (correct) {
      expert.wins++;
      // Reward: weight += eta * (1 - gate_weight_normalized)
      expert.gateScore += LEARNING_RATE * (1 - this._normalizedScore(childId));
    } else {
      // Punish: weight *= (1 - eta)
      expert.gateScore *= (1 - LEARNING_RATE);
    }

    // Update win rate
    expert.wr = expert.trades > 0 ? expert.wins / expert.trades : 0.5;

    // Update Brier score if we have probability info
    if (meta.confidence !== undefined && meta.actualProb !== undefined) {
      const predicted = (meta.confidence || 50) / 100;
      const actual = meta.actualProb; // 1 if correct direction, 0 if not
      expert.brierSum += Math.pow(predicted - actual, 2);
      expert.brierCount++;
    }

    // Track edge accuracy
    if (meta.hadEdge !== undefined) {
      if (correct && meta.hadEdge) expert.edgeHits++;
      else if (!correct && meta.hadEdge) expert.edgeMisses++;
    }

    // Per-asset tracking
    if (meta.asset) {
      const a = meta.asset.toLowerCase().replace('usdt', '');
      if (!expert.perAsset[a]) expert.perAsset[a] = { w: 0, l: 0 };
      if (correct) expert.perAsset[a].w++;
      else expert.perAsset[a].l++;
    }

    // Per-timeframe tracking
    if (meta.timeframe) {
      const tf = String(meta.timeframe);
      if (!expert.perTimeframe[tf]) expert.perTimeframe[tf] = { w: 0, l: 0 };
      if (correct) expert.perTimeframe[tf].w++;
      else expert.perTimeframe[tf].l++;
    }

    expert.lastUpdated = new Date().toISOString();

    // Auto-assign specialization after threshold
    if (expert.trades >= MIN_TRADES_FOR_SPECIALIZATION && !expert.specialization) {
      expert.specialization = this._detectSpecialization(childId);
    }

    // Re-normalize all gate scores to prevent unbounded growth
    this._normalizeGateScores();

    this._save();
  }

  // ═══ GATE WEIGHT COMPUTATION ═══

  /**
   * Compute softmax gate weights for a set of active experts.
   * Score = composite of WR, inverse Brier, edge accuracy.
   */
  _computeGateWeights(activeIds) {
    if (!activeIds || activeIds.length === 0) return {};

    const scores = activeIds.map(id => {
      const expert = this.experts[id];
      if (!expert || expert.trades === 0) return 1.0; // uniform prior

      // Composite performance score for gating
      const wrScore = expert.wr; // 0-1
      const brierScore = expert.brierCount > 0
        ? 1 - (expert.brierSum / expert.brierCount) // lower Brier = better, invert to 0-1
        : 0.5;
      const edgeTotal = expert.edgeHits + expert.edgeMisses;
      const edgeScore = edgeTotal > 0 ? expert.edgeHits / edgeTotal : 0.5;

      // Weighted composite: WR matters most, then Brier, then edge
      return 0.5 * wrScore + 0.3 * brierScore + 0.2 * edgeScore + expert.gateScore;
    });

    const weights = softmax(scores);
    const result = {};
    for (let i = 0; i < activeIds.length; i++) {
      result[activeIds[i]] = weights[i];
    }
    return result;
  }

  _normalizedScore(childId) {
    const allScores = Object.values(this.experts).map(e => e.gateScore);
    if (allScores.length === 0) return 0.5;
    const maxS = Math.max(...allScores);
    const minS = Math.min(...allScores);
    const range = maxS - minS;
    if (range === 0) return 0.5;
    return (this.experts[childId].gateScore - minS) / range;
  }

  _normalizeGateScores() {
    const ids = Object.keys(this.experts);
    if (ids.length === 0) return;
    const scores = ids.map(id => this.experts[id].gateScore);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    // Center around 1.0 to prevent drift
    for (const id of ids) {
      this.experts[id].gateScore = this.experts[id].gateScore - mean + 1.0;
    }
  }

  // ═══ SPECIALIZATION DETECTION ═══

  _detectSpecialization(childId) {
    const expert = this.experts[childId];
    if (!expert) return null;

    let bestSpec = null;
    let bestWR = 0;
    let bestCount = 0;

    // Check per-asset specialization
    for (const [asset, stats] of Object.entries(expert.perAsset)) {
      const total = stats.w + stats.l;
      if (total < 10) continue; // need minimum sample
      const wr = stats.w / total;
      if (wr > bestWR || (wr === bestWR && total > bestCount)) {
        bestWR = wr;
        bestCount = total;
        bestSpec = { type: 'asset', value: asset, wr: parseFloat((wr * 100).toFixed(1)), trades: total };
      }
    }

    // Check per-timeframe specialization
    for (const [tf, stats] of Object.entries(expert.perTimeframe)) {
      const total = stats.w + stats.l;
      if (total < 10) continue;
      const wr = stats.w / total;
      if (wr > bestWR || (wr === bestWR && total > bestCount)) {
        bestWR = wr;
        bestCount = total;
        bestSpec = { type: 'timeframe', value: tf + 'min', wr: parseFloat((wr * 100).toFixed(1)), trades: total };
      }
    }

    if (bestSpec) {
      console.log(`[MOE DYNASTY] Expert ${childId} specialized: ${bestSpec.type}=${bestSpec.value} (${bestSpec.wr}% WR over ${bestSpec.trades} trades)`);
    }

    return bestSpec;
  }

  // ═══ PUBLIC GETTERS ═══

  getGateWeights() {
    const ids = Object.keys(this.experts);
    return this._computeGateWeights(ids);
  }

  getStatus() {
    const ids = Object.keys(this.experts);
    if (ids.length === 0) return { experts: 0, totalTrades: 0, summary: 'No experts registered.' };

    const gateWeights = this._computeGateWeights(ids);
    const expertSummaries = ids.map(id => {
      const e = this.experts[id];
      return {
        childId: id,
        trades: e.trades,
        wins: e.wins,
        wr: parseFloat((e.wr * 100).toFixed(1)),
        gateWeight: parseFloat((gateWeights[id] || 0).toFixed(4)),
        gateScore: parseFloat(e.gateScore.toFixed(4)),
        brier: e.brierCount > 0 ? parseFloat((e.brierSum / e.brierCount).toFixed(4)) : null,
        edgeAccuracy: (e.edgeHits + e.edgeMisses) > 0
          ? parseFloat((e.edgeHits / (e.edgeHits + e.edgeMisses) * 100).toFixed(1))
          : null,
        specialization: e.specialization,
      };
    }).sort((a, b) => b.gateWeight - a.gateWeight);

    const totalTrades = ids.reduce((s, id) => s + this.experts[id].trades, 0);

    return {
      experts: ids.length,
      totalTrades,
      learningRate: LEARNING_RATE,
      specializationThreshold: MIN_TRADES_FOR_SPECIALIZATION,
      expertSummaries,
    };
  }

  // ═══ EXPERT INITIALIZATION ═══

  _initExpert(childId) {
    this.experts[childId] = {
      gateScore: 1.0,
      trades: 0,
      wins: 0,
      wr: 0.5,
      brierSum: 0,
      brierCount: 0,
      edgeHits: 0,
      edgeMisses: 0,
      specialization: null,
      perAsset: {},
      perTimeframe: {},
      lastUpdated: new Date().toISOString(),
    };
    return this.experts[childId];
  }

  // ═══ PERSISTENCE ═══

  _load() {
    try {
      if (fs.existsSync(MOE_PATH)) {
        const data = JSON.parse(fs.readFileSync(MOE_PATH, 'utf8'));
        this.experts = data.experts || {};
      }
    } catch (e) {
      console.error('[MOE DYNASTY] Failed to load weights:', e.message);
      this.experts = {};
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const tmp = MOE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        experts: this.experts,
        savedAt: new Date().toISOString(),
        version: 1,
      }, null, 2));
      fs.renameSync(tmp, MOE_PATH);
    } catch (e) {
      console.error('[MOE DYNASTY] Failed to save weights:', e.message);
    }
  }
}

export const moeDynasty = new MoEDynasty();
