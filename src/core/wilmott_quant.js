// src/core/wilmott_quant.js
// Paul Wilmott's "Quantitative Finance" — Full Implementation for ADAN
// 16 concepts across 3 tiers extracted from 1,401 pages / 83 chapters

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const WILMOTT_STATE_PATH = path.join(DIR, 'wilmott_state.json');

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 1: GAME CHANGERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. EWMA Volatility (Ch 42/49) ──────────────────────────────────────────
// σ²_n = λ × σ²_{n-1} + (1-λ) × R²_n
// RiskMetrics: λ=0.94 for daily, eliminates plateauing
class EWMAVolatility {
    constructor(lambda = 0.94) {
        this.lambda = lambda;
        this.state = {}; // { asset: { variance, lastPrice, history[] } }
    }

    update(asset, price) {
        const sym = asset.toLowerCase().replace('usdt', '');
        if (!this.state[sym]) {
            this.state[sym] = { variance: 0.0004, lastPrice: price, history: [], ewmaVol: 0.02 };
            return;
        }
        const s = this.state[sym];
        if (s.lastPrice <= 0) { s.lastPrice = price; return; }

        const logReturn = Math.log(price / s.lastPrice);
        const returnSq = logReturn * logReturn;

        // EWMA variance update
        s.variance = this.lambda * s.variance + (1 - this.lambda) * returnSq;
        s.ewmaVol = Math.sqrt(s.variance);
        s.lastPrice = price;

        // Keep history for GARCH and kurtosis
        s.history.push(logReturn);
        if (s.history.length > 500) s.history = s.history.slice(-500);
    }

    getVolatility(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        return this.state[sym]?.ewmaVol || 0.02;
    }

    // GARCH mean-reversion forecast: E[σ²_{n+k}] = σ̄² + (σ²_n - σ̄²)(1-ν)^k
    forecastVolatility(asset, stepsAhead = 10) {
        const sym = asset.toLowerCase().replace('usdt', '');
        const s = this.state[sym];
        if (!s || s.history.length < 30) return this.getVolatility(asset);

        const longRunVar = s.history.slice(-100).reduce((a, r) => a + r * r, 0) / Math.min(s.history.length, 100);
        const nu = 1 - this.lambda; // speed of mean-reversion
        const forecastVar = longRunVar + (s.variance - longRunVar) * Math.pow(1 - nu, stepsAhead);
        return Math.sqrt(Math.max(0, forecastVar));
    }

    // Kurtosis detection for jump diffusion (Ch 57)
    getKurtosis(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        const h = this.state[sym]?.history;
        if (!h || h.length < 30) return 3.0; // Normal kurtosis

        const n = h.length;
        const mean = h.reduce((a, b) => a + b, 0) / n;
        const m2 = h.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
        const m4 = h.reduce((a, r) => a + (r - mean) ** 4, 0) / n;
        return m2 > 0 ? m4 / (m2 * m2) : 3.0;
    }
}

// ── 2. Uncertain Parameters / Worst-Case Pricing (Ch 52) ───────────────────
// Avellaneda-Levy-Parás-Lyons: price in [V_min, V_max] using σ range
// Only trade when market price falls OUTSIDE the uncertainty range
class UncertainParameters {
    // Compute fair value range for a binary option
    // Using σ_low and σ_high to get [V_min, V_max]
    computeRange(marketPrice, volatility, timeToClose_hours) {
        if (timeToClose_hours <= 0) return { vMin: marketPrice, vMax: marketPrice, width: 0 };

        // σ range: use EWMA vol ± 30% as uncertainty band
        const sigmaLow = volatility * 0.7;
        const sigmaHigh = volatility * 1.3;
        const T = timeToClose_hours / (24 * 365); // convert to years

        // Binary option value = N(d2) where d2 depends on σ
        // For worst case long: use σ_low when gamma > 0, σ_high when gamma < 0
        // Simplified: value range from two σ extremes
        const sqrtT = Math.sqrt(Math.max(T, 0.0001));

        // d2 for binary: approximation around current price
        // If market implies p, then d2 ≈ Φ^{-1}(p)
        // Adjusting for σ range: Δd2 ≈ ±(σ_high - σ_low) * √T / 2
        const volImpact = (sigmaHigh - sigmaLow) * sqrtT / 2;

        // Convert to probability space
        const vMin = Math.max(0.01, marketPrice - volImpact * 0.5);
        const vMax = Math.min(0.99, marketPrice + volImpact * 0.5);

        return {
            vMin: parseFloat(vMin.toFixed(4)),
            vMax: parseFloat(vMax.toFixed(4)),
            width: parseFloat((vMax - vMin).toFixed(4)),
            sigmaLow, sigmaHigh
        };
    }

    // Should we trade? Only if market price is OUTSIDE the uncertainty range
    shouldTrade(marketPrice, fairValue, volatility, timeToClose_hours) {
        const range = this.computeRange(fairValue, volatility, timeToClose_hours);

        if (marketPrice < range.vMin) {
            return { trade: true, side: 'YES', edge: range.vMin - marketPrice, range, reason: `Price ${marketPrice} < V_min ${range.vMin}` };
        }
        if (marketPrice > range.vMax) {
            return { trade: true, side: 'NO', edge: marketPrice - range.vMax, range, reason: `Price ${marketPrice} > V_max ${range.vMax}` };
        }
        return { trade: false, side: null, edge: 0, range, reason: `Price ${marketPrice} within uncertainty [${range.vMin}, ${range.vMax}]` };
    }
}

// ── 3. CrashMetrics / Crash Mode (Ch 43/58) ───────────────────────────────
// During crash: ALL correlations → 1. Worst case: δ_worst = -Δ²/(2Γ)
class CrashMetrics {
    constructor() {
        this.crashMode = false;
        this.lastCheck = 0;
    }

    // Detect crash mode from EWMA vol and recent returns
    detectCrash(ewmaVol, recentReturns = []) {
        // Crash indicators:
        // 1. EWMA vol > 2x normal (normal ~2% for crypto)
        // 2. Recent returns show sharp negative move
        // 3. Multiple assets moving together (checked externally)
        const volThreshold = 0.04; // 4% = double normal crypto vol
        const highVol = ewmaVol > volThreshold;

        let sharpDrop = false;
        if (recentReturns.length >= 5) {
            const last5 = recentReturns.slice(-5);
            const totalReturn = last5.reduce((a, b) => a + b, 0);
            sharpDrop = totalReturn < -0.03; // 3% drop in 5 periods
        }

        this.crashMode = highVol && sharpDrop;
        return {
            crashMode: this.crashMode,
            ewmaVol,
            reason: this.crashMode ? `HIGH VOL (${(ewmaVol * 100).toFixed(1)}%) + SHARP DROP` : 'Normal'
        };
    }

    // Portfolio worst-case loss under crash (all correlations = 1)
    worstCaseLoss(openPositions, crashSize = 0.20) {
        if (!openPositions || openPositions.length === 0) return 0;

        // Sum all directional exposure assuming crash = all crypto drops by crashSize
        let totalExposure = 0;
        for (const pos of openPositions) {
            const stake = pos.stake || 100;
            const isCryptoUp = (pos.side === 'YES' && (pos.asset || '').match(/btc|eth|sol|bnb/i)) ||
                (pos.side === 'NO' && !(pos.asset || '').match(/btc|eth|sol|bnb/i));

            if (isCryptoUp) {
                // Long crypto = loses on crash
                totalExposure += stake;
            }
        }

        // Worst case: lose crashSize fraction of crypto-long exposure
        return totalExposure * crashSize;
    }

    // Crash allocation limit: never invest more than 1/k* (Ch 67)
    maxAllocation(crashSize = 0.20) {
        return 1 / crashSize; // e.g., k*=0.20 → max 5x capital
    }

    // Stake multiplier in crash mode
    getStakeMultiplier() {
        return this.crashMode ? 0.3 : 1.0; // 70% reduction in crash mode
    }
}

// ── 4. Portfolio VaR Monitor (Ch 19) ───────────────────────────────────────
// VaR = -α(1-c) × √δt × √(ΣΣ Δi×Δj×σi×σj×ρij×Si×Sj)
class VaRMonitor {
    constructor() {
        this.confidence = 0.99;
        this.alpha = 2.326; // 99% confidence = 2.326 std deviations
        this.timeHorizon = 1 / 365; // 1 day in years
    }

    // Calculate portfolio VaR
    calculateVaR(openPositions, ewmaVols = {}, crashMode = false) {
        if (!openPositions || openPositions.length === 0) return { var: 0, pctOfFund: 0 };

        // In crash mode: assume all correlations = 1 (Ch 43)
        const rho = crashMode ? 1.0 : 0.85; // BTC/ETH/SOL are ~85% correlated normally

        let sumVariance = 0;
        for (let i = 0; i < openPositions.length; i++) {
            const pi = openPositions[i];
            const si = pi.stake || 100;
            const voli = ewmaVols[pi.asset?.toLowerCase()] || 0.02;

            for (let j = 0; j < openPositions.length; j++) {
                const pj = openPositions[j];
                const sj = pj.stake || 100;
                const volj = ewmaVols[pj.asset?.toLowerCase()] || 0.02;

                const corr = (i === j) ? 1.0 : rho;
                sumVariance += si * sj * voli * volj * corr;
            }
        }

        const portfolioStd = Math.sqrt(Math.max(0, sumVariance)) * Math.sqrt(this.timeHorizon);
        const var99 = this.alpha * portfolioStd;

        return {
            var: parseFloat(var99.toFixed(2)),
            portfolioStd: parseFloat(portfolioStd.toFixed(2)),
            positions: openPositions.length
        };
    }

    // Should we block new trades based on VaR?
    shouldBlock(var99, fund, maxVarPct = 0.20) {
        if (fund <= 0) return false;
        const varPct = var99 / fund;
        return {
            blocked: varPct > maxVarPct,
            varPct: parseFloat(varPct.toFixed(4)),
            reason: varPct > maxVarPct
                ? `VaR ${(varPct * 100).toFixed(1)}% > max ${(maxVarPct * 100).toFixed(0)}% of fund`
                : `VaR ${(varPct * 100).toFixed(1)}% OK`
        };
    }
}

// ── 5. Asset Allocation Under Crash Threat (Ch 67) ─────────────────────────
// π̂(t) decreases as time horizon approaches. Never invest > 1/k*
class CrashAllocation {
    // Optimal allocation that balances crash protection vs returns
    // k* = worst possible crash, T = time to horizon, t = current time
    optimalAllocation(mu = 0.10, r = 0.05, sigma = 0.20, kStar = 0.20, timeRemaining = 1.0) {
        // Merton optimal (no crash): π* = (μ-r)/σ²
        const piStar = (mu - r) / (sigma * sigma);

        // Max allocation under crash: 1/k*
        const maxPi = 1 / kStar;

        // Time-varying reduction: as T→0, reduce allocation
        // Simple approximation of the Korn-Wilmott ODE solution
        const timeFactor = 1 - Math.exp(-0.5 * (mu - r) / (sigma * sigma) * timeRemaining);
        const crashAdjPi = Math.min(piStar, maxPi) * timeFactor;

        return {
            piStar: parseFloat(piStar.toFixed(3)),
            maxPi: parseFloat(maxPi.toFixed(3)),
            optimal: parseFloat(Math.max(0, crashAdjPi).toFixed(3)),
            timeFactor: parseFloat(timeFactor.toFixed(3))
        };
    }

    // Stake multiplier based on crash-aware allocation
    getStakeMultiplier(timeToCloseHours, volatility, crashSize = 0.20) {
        const T = timeToCloseHours / (24 * 365);
        const alloc = this.optimalAllocation(0.10, 0.05, volatility, crashSize, T);
        // Scale: if optimal is < piStar, reduce stake proportionally
        const ratio = alloc.piStar > 0 ? alloc.optimal / alloc.piStar : 1;
        return Math.max(0.3, Math.min(1.0, ratio));
    }
}

// ── 6. Skill Factor / Implied Skill (Ch 75) ───────────────────────────────
// Trader skill p → probability correct = ½ + p/2
// From P&L: mean = Cp√(2/π), std = C√(1 - 2p²/π)
class SkillFactor {
    // Calculate implied skill from win/loss record
    computeSkill(wins, losses) {
        const total = wins + losses;
        if (total < 10) return { p: 0, confidence: 0, isSkilled: false };

        const winRate = wins / total;
        // p = 2 × (winRate - 0.5) — since Prob(correct) = ½ + p/2
        const p = Math.max(0, 2 * (winRate - 0.5));

        // Confidence interval: standard error of proportion
        const se = Math.sqrt(winRate * (1 - winRate) / total);
        const zScore = total >= 30 ? (winRate - 0.5) / se : 0;

        return {
            p: parseFloat(p.toFixed(4)),
            winRate: parseFloat(winRate.toFixed(4)),
            isSkilled: p > 0.05 && zScore > 1.645, // p>5% and 95% significant
            zScore: parseFloat(zScore.toFixed(2)),
            confidence: Math.min(100, Math.round(total / 2)) // 0-100 based on sample size
        };
    }

    // Composite score incorporating skill factor
    compositeScore(accuracy, totalTrades, p) {
        if (totalTrades < 20) return accuracy / 100;
        // Wilmott Ch17 × Ch75: freq × edge × skill significance
        const freqEdge = (accuracy / 100) * Math.log(totalTrades + 1);
        const skillBonus = p > 0.10 ? 1.0 + p : 1.0; // Bonus for genuinely skilled children
        return freqEdge * skillBonus;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 2: HIGH VALUE
// ═══════════════════════════════════════════════════════════════════════════════

// ── 7. Transaction Cost Adjustment (Ch 48) ─────────────────────────────────
// K = κ/(σ√δt) — if K >> 1, trading too often
class TransactionCosts {
    constructor(kappa = 0.02) {
        this.kappa = kappa; // ~2% Polymarket spread
    }

    // Minimum EV needed to overcome transaction costs
    minProfitableEV(volatility, tradingFrequencyPerDay = 10) {
        const deltaT = 1 / (365 * tradingFrequencyPerDay);
        const K = this.kappa / (volatility * Math.sqrt(deltaT));

        return {
            K: parseFloat(K.toFixed(3)),
            minEV: this.kappa * 2, // Need at least 2x spread to be profitable
            tradingTooOften: K > 1.0,
            recommendation: K > 1.0 ? 'REDUCE_FREQUENCY' : K < 0.1 ? 'CAN_TRADE_MORE' : 'OPTIMAL'
        };
    }

    // Adjust edge threshold based on transaction costs
    adjustedEdge(rawEdge) {
        return Math.max(0, rawEdge - this.kappa);
    }
}

// ── 8. Binary Option Fair Value (Ch 7) ─────────────────────────────────────
// Binary_call = e^{-r(T-t)} × N(d2)
// d2 = [log(S/E) + (r - σ²/2)(T-t)] / [σ√(T-t)]
class BinaryFairValue {
    // Normal CDF approximation (Abramowitz & Stegun)
    _normalCDF(x) {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1.0 + sign * y);
    }

    // Fair value of a binary call (YES share)
    // S = current crypto price, E = strike/reference, σ = volatility, T = time to expiry (years)
    fairValue(currentPrice, referencePrice, volatility, timeToExpiry, riskFreeRate = 0.05) {
        if (timeToExpiry <= 0) return currentPrice >= referencePrice ? 1.0 : 0.0;
        if (volatility <= 0) return currentPrice >= referencePrice ? 1.0 : 0.0;

        const sqrtT = Math.sqrt(timeToExpiry);
        const d2 = (Math.log(currentPrice / referencePrice) + (riskFreeRate - 0.5 * volatility * volatility) * timeToExpiry) / (volatility * sqrtT);
        const value = Math.exp(-riskFreeRate * timeToExpiry) * this._normalCDF(d2);

        return parseFloat(Math.max(0.01, Math.min(0.99, value)).toFixed(4));
    }
}

// ── 9. Jump Diffusion / Fat Tails (Ch 57) ──────────────────────────────────
// Adjust confidence based on kurtosis (fat tails = more uncertainty)
class JumpDiffusion {
    // Confidence reduction for fat-tailed markets
    adjustConfidence(confidence, kurtosis) {
        // Normal kurtosis = 3. Crypto typically 5-15.
        if (kurtosis <= 3.5) return confidence; // Normal enough
        // Reduce confidence proportionally to excess kurtosis
        const excessK = kurtosis - 3;
        const reduction = Math.min(0.3, excessK * 0.03); // Max 30% reduction
        return Math.round(confidence * (1 - reduction));
    }
}

// ── 10. Feedback Effect / Illiquidity (Ch 61) ──────────────────────────────
// σ_effective = σ / (1 - ε × ∂Δ/∂S)
// If your trading moves the market, reduce stake
class FeedbackEffect {
    // Stake reduction for illiquid markets
    getStakeMultiplier(stake, volume24h) {
        if (!volume24h || volume24h <= 0) return 0.5; // Unknown liquidity = cautious
        const impactRatio = stake / volume24h;

        if (impactRatio > 0.10) return 0.25; // >10% of daily volume = massive impact
        if (impactRatio > 0.05) return 0.50; // >5% = significant
        if (impactRatio > 0.02) return 0.75; // >2% = noticeable
        return 1.0; // <2% = negligible
    }
}

// ── 11. Utility Theory (Ch 62) ─────────────────────────────────────────────
// CRRA: U(W) = (W^γ - 1)/γ; log utility = Kelly
// Already implicit in Half Kelly, but expose for dashboard
class UtilityTheory {
    // Certainty equivalent: how much guaranteed $ = the risky bet
    certaintyEquivalent(expectedReturn, variance, riskAversion = 0.5) {
        // CE ≈ E[W] + ½ × (U''/U') × Var[W]
        // For CRRA with γ: CE = E[W] - ½(1-γ)/W × Var[W]
        return expectedReturn - 0.5 * riskAversion * variance;
    }
}

// ── 12. Horse Race Arbitrage Detection (Ch 17) ─────────────────────────────
// If Σ 1/(q_i + 1) < 1 for all outcomes → ARBITRAGE
class ArbitrageDetector {
    // Check if a Polymarket market has arbitrage
    // yesPrice + noPrice should = 1.0 (after fees)
    checkArbitrage(yesPrice, noPrice, fees = 0.02) {
        if (!yesPrice || !noPrice) return { hasArbitrage: false };

        const impliedTotal = yesPrice + noPrice;
        const arbitrageGap = 1.0 - impliedTotal;

        // If total < 1.0 - fees, there's an arbitrage (buy both sides)
        const hasArbitrage = arbitrageGap > fees;

        return {
            hasArbitrage,
            impliedTotal: parseFloat(impliedTotal.toFixed(4)),
            gap: parseFloat(arbitrageGap.toFixed(4)),
            profitIfBuyBoth: hasArbitrage ? parseFloat((arbitrageGap - fees).toFixed(4)) : 0,
            reason: hasArbitrage
                ? `YES(${yesPrice}) + NO(${noPrice}) = ${impliedTotal.toFixed(3)} < 1.0 → ${(arbitrageGap * 100).toFixed(1)}% gap`
                : 'No arbitrage'
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3: PHILOSOPHICAL INSIGHTS (embedded in the system)
// ═══════════════════════════════════════════════════════════════════════════════
// 13. Discrete hedging error → always residual risk (accounted for in Half Kelly)
// 14. "Make it simple, but no simpler" → 7 features is enough
// 15. Real Options / optimal entry → mispricing threshold = exercise boundary
// 16. GARCH mean-reversion → vol always returns to mean

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER WILMOTT ENGINE — Orchestrates all components
// ═══════════════════════════════════════════════════════════════════════════════

class WilmottEngine {
    constructor() {
        this.ewma = new EWMAVolatility(0.94);
        this.uncertain = new UncertainParameters();
        this.crash = new CrashMetrics();
        this.var = new VaRMonitor();
        this.crashAlloc = new CrashAllocation();
        this.skill = new SkillFactor();
        this.txCost = new TransactionCosts(0.02);
        this.binary = new BinaryFairValue();
        this.jumpDiff = new JumpDiffusion();
        this.feedback = new FeedbackEffect();
        this.utility = new UtilityTheory();
        this.arbitrage = new ArbitrageDetector();
        this._loadState();
    }

    // ── Price Update (call from main loop) ──
    updatePrice(asset, price) {
        this.ewma.update(asset, price);
    }

    // ── Full Pre-Trade Analysis ──
    // Returns: { approved, reason, adjustments }
    preTrade(market, decision, fund, openPositions) {
        const asset = market.asset || decision._childSpec?.split('-')[0] || 'btc';
        const vol = this.ewma.getVolatility(asset);
        const kurtosis = this.ewma.getKurtosis(asset);
        const hoursToClose = market.closesAt ? (new Date(market.closesAt) - Date.now()) / 3600000 : 24;
        const yesPrice = market.yesPrice || 0.5;

        const checks = [];
        let stakeMultiplier = 1.0;

        // 1. Crash Mode Check (Ch 43/58)
        const recentReturns = this.ewma.state[asset.toLowerCase()]?.history?.slice(-10) || [];
        const crashCheck = this.crash.detectCrash(vol, recentReturns);
        if (crashCheck.crashMode) {
            stakeMultiplier *= this.crash.getStakeMultiplier();
            checks.push({ gate: 'CRASH_MODE', passed: true, adjusted: true, reason: crashCheck.reason });
        }

        // 2. VaR Gate (Ch 19)
        const ewmaVols = {};
        for (const [sym, s] of Object.entries(this.ewma.state)) {
            ewmaVols[sym] = s.ewmaVol;
        }
        const varResult = this.var.calculateVaR(openPositions, ewmaVols, crashCheck.crashMode);
        const varBlock = this.var.shouldBlock(varResult.var, fund);
        if (varBlock.blocked) {
            checks.push({ gate: 'VAR_LIMIT', passed: false, reason: varBlock.reason });
            return { approved: false, reason: `VaR BLOCKED: ${varBlock.reason}`, checks, stakeMultiplier };
        }
        checks.push({ gate: 'VAR_LIMIT', passed: true, reason: varBlock.reason });

        // 3. Uncertain Parameters Range (Ch 52)
        const fairValue = decision.myProb || yesPrice;
        const uncertainCheck = this.uncertain.shouldTrade(yesPrice, fairValue, vol, hoursToClose);
        checks.push({ gate: 'UNCERTAIN_PARAMS', passed: uncertainCheck.trade, reason: uncertainCheck.reason, range: uncertainCheck.range });
        // Note: don't block on uncertain params alone in training mode, just log

        // 4. Crash Allocation Limit (Ch 67)
        const allocMult = this.crashAlloc.getStakeMultiplier(hoursToClose, vol);
        stakeMultiplier *= allocMult;
        checks.push({ gate: 'CRASH_ALLOC', passed: true, reason: `Time-adj: ${allocMult.toFixed(2)}` });

        // 5. Transaction Cost Check (Ch 48)
        const edge = decision.edge || 0.03;
        const adjustedEdge = this.txCost.adjustedEdge(edge);
        const txCheck = this.txCost.minProfitableEV(vol);
        if (adjustedEdge <= 0) {
            checks.push({ gate: 'TX_COST', passed: false, reason: `Edge ${(edge * 100).toFixed(1)}% < spread ${(this.txCost.kappa * 100).toFixed(1)}%` });
            return { approved: false, reason: `TX COST: edge too small after spread`, checks, stakeMultiplier };
        }
        checks.push({ gate: 'TX_COST', passed: true, reason: `Net edge: ${(adjustedEdge * 100).toFixed(1)}% (K=${txCheck.K.toFixed(2)})` });

        // 6. Jump Diffusion / Fat Tails (Ch 57)
        const adjConf = this.jumpDiff.adjustConfidence(decision.confidence || 65, kurtosis);
        if (adjConf < decision.confidence) {
            checks.push({ gate: 'FAT_TAILS', passed: true, adjusted: true, reason: `Kurtosis=${kurtosis.toFixed(1)}, conf ${decision.confidence}→${adjConf}` });
        }

        // 7. Feedback / Illiquidity (Ch 61)
        const feedbackMult = this.feedback.getStakeMultiplier(decision.stake || 100, market.volume24h);
        stakeMultiplier *= feedbackMult;
        if (feedbackMult < 1.0) {
            checks.push({ gate: 'ILLIQUIDITY', passed: true, adjusted: true, reason: `Vol impact: ×${feedbackMult.toFixed(2)}` });
        }

        // 8. CrashMetrics worst-case (Ch 58)
        const worstLoss = this.crash.worstCaseLoss(openPositions);
        if (worstLoss > fund * 0.3) {
            stakeMultiplier *= 0.5;
            checks.push({ gate: 'CRASH_EXPOSURE', passed: true, adjusted: true, reason: `Worst-case loss $${worstLoss.toFixed(0)} > 30% fund` });
        }

        return {
            approved: true,
            reason: 'ALL_WILMOTT_GATES_PASSED',
            checks,
            stakeMultiplier: parseFloat(stakeMultiplier.toFixed(3)),
            adjustedConfidence: adjConf,
            adjustedEdge,
            volatility: vol,
            kurtosis,
            crashMode: crashCheck.crashMode,
            varPct: varBlock.varPct
        };
    }

    // ── Arbitrage Scanner ──
    scanArbitrage(markets) {
        const opportunities = [];
        for (const m of markets) {
            if (!m.yesPrice) continue;
            const noPrice = 1 - m.yesPrice; // Implied
            // Check if actual NO price differs (if available)
            const actualNoPrice = m.noPrice || noPrice;
            const arb = this.arbitrage.checkArbitrage(m.yesPrice, actualNoPrice);
            if (arb.hasArbitrage) {
                opportunities.push({ market: m.title, ...arb });
            }
        }
        return opportunities;
    }

    // ── Binary Fair Value Calculator ──
    binaryFairValue(currentPrice, referencePrice, volatility, hoursToExpiry) {
        const T = hoursToExpiry / (24 * 365);
        return this.binary.fairValue(currentPrice, referencePrice, volatility, T);
    }

    // ── Stats for Dashboard ──
    getStats() {
        const vols = {};
        const kurtoses = {};
        for (const [sym, s] of Object.entries(this.ewma.state)) {
            vols[sym] = (s.ewmaVol * 100).toFixed(2) + '%';
            kurtoses[sym] = this.ewma.getKurtosis(sym).toFixed(1);
        }
        return {
            ewmaVolatilities: vols,
            kurtosis: kurtoses,
            crashMode: this.crash.crashMode,
            tier: 'WILMOTT_v6.0'
        };
    }

    // ── Persistence ──
    _loadState() {
        try {
            if (fs.existsSync(WILMOTT_STATE_PATH)) {
                const data = JSON.parse(fs.readFileSync(WILMOTT_STATE_PATH, 'utf8'));
                if (data.ewmaState) {
                    for (const [sym, s] of Object.entries(data.ewmaState)) {
                        this.ewma.state[sym] = s;
                    }
                }
            }
        } catch { }
    }

    saveState() {
        try {
            if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(WILMOTT_STATE_PATH, JSON.stringify({
                ewmaState: this.ewma.state,
                crashMode: this.crash.crashMode,
                savedAt: new Date().toISOString()
            }, null, 2));
        } catch { }
    }
}

export const wilmott = new WilmottEngine();
export { EWMAVolatility, UncertainParameters, CrashMetrics, VaRMonitor, CrashAllocation, SkillFactor, TransactionCosts, BinaryFairValue, JumpDiffusion, FeedbackEffect, UtilityTheory, ArbitrageDetector };
