// src/ml/evolution_strategies.js
// Evolution Strategies (ES) for ADAN-PRED — OpenAI-style parameter optimization
// Evolves strategy weights: Kelly multiplier, edge thresholds, confidence floors, etc.
// Runs once per Dream cycle or after 200 trades. Persists best params to disk.
// Pure Node.js, zero dependencies.

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';
const DIR = path.join(HOME, '.adan-pred');
const PARAMS_PATH = path.join(DIR, 'evolution_params.json');
const ES_LOG_PATH = path.join(DIR, 'evolution_log.jsonl');

// ── Default parameter vector ────────────────────────────────────────────────
const DEFAULT_PARAMS = {
  kellyBase:       0.50,   // Fractional Kelly multiplier (0.1 - 1.0)
  edgeMin:         0.03,   // Minimum edge threshold to enter trade (0.005 - 0.15)
  confidenceFloor: 55,     // Minimum confidence % to trade (30 - 85)
  regimeWeight:    1.0,    // Multiplier for regime-based adjustments (0.3 - 2.0)
  hourWeight:      1.0,    // Multiplier for hour-of-day signal (0.3 - 2.0)
  momentumDecay:   0.95,   // Exponential decay for momentum signals (0.80 - 0.99)
};

// ── Parameter bounds (hard clamps) ──────────────────────────────────────────
const BOUNDS = {
  kellyBase:       [0.10, 1.00],
  edgeMin:         [0.005, 0.15],
  confidenceFloor: [30, 85],
  regimeWeight:    [0.30, 2.00],
  hourWeight:      [0.30, 2.00],
  momentumDecay:   [0.80, 0.99],
};

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

// ── ES Hyperparameters ──────────────────────────────────────────────────────
const POPULATION_SIZE = 20;  // N = number of perturbation vectors
const SIGMA = 0.02;          // Gaussian noise standard deviation
const ALPHA = 0.01;          // Learning rate
const MIN_TRADES = 50;       // Minimum trades required to compute fitness
const EVAL_WINDOW = 200;     // Trades window for Sharpe calculation

// ── Gaussian random (Box-Muller) ────────────────────────────────────────────
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── Clamp a parameter to its bounds ─────────────────────────────────────────
function clamp(key, value) {
  const [lo, hi] = BOUNDS[key] || [-Infinity, Infinity];
  return Math.max(lo, Math.min(hi, value));
}

// ── Vectorize a param object to array ───────────────────────────────────────
function toVec(params) {
  return PARAM_KEYS.map(k => params[k] ?? DEFAULT_PARAMS[k]);
}

// ── Array back to param object ──────────────────────────────────────────────
function toParams(vec) {
  const p = {};
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    p[PARAM_KEYS[i]] = parseFloat(clamp(PARAM_KEYS[i], vec[i]).toFixed(6));
  }
  return p;
}

// ── Simulate Sharpe ratio for a param vector over a trades window ───────────
// Each trade has: { pnl, edge, confidence, stake, ... }
// We filter trades that would have been taken under this param set,
// then compute Sharpe on the returns.
function computeFitness(params, trades) {
  const returns = [];

  for (const t of trades) {
    const edge = Math.abs(t.edge || 0);
    const conf = t.confidence || 50;
    const pnlVal = t.pnl || 0;
    const stake = t.stake || 100;

    // Would this trade have been taken with these params?
    if (edge < params.edgeMin) continue;
    if (conf < params.confidenceFloor) continue;

    // Simulate Kelly-scaled return
    const kellyScale = params.kellyBase / 0.50; // relative to default 0.50
    const ret = (pnlVal / Math.max(stake, 1)) * kellyScale;
    returns.push(ret);
  }

  // Not enough trades passed the filter — penalize
  if (returns.length < 10) return -10.0;

  // Sharpe ratio: mean(returns) / std(returns)
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 0.001; // avoid div by zero

  // Annualize: assume ~6 trades/day, 365 days
  const sharpe = (mean / std) * Math.sqrt(6 * 365);

  // Bonus for taking more trades (information value)
  const tradeBonus = Math.log(returns.length + 1) * 0.1;

  return sharpe + tradeBonus;
}


class EvolutionStrategies {

  constructor() {
    this._theta = null;       // Current best parameter vector (array)
    this._params = null;      // Current best as object
    this._generation = 0;     // ES generation counter
    this._lastFitness = null; // Last fitness of current theta
    this._history = [];       // Fitness history
    this._load();
  }

  // ── Load persisted params or use defaults ─────────────────────────────────
  _load() {
    try {
      if (fs.existsSync(PARAMS_PATH)) {
        const data = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8'));
        this._params = { ...DEFAULT_PARAMS, ...data.params };
        this._theta = toVec(this._params);
        this._generation = data.generation || 0;
        this._lastFitness = data.lastFitness ?? null;
        this._history = data.history || [];
        return;
      }
    } catch {}
    this._params = { ...DEFAULT_PARAMS };
    this._theta = toVec(this._params);
    this._generation = 0;
    this._lastFitness = null;
    this._history = [];
  }

  // ── Persist current state ─────────────────────────────────────────────────
  _save() {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const data = {
        params: this._params,
        generation: this._generation,
        lastFitness: this._lastFitness,
        history: this._history.slice(-100), // keep last 100 entries
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(PARAMS_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[ES] Save error:', e.message);
    }
  }

  // ── Log an evolution step ─────────────────────────────────────────────────
  _log(entry) {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      fs.appendFileSync(ES_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {}
  }

  // ── MAIN: Run one ES evolution step ───────────────────────────────────────
  // trades: array of closed trade objects with { pnl, edge, confidence, stake }
  // Returns: { improved, generation, fitness, params, delta }
  evolve(trades) {
    if (!trades || trades.length < MIN_TRADES) {
      return {
        improved: false,
        generation: this._generation,
        reason: `Not enough trades: ${trades?.length || 0} < ${MIN_TRADES}`,
        params: { ...this._params },
      };
    }

    // Use last EVAL_WINDOW trades
    const window = trades.slice(-EVAL_WINDOW);
    const dim = PARAM_KEYS.length;

    // ── Step 1: Generate N perturbation vectors (epsilon_i) ─────────────
    const epsilons = [];     // N x dim
    const fitnesses = [];    // N fitness values

    for (let i = 0; i < POPULATION_SIZE; i++) {
      // Sample epsilon ~ N(0, 1) per dimension
      const eps = [];
      for (let d = 0; d < dim; d++) {
        eps.push(randn());
      }
      epsilons.push(eps);

      // Perturbed parameter vector: theta + sigma * eps
      const perturbed = this._theta.map((t, d) => t + SIGMA * eps[d]);
      const perturbedParams = toParams(perturbed);

      // Evaluate fitness
      const fit = computeFitness(perturbedParams, window);
      fitnesses.push(fit);
    }

    // ── Step 2: Normalize fitnesses (rank-based for stability) ──────────
    // Use fitness ranks instead of raw values to reduce variance
    const indexed = fitnesses.map((f, i) => ({ f, i }));
    indexed.sort((a, b) => a.f - b.f);
    const ranks = new Array(POPULATION_SIZE);
    for (let r = 0; r < POPULATION_SIZE; r++) {
      // Centered rank: maps to [-0.5, 0.5]
      ranks[indexed[r].i] = (r / (POPULATION_SIZE - 1)) - 0.5;
    }

    // ── Step 3: ES gradient estimate ────────────────────────────────────
    // theta_new = theta_old + alpha * (1 / (N * sigma)) * sum(rank_i * eps_i)
    const scale = ALPHA / (POPULATION_SIZE * SIGMA);
    const gradient = new Array(dim).fill(0);

    for (let i = 0; i < POPULATION_SIZE; i++) {
      for (let d = 0; d < dim; d++) {
        gradient[d] += ranks[i] * epsilons[i][d];
      }
    }

    // ── Step 4: Update theta ────────────────────────────────────────────
    const oldTheta = [...this._theta];
    for (let d = 0; d < dim; d++) {
      this._theta[d] += scale * gradient[d];
      // Clamp to bounds
      this._theta[d] = clamp(PARAM_KEYS[d], this._theta[d]);
    }

    // ── Step 5: Evaluate new theta fitness ──────────────────────────────
    this._params = toParams(this._theta);
    const newFitness = computeFitness(this._params, window);
    const oldFitness = this._lastFitness;
    const improved = oldFitness === null || newFitness > oldFitness;

    // If regression, revert with 50% probability (allow exploration)
    if (!improved && Math.random() > 0.5) {
      this._theta = oldTheta;
      this._params = toParams(this._theta);
    } else {
      this._lastFitness = newFitness;
    }

    this._generation++;

    // Compute delta for logging
    const delta = {};
    const oldParams = toParams(oldTheta);
    for (const k of PARAM_KEYS) {
      const diff = this._params[k] - oldParams[k];
      if (Math.abs(diff) > 1e-6) {
        delta[k] = parseFloat(diff.toFixed(6));
      }
    }

    // Record history
    const entry = {
      generation: this._generation,
      fitness: parseFloat(newFitness.toFixed(4)),
      improved,
      params: { ...this._params },
      tradesUsed: window.length,
      populationBestFitness: parseFloat(Math.max(...fitnesses).toFixed(4)),
      populationAvgFitness: parseFloat((fitnesses.reduce((a, b) => a + b, 0) / POPULATION_SIZE).toFixed(4)),
      ts: new Date().toISOString(),
    };

    this._history.push({
      gen: this._generation,
      fitness: entry.fitness,
      ts: entry.ts,
    });

    this._save();
    this._log(entry);

    // Console output
    const arrow = improved ? '\u2191' : '\u2193';
    console.log(`[ES] Gen ${this._generation} | Fitness: ${newFitness.toFixed(3)} ${arrow} | Kelly=${this._params.kellyBase.toFixed(3)} Edge=${this._params.edgeMin.toFixed(4)} Conf=${this._params.confidenceFloor.toFixed(1)} RegW=${this._params.regimeWeight.toFixed(3)} HourW=${this._params.hourWeight.toFixed(3)} MomD=${this._params.momentumDecay.toFixed(4)}`);

    return {
      improved,
      generation: this._generation,
      fitness: parseFloat(newFitness.toFixed(4)),
      oldFitness: oldFitness !== null ? parseFloat(oldFitness.toFixed(4)) : null,
      params: { ...this._params },
      delta,
      tradesUsed: window.length,
    };
  }

  // ── Get current best parameters ───────────────────────────────────────────
  getBestParams() {
    return { ...this._params };
  }

  // ── Get status for dashboard / logging ────────────────────────────────────
  getStatus() {
    return {
      generation: this._generation,
      fitness: this._lastFitness !== null ? parseFloat(this._lastFitness.toFixed(4)) : null,
      params: { ...this._params },
      historyLength: this._history.length,
      lastEvolved: this._history.length > 0 ? this._history[this._history.length - 1].ts : null,
    };
  }
}

export const evolutionStrategies = new EvolutionStrategies();
