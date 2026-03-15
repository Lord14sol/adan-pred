// src/ml/scenario_forecaster.js
// ADAN Scenario Forecaster — "Third Eye" for future vision
// Before each trade, ADAN simulates 3 scenarios (bull/bear/neutral)
// and uses the probability-weighted outcome to:
//   1. Add forecast features to ML vector (feature #33-35)
//   2. Apply Kelly multiplier #15 (confirm/contradict direction)
//   3. Learn from forecast accuracy to self-improve
//   4. Write scenario analysis to journal for self-reflection
//
// Uses Workhorse (Gemini 3.1 Flash Lite) via callDistributed — FREE

import fs from 'fs';
import path from 'path';
import { DIR } from '../core/config.js';

const FORECAST_LOG_PATH = path.join(DIR, 'forecast_log.jsonl');
const FORECAST_STATS_PATH = path.join(DIR, 'forecast_stats.json');
const MAX_LOG_LINES = 500;

class ScenarioForecaster {

  constructor() {
    this.stats = this._loadStats();
    this._lastForecast = null;
  }

  // ── MAIN: Generate 3 scenarios from candle data + indicators ──
  async forecast({ asset, candles, rsi, trend1m, trend5m, volRatio, bbPct, macdHist, side, edge, marketPrice }) {
    if (!candles || candles.length < 20) return null;

    // Extract last 30 closes for compact representation
    const closes = candles.slice(-30).map(c => c.close || c.c || c);
    const prices = closes.map(p => typeof p === 'number' ? p.toFixed(2) : p);
    const lastPrice = parseFloat(prices[prices.length - 1]);
    const priceRange = Math.max(...closes) - Math.min(...closes);
    const avgVolume = candles.slice(-10).reduce((s, c) => s + (c.volume || c.v || 0), 0) / 10;

    // Build compact prompt for scenario analysis
    const prompt = `You are a quantitative price forecaster. Given the last 30 candle closes and technical indicators, generate 3 scenarios for the NEXT 5 minutes.

ASSET: ${asset}
LAST 30 CLOSES (newest last): ${prices.join(', ')}
CURRENT PRICE: ${lastPrice}
RSI: ${rsi || '?'} | TREND 1m: ${trend1m || '?'}% | TREND 5m: ${trend5m || '?'}%
VOL RATIO: ${volRatio || '?'} | BB%: ${bbPct || '?'} | MACD: ${macdHist || '?'}
PRICE RANGE (30 candles): ${priceRange.toFixed(2)}

Generate EXACTLY 3 scenarios in this format:
BULL: <probability 0-100>% | target: <price> | reason: <10 words max>
BEAR: <probability 0-100>% | target: <price> | reason: <10 words max>
NEUTRAL: <probability 0-100>% | target: <price> | reason: <10 words max>
DIRECTION: <UP or DOWN or FLAT>
CONFIDENCE: <0-100>

Rules: probabilities must sum to 100. Be specific with price targets.`;

    try {
      const { callDistributed } = await import('../../adan-llm-router.js');
      const response = await callDistributed(prompt, { temperature: 0.15, maxTokens: 300 });
      if (!response || response.length < 30) return null;

      const parsed = this._parseResponse(response, lastPrice);
      if (!parsed) return null;

      // Compute forecast features
      const expectedMove = (
        parsed.bull.prob * (parsed.bull.target - lastPrice) +
        parsed.bear.prob * (parsed.bear.target - lastPrice) +
        parsed.neutral.prob * (parsed.neutral.target - lastPrice)
      ) / 100;

      const forecastDirection = expectedMove > 0 ? 'UP' : expectedMove < 0 ? 'DOWN' : 'FLAT';
      const forecastConfidence = parsed.confidence / 100;
      const forecastAgreesWithTrade = (side === 'YES' && forecastDirection === 'UP') ||
                                       (side === 'NO' && forecastDirection === 'DOWN');

      // Kelly multiplier: boost if forecast agrees, penalize if contradicts
      let kellyMult = 1.0;
      if (forecastConfidence > 0.6) {
        kellyMult = forecastAgreesWithTrade ? 1.15 : 0.75;
      } else if (forecastConfidence > 0.4) {
        kellyMult = forecastAgreesWithTrade ? 1.05 : 0.90;
      }

      const result = {
        ts: new Date().toISOString(),
        asset,
        lastPrice,
        scenarios: parsed,
        expectedMove: parseFloat(expectedMove.toFixed(4)),
        forecastDirection,
        forecastConfidence,
        forecastAgreesWithTrade,
        kellyMult,
        // ML features to inject into feature vector
        features: {
          forecast_direction: forecastDirection === 'UP' ? 1 : forecastDirection === 'DOWN' ? -1 : 0,
          forecast_confidence: forecastConfidence,
          forecast_expected_move_pct: (expectedMove / lastPrice) * 100,
        },
      };

      this._lastForecast = result;
      console.log(`[FORECAST] ${asset}: ${forecastDirection} (${(forecastConfidence * 100).toFixed(0)}% conf) | Expected: ${expectedMove > 0 ? '+' : ''}${expectedMove.toFixed(2)} | Kelly: ${kellyMult}x | ${forecastAgreesWithTrade ? 'CONFIRMS' : 'CONTRADICTS'} ${side}`);

      return result;
    } catch (e) {
      console.error('[FORECAST] Error:', e.message);
      return null;
    }
  }

  // ── Parse LLM response into structured scenarios ──
  _parseResponse(text, lastPrice) {
    const result = { bull: {}, bear: {}, neutral: {}, direction: 'FLAT', confidence: 50 };

    for (const line of text.split('\n')) {
      const trimmed = line.trim().toUpperCase();

      if (trimmed.startsWith('BULL:')) {
        const m = trimmed.match(/(\d+)%.*?target[:\s]*\$?([\d.]+)/i) ||
                  line.trim().match(/(\d+)%.*?([\d.]+)/);
        if (m) {
          result.bull = { prob: parseInt(m[1]), target: parseFloat(m[2]), raw: line.trim() };
        }
      } else if (trimmed.startsWith('BEAR:')) {
        const m = trimmed.match(/(\d+)%.*?target[:\s]*\$?([\d.]+)/i) ||
                  line.trim().match(/(\d+)%.*?([\d.]+)/);
        if (m) {
          result.bear = { prob: parseInt(m[1]), target: parseFloat(m[2]), raw: line.trim() };
        }
      } else if (trimmed.startsWith('NEUTRAL:')) {
        const m = trimmed.match(/(\d+)%.*?target[:\s]*\$?([\d.]+)/i) ||
                  line.trim().match(/(\d+)%.*?([\d.]+)/);
        if (m) {
          result.neutral = { prob: parseInt(m[1]), target: parseFloat(m[2]), raw: line.trim() };
        }
      } else if (trimmed.startsWith('DIRECTION:')) {
        result.direction = trimmed.includes('UP') ? 'UP' : trimmed.includes('DOWN') ? 'DOWN' : 'FLAT';
      } else if (trimmed.startsWith('CONFIDENCE:')) {
        const cm = trimmed.match(/(\d+)/);
        if (cm) result.confidence = Math.min(100, Math.max(0, parseInt(cm[1])));
      }
    }

    // Validate: need at least bull and bear
    if (!result.bull.prob || !result.bear.prob) return null;

    // Default neutral if missing
    if (!result.neutral.prob) {
      result.neutral = { prob: Math.max(0, 100 - result.bull.prob - result.bear.prob), target: lastPrice };
    }

    return result;
  }

  // ── Record actual outcome for learning ──
  recordOutcome({ asset, forecastDirection, actualDirection, expectedMove, actualMove }) {
    const correct = forecastDirection === actualDirection;

    // Update stats
    this.stats.total++;
    if (correct) this.stats.correct++;
    this.stats.accuracy = this.stats.total > 0 ? (this.stats.correct / this.stats.total) : 0;

    // Track by asset
    if (!this.stats.byAsset[asset]) this.stats.byAsset[asset] = { total: 0, correct: 0 };
    this.stats.byAsset[asset].total++;
    if (correct) this.stats.byAsset[asset].correct++;

    // Track move error
    if (expectedMove !== undefined && actualMove !== undefined) {
      this.stats.totalMoveError += Math.abs(expectedMove - actualMove);
      this.stats.moveErrorCount++;
    }

    this._saveStats();

    // Append to log
    try {
      const entry = {
        ts: new Date().toISOString(), asset, forecastDirection, actualDirection,
        correct, expectedMove, actualMove,
      };
      fs.appendFileSync(FORECAST_LOG_PATH, JSON.stringify(entry) + '\n');

      // Prune log
      const lines = fs.readFileSync(FORECAST_LOG_PATH, 'utf8').trim().split('\n');
      if (lines.length > MAX_LOG_LINES) {
        fs.writeFileSync(FORECAST_LOG_PATH, lines.slice(-MAX_LOG_LINES).join('\n') + '\n');
      }
    } catch {}

    return correct;
  }

  // ── Get Kelly multiplier from last forecast ──
  getKellyMultiplier() {
    return this._lastForecast?.kellyMult || 1.0;
  }

  // ── Get ML features from last forecast ──
  getFeatures() {
    return this._lastForecast?.features || {
      forecast_direction: 0,
      forecast_confidence: 0,
      forecast_expected_move_pct: 0,
    };
  }

  // ── Get journal summary for consciousness reflection ──
  getJournalSummary() {
    if (this.stats.total < 5) return '';
    const acc = (this.stats.accuracy * 100).toFixed(1);
    const avgErr = this.stats.moveErrorCount > 0
      ? (this.stats.totalMoveError / this.stats.moveErrorCount).toFixed(4)
      : 'N/A';

    const lines = [`\n══ SCENARIO FORECASTER: My prediction accuracy ══`];
    lines.push(`Overall: ${acc}% correct over ${this.stats.total} forecasts`);
    lines.push(`Average move error: ${avgErr}`);

    for (const [asset, s] of Object.entries(this.stats.byAsset)) {
      const assetAcc = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(0) : '?';
      lines.push(`  ${asset}: ${assetAcc}% (${s.total} forecasts)`);
    }

    if (this.stats.accuracy < 0.45) {
      lines.push(`WARNING: Forecast accuracy below 45% — forecaster may be hurting decisions`);
    } else if (this.stats.accuracy > 0.55) {
      lines.push(`STRENGTH: Forecast accuracy above 55% — third eye is working`);
    }

    return lines.join('\n') + '\n';
  }

  // ── Status for dashboard ──
  getStatus() {
    return {
      total: this.stats.total,
      accuracy: (this.stats.accuracy * 100).toFixed(1) + '%',
      lastForecast: this._lastForecast ? {
        asset: this._lastForecast.asset,
        direction: this._lastForecast.forecastDirection,
        confidence: (this._lastForecast.forecastConfidence * 100).toFixed(0) + '%',
        agrees: this._lastForecast.forecastAgreesWithTrade,
      } : null,
      byAsset: Object.fromEntries(
        Object.entries(this.stats.byAsset).map(([k, v]) => [k, {
          accuracy: v.total > 0 ? ((v.correct / v.total) * 100).toFixed(0) + '%' : 'N/A',
          total: v.total,
        }])
      ),
    };
  }

  // ── Persistence ──
  _loadStats() {
    const defaults = { total: 0, correct: 0, accuracy: 0, byAsset: {}, totalMoveError: 0, moveErrorCount: 0 };
    try {
      if (fs.existsSync(FORECAST_STATS_PATH)) {
        return { ...defaults, ...JSON.parse(fs.readFileSync(FORECAST_STATS_PATH, 'utf8')) };
      }
    } catch {}
    return defaults;
  }

  _saveStats() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FORECAST_STATS_PATH, JSON.stringify(this.stats, null, 2));
    } catch (e) { console.error('[FORECAST] Save error:', e.message); }
  }
}

export const scenarioForecaster = new ScenarioForecaster();
