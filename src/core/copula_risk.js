// src/core/copula_risk.js
// Student-t Copula for tail dependence in correlated portfolio
// BTC + ETH crash together 55% of the time — Gaussian copula misses this entirely
// Part of Mother Code v2.0 — Quant Intelligence Layer

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const RETURNS_PATH = path.join(DIR, 'log_returns.json');

// Default correlations (used as fallback)
const DEFAULT_CORRELATIONS = {
    'BTC-ETH': 0.85, 'BTC-SOL': 0.75, 'ETH-SOL': 0.80,
    'BTC-BNB': 0.70, 'ETH-BNB': 0.72,
    'BTC-BTC': 1.0, 'ETH-ETH': 1.0, 'SOL-SOL': 1.0
};

const NU = 4; // Student-t degrees of freedom

// ── Regularized Incomplete Beta Function (Lentz's continued fraction) ──
function lnGamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
        -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function incompleteBeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

    // Lentz's continued fraction
    if (x < (a + 1) / (a + b + 2)) {
        return front * betaCF(a, b, x) / a;
    } else {
        return 1 - front * betaCF(b, a, 1 - x) / b;
    }
}

function betaCF(a, b, x) {
    const maxIter = 200;
    const eps = 3e-7;
    let qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIter; m++) {
        let m2 = 2 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
        c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
        h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
        c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < eps) break;
    }
    return h;
}

// Student-t CDF using regularized incomplete beta
function tCDF(x, nu) {
    const t2 = nu / (nu + x * x);
    const ib = incompleteBeta(nu / 2, 0.5, t2);
    return 0.5 * (1 + Math.sign(x) * (1 - ib));
}

function tailDependence(rho, nu = NU) {
    if (rho <= -1) return 0;
    if (rho >= 1) return 1;
    const inner = Math.sqrt((nu + 1) * (1 - rho) / (1 + rho));
    // Use real t-CDF instead of normal approximation
    return 2 * tCDF(-inner, nu + 1);
}

export class CopulaRisk {
    constructor() {
        this.logReturns = {}; // { 'BTC': [r1, r2, ...], 'ETH': [...] }
        this._loadReturns();
    }

    _loadReturns() {
        try {
            if (fs.existsSync(RETURNS_PATH)) {
                this.logReturns = JSON.parse(fs.readFileSync(RETURNS_PATH, 'utf8'));
            }
        } catch { this.logReturns = {}; }
    }

    _saveReturns() {
        try {
            fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(RETURNS_PATH, JSON.stringify(this.logReturns));
        } catch { }
    }

    // Record daily log returns for rolling correlation
    recordReturn(asset, price, prevPrice) {
        if (!prevPrice || prevPrice <= 0 || !price || price <= 0) return;
        const logReturn = Math.log(price / prevPrice);
        if (!this.logReturns[asset]) this.logReturns[asset] = [];
        this.logReturns[asset].push(logReturn);
        // Keep last 30 days (assuming ~1 observation per cycle)
        if (this.logReturns[asset].length > 720) this.logReturns[asset] = this.logReturns[asset].slice(-720);
        this._saveReturns();
    }

    // Rolling Pearson correlation from log returns
    _rollingCorrelation(assetA, assetB, window = 30) {
        const rA = this.logReturns[assetA];
        const rB = this.logReturns[assetB];
        if (!rA || !rB) return null;
        const n = Math.min(rA.length, rB.length, window);
        if (n < 10) return null;

        const a = rA.slice(-n), b = rB.slice(-n);
        const meanA = a.reduce((s, v) => s + v, 0) / n;
        const meanB = b.reduce((s, v) => s + v, 0) / n;
        let cov = 0, varA = 0, varB = 0;
        for (let i = 0; i < n; i++) {
            const dA = a[i] - meanA, dB = b[i] - meanB;
            cov += dA * dB;
            varA += dA * dA;
            varB += dB * dB;
        }
        if (varA === 0 || varB === 0) return null;
        return cov / Math.sqrt(varA * varB);
    }

    // Get correlation: dynamic if available, otherwise fallback to default
    getCorrelation(assetA, assetB, regime = 'NORMAL') {
        const corrKey = [assetA, assetB].sort().join('-');
        let rho = this._rollingCorrelation(assetA, assetB);
        if (rho === null) rho = DEFAULT_CORRELATIONS[corrKey] || 0;
        // In VOLATILE regime, correlations tend to increase
        if (regime === 'VOLATILE') rho = Math.min(0.99, rho * 1.15);
        return rho;
    }

    analyzePortfolio(openPositions, regime = 'NORMAL') {
        if (!openPositions || openPositions.length < 2) {
            return { risk: 'LOW', stakeMultiplier: 1.0, correlated: [] };
        }

        let maxTailDep = 0;
        const correlated = [];

        for (let i = 0; i < openPositions.length; i++) {
            for (let j = i + 1; j < openPositions.length; j++) {
                const assetA = this._extractAsset(openPositions[i].marketTitle || openPositions[i].market || openPositions[i].title || '');
                const assetB = this._extractAsset(openPositions[j].marketTitle || openPositions[j].market || openPositions[j].title || '');
                if (!assetA || !assetB) continue;

                const rho = this.getCorrelation(assetA, assetB, regime);

                if (rho > 0.5) {
                    const lambda = tailDependence(rho, NU);
                    maxTailDep = Math.max(maxTailDep, lambda);
                    correlated.push({
                        pair: assetA + '+' + assetB,
                        correlation: parseFloat(rho.toFixed(3)),
                        tailDependence: parseFloat(lambda.toFixed(3)),
                        interpretation: `${(lambda * 100).toFixed(1)}% joint crash probability`
                    });
                }
            }
        }

        let risk, stakeMultiplier;
        if (maxTailDep > 0.5) { risk = 'HIGH_TAIL_RISK'; stakeMultiplier = 0.5; }
        else if (maxTailDep > 0.3) { risk = 'MODERATE_TAIL_RISK'; stakeMultiplier = 0.7; }
        else if (maxTailDep > 0.1) { risk = 'LOW_TAIL_RISK'; stakeMultiplier = 0.85; }
        else { risk = 'DIVERSIFIED'; stakeMultiplier = 1.0; }

        if (correlated.length > 0) {
            console.log('[COPULA] 📊 Tail risk:', risk,
                '| Max λ:', (maxTailDep * 100).toFixed(1) + '%',
                '| Stake adj:', stakeMultiplier);
        }

        return {
            risk, stakeMultiplier,
            maxTailDependence: parseFloat(maxTailDep.toFixed(3)),
            correlated,
            recommendation: stakeMultiplier < 1
                ? 'Portfolio correlated — reduce new positions ' + ((1 - stakeMultiplier) * 100).toFixed(0) + '%'
                : 'Portfolio diversified'
        };
    }

    _extractAsset(title) {
        const t = (title || '').toUpperCase();
        if (t.includes('BITCOIN') || t.includes('BTC')) return 'BTC';
        if (t.includes('ETHEREUM') || t.includes('ETH')) return 'ETH';
        if (t.includes('SOLANA') || t.includes('SOL')) return 'SOL';
        if (t.includes('BINANCE') || t.includes('BNB')) return 'BNB';
        return null;
    }
}

export const copulaRisk = new CopulaRisk();
