// src/core/feature_attribution.js
// Feature 4: Feature Attribution — measures which signals generate alpha
// Tracks features per trade, calculates per-signal information ratio

import fs from 'fs';
import path from 'path';

const ADAN_DIR = process.env.ADAN_DIR || process.cwd();
const DATA_FILE = path.join(ADAN_DIR, 'data', 'feature_log.json');

export class FeatureTracker {
    constructor() {
        this.trades = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            }
        } catch (e) { }
        return [];
    }

    _save() {
        try {
            const dir = path.dirname(DATA_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.trades, null, 2));
        } catch (e) {
            console.error('[FEATURE_ATTR] Save error:', e.message);
        }
    }

    // Record features when entering a trade
    recordEntry(tradeId, features) {
        this.trades.push({
            id: tradeId,
            timestamp: new Date().toISOString(),
            features: { ...features },
            resolved: false,
            won: null
        });
        this._save();
    }

    // Update trade with resolution
    recordResolution(tradeId, won, pnl) {
        const trade = this.trades.find(t => t.id === tradeId);
        if (trade) {
            trade.resolved = true;
            trade.won = won;
            trade.pnl = pnl;
            this._save();
        }
    }

    // Extract feature vector from current market state
    extractFeatures(state) {
        const fg = state.fearGreed || 0;
        const funding = state.fundingRate || 0;
        const trendStr = state.trendStrength || 0;
        const volRatio = state.volRatio || 1;
        const session = state.sessionName || 'UNKNOWN';
        const humanState = state.humanState || 'RATIONAL_MARKET';
        const utcH = new Date().getUTCHours();
        const edge = state.edge || 0;
        const confidence = state.confidence || 50;
        const asset = (state.asset || '').toUpperCase();
        const smartMoneySig = state.smartMoneySignal || 'NO_DATA';
        const spreadPct = state.spreadPct || 0;

        return {
            fearGreed: fg,
            fearBucket: fg < 25 ? 'EXTREME_FEAR' : fg < 40 ? 'FEAR' : fg < 60 ? 'NEUTRAL' : fg < 75 ? 'GREED' : 'EXTREME_GREED',
            fundingRate: funding,
            fundingBucket: funding < -0.01 ? 'NEG_STRONG' : funding < 0 ? 'NEG_WEAK' : funding < 0.01 ? 'POS_WEAK' : 'POS_STRONG',
            trendStrength: trendStr,
            volRatio,
            session,
            humanState,
            utcHour: utcH,
            hourBucket: utcH < 6 ? 'ASIA_NIGHT' : utcH < 12 ? 'EU_MORNING' : utcH < 18 ? 'US_SESSION' : 'US_EVENING',
            edge,
            confidence,
            asset,
            smartMoneySig,
            spreadPct
        };
    }

    // Calculate per-feature win rates
    getAttribution() {
        const resolved = this.trades.filter(t => t.resolved);
        if (resolved.length < 10) {
            return { sufficient: false, totalTrades: resolved.length, features: {} };
        }

        const totalWR = resolved.filter(t => t.won).length / resolved.length;

        // Feature buckets to analyze
        const buckets = ['fearBucket', 'fundingBucket', 'session', 'humanState', 'hourBucket', 'asset', 'smartMoneySig'];
        const attribution = {};

        for (const feature of buckets) {
            const values = {};
            for (const trade of resolved) {
                const val = trade.features?.[feature] || 'UNKNOWN';
                if (!values[val]) values[val] = { wins: 0, losses: 0, total: 0, pnl: 0 };
                values[val].total++;
                if (trade.won) values[val].wins++;
                else values[val].losses++;
                values[val].pnl += trade.pnl || 0;
            }

            // Calculate information ratio for each value
            const featureResults = {};
            for (const [val, stats] of Object.entries(values)) {
                if (stats.total < 3) continue; // Not enough data
                const wr = stats.wins / stats.total;
                const edge = wr - totalWR;
                const ir = edge; // Simplified information ratio
                featureResults[val] = {
                    wr: parseFloat((wr * 100).toFixed(1)),
                    trades: stats.total,
                    edge: parseFloat((edge * 100).toFixed(1)),
                    pnl: Math.round(stats.pnl),
                    impact: edge > 0.05 ? 'STRONG_POSITIVE' :
                        edge > 0.02 ? 'POSITIVE' :
                            edge > -0.02 ? 'NEUTRAL' :
                                edge > -0.05 ? 'NEGATIVE' : 'STRONG_NEGATIVE'
                };
            }

            attribution[feature] = featureResults;
        }

        return {
            sufficient: true,
            totalTrades: resolved.length,
            baselineWR: parseFloat((totalWR * 100).toFixed(1)),
            features: attribution
        };
    }

    // Generate terminal report
    getReport() {
        const attr = this.getAttribution();
        if (!attr.sufficient) {
            return `Feature Attribution: ${attr.totalTrades} trades (need 10+ for analysis)`;
        }

        const lines = [
            `═══ FEATURE ATTRIBUTION · ${attr.totalTrades} trades · Baseline WR: ${attr.baselineWR}% ═══`,
        ];

        for (const [feature, values] of Object.entries(attr.features)) {
            lines.push(`\n▶ ${feature.toUpperCase()}`);
            const sorted = Object.entries(values).sort((a, b) => b[1].edge - a[1].edge);
            for (const [val, stats] of sorted) {
                const color = stats.edge > 0 ? '+' : '';
                const icon = stats.impact.includes('POSITIVE') ? '✅' :
                    stats.impact.includes('NEGATIVE') ? '❌' : '○';
                lines.push(`  ${icon} ${val}: ${stats.wr}% WR (${stats.trades}t) | Edge: ${color}${stats.edge}% | P&L: $${stats.pnl}`);
            }
        }

        return lines.join('\n');
    }

    // API response format
    getAPIResponse() {
        return this.getAttribution();
    }
}

export const featureTracker = new FeatureTracker();
