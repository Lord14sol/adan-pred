// src/core/polymerase.js
// Pre-execution simulation — 7 safety gates before any bet
// UPGRADED: Shadow Bet Learning — records blocked bets, checks resolutions, learns
// Part of Mother Code v2.0
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const BLOCKS_LOG = path.join(DIR, 'polymerase_blocks.jsonl');
const SHADOW_FILE = path.join(DIR, 'polymerase_shadows.json');
const LEARNING_FILE = path.join(DIR, 'polymerase_learning.json');

export class Polymerase {
    constructor() {
        this.shadows = this._loadShadows();
        this.learning = this._loadLearning();
    }

    // ── Main Simulation (7 gates) ──
    simulate(market, decision, stake, level = 4) {
        const checks = [];
        const addCheck = (gate, name, passed, reason) => {
            checks.push({ gate, name, passed, reason });
            return passed;
        };

        const { yesPrice, closesAt, volume24h } = market;
        const targetSide = decision.targetSide || 'YES';
        const effectivePrice = targetSide === 'YES' ? yesPrice : (1 - yesPrice);

        // Gate 0: price validity (ALWAYS active)
        if (!addCheck(0, 'PRICE_VALID', effectivePrice > 0.01 && effectivePrice < 0.99,
            `effectivePrice=${effectivePrice}`)) {
            return this._block(checks, 'Invalid price', market, decision, stake);
        }

        if (level < 5) return { approved: true, reason: 'BELOW_LVL5', checks };

        // Gate 1: exit path exists
        const hasExitPath = closesAt && new Date(closesAt) > new Date();
        if (!addCheck(1, 'EXIT_PATH', hasExitPath, `closesAt=${closesAt}`)) {
            return this._block(checks, 'No valid exit path', market, decision, stake);
        }

        // Gate 2: close window valid — ADAPTIVE threshold from learning data
        const hoursToClose = closesAt ? (new Date(closesAt) - Date.now()) / 3600000 : 0;
        const minWindow = this._getAdaptiveThreshold('CLOSE_WINDOW');
        if (!addCheck(2, 'CLOSE_WINDOW', hoursToClose >= minWindow && hoursToClose <= 168,
            `hoursToClose=${hoursToClose.toFixed(1)}, minWindow=${minWindow.toFixed(2)}`)) {
            return this._block(checks, `Close window invalid: ${hoursToClose.toFixed(1)}h`, market, decision, stake);
        }

        // Gate 3: recovery potential >= 40%
        const recovery = effectivePrice >= 0.4 ? ((1 - effectivePrice) / effectivePrice) : 0;
        if (!addCheck(3, 'RECOVERY_POTENTIAL', recovery >= 0.40,
            `recovery=${(recovery * 100).toFixed(1)}%`)) {
            return this._block(checks, `Low recovery potential: ${(recovery * 100).toFixed(1)}%`, market, decision, stake);
        }

        // Gate 4: liquidity >= 2x stake
        const liquidityOk = !volume24h || volume24h >= stake * 2;
        addCheck(4, 'LIQUIDITY', liquidityOk, `vol24h=${volume24h}, stake=${stake}`);

        if (level >= 8) {
            // Gate 5: price rational
            addCheck(5, 'PRICE_RATIONAL', effectivePrice >= 0.05 && effectivePrice <= 0.95,
                `price=${effectivePrice}`);

            // Gate 6: Dead Zone size limiter
            const isDeadZone = !checks[4].passed;
            if (isDeadZone && stake > 50) {
                return this._block(checks, 'Dead Zone bet exceeds $50 limit', market, decision, stake);
            }
        }

        const blocked = checks.filter(c => !c.passed);
        if (blocked.length > 0) {
            return this._block(checks, blocked[0].reason, market, decision, stake);
        }

        console.log('[POLYMERASE] ✅ All gates passed for:', (market.title || '').slice(0, 50));
        return { approved: true, reason: 'ALL_GATES_PASSED', checks };
    }

    _block(checks, reason, market, decision, stake) {
        const failed = checks.find(c => !c.passed);
        const entry = { t: new Date().toISOString(), reason, gate: failed?.gate, checks };
        try { fs.appendFileSync(BLOCKS_LOG, JSON.stringify(entry) + '\n'); } catch { }

        // ═══ SHADOW BET: Record what would have happened ═══
        if (market && decision) {
            this._recordShadowBet(market, decision, stake, reason, failed?.gate);
        }

        console.log('[POLYMERASE] ❌ BLOCKED:', reason);
        return { approved: false, reason, checks };
    }

    // ═══ SHADOW BET SYSTEM ═══

    _recordShadowBet(market, decision, stake, blockReason, gateNum) {
        const shadow = {
            id: `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            marketId: market.id || '',
            marketTitle: (market.title || '').slice(0, 80),
            side: decision.targetSide || 'YES',
            wouldHaveStaked: stake || 100,
            yesPrice: market.yesPrice,
            closesAt: market.closesAt,
            blockReason,
            gateNum: gateNum ?? -1,
            resolved: false,
            wouldHaveWon: null,
            wouldHavePnl: null
        };
        this.shadows.push(shadow);
        this._saveShadows();

        console.log(`[POLYMERASE] 👻 Shadow bet recorded: ${shadow.side} on "${shadow.marketTitle.slice(0, 40)}"`);
    }

    // Check shadow bet resolutions — call from checkResolutions cycle
    async checkShadowResolutions(polyFetch) {
        let resolved = 0;
        for (const s of this.shadows) {
            if (s.resolved) continue;
            if (!s.closesAt || new Date(s.closesAt) > new Date()) continue;

            // Market should be closed — try to fetch result
            try {
                const data = await polyFetch('/markets/' + s.marketId);
                if (!data) continue;
                const closed = data.closed || data.archived || data.active === false;
                if (!closed) continue;

                let outcomePrices;
                try {
                    outcomePrices = typeof data.outcomePrices === 'string'
                        ? JSON.parse(data.outcomePrices) : data.outcomePrices;
                } catch { outcomePrices = [0.5, 0.5]; }

                const yesWon = Array.isArray(outcomePrices) && parseFloat(outcomePrices[0]) >= 0.99;
                const wouldHaveWon = (s.side === 'YES' && yesWon) || (s.side === 'NO' && !yesWon);

                // Calculate virtual P&L
                const entryPrice = s.side === 'YES' ? s.yesPrice : (1 - s.yesPrice);
                const wouldHavePnl = wouldHaveWon
                    ? parseFloat((s.wouldHaveStaked * (1 / Math.max(entryPrice, 0.01) - 1)).toFixed(2))
                    : -s.wouldHaveStaked;

                s.resolved = true;
                s.wouldHaveWon = wouldHaveWon;
                s.wouldHavePnl = wouldHavePnl;
                s.resolvedAt = new Date().toISOString();
                resolved++;

                const icon = wouldHaveWon ? '💰' : '🛡️';
                const verb = wouldHaveWon ? 'WRONG BLOCK (would have won)' : 'CORRECT BLOCK (saved money)';
                console.log(`[POLYMERASE] ${icon} Shadow resolved: ${verb} | $${wouldHavePnl.toFixed(0)} | Gate: ${s.blockReason.slice(0, 30)}`);

                // Update learning data
                this._updateLearning(s);
            } catch (e) { /* skip */ }
        }

        if (resolved > 0) {
            this._saveShadows();
            this._saveLearning();
            this._printLearningReport();
        }

        // Clean old resolved shadows (keep last 500)
        const resolvedShadows = this.shadows.filter(s => s.resolved);
        if (resolvedShadows.length > 500) {
            this.shadows = [
                ...this.shadows.filter(s => !s.resolved),
                ...resolvedShadows.slice(-500)
            ];
            this._saveShadows();
        }

        return resolved;
    }

    // ═══ LEARNING ENGINE ═══

    _updateLearning(shadow) {
        const key = this._getGateKey(shadow.blockReason);
        if (!this.learning[key]) {
            this.learning[key] = {
                totalBlocks: 0,
                correctBlocks: 0,   // block saved money (would have lost)
                wrongBlocks: 0,     // block cost money (would have won)
                savedPnl: 0,        // total $ saved by correct blocks
                missedPnl: 0,       // total $ missed by wrong blocks
                netValue: 0         // savedPnl - missedPnl (positive = gate is helping)
            };
        }

        const l = this.learning[key];
        l.totalBlocks++;
        if (shadow.wouldHaveWon) {
            l.wrongBlocks++;
            l.missedPnl += shadow.wouldHavePnl;
        } else {
            l.correctBlocks++;
            l.savedPnl += Math.abs(shadow.wouldHavePnl);
        }
        l.netValue = l.savedPnl - l.missedPnl;
        l.accuracy = parseFloat((l.correctBlocks / l.totalBlocks * 100).toFixed(1));
    }

    _getGateKey(reason) {
        // Normalize reasons into gate categories
        if (reason.includes('Close window invalid')) return 'CLOSE_WINDOW';
        if (reason.includes('exit path')) return 'EXIT_PATH';
        if (reason.includes('recovery')) return 'RECOVERY_POTENTIAL';
        if (reason.includes('Dead Zone')) return 'DEAD_ZONE';
        if (reason.includes('Invalid price')) return 'PRICE_INVALID';
        if (reason.includes('Liquidity')) return 'LIQUIDITY';
        return 'OTHER';
    }

    _getAdaptiveThreshold(gateName) {
        // Default thresholds
        const defaults = { CLOSE_WINDOW: 0.5 }; // 30 min default

        const data = this.learning[gateName];
        if (!data || data.totalBlocks < 20) {
            return defaults[gateName] || 0.5; // Not enough data, use default
        }

        // If accuracy < 50% (blocking more winners than losers), loosen the gate
        // If accuracy > 80%, tighten the gate
        if (data.accuracy < 50 && gateName === 'CLOSE_WINDOW') {
            // Gate is too aggressive — lower the min window
            return Math.max(0.08, defaults[gateName] * 0.7); // ~5 min floor
        } else if (data.accuracy > 80) {
            // Gate is nailing it — tighten further
            return Math.min(1.0, defaults[gateName] * 1.3); // ~40 min ceiling
        }
        return defaults[gateName] || 0.5;
    }

    _printLearningReport() {
        const keys = Object.keys(this.learning);
        if (keys.length === 0) return;

        console.log('\n[POLYMERASE] 🧠 === LEARNING REPORT ===');
        for (const [gate, data] of Object.entries(this.learning)) {
            const icon = data.accuracy >= 60 ? '✅' : data.accuracy >= 40 ? '⚠️' : '❌';
            const netIcon = data.netValue >= 0 ? '💰' : '💸';
            console.log(`  ${icon} ${gate}: ${data.accuracy}% accuracy (${data.correctBlocks}/${data.totalBlocks}) | ${netIcon} Net: $${data.netValue >= 0 ? '+' : ''}${data.netValue.toFixed(0)} (saved $${data.savedPnl.toFixed(0)}, missed $${data.missedPnl.toFixed(0)})`);
        }

        // Overall
        const total = keys.reduce((acc, k) => ({
            blocks: acc.blocks + this.learning[k].totalBlocks,
            correct: acc.correct + this.learning[k].correctBlocks,
            saved: acc.saved + this.learning[k].savedPnl,
            missed: acc.missed + this.learning[k].missedPnl
        }), { blocks: 0, correct: 0, saved: 0, missed: 0 });

        const overallAcc = total.blocks > 0 ? (total.correct / total.blocks * 100).toFixed(1) : '0';
        const net = total.saved - total.missed;
        console.log(`  ── TOTAL: ${overallAcc}% accuracy | Net value: $${net >= 0 ? '+' : ''}${net.toFixed(0)}`);
        console.log('[POLYMERASE] 🧠 === END REPORT ===\n');
    }

    // ═══ PERSISTENCE ═══

    _loadShadows() {
        try {
            if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
            if (fs.existsSync(SHADOW_FILE)) {
                return JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf8'));
            }
        } catch (e) { }
        return [];
    }

    _saveShadows() {
        try {
            if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(SHADOW_FILE, JSON.stringify(this.shadows, null, 2));
        } catch (e) { }
    }

    _loadLearning() {
        try {
            if (fs.existsSync(LEARNING_FILE)) {
                return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
            }
        } catch (e) { }
        return {};
    }

    _saveLearning() {
        try {
            if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(LEARNING_FILE, JSON.stringify(this.learning, null, 2));
        } catch (e) { }
    }

    // ═══ API / Stats ═══

    getStats() {
        const total = this.shadows.length;
        const resolved = this.shadows.filter(s => s.resolved);
        const unresolved = this.shadows.filter(s => !s.resolved);
        const correctBlocks = resolved.filter(s => !s.wouldHaveWon);
        const wrongBlocks = resolved.filter(s => s.wouldHaveWon);
        const savedPnl = correctBlocks.reduce((a, s) => a + Math.abs(s.wouldHavePnl || 0), 0);
        const missedPnl = wrongBlocks.reduce((a, s) => a + (s.wouldHavePnl || 0), 0);

        return {
            totalShadows: total,
            pendingResolution: unresolved.length,
            resolved: resolved.length,
            correctBlocks: correctBlocks.length,
            wrongBlocks: wrongBlocks.length,
            accuracy: resolved.length > 0 ? parseFloat((correctBlocks.length / resolved.length * 100).toFixed(1)) : 0,
            savedPnl: parseFloat(savedPnl.toFixed(2)),
            missedPnl: parseFloat(missedPnl.toFixed(2)),
            netValue: parseFloat((savedPnl - missedPnl).toFixed(2)),
            perGate: this.learning,
            recentShadows: this.shadows.slice(-10).reverse()
        };
    }
}

export const polymerase = new Polymerase();
