// src/core/lmsr_engine.js
// LMSR Edge Calculator + Brier Score Calibration
// Polymarket uses LMSR. Understanding LMSR = finding the real edge.
// Part of Mother Code v2.0 — Quant Intelligence Layer
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const CALIBRATION_LOG = path.join(DIR, 'calibration.jsonl');
const EDGE_LOG = path.join(DIR, 'edge_detections.jsonl');

export class LMSREngine {
    constructor() {
        this.b = 100; // Default Polymarket liquidity parameter
        this.predictionLog = [];
        this._loadHistory();
    }

    // Dynamic b estimation from market liquidity
    estimateB(volume24h) {
        if (volume24h && volume24h > 0) {
            return Math.max(10, volume24h / 10);
        }
        return 100; // fallback
    }

    _loadHistory() {
        try {
            const lines = fs.readFileSync(CALIBRATION_LOG, 'utf8').split('\n').filter(Boolean);
            this.predictionLog = lines.slice(-500).map(l => {
                try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
        } catch { this.predictionLog = []; }
    }

    // Inverse LMSR: given market price, get implied momentum
    getImpliedShares(yesPrice, volume24h) {
        if (yesPrice <= 0 || yesPrice >= 1) return 0;
        const b = this.estimateB(volume24h);
        return b * Math.log(yesPrice / (1 - yesPrice));
    }

    // Bayesian fair value calculator
    // Prior = market price → update with signals → posterior = fair value
    calculateFairValue({
        yesPrice, fearGreedIndex, volRatio, priceChange1h, rsi14,
        bbPosition, sessionEdge, humanState, soulRules, side
    }) {
        let logit = Math.log(yesPrice / (1 - yesPrice));
        let confidence = 1.0;
        const updates = [];

        // Signal 1: Fear & Greed (contrarian)
        if (fearGreedIndex != null) {
            if (fearGreedIndex < 20) {
                logit += 0.3; updates.push({ signal: 'EXTREME_FEAR', update: +0.3 });
            } else if (fearGreedIndex < 35) {
                logit += 0.15; updates.push({ signal: 'FEAR', update: +0.15 });
            } else if (fearGreedIndex > 80) {
                logit -= 0.3; updates.push({ signal: 'EXTREME_GREED', update: -0.3 });
            } else if (fearGreedIndex > 65) {
                logit -= 0.15; updates.push({ signal: 'GREED', update: -0.15 });
            }
        }

        // Signal 2: RSI
        if (rsi14 != null) {
            if (rsi14 < 30) { logit += 0.25; updates.push({ signal: 'RSI_OVERSOLD', update: +0.25 }); }
            else if (rsi14 < 40) { logit += 0.10; updates.push({ signal: 'RSI_LOW', update: +0.10 }); }
            else if (rsi14 > 70) { logit -= 0.25; updates.push({ signal: 'RSI_OVERBOUGHT', update: -0.25 }); }
            else if (rsi14 > 60) { logit -= 0.10; updates.push({ signal: 'RSI_HIGH', update: -0.10 }); }
        }

        // Signal 3: Volume
        if (volRatio != null) {
            if (volRatio > 3.0) {
                const dirMult = (priceChange1h || 0) > 0 ? 0.2 : -0.2;
                logit += dirMult; updates.push({ signal: 'HIGH_VOLUME', update: dirMult });
            } else if (volRatio < 0.3) {
                confidence *= 0.7; updates.push({ signal: 'LOW_VOLUME', update: 0 });
            }
        }

        // Signal 4: Bollinger Bands
        if (bbPosition != null) {
            if (bbPosition < 0.1) { logit += 0.20; updates.push({ signal: 'BB_LOWER', update: +0.20 }); }
            else if (bbPosition > 0.9) { logit -= 0.20; updates.push({ signal: 'BB_UPPER', update: -0.20 }); }
        }

        // Signal 5: Session quality
        if (sessionEdge != null) {
            if (sessionEdge >= 1.2) { confidence *= 1.15; updates.push({ signal: 'PRIME_SESSION' }); }
            else if (sessionEdge < 0.7) { confidence *= 0.8; updates.push({ signal: 'WEAK_SESSION' }); }
        }

        // Signal 6: Human state
        if (humanState === 'HERD_PANIC') { logit += 0.25; updates.push({ signal: 'HERD_PANIC', update: +0.25 }); }
        if (humanState === 'HERD_FOMO') { logit -= 0.20; updates.push({ signal: 'HERD_FOMO', update: -0.20 }); }

        // Signal 7: Soul Rules
        if (soulRules?.length > 0) {
            soulRules.forEach(rule => {
                if (rule.confidence > 0.7 && rule.direction) {
                    const ruleUpdate = (rule.direction === 'YES' ? 0.1 : -0.1) * rule.confidence;
                    logit += ruleUpdate;
                    updates.push({ signal: 'SOUL:' + (rule.text || '').slice(0, 25), update: ruleUpdate });
                }
            });
        }

        // sigmoid(logit) → probability
        const fairProbYES = 1 / (1 + Math.exp(-logit));
        const fairProb = side === 'YES' ? fairProbYES : (1 - fairProbYES);
        const marketProb = side === 'YES' ? yesPrice : (1 - yesPrice);
        const edge = (fairProb - marketProb) * confidence;
        const MIN_EDGE = 0.05;

        const result = {
            fairProb: parseFloat(fairProb.toFixed(4)),
            marketProb: parseFloat(marketProb.toFixed(4)),
            edge: parseFloat(edge.toFixed(4)),
            confidence: parseFloat(confidence.toFixed(3)),
            hasSufficientEdge: edge >= MIN_EDGE,
            updates,
            recommendation: edge >= MIN_EDGE
                ? (edge >= 0.10 ? 'STRONG_BET' : 'BET')
                : (edge >= 0 ? 'MARGINAL_SKIP' : 'SKIP_OVERPRICED'),
            logitComponents: {
                priorLogit: parseFloat(Math.log(yesPrice / (1 - yesPrice)).toFixed(3)),
                posteriorLogit: parseFloat(logit.toFixed(3)),
                totalShift: parseFloat((logit - Math.log(yesPrice / (1 - yesPrice))).toFixed(3))
            }
        };

        if (Math.abs(edge) >= MIN_EDGE) {
            try { fs.appendFileSync(EDGE_LOG, JSON.stringify({ t: new Date().toISOString(), ...result, side }) + '\n'); } catch { }
        }

        const icon = edge >= MIN_EDGE ? '🟢' : '🔴';
        console.log('[LMSR]', icon, 'Edge:', (edge * 100).toFixed(1) + '%',
            '| Fair:', (fairProb * 100).toFixed(1) + '%',
            '| Market:', (marketProb * 100).toFixed(1) + '%',
            '|', result.recommendation);

        return result;
    }

    recordPrediction(predId, pHat, side) {
        const entry = { id: predId, pHat, side, t: new Date().toISOString(), resolved: false, outcome: null };
        this.predictionLog.push(entry);
        try { fs.appendFileSync(CALIBRATION_LOG, JSON.stringify(entry) + '\n'); } catch { }
    }

    resolvePrediction(predId, won) {
        const pred = this.predictionLog.find(p => p.id === predId);
        if (!pred) return;
        pred.resolved = true;
        pred.outcome = won ? 1 : 0;
        pred.brierContribution = Math.pow(pred.pHat - pred.outcome, 2);
        try { fs.appendFileSync(CALIBRATION_LOG, JSON.stringify({ ...pred, event: 'RESOLVED' }) + '\n'); } catch { }
    }

    getBrierScore(lastN = 100) {
        const resolved = this.predictionLog.filter(p => p.resolved && p.outcome !== null).slice(-lastN);
        if (resolved.length < 10) return { score: null, n: resolved.length, status: 'INSUFFICIENT_DATA' };
        const score = resolved.reduce((s, p) => s + p.brierContribution, 0) / resolved.length;
        const status = score < 0.10 ? 'EXCELLENT' : score < 0.15 ? 'GOOD' : score < 0.20 ? 'FAIR' : score < 0.25 ? 'POOR' : 'RANDOM_OR_WORSE';
        return { score: parseFloat(score.toFixed(4)), n: resolved.length, status };
    }

    getPromptContext(yesPrice, side) {
        const brier = this.getBrierScore(50);
        const impliedShares = this.getImpliedShares(yesPrice);
        const marketBias = impliedShares > 20 ? 'YES_HEAVY'
            : impliedShares < -20 ? 'NO_HEAVY' : 'BALANCED';
        return `━━━ LMSR MARKET INTELLIGENCE ━━━
Market Price: ${(yesPrice * 100).toFixed(1)}% YES | Side: ${side}
LMSR Momentum: ${impliedShares.toFixed(1)} shares | Market Bias: ${marketBias}
Brier Score: ${brier.score !== null ? brier.score + ' (' + brier.status + ')' : 'building data...'}`;
    }
}

export const lmsrEngine = new LMSREngine();
