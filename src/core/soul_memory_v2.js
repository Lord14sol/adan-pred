// ═══════════════════════════════════════════════════════════════════════════
// SOUL MEMORY v2.0 — Predictive Memory Engine
// "The next scarce asset is a trained agent's memory" — Computa Labs
//
// Architecture:
//   Layer 1: BELIEFS     — Compressed rules with statistical validation
//   Layer 2: SEQUENCES   — Temporal patterns (what happens AFTER X)
//   Layer 3: REGIMES     — Market state clusters with per-regime strategies
//   Layer 4: CONSOLIDATION — Dream mode compresses raw data into wisdom
//
// This replaces the flat soul_rules.json + SOUL.md append-only chaos
// with a structured, self-pruning, predictive memory system.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const MEMORY_V2_PATH = path.join(DIR, 'soul_memory_v2.json');

// ── Atomic write (consistent with config.js) ──
function atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: BELIEFS — Compressed, validated rules
// Unlike soul_rules.json (54 unvalidated rules), beliefs require:
//   - Minimum 5 observations to form
//   - Confidence = wins / (wins + losses) with Bayesian prior
//   - Temporal decay: unused beliefs lose strength over time
//   - Maximum 30 beliefs (forces quality over quantity)
// ═══════════════════════════════════════════════════════════════════════════

const MAX_BELIEFS = 30;
const MIN_OBS_TO_FORM = 5;
const DECAY_RATE = 0.995;  // Per cycle, ~60% after 100 unused cycles

function bayesianConfidence(wins, losses, prior = 0.5) {
    // Beta distribution posterior mean with weak prior (alpha=1, beta=1)
    return (wins + 1) / (wins + losses + 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: SEQUENCES — "What happens after X?"
// Tracks temporal chains: if condition A happened, what was the outcome?
// Example: "After BTC RSI < 30 AND funding negative → 68% chance of UP in 5min"
// This is how ADAN "sees the future" — pattern completion from experience.
// ═══════════════════════════════════════════════════════════════════════════

function buildConditionKey(features) {
    // Create a discretized key from market features
    const rsiZone = features.rsi < 30 ? 'oversold' : features.rsi > 70 ? 'overbought' : 'mid';
    const trendZone = features.trend5m < -0.3 ? 'down' : features.trend5m > 0.3 ? 'up' : 'flat';
    const volZone = features.volRatio > 1.5 ? 'high' : features.volRatio < 0.7 ? 'low' : 'normal';
    const obZone = features.buyPressure > 60 ? 'buy_wall' : features.buyPressure < 40 ? 'sell_wall' : 'balanced';
    return `${features.asset || 'any'}|rsi:${rsiZone}|trend:${trendZone}|vol:${volZone}|ob:${obZone}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: REGIMES — Cluster market states
// Instead of treating every trade the same, ADAN recognizes "I've been here before"
// and applies the strategy that worked in THIS specific regime.
// Regimes: TRENDING_UP, TRENDING_DOWN, CHOPPY, VOLATILE, COMPRESSED
// ═══════════════════════════════════════════════════════════════════════════

function classifyRegime(features) {
    const { trend5m, trend15m, volatility, bbWidth, volRatio } = features;
    if (Math.abs(trend5m) > 0.5 && Math.abs(trend15m) > 0.8) {
        return trend5m > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
    }
    if (volatility > 0.003 || volRatio > 2.0) return 'VOLATILE';
    if (bbWidth && bbWidth < 0.005) return 'COMPRESSED';
    return 'CHOPPY';
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SoulMemoryV2 {
    constructor() {
        this.data = this._load();
    }

    _load() {
        const defaults = {
            version: 2,
            beliefs: [],         // Layer 1: validated rules
            sequences: {},       // Layer 2: conditionKey → { wins, losses, totalPnL, lastSeen, side }
            regimes: {},         // Layer 3: regime → { bestSide, wr, trades, avgEdge }
            assetProfiles: {},   // Per-asset memory: { btc: { yesBias, noBias, bestHours, worstHours } }
            consolidated: 0,     // Number of consolidation cycles run
            lastConsolidation: null,
            stats: { totalRecorded: 0, beliefsFormed: 0, sequenceHits: 0 }
        };
        try {
            if (fs.existsSync(MEMORY_V2_PATH)) {
                return { ...defaults, ...JSON.parse(fs.readFileSync(MEMORY_V2_PATH, 'utf8')) };
            }
        } catch { }
        return defaults;
    }

    _save() {
        atomicWrite(MEMORY_V2_PATH, this.data);
    }

    // ── Record a trade outcome (called from checkResolutions) ──
    recordTrade({ asset, side, won, edge, confidence, features, hour, pnl }) {
        this.data.stats.totalRecorded++;

        // Layer 2: Record sequence
        if (features) {
            const key = buildConditionKey({ ...features, asset });
            if (!this.data.sequences[key]) {
                this.data.sequences[key] = { wins: 0, losses: 0, totalPnL: 0, lastSeen: null, sides: { YES: { w: 0, l: 0 }, NO: { w: 0, l: 0 } } };
            }
            const seq = this.data.sequences[key];
            if (won) { seq.wins++; } else { seq.losses++; }
            seq.totalPnL += pnl || 0;
            seq.lastSeen = new Date().toISOString();
            if (!seq.sides[side]) seq.sides[side] = { w: 0, l: 0 };
            if (won) { seq.sides[side].w++; } else { seq.sides[side].l++; }
        }

        // Layer 3: Record regime performance
        if (features) {
            const regime = classifyRegime(features);
            if (!this.data.regimes[regime]) {
                this.data.regimes[regime] = { trades: 0, wins: 0, sides: { YES: { w: 0, l: 0 }, NO: { w: 0, l: 0 } }, totalPnL: 0, avgEdge: 0 };
            }
            const reg = this.data.regimes[regime];
            reg.trades++;
            if (won) reg.wins++;
            reg.totalPnL += pnl || 0;
            reg.avgEdge = (reg.avgEdge * (reg.trades - 1) + (edge || 0)) / reg.trades;
            if (!reg.sides[side]) reg.sides[side] = { w: 0, l: 0 };
            if (won) { reg.sides[side].w++; } else { reg.sides[side].l++; }
        }

        // Asset profile
        if (!this.data.assetProfiles[asset]) {
            this.data.assetProfiles[asset] = {
                trades: 0, wins: 0,
                yesWins: 0, yesTotal: 0,
                noWins: 0, noTotal: 0,
                hourStats: {},
                totalPnL: 0
            };
        }
        const ap = this.data.assetProfiles[asset];
        ap.trades++;
        if (won) ap.wins++;
        ap.totalPnL += pnl || 0;
        if (side === 'YES') { ap.yesTotal++; if (won) ap.yesWins++; }
        if (side === 'NO') { ap.noTotal++; if (won) ap.noWins++; }
        if (hour != null) {
            const h = String(hour);
            if (!ap.hourStats[h]) ap.hourStats[h] = { w: 0, l: 0 };
            if (won) { ap.hourStats[h].w++; } else { ap.hourStats[h].l++; }
        }

        this._save();
    }

    // ── PREDICTIVE RECALL: "I've seen this before, and here's what happened" ──
    // This is the alien intelligence layer. Before each trade, ADAN checks:
    // 1. Have I seen this exact market condition before?
    // 2. What was my WR in this condition?
    // 3. Which side (YES/NO) worked better?
    // 4. What regime am I in, and how do I perform in this regime?
    predict({ asset, side, features }) {
        const result = {
            hasMemory: false,
            sequenceWR: null,
            sequenceBestSide: null,
            regimeWR: null,
            regimeBestSide: null,
            assetSideWR: null,
            recommendation: null,
            confidence: 0,
            promptContext: '',
        };

        // Layer 2: Sequence match
        if (features) {
            const key = buildConditionKey({ ...features, asset });
            const seq = this.data.sequences[key];
            if (seq && (seq.wins + seq.losses) >= MIN_OBS_TO_FORM) {
                result.hasMemory = true;
                result.sequenceWR = bayesianConfidence(seq.wins, seq.losses);
                this.data.stats.sequenceHits++;

                // Which side worked better in this exact condition?
                const yesWR = seq.sides.YES ? bayesianConfidence(seq.sides.YES.w, seq.sides.YES.l) : 0.5;
                const noWR = seq.sides.NO ? bayesianConfidence(seq.sides.NO.w, seq.sides.NO.l) : 0.5;
                result.sequenceBestSide = yesWR > noWR ? 'YES' : 'NO';
            }
        }

        // Layer 3: Regime match
        if (features) {
            const regime = classifyRegime(features);
            const reg = this.data.regimes[regime];
            if (reg && reg.trades >= MIN_OBS_TO_FORM) {
                result.regimeWR = bayesianConfidence(reg.wins, reg.trades - reg.wins);
                const yesWR = reg.sides.YES ? bayesianConfidence(reg.sides.YES.w, reg.sides.YES.l) : 0.5;
                const noWR = reg.sides.NO ? bayesianConfidence(reg.sides.NO.w, reg.sides.NO.l) : 0.5;
                result.regimeBestSide = yesWR > noWR ? 'YES' : 'NO';
            }
        }

        // Asset profile
        const ap = this.data.assetProfiles[asset];
        if (ap && ap.trades >= 10) {
            const sideStats = side === 'YES'
                ? { w: ap.yesWins, t: ap.yesTotal }
                : { w: ap.noWins, t: ap.noTotal };
            if (sideStats.t >= 5) {
                result.assetSideWR = bayesianConfidence(sideStats.w, sideStats.t - sideStats.w);
            }
        }

        // Generate recommendation
        const signals = [];
        if (result.sequenceWR !== null) {
            if (result.sequenceWR > 0.6) signals.push({ type: 'sequence', dir: 'FAVOR', strength: result.sequenceWR });
            else if (result.sequenceWR < 0.4) signals.push({ type: 'sequence', dir: 'AVOID', strength: 1 - result.sequenceWR });
        }
        if (result.regimeWR !== null) {
            if (result.regimeBestSide && result.regimeBestSide !== side) {
                signals.push({ type: 'regime', dir: 'WRONG_SIDE', strength: 0.7 });
            }
        }
        if (result.assetSideWR !== null && result.assetSideWR < 0.45) {
            signals.push({ type: 'asset_bias', dir: 'AVOID', strength: 1 - result.assetSideWR });
        }

        // Combine signals
        const avoidSignals = signals.filter(s => s.dir === 'AVOID' || s.dir === 'WRONG_SIDE');
        const favorSignals = signals.filter(s => s.dir === 'FAVOR');

        if (avoidSignals.length >= 2) {
            result.recommendation = 'STRONG_AVOID';
            result.confidence = Math.round(avoidSignals.reduce((s, a) => s + a.strength, 0) / avoidSignals.length * 100);
        } else if (avoidSignals.length === 1 && favorSignals.length === 0) {
            result.recommendation = 'CAUTION';
            result.confidence = Math.round(avoidSignals[0].strength * 100);
        } else if (favorSignals.length >= 1 && avoidSignals.length === 0) {
            result.recommendation = 'FAVOR';
            result.confidence = Math.round(favorSignals.reduce((s, f) => s + f.strength, 0) / favorSignals.length * 100);
        } else {
            result.recommendation = 'NEUTRAL';
            result.confidence = 50;
        }

        // Build prompt context for LLM
        const lines = [];
        if (result.hasMemory) {
            lines.push(`SOUL MEMORY: I've seen this EXACT condition before (${asset} rsi/trend/vol/ob pattern).`);
            lines.push(`  Sequence WR: ${(result.sequenceWR * 100).toFixed(0)}% | Best side: ${result.sequenceBestSide}`);
        }
        if (result.regimeWR !== null) {
            const regime = features ? classifyRegime(features) : '?';
            lines.push(`  Regime: ${regime} → WR: ${(result.regimeWR * 100).toFixed(0)}% | Best side: ${result.regimeBestSide}`);
        }
        if (result.assetSideWR !== null) {
            lines.push(`  ${asset.toUpperCase()} ${side} historical WR: ${(result.assetSideWR * 100).toFixed(0)}%${result.assetSideWR < 0.45 ? ' ⚠ WEAK' : ''}`);
        }
        if (result.recommendation === 'STRONG_AVOID') {
            lines.push(`  ⛔ SOUL VERDICT: STRONG AVOID — multiple memory signals against this trade.`);
        } else if (result.recommendation === 'FAVOR') {
            lines.push(`  ✅ SOUL VERDICT: FAVORABLE — memory supports this trade pattern.`);
        }
        result.promptContext = lines.length > 0 ? '\n══ SOUL MEMORY v2 (predictive recall) ══\n' + lines.join('\n') + '\n' : '';

        return result;
    }

    // ── CONSOLIDATION: Dream Mode v2 — compress raw data into wisdom ──
    // Called during off-hours. Instead of asking LLM to generate rules,
    // this mathematically extracts the top patterns from sequences.
    consolidate() {
        const beliefs = [];

        // Extract top sequences as beliefs
        const seqEntries = Object.entries(this.data.sequences)
            .filter(([, v]) => (v.wins + v.losses) >= MIN_OBS_TO_FORM)
            .map(([key, v]) => ({
                key,
                wr: bayesianConfidence(v.wins, v.losses),
                n: v.wins + v.losses,
                pnl: v.totalPnL,
                bestSide: v.sides.YES && v.sides.NO
                    ? (bayesianConfidence(v.sides.YES.w, v.sides.YES.l) > bayesianConfidence(v.sides.NO.w, v.sides.NO.l) ? 'YES' : 'NO')
                    : 'ANY',
                lastSeen: v.lastSeen,
            }))
            .sort((a, b) => {
                // Sort by (WR distance from 50%) × sqrt(n) — statistical significance
                const sigA = Math.abs(a.wr - 0.5) * Math.sqrt(a.n);
                const sigB = Math.abs(b.wr - 0.5) * Math.sqrt(b.n);
                return sigB - sigA;
            });

        for (const seq of seqEntries.slice(0, MAX_BELIEFS)) {
            const [asset, ...conditions] = seq.key.split('|');
            const condStr = conditions.join(', ');
            const action = seq.wr > 0.55 ? 'FAVOR ' + seq.bestSide : seq.wr < 0.45 ? 'AVOID' : 'NEUTRAL';
            beliefs.push({
                text: `When ${asset.toUpperCase()} is ${condStr} → ${action} (WR: ${(seq.wr * 100).toFixed(0)}%, n=${seq.n}, PnL: $${seq.pnl.toFixed(0)})`,
                confidence: seq.wr,
                sampleSize: seq.n,
                asset,
                action,
                bestSide: seq.bestSide,
                lastSeen: seq.lastSeen,
            });
        }

        this.data.beliefs = beliefs;
        this.data.consolidated++;
        this.data.lastConsolidation = new Date().toISOString();
        this.data.stats.beliefsFormed = beliefs.length;

        // Prune old sequences (not seen in 7 days)
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        for (const [key, val] of Object.entries(this.data.sequences)) {
            if (val.lastSeen && new Date(val.lastSeen).getTime() < weekAgo) {
                delete this.data.sequences[key];
            }
        }

        this._save();
        return beliefs;
    }

    // ── Get top beliefs for LLM prompt (replaces soulManager.getRelevantRules) ──
    getBeliefPrompt({ asset, features } = {}) {
        if (this.data.beliefs.length === 0) return '';

        const regime = features ? classifyRegime(features) : null;
        const relevant = this.data.beliefs
            .filter(b => b.sampleSize >= MIN_OBS_TO_FORM)
            .filter(b => !asset || b.asset === asset || b.asset === 'any')
            .slice(0, 6);

        if (relevant.length === 0) return '';

        const lines = relevant.map(b =>
            `  • [n=${b.sampleSize}] ${b.text}`
        );

        return '\n══ SOUL BELIEFS (validated from ' + this.data.stats.totalRecorded + ' trades) ══\n' + lines.join('\n') + '\n';
    }

    // ── Dashboard summary ──
    getSummary() {
        const seqCount = Object.keys(this.data.sequences).length;
        const regimeCount = Object.keys(this.data.regimes).length;
        const beliefCount = this.data.beliefs.length;
        return {
            beliefs: beliefCount,
            sequences: seqCount,
            regimes: regimeCount,
            totalRecorded: this.data.stats.totalRecorded,
            sequenceHits: this.data.stats.sequenceHits,
            consolidated: this.data.consolidated,
        };
    }
}

export const soulMemory = new SoulMemoryV2();
