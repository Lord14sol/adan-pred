// src/core/greeks_adapter.js
// Options Greeks adapted for Polymarket binary contracts
// Delta, Gamma, Theta, Exit Urgency, Hold Recommendation
// Part of Mother Code v2.0 — Quant Intelligence Layer

const RISK_FREE_RATE = 0.05;

function normalPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function normalCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const c = 1 - normalPDF(x) * p;
    return x >= 0 ? c : 1 - c;
}

export function calculateGreeks(yesPrice, hoursToClose, options = {}) {
    if (!yesPrice || yesPrice <= 0 || yesPrice >= 1 || hoursToClose <= 0) return null;

    const T = hoursToClose / 8760; // hours to years
    const sqrtT = Math.sqrt(T);
    const S = yesPrice;
    // Strike K = current market price (not fixed 0.5)
    const K = options.strikePrice || yesPrice;
    const r = RISK_FREE_RATE;

    // IV estimation: prefer spread-based, fallback to historical vol
    let sigma;
    if (options.spread && options.spread > 0) {
        // IV ≈ spread / (2 × √(T/365))
        sigma = Math.max(0.1, Math.min(3.0, options.spread / (2 * Math.sqrt(T))));
    } else if (options.historicalVol && options.historicalVol > 0) {
        // Use Binance historical volatility of underlying asset
        sigma = options.historicalVol;
    } else {
        sigma = 0.8; // default fallback
    }

    const d1 = (Math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    const delta = Math.exp(-r * T) * normalPDF(d2) / (S * sigma * sqrtT);
    const gamma = -delta * d1 / (S * sigma * sqrtT);
    const theta = -(S * normalPDF(d1) * sigma) / (2 * sqrtT) * (1 / 365);
    const exitUrgency = parseFloat(Math.min(1, Math.abs(delta) * (1 + Math.abs(gamma))).toFixed(3));

    let holdRecommendation;
    if (hoursToClose < 1) holdRecommendation = 'EXIT_NOW';
    else if (exitUrgency > 0.7) holdRecommendation = 'CONSIDER_EXIT';
    else if (hoursToClose > 48) holdRecommendation = 'HOLD';
    else holdRecommendation = 'HOLD_MONITOR';

    return {
        delta: parseFloat(delta.toFixed(6)),
        gamma: parseFloat(gamma.toFixed(6)),
        theta: parseFloat(theta.toFixed(6)),
        exitUrgency,
        holdRecommendation,
        hoursToClose: parseFloat(hoursToClose.toFixed(2)),
        timeDecayPerDay: (Math.abs(theta) * 100).toFixed(4) + '%/day',
        impliedVol: parseFloat(sigma.toFixed(4))
    };
}
