// src/core/regime_classifier.js
// Advanced Quantitative Framework: Regime Classifier
// Wilmott v6.0: EWMA Volatility (Ch 42/49) + Kurtosis (Ch 57) + Efficiency Ratio
//
// MATHEMATICAL FOUNDATION:
// 1. EWMA Volatility: σ²_n = λ×σ²_{n-1} + (1-λ)×R²_n (RiskMetrics λ=0.94)
// 2. Kurtosis: fat tails detection for jump diffusion awareness
// 3. Efficiency Ratio (Kaufman): trend strength = net move / path distance
// 4. Regime Classification:
//    - High σ + Low Trend = VOLATILE
//    - High Trend + High Efficiency = TRENDING
//    - Low σ + Low Trend = MEAN_REVERTING

class RegimeDetector {
    constructor() {
        this.history = {
            btc: [],
            eth: [],
            sol: [],
            bnb: []
        };
        this.maxHistory = 60;

        // EWMA state per asset (Wilmott Ch 42/49: RiskMetrics λ=0.94)
        this.ewma = {}; // { sym: { variance, lastPrice } }
        this.lambda = 0.94;

        // Thresholds
        this.VOLATILITY_THRESHOLD = 0.0025;
        this.TREND_THRESHOLD = 0.0040;
    }

    updatePrice(asset, currentPrice) {
        if (!asset || !currentPrice) return;
        const sym = asset.toLowerCase().replace('usdt', '');
        if (!this.history[sym]) this.history[sym] = [];

        this.history[sym].push({
            timestamp: Date.now(),
            price: currentPrice
        });

        // Prune older than maxHistory minutes
        const cutoff = Date.now() - (this.maxHistory * 60 * 1000);
        this.history[sym] = this.history[sym].filter(p => p.timestamp >= cutoff);

        // ── Wilmott EWMA Volatility Update (Ch 42/49) ──
        if (!this.ewma[sym]) {
            this.ewma[sym] = { variance: 0.0004, lastPrice: currentPrice, returns: [] };
            return;
        }
        const e = this.ewma[sym];
        if (e.lastPrice > 0) {
            const logReturn = Math.log(currentPrice / e.lastPrice);
            e.variance = this.lambda * e.variance + (1 - this.lambda) * logReturn * logReturn;
            e.returns.push(logReturn);
            if (e.returns.length > 500) e.returns = e.returns.slice(-500);
        }
        e.lastPrice = currentPrice;
    }

    detectRegime(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        const data = this.history[sym] || [];

        if (data.length < 10) {
            return { regime: 'MEAN_REVERTING', metrics: { volatility: 0, trend: 0 }, confident: false };
        }

        // ── Wilmott EWMA Vol (replaces naive std dev) ──
        const ewmaState = this.ewma[sym];
        const volatility = ewmaState ? Math.sqrt(ewmaState.variance) : this._naiveVol(data);

        // ── Wilmott Kurtosis (Ch 57: fat tail detection) ──
        const kurtosis = this._calcKurtosis(ewmaState?.returns || []);

        // ── Efficiency Ratio (Kaufman) ──
        const startPrice = data[0].price;
        const endPrice = data[data.length - 1].price;
        const netDirectionalMove = Math.abs(endPrice - startPrice);

        let pathDistance = 0;
        for (let i = 1; i < data.length; i++) {
            pathDistance += Math.abs(data[i].price - data[i - 1].price);
        }
        const efficiencyRatio = pathDistance > 0 ? (netDirectionalMove / pathDistance) : 0;
        const absoluteTrendPct = Math.abs(endPrice - startPrice) / startPrice;

        // ── Classification Logic ──
        let regime = 'MEAN_REVERTING';

        if (absoluteTrendPct > this.TREND_THRESHOLD && efficiencyRatio > 0.3) {
            regime = 'TRENDING';
        } else if (volatility > this.VOLATILITY_THRESHOLD) {
            regime = 'VOLATILE';
        }

        return {
            regime,
            metrics: {
                volatility: parseFloat(volatility.toFixed(6)),
                ewmaVol: ewmaState ? parseFloat(Math.sqrt(ewmaState.variance).toFixed(6)) : 0,
                trend: parseFloat(absoluteTrendPct.toFixed(6)),
                efficiency: parseFloat(efficiencyRatio.toFixed(3)),
                kurtosis: parseFloat(kurtosis.toFixed(2))
            },
            confident: data.length >= 30
        };
    }

    // EWMA vol getter for external use (wilmott engine sync)
    getEWMAVol(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        return this.ewma[sym] ? Math.sqrt(this.ewma[sym].variance) : 0.02;
    }

    // Kurtosis getter for jump diffusion (Ch 57)
    getKurtosis(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        return this._calcKurtosis(this.ewma[sym]?.returns || []);
    }

    _calcKurtosis(returns) {
        if (!returns || returns.length < 30) return 3.0; // Normal
        const n = returns.length;
        const mean = returns.reduce((a, b) => a + b, 0) / n;
        const m2 = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
        const m4 = returns.reduce((a, r) => a + (r - mean) ** 4, 0) / n;
        return m2 > 0 ? m4 / (m2 * m2) : 3.0;
    }

    _naiveVol(data) {
        const returns = [];
        for (let i = 1; i < data.length; i++) {
            returns.push(Math.log(data[i].price / data[i - 1].price));
        }
        if (returns.length === 0) return 0;
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
        return Math.sqrt(variance);
    }
}

export const regimeDetector = new RegimeDetector();
