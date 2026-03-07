// src/core/feature_importance.js
// Feature Importance Tracker — Point-Biserial Correlation of signals vs win/loss
// After 50+ trades, ranks which signals actually predict outcomes
// Part of Mother Code v2.0 — Quant Intelligence Layer

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const FEATURE_LOG = path.join(DIR, 'feature_importance.jsonl');
const MIN_TRADES_FOR_RANKING = 50;

// Features to track
const FEATURE_NAMES = [
    'rsi', 'macd_hist', 'bb_position', 'vwap_deviation',
    'fear_greed', 'news_score', 'funding_rate', 'oi_change',
    'whale_walls', 'regime', 'session_edge', 'human_state',
    'oracle_signal', 'vol_ratio', 'trend_strength'
];

export class FeatureImportanceTracker {
    constructor() {
        this.records = [];
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(FEATURE_LOG)) {
                const lines = fs.readFileSync(FEATURE_LOG, 'utf8').trim().split('\n').filter(Boolean);
                this.records = lines.slice(-1000).map(l => {
                    try { return JSON.parse(l); } catch { return null; }
                }).filter(Boolean);
            }
        } catch { this.records = []; }
    }

    // Record features at trade entry
    recordEntry(tradeId, features) {
        const entry = {
            tradeId,
            ts: new Date().toISOString(),
            features: this._normalizeFeatures(features),
            resolved: false,
            won: null
        };
        this.records.push(entry);
        try {
            fs.mkdirSync(DIR, { recursive: true });
            fs.appendFileSync(FEATURE_LOG, JSON.stringify(entry) + '\n');
        } catch { }
    }

    // Resolve a trade — mark as won/lost
    resolveEntry(tradeId, won) {
        const entry = this.records.find(r => r.tradeId === tradeId && !r.resolved);
        if (!entry) return;
        entry.resolved = true;
        entry.won = won;
        try {
            fs.appendFileSync(FEATURE_LOG, JSON.stringify({ ...entry, event: 'RESOLVED' }) + '\n');
        } catch { }
    }

    _normalizeFeatures(raw) {
        return {
            rsi: raw.rsi || 50,
            macd_hist: raw.macdHist || 0,
            bb_position: raw.bbPosition || 0.5,
            vwap_deviation: raw.vwapDeviation || 0,
            fear_greed: raw.fearGreed || 50,
            news_score: raw.newsScore || 0,
            funding_rate: raw.fundingRate || 0,
            oi_change: raw.oiChange || 0,
            whale_walls: raw.whaleWalls || 0,
            regime: raw.regime === 'TRENDING' ? 1 : raw.regime === 'VOLATILE' ? -1 : 0,
            session_edge: raw.sessionEdge || 1,
            human_state: raw.humanState === 'RATIONAL_MARKET' ? 0 : raw.humanState === 'HERD_PANIC' ? -1 : 1,
            oracle_signal: raw.oracleSignal || 0,
            vol_ratio: raw.volRatio || 1,
            trend_strength: raw.trendStrength || 0
        };
    }

    // Point-Biserial Correlation: rpb = (M1 - M0) / S * √(n1*n0 / n²)
    // Where M1 = mean of feature for wins, M0 = mean for losses
    calculateImportance() {
        const resolved = this.records.filter(r => r.resolved && r.won !== null);
        if (resolved.length < MIN_TRADES_FOR_RANKING) {
            return { ready: false, n: resolved.length, needed: MIN_TRADES_FOR_RANKING };
        }

        const wins = resolved.filter(r => r.won);
        const losses = resolved.filter(r => !r.won);
        const n = resolved.length;
        const n1 = wins.length;
        const n0 = losses.length;

        if (n1 === 0 || n0 === 0) return { ready: false, n, reason: 'ALL_SAME_OUTCOME' };

        const rankings = [];

        for (const feature of FEATURE_NAMES) {
            const allValues = resolved.map(r => r.features[feature] || 0);
            const winValues = wins.map(r => r.features[feature] || 0);
            const lossValues = losses.map(r => r.features[feature] || 0);

            const meanAll = allValues.reduce((s, v) => s + v, 0) / n;
            const stdAll = Math.sqrt(allValues.reduce((s, v) => s + (v - meanAll) ** 2, 0) / n);

            if (stdAll === 0) {
                rankings.push({ feature, rpb: 0, predictive: false });
                continue;
            }

            const meanWin = winValues.reduce((s, v) => s + v, 0) / n1;
            const meanLoss = lossValues.reduce((s, v) => s + v, 0) / n0;

            const rpb = ((meanWin - meanLoss) / stdAll) * Math.sqrt((n1 * n0) / (n * n));

            rankings.push({
                feature,
                rpb: parseFloat(rpb.toFixed(4)),
                meanWin: parseFloat(meanWin.toFixed(4)),
                meanLoss: parseFloat(meanLoss.toFixed(4)),
                predictive: Math.abs(rpb) > 0.1
            });
        }

        // Sort by absolute correlation
        rankings.sort((a, b) => Math.abs(b.rpb) - Math.abs(a.rpb));

        return {
            ready: true,
            n: resolved.length,
            winRate: (n1 / n * 100).toFixed(1) + '%',
            rankings,
            topPredictors: rankings.filter(r => r.predictive).slice(0, 5),
            weakSignals: rankings.filter(r => !r.predictive)
        };
    }

    // Generate prompt context for LLM
    getPromptContext() {
        const imp = this.calculateImportance();
        if (!imp.ready) return '';
        if (imp.topPredictors.length === 0) return '';

        const lines = ['━━━ FEATURE IMPORTANCE (Point-Biserial) ━━━'];
        lines.push(`Based on ${imp.n} resolved trades (WR: ${imp.winRate}):`);
        for (const p of imp.topPredictors) {
            const dir = p.rpb > 0 ? '↑ predicts WIN' : '↓ predicts LOSS';
            lines.push(`  ${p.feature}: r=${p.rpb} ${dir} (win_mean=${p.meanWin}, loss_mean=${p.meanLoss})`);
        }
        if (imp.weakSignals.length > 0) {
            lines.push(`Weak signals (ignore): ${imp.weakSignals.map(w => w.feature).join(', ')}`);
        }
        return lines.join('\n');
    }
}

export const featureImportance = new FeatureImportanceTracker();
