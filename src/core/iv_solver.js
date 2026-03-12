/**
 * ADAN IV SOLVER ENGINE
 * Newton-Raphson Implied Volatility + Skew Analysis
 * Basado en: Black-Scholes (Wilmott Ch7) + Video BS/IV theory
 * 
 * PROPÓSITO: Transformar ADAN de predictor a árbitro de volatilidad
 */

class IVSolverEngine {

    constructor() {
        this.RISK_FREE_RATE = 0.05;        // Proxy tasa libre de riesgo
        this.MAX_ITERATIONS = 100;          // Newton-Raphson max iter
        this.TOLERANCE = 0.0001;            // Convergencia
        this.INITIAL_VOL_SEED = 0.2;        // 20% seed
        this.IV_CACHE = new Map();          // Cache para no recalcular
        this.skewHistory = [];              // Historial de skew para calibración
    }

    // [FUNCIÓN 1] CDF Normal estándar (aproximación de Abramowitz & Stegun)
    normalCDF(x) {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1.0 + sign * y);
    }

    // [FUNCIÓN 2] PDF Normal estándar
    normalPDF(x) {
        return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
    }

    // [FUNCIÓN 3] Black-Scholes price para binary option (Digital Call)
    // Polymarket YES shares are digital options
    binaryCallPrice(S, K, T, r, sigma) {
        if (T <= 0) return S >= K ? 1.0 : 0.0;
        const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
        return Math.exp(-r * T) * this.normalCDF(d2);
    }

    // [FUNCIÓN 4] Vega: sensibilidad del precio a la volatilidad
    // Para una opción binaria, la vega es la derivada de e^-rT * N(d2) respecto a sigma
    vega(S, K, T, r, sigma) {
        if (T <= 0) return 0;
        const sqrtT = Math.sqrt(T);
        const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const derivative_d2_sigma = -(Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sigma * sqrtT);
        return Math.exp(-r * T) * this.normalPDF(d2) * derivative_d2_sigma;
    }

    // [FUNCIÓN 5] CORE: Newton-Raphson IV Solver
    solveIV(marketPrice, S, K, T, r = this.RISK_FREE_RATE) {
        if (marketPrice <= 0 || marketPrice >= 1) return null;
        if (T <= 0) return null;

        let sigma = this.INITIAL_VOL_SEED;

        try {
            for (let i = 0; i < this.MAX_ITERATIONS; i++) {
                const price = this.binaryCallPrice(S, K, T, r, sigma);
                const diff = price - marketPrice;

                if (Math.abs(diff) < this.TOLERANCE) {
                    return parseFloat(sigma.toFixed(4));
                }

                const v = this.vega(S, K, T, r, sigma);
                if (Math.abs(v) < 1e-10) break; // Avoid division by zero

                sigma = sigma - diff / v;

                // Clamp to realistic bounds
                if (sigma < 0.001) sigma = 0.001;
                if (sigma > 10.0) sigma = 10.0;
            }
        } catch (e) {
            console.error('[IV SOLVER] Error in solveIV:', e.message);
            return null;
        }

        return null; // Did not converge
    }

    // [FUNCIÓN 6] Calcular Skew dado array de {strike, marketPrice}
    calculateSkew(spotPrice, strikeArray, maturity) {
        if (!strikeArray || strikeArray.length < 2) return null;

        const ivs = strikeArray.map(s => ({
            strike: s.strike,
            iv: this.solveIV(s.marketPrice, spotPrice, s.strike, maturity)
        })).filter(x => x.iv !== null);

        if (ivs.length < 2) return null;

        const lowStrike = Math.min(...ivs.map(x => x.strike));
        const highStrike = Math.max(...ivs.map(x => x.strike));
        const ivLow = ivs.find(x => x.strike === lowStrike).iv;
        const ivHigh = ivs.find(x => x.strike === highStrike).iv;

        const skew = ivLow - ivHigh;
        const regime = skew > 0.05 ? 'FEAR' : skew < -0.05 ? 'GREED' : 'NEUTRAL';

        return { skew, regime, ivs };
    }

    // [FUNCIÓN 7] IV Spread: implícita vs realizada (EWMA)
    calculateIVSpread(impliedVol, ewmaVol) {
        if (!impliedVol || !ewmaVol) return 0;
        return impliedVol - ewmaVol;
    }

    // [FUNCIÓN 8] Señal para facciones ADAN
    generateVolSignal(skew, ivSpread, currentIV) {
        let signal = 'NEUTRAL';
        let strength = 0;
        let faction = 'SNAKE';

        if (ivSpread > 0.15) {
            signal = 'SELL_VOL';
            strength = Math.min(1.0, (ivSpread - 0.15) / 0.2);
            faction = 'SNAKE';
        } else if (ivSpread < -0.10) {
            signal = 'BUY_VOL';
            strength = Math.min(1.0, Math.abs(ivSpread + 0.10) / 0.2);
            faction = 'EVA';
        }

        if (Math.abs(skew) > 0.10) {
            strength = Math.max(strength, 0.8);
            faction = 'ATLAS';
        }

        return { faction, signal, strength: parseFloat(strength.toFixed(2)), ivSpread, skew };
    }

    // [FUNCIÓN 9] Integración con Polymarket order book
    analyzePolymarketBook(yesPrice, noPrice, maturityHours) {
        const T = maturityHours / (24 * 365);
        const S = 0.5; // Polymarket binary range center proxy
        const K = 0.5;

        const ivYes = this.solveIV(yesPrice, S, K, T);

        // In a perfectly efficient book, yesPrice + noPrice = 1.0 (approx)
        // If yesPrice + noPrice > 1.05, potential arbitrage or extreme spread
        const bookSum = yesPrice + noPrice;

        const signal = this.generateVolSignal(0, ivYes ? (ivYes - 0.8) : 0, ivYes);

        return {
            iv: ivYes,
            bookSum,
            signal,
            isArbitrage: bookSum > 1.05,
            isGap: bookSum < 0.95
        };
    }
}

export default IVSolverEngine;
