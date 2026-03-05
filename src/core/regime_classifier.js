// src/core/regime_classifier.js
// Advanced Quantitative Framework: Regime Classifier
// Detects market regimes (TRENDING, VOLATILE, MEAN_REVERTING) based on rolling volatility and trend strength.

// MATHEMATICAL FOUNDATION:
// 1. Volatility (σ): Standard deviation of recent log returns.
// 2. Trend Strength (Adx proxy or SMA slope): Directional conviction.
// 3. Regime Classification:
//    - High σ + Low Trend = VOLATILE (sideways chop, unpredictable)
//    - High Trend = TRENDING (clear directional bias, regardless of σ)
//    - Low σ + Low Trend = MEAN_REVERTING (range-bound, predictable oscillation)

class RegimeDetector {
    constructor() {
        this.history = {
            btc: [], // [{ timestamp, price }]
            eth: [],
            sol: [],
            bnb: []
        };
        this.maxHistory = 60; // Keep 60 minutes of 1m data

        // Thresholds (can be tuned via Bayesian updates later)
        this.VOLATILITY_THRESHOLD = 0.0025; // 0.25% standard deviation
        this.TREND_THRESHOLD = 0.0040;      // 0.40% directional move
    }

    /**
     * Interface:
     * Input: { asset (string), currentPrice (number) }
     * Output: void (updates internal state)
     */
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
    }

    /**
     * Interface:
     * Input: asset (string)
     * Output: { regime: "TRENDING" | "VOLATILE" | "MEAN_REVERTING", metrics: { volatility, trend } }
     */
    detectRegime(asset) {
        const sym = asset.toLowerCase().replace('usdt', '');
        const data = this.history[sym] || [];

        // Default to MEAN_REVERTING if not enough data (need at least 10 data points)
        if (data.length < 10) {
            return { regime: 'MEAN_REVERTING', metrics: { volatility: 0, trend: 0 }, confident: false };
        }

        // 1. Calculate Log Returns
        const returns = [];
        for (let i = 1; i < data.length; i++) {
            const r = Math.log(data[i].price / data[i - 1].price);
            returns.push(r);
        }

        // 2. Calculate Volatility (Standard Deviation of log returns)
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const squaredDiffs = returns.map(r => Math.pow(r - meanReturn, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
        const volatility = Math.sqrt(variance);

        // 3. Calculate Trend Strength (Total distance vs Path distance)
        // Also known as Efficiency Ratio (Kaufman)
        const startPrice = data[0].price;
        const endPrice = data[data.length - 1].price;
        const netDirectionalMove = Math.abs(endPrice - startPrice);

        let pathDistance = 0;
        for (let i = 1; i < data.length; i++) {
            pathDistance += Math.abs(data[i].price - data[i - 1].price);
        }

        // Efficiency Ratio: 1.0 is a straight line (max trend), 0.0 is pure noise
        const efficiencyRatio = pathDistance > 0 ? (netDirectionalMove / pathDistance) : 0;

        // Overall trend % over the window
        const absoluteTrendPct = Math.abs(endPrice - startPrice) / startPrice;

        // 4. Classification Logic
        let regime = 'MEAN_REVERTING';

        if (absoluteTrendPct > this.TREND_THRESHOLD && efficiencyRatio > 0.3) {
            regime = 'TRENDING';
        } else if (volatility > this.VOLATILITY_THRESHOLD) {
            regime = 'VOLATILE';
        } else {
            regime = 'MEAN_REVERTING';
        }

        return {
            regime,
            metrics: {
                volatility: parseFloat(volatility.toFixed(6)),
                trend: parseFloat(absoluteTrendPct.toFixed(6)),
                efficiency: parseFloat(efficiencyRatio.toFixed(3))
            },
            confident: data.length >= 30 // True if we have at least 30 mins of data
        };
    }
}

export const regimeDetector = new RegimeDetector();
