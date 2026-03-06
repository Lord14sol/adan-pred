// src/core/child_learning.js
// Child Learning Engine — Shadow Predictions, Weighted Consensus & Evolutionary Architecture
// Each child records predictions, accumulates accuracy, and evolves its DNA over time.

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';
const DIR = process.env.ADAN_DIR || path.join(HOME, '.adan-pred');
const LEARNING_PATH = path.join(DIR, 'child_learning.json');
const SHADOWS_PATH = path.join(DIR, 'child_shadows.jsonl');

const MAX_CHILDREN_PER_PARENT = 3;
const MIN_PREDICTIONS_FOR_WEIGHT = 10;   // Need 10+ resolved to start weighting
const MIN_PREDICTIONS_FOR_EVOLUTION = 100; // Need 100+ resolved to trigger evolution
const EVOLUTION_INTERVAL = 200;           // Evolve every 200 resolved predictions (global)
const MUTATION_RATE = 0.10;               // ±10% random noise on mutation
const DIVERSITY_THRESHOLD = 0.90;         // If DNA similarity > 90%, force stronger mutation

// ═══ DEFAULT DNA — the tunable parameters each child can evolve ═══
const DEFAULT_DNA = {
    rsiOversold: 35,
    rsiOverbought: 65,
    macdWeight: 1.0,
    trendMinPct: 0.3,
    trend15mMinPct: 0.5,
    volSpikeThreshold: 1.5,
    minConfidence: 55,
    generation: 1
};

// Hard floors and ceilings for each parameter (prevents insane mutations)
const DNA_BOUNDS = {
    rsiOversold: { min: 20, max: 45 },
    rsiOverbought: { min: 55, max: 80 },
    macdWeight: { min: 0.2, max: 2.0 },
    trendMinPct: { min: 0.05, max: 1.0 },
    trend15mMinPct: { min: 0.1, max: 1.5 },
    volSpikeThreshold: { min: 1.0, max: 3.0 },
    minConfidence: { min: 40, max: 80 },
};

class ChildLearningEngine {
    constructor() {
        this.learning = {};   // { childId: { predictions, correct, wrong, accuracy, perSignal, dna, ... } }
        this.shadows = [];    // Unresolved shadow predictions
        this.globalResolved = 0;
        this.lastEvolution = 0;
        this._load();
    }

    // ═══ PHASE 1: SHADOW PREDICTION TRACKING ═══

    /**
     * Record a child's prediction as a shadow bet
     * Called from runChildScanner() whenever a child emits a non-NEUTRAL signal
     */
    recordPrediction(childId, { direction, confidence, asset, marketId, marketCloseTime, reasons, regime = 'UNKNOWN' }) {
        // Save entryPrice at prediction time for accurate resolution
        const sym = this._assetToSymbol(asset);
        const shadow = {
            childId,
            direction,       // 'UP' or 'DOWN'
            confidence,
            asset,
            marketId: marketId || `${asset}_${Date.now()}`,
            marketCloseTime: marketCloseTime || new Date(Date.now() + 5 * 60000).toISOString(),
            reasons: reasons || [],
            regime,         // TRENDING, VOLATILE, MEAN_REVERTING
            ts: new Date().toISOString(),
            entryPrice: null, // Set externally or from prices
            resolved: false,
            correct: null,
        };

        this.shadows.push(shadow);

        // Persist shadow
        try {
            fs.appendFileSync(SHADOWS_PATH, JSON.stringify(shadow) + '\n');
        } catch (e) { /* skip */ }

        return shadow;
    }

    /**
     * Check if any shadow predictions can be resolved
     * Called from the main checkResolutions() cycle
     */
    checkResolutions(prices) {
        const now = Date.now();
        let resolved = 0;

        for (const s of this.shadows) {
            if (s.resolved) continue;
            const closeTime = new Date(s.marketCloseTime).getTime();
            if (closeTime > now) continue; // Not closed yet

            try {
                // Determine actual outcome from price movement
                const sym = this._assetToSymbol(s.asset);
                const currentPrice = prices?.[sym]?.price;
                if (!currentPrice) continue;

                // Compare against entry price saved at prediction time
                let actualDirection;
                if (s.entryPrice && s.entryPrice > 0) {
                    const pctChange = (currentPrice - s.entryPrice) / s.entryPrice;
                    actualDirection = pctChange > 0.001 ? 'UP' : pctChange < -0.001 ? 'DOWN' : 'NEUTRAL';
                } else {
                    // Fallback: use 5m trend if no entryPrice saved
                    const priceData = prices[sym];
                    actualDirection = priceData && priceData.trend5m > 0.05 ? 'UP' :
                        priceData && priceData.trend5m < -0.05 ? 'DOWN' : 'NEUTRAL';
                }

                const correct = (s.direction === actualDirection);

                s.resolved = true;
                s.correct = correct;
                s.resolvedAt = new Date().toISOString();
                s.actualDirection = actualDirection;

                // Update learning stats
                this._updateChildStats(s);
                resolved++;

                const icon = correct ? '✅' : '❌';
                console.log(`[CHILD LEARNING] ${icon} ${s.childId}: predicted ${s.direction}, actual ${actualDirection} | ${correct ? 'CORRECT' : 'WRONG'}`);
            } catch (e) { /* skip */ }
        }

        if (resolved > 0) {
            this.globalResolved += resolved;
            this._save();
            this._printReport();

            // Check if evolution should trigger
            if (this.globalResolved - this.lastEvolution >= EVOLUTION_INTERVAL) {
                this._evolve();
                this.lastEvolution = this.globalResolved;
                this._save();
            }
        }

        // Cleanup old resolved shadows (keep last 1000)
        const resolvedShadows = this.shadows.filter(s => s.resolved);
        if (resolvedShadows.length > 1000) {
            this.shadows = [
                ...this.shadows.filter(s => !s.resolved),
                ...resolvedShadows.slice(-1000)
            ];
        }

        return resolved;
    }

    // ═══ STATS & WEIGHTED CONSENSUS ═══

    /**
     * Get stats for a specific child
     */
    getChildStats(childId) {
        return this.learning[childId] || this._initChild(childId);
    }

    /**
     * Calculate weighted consensus from all children's current signals
     * @param {Array} childSignals - [{ childId, direction, confidence }, ...]
     * @returns {{ direction, weightedConfidence, details }}
     */
    getWeightedConsensus(childSignals) {
        if (!childSignals || childSignals.length === 0) {
            return { direction: 'NEUTRAL', weightedConfidence: 0, details: [] };
        }

        let upScore = 0, downScore = 0;
        const details = [];

        for (const sig of childSignals) {
            if (sig.direction === 'NEUTRAL') continue;

            const stats = this.getChildStats(sig.childId);

            // ── REGIME-WEIGHTED CONSENSUS ──
            // If we have a current regime from the signal, we use the regime-specific accuracy.
            // Otherwise, fallback to the global accuracy.
            const regime = sig.regime || 'UNKNOWN';
            let accuracyToUse = stats.accuracy;
            let usedRegimeAcc = false;

            if (regime !== 'UNKNOWN' && stats.regimes && stats.regimes[regime] && stats.regimes[regime].total >= 5) {
                // We have enough data to judge this child's performance in this specific regime
                accuracyToUse = Math.round((stats.regimes[regime].correct / stats.regimes[regime].total) * 100);
                usedRegimeAcc = true;
            }

            // Weight = accuracy / 50 (so 60% acc = 1.2x, 40% = 0.8x)
            // If not enough data, weight = 1.0 (neutral)
            const weight = stats.totalResolved >= MIN_PREDICTIONS_FOR_WEIGHT
                ? Math.max(0.3, Math.min(2.0, accuracyToUse / 50))
                : 1.0;

            const contribution = sig.confidence * weight;

            if (sig.direction === 'UP') upScore += contribution;
            else if (sig.direction === 'DOWN') downScore += contribution;

            details.push({
                childId: sig.childId,
                direction: sig.direction,
                confidence: sig.confidence,
                accuracy: accuracyToUse,
                regimeUsed: usedRegimeAcc ? regime : 'GLOBAL',
                weight: parseFloat(weight.toFixed(2)),
                generation: stats.dna?.generation || 1,
                totalResolved: stats.totalResolved,
            });
        }

        const totalScore = upScore + downScore;
        const direction = upScore > downScore ? 'UP' : downScore > upScore ? 'DOWN' : 'NEUTRAL';
        const weightedConfidence = totalScore > 0
            ? Math.round((Math.max(upScore, downScore) / totalScore) * 100)
            : 0;

        // Sort details: highest weight first
        details.sort((a, b) => b.weight - a.weight);

        return { direction, weightedConfidence, details };
    }

    /**
     * Generate prompt context for the LLM (replaces flat intel summary)
     */
    getPromptContext(childSignals) {
        const consensus = this.getWeightedConsensus(childSignals);
        if (consensus.details.length === 0) return '';

        const agreeing = consensus.details.filter(d => d.direction === consensus.direction);
        const opposing = consensus.details.filter(d => d.direction !== consensus.direction && d.direction !== 'NEUTRAL');

        const lines = [
            `━━━ DYNASTY WEIGHTED CONSENSUS ━━━`,
            `Direction: ${consensus.direction} (${consensus.weightedConfidence}% weighted confidence)`,
        ];

        if (agreeing.length > 0) {
            lines.push(`Agreeing: ${agreeing.map(d =>
                `${d.childId}(${d.accuracy}% acc [${d.regimeUsed}], ${d.weight}x)`
            ).join(', ')}`);
        }
        if (opposing.length > 0) {
            lines.push(`Opposing: ${opposing.map(d =>
                `${d.childId}(${d.accuracy}% acc [${d.regimeUsed}], ${d.weight}x) → signal discounted`
            ).join(', ')}`);
        }

        const maxGen = Math.max(...consensus.details.map(d => d.generation), 1);
        const totalResolved = Object.values(this.learning).reduce((s, l) => s + (l.totalResolved || 0), 0);
        const nextEvolution = EVOLUTION_INTERVAL - (this.globalResolved - this.lastEvolution);
        lines.push(`Generation: G${maxGen} | Total resolved: ${totalResolved} | Next evolution in ${nextEvolution} predictions`);

        return lines.join('\n');
    }

    /**
     * Get DNA for a child (for use in childSignal function to use evolved thresholds)
     */
    getChildDNA(childId) {
        const stats = this.getChildStats(childId);
        return stats.dna || { ...DEFAULT_DNA };
    }

    // ═══ PHASE 2: EVOLUTIONARY ENGINE ═══

    _evolve() {
        const children = Object.entries(this.learning)
            .filter(([, stats]) => stats.totalResolved >= 20) // Only evolve children with enough data
            .sort((a, b) => b[1].accuracy - a[1].accuracy);

        if (children.length < 3) {
            console.log('[EVOLUTION] ⏳ Not enough children with data to evolve. Waiting...');
            return;
        }

        console.log('\n[EVOLUTION] 🧬 ═══ EVOLUTIONARY CYCLE TRIGGERED ═══');

        // Top 2 performers
        const [best1Id, best1Stats] = children[0];
        const [best2Id, best2Stats] = children[1];

        // Bottom performer
        const [worstId, worstStats] = children[children.length - 1];

        console.log(`[EVOLUTION] 🏆 Best: ${best1Id} (${best1Stats.accuracy}%) + ${best2Id} (${best2Stats.accuracy}%)`);
        console.log(`[EVOLUTION] 💀 Worst: ${worstId} (${worstStats.accuracy}%) → CULLING`);

        // ── SHANNON ENTROPY: Diversity Penalty ──
        // H = -Σ p_i * log(p_i). We calculate the entropy of the parameter distributions.
        const entropy = this._calculateShannonEntropy(children.map(c => c[1].dna));
        console.log(`[EVOLUTION] 🧬 Gene Pool Entropy: H = ${entropy.toFixed(3)}`);

        // Crossover: combine best parameters from top 2
        let newDNA = this._crossover(best1Stats.dna, best2Stats.dna);

        // Mutation: add random noise
        let mutatedDNA = this._mutate(newDNA);

        // Diversity enforcement
        if (entropy < 0.5) {
            console.log(`[EVOLUTION] 🚨 CRITICAL: Monoculture detected (H < 0.5). Forcing extreme mutation penalty!`);
            // Force 3x mutation rate when entropy is dangerously low
            Object.keys(DNA_BOUNDS).forEach(key => {
                mutatedDNA[key] = this._mutateParam(mutatedDNA[key], key, MUTATION_RATE * 3);
            });
        } else {
            // Standard diversity check (fallback)
            for (const [id, stats] of children) {
                if (id === worstId) continue;
                const similarity = this._dnaSimilarity(mutatedDNA, stats.dna);
                if (similarity > DIVERSITY_THRESHOLD) {
                    console.log(`[EVOLUTION] 🔀 Local diversity penalty (${(similarity * 100).toFixed(0)}% similar to ${id})`);
                    Object.keys(DNA_BOUNDS).forEach(key => {
                        mutatedDNA[key] = this._mutateParam(mutatedDNA[key], key, MUTATION_RATE * 2);
                    });
                    break;
                }
            }
        }

        mutatedDNA.generation = Math.max(best1Stats.dna?.generation || 1, best2Stats.dna?.generation || 1) + 1;

        // Apply new DNA to worst performer (cull + rebirth)
        this.learning[worstId] = {
            ...this._initChild(worstId),
            dna: mutatedDNA,
            evolvedFrom: [best1Id, best2Id],
            evolvedAt: new Date().toISOString(),
        };

        console.log(`[EVOLUTION] 🌱 ${worstId} reborn as G${mutatedDNA.generation} from ${best1Id} × ${best2Id}`);
        console.log(`[EVOLUTION] 📊 New DNA:`, JSON.stringify(mutatedDNA, null, 2));
        console.log('[EVOLUTION] ═══════════════════════════════════\n');
    }

    _crossover(dna1, dna2) {
        const child = {};
        for (const key of Object.keys(DNA_BOUNDS)) {
            // Randomly pick from parent1 or parent2
            child[key] = Math.random() < 0.5 ? (dna1?.[key] ?? DEFAULT_DNA[key]) : (dna2?.[key] ?? DEFAULT_DNA[key]);
        }
        return child;
    }

    _mutate(dna) {
        const mutated = { ...dna };
        for (const key of Object.keys(DNA_BOUNDS)) {
            mutated[key] = this._mutateParam(mutated[key] ?? DEFAULT_DNA[key], key, MUTATION_RATE);
        }
        return mutated;
    }

    _mutateParam(value, paramName, rate) {
        const noise = 1 + (Math.random() * 2 - 1) * rate; // Random between (1-rate) and (1+rate)
        const mutated = value * noise;
        const bounds = DNA_BOUNDS[paramName];
        if (!bounds) return mutated;
        return Math.max(bounds.min, Math.min(bounds.max, parseFloat(mutated.toFixed(2))));
    }

    _dnaSimilarity(dna1, dna2) {
        if (!dna1 || !dna2) return 0;
        let totalDiff = 0, count = 0;
        for (const key of Object.keys(DNA_BOUNDS)) {
            const v1 = dna1[key] ?? DEFAULT_DNA[key];
            const v2 = dna2[key] ?? DEFAULT_DNA[key];
            const maxVal = Math.max(Math.abs(v1), Math.abs(v2), 0.01);
            totalDiff += Math.abs(v1 - v2) / maxVal;
            count++;
        }
        return count > 0 ? 1 - (totalDiff / count) : 0;
    }

    /**
     * Calculates Shannon Entropy (H) of the current gene pool.
     * H = -Σ p_i * log(p_i)
     * High entropy = High diversity (healthy). Low entropy = Monoculture (danger).
     */
    _calculateShannonEntropy(dnas) {
        if (!dnas || dnas.length < 2) return 1.0;

        // We calculate entropy by looking at the distribution of values for each parameter.
        // We discretize the continuous parameter space into buckets (bins).
        let totalEntropy = 0;
        const keys = Object.keys(DNA_BOUNDS);
        const numBins = 5; // Divide the range of each parameter into 5 buckets

        for (const key of keys) {
            const min = DNA_BOUNDS[key].min;
            const max = DNA_BOUNDS[key].max;
            const range = max - min;
            const binCounts = new Array(numBins).fill(0);

            // Assign each DNA's parameter to a bucket
            for (const dna of dnas) {
                let val = dna[key] ?? DEFAULT_DNA[key];
                val = Math.max(min, Math.min(max, val)); // Clamp
                let binIdx = Math.floor(((val - min) / range) * numBins);
                if (binIdx >= numBins) binIdx = numBins - 1; // edge case for val === max
                binCounts[binIdx]++;
            }

            // Calculate entropy for this parameter
            let paramEntropy = 0;
            for (const count of binCounts) {
                if (count > 0) {
                    const p = count / dnas.length;
                    paramEntropy -= p * Math.log2(p);
                }
            }

            // Normalize paramEntropy to [0, 1] range. Max entropy for N bins is log2(N)
            const maxPossibleEntropy = Math.log2(numBins);
            const normalizedEntropy = maxPossibleEntropy > 0 ? paramEntropy / maxPossibleEntropy : 0;

            totalEntropy += normalizedEntropy;
        }

        // Average entropy across all parameters
        return totalEntropy / keys.length;
    }

    // ═══ INTERNAL HELPERS ═══

    _updateChildStats(shadow) {
        const id = shadow.childId;
        if (!this.learning[id]) this.learning[id] = this._initChild(id);

        const stats = this.learning[id];
        stats.totalResolved++;

        if (shadow.correct) {
            stats.correct++;
        } else {
            stats.wrong++;
        }
        stats.accuracy = parseFloat((stats.correct / stats.totalResolved * 100).toFixed(1));

        // Regime-specific tracking
        const regime = shadow.regime || 'UNKNOWN';
        if (regime !== 'UNKNOWN') {
            if (!stats.regimes) stats.regimes = {};
            if (!stats.regimes[regime]) stats.regimes[regime] = { correct: 0, total: 0 };
            stats.regimes[regime].total++;
            if (shadow.correct) stats.regimes[regime].correct++;
        }

        // Per-signal tracking
        for (const reason of (shadow.reasons || [])) {
            const key = this._normalizeReason(reason);
            if (!stats.perSignal[key]) stats.perSignal[key] = { correct: 0, total: 0, accuracy: 0 };
            stats.perSignal[key].total++;
            if (shadow.correct) stats.perSignal[key].correct++;
            stats.perSignal[key].accuracy = parseFloat(
                (stats.perSignal[key].correct / stats.perSignal[key].total * 100).toFixed(1)
            );
        }
    }

    _normalizeReason(reason) {
        if (/rsi/i.test(reason)) return 'RSI';
        if (/macd/i.test(reason)) return 'MACD';
        if (/trend/i.test(reason)) return 'TREND';
        if (/vol/i.test(reason)) return 'VOLUME';
        return 'OTHER';
    }

    _initChild(childId) {
        return {
            totalResolved: 0,
            correct: 0,
            wrong: 0,
            accuracy: 50, // Start at 50% (neutral prior)
            perSignal: {},
            regimes: {
                TRENDING: { correct: 0, total: 0 },
                VOLATILE: { correct: 0, total: 0 },
                MEAN_REVERTING: { correct: 0, total: 0 }
            },
            dna: { ...DEFAULT_DNA },
        };
    }

    _assetToSymbol(asset) {
        const map = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', bnb: 'BNBUSDT' };
        return map[asset?.toLowerCase()] || asset;
    }

    _printReport() {
        const ids = Object.keys(this.learning);
        if (ids.length === 0) return;

        console.log('\n[CHILD LEARNING] 🧬 ═══ DYNASTY LEARNING REPORT ═══');
        for (const id of ids) {
            const s = this.learning[id];
            if (s.totalResolved === 0) continue;
            const gen = s.dna?.generation || 1;
            console.log(`  ${id}: G${gen} | ${s.totalResolved} resolved | ${s.correct}W/${s.wrong}L | Accuracy: ${s.accuracy}%`);
            for (const [sig, data] of Object.entries(s.perSignal)) {
                console.log(`    └─ ${sig}: ${data.correct}/${data.total} (${data.accuracy}%)`);
            }
            if (s.regimes) {
                for (const [reg, data] of Object.entries(s.regimes)) {
                    if (data.total > 0) {
                        const acc = Math.round((data.correct / data.total) * 100);
                        console.log(`    └─ [${reg}]: ${data.correct}/${data.total} (${acc}%)`);
                    }
                }
            }
        }
        const nextEvo = EVOLUTION_INTERVAL - (this.globalResolved - this.lastEvolution);
        console.log(`  Next evolution in: ${nextEvo} predictions`);
        console.log('[CHILD LEARNING] ═══════════════════════════════════\n');
    }

    // ═══ PERSISTENCE ═══

    _load() {
        try {
            if (fs.existsSync(LEARNING_PATH)) {
                const data = JSON.parse(fs.readFileSync(LEARNING_PATH, 'utf8'));
                this.learning = data.learning || {};
                this.globalResolved = data.globalResolved || 0;
                this.lastEvolution = data.lastEvolution || 0;
            }
        } catch (e) { /* start fresh */ }

        // Load unresolved shadows
        try {
            if (fs.existsSync(SHADOWS_PATH)) {
                const lines = fs.readFileSync(SHADOWS_PATH, 'utf8').trim().split('\n').filter(Boolean);
                this.shadows = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
                // Only keep unresolved ones in memory
                this.shadows = this.shadows.filter(s => !s.resolved);
            }
        } catch (e) { /* start fresh */ }
    }

    _save() {
        try {
            fs.writeFileSync(LEARNING_PATH, JSON.stringify({
                learning: this.learning,
                globalResolved: this.globalResolved,
                lastEvolution: this.lastEvolution,
                savedAt: new Date().toISOString(),
            }, null, 2));
        } catch (e) { /* skip */ }
    }
}

export const childLearning = new ChildLearningEngine();
export { MAX_CHILDREN_PER_PARENT, DEFAULT_DNA };
