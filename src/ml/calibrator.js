// src/ml/calibrator.js
// Isotonic Calibration — fixes miscalibrated probabilities
// If model says "62% chance" but actual WR at that level is 55%, fix it.
// Uses Pool Adjacent Violators (PAV) algorithm for isotonic regression.

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const CAL_PATH = path.join(DIR, 'calibration_map.json');

export class Calibrator {

  constructor() {
    this.breakpoints = []; // [{rawProb, calibratedProb, count}]
    this.n_bins = 15;
    this.built = false;
    this._load();
  }

  // ── Build calibration map from walk-forward OOS predictions ──
  // predictions: [{probability, actual}] from all OOS folds
  build(predictions) {
    if (!predictions || predictions.length < 100) {
      console.log(`[CALIBRATOR] Need 100+ OOS predictions, got ${predictions?.length || 0}`);
      return;
    }

    // Sort by predicted probability
    const sorted = [...predictions].sort((a, b) => a.probability - b.probability);

    // Equal-count binning
    const binSize = Math.floor(sorted.length / this.n_bins);
    const bins = [];

    for (let i = 0; i < this.n_bins; i++) {
      const start = i * binSize;
      const end = i === this.n_bins - 1 ? sorted.length : (i + 1) * binSize;
      const slice = sorted.slice(start, end);

      const avgRaw = slice.reduce((s, p) => s + p.probability, 0) / slice.length;
      const actualWR = slice.filter(p => p.actual === 1).length / slice.length;

      bins.push({ rawProb: avgRaw, calibratedProb: actualWR, count: slice.length });
    }

    // Pool Adjacent Violators (PAV) — enforce monotonicity
    this.breakpoints = this._pav(bins);
    this.built = true;
    this._save();

    const avgShift = this.breakpoints.reduce((s, b) => s + Math.abs(b.rawProb - b.calibratedProb), 0) / this.breakpoints.length;
    console.log(`[CALIBRATOR] Built from ${predictions.length} predictions, ${this.breakpoints.length} breakpoints, avg shift: ${(avgShift * 100).toFixed(1)}%`);
  }

  // Pool Adjacent Violators algorithm
  _pav(bins) {
    const result = bins.map(b => ({ ...b }));

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < result.length - 1; i++) {
        if (result[i].calibratedProb > result[i + 1].calibratedProb) {
          // Pool these two bins
          const totalCount = result[i].count + result[i + 1].count;
          const pooledProb = (result[i].calibratedProb * result[i].count +
                              result[i + 1].calibratedProb * result[i + 1].count) / totalCount;
          const pooledRaw = (result[i].rawProb * result[i].count +
                             result[i + 1].rawProb * result[i + 1].count) / totalCount;

          result[i] = { rawProb: pooledRaw, calibratedProb: pooledProb, count: totalCount };
          result.splice(i + 1, 1);
          changed = true;
          break;
        }
      }
    }

    return result;
  }

  // ── Calibrate a raw probability ──
  calibrate(rawProb) {
    if (!this.built || this.breakpoints.length < 2) return rawProb;

    // Clamp
    if (rawProb <= this.breakpoints[0].rawProb) return this.breakpoints[0].calibratedProb;
    if (rawProb >= this.breakpoints[this.breakpoints.length - 1].rawProb) {
      return this.breakpoints[this.breakpoints.length - 1].calibratedProb;
    }

    // Linear interpolation between breakpoints
    for (let i = 0; i < this.breakpoints.length - 1; i++) {
      const lo = this.breakpoints[i];
      const hi = this.breakpoints[i + 1];
      if (rawProb >= lo.rawProb && rawProb <= hi.rawProb) {
        const t = (rawProb - lo.rawProb) / (hi.rawProb - lo.rawProb);
        return lo.calibratedProb + t * (hi.calibratedProb - lo.calibratedProb);
      }
    }

    return rawProb;
  }

  // ── Persistence ──
  _save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(CAL_PATH, JSON.stringify({
        breakpoints: this.breakpoints,
        built: this.built,
        builtAt: new Date().toISOString(),
      }, null, 2));
    } catch {}
  }

  _load() {
    try {
      if (fs.existsSync(CAL_PATH)) {
        const data = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8'));
        if (data.breakpoints?.length > 0) {
          this.breakpoints = data.breakpoints;
          this.built = true;
        }
      }
    } catch {}
  }

  getStatus() {
    return {
      built: this.built,
      breakpoints: this.breakpoints.length,
    };
  }
}

export const calibrator = new Calibrator();
