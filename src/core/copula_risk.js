// src/core/copula_risk.js
// Student-t Copula for tail dependence in correlated portfolio
// BTC + ETH crash together 55% of the time — Gaussian copula misses this entirely
// Part of Mother Code v2.0 — Quant Intelligence Layer

const CORRELATIONS = {
    'BTC-ETH': 0.85, 'BTC-SOL': 0.75, 'ETH-SOL': 0.80,
    'BTC-BNB': 0.70, 'ETH-BNB': 0.72,
    'BTC-BTC': 1.0, 'ETH-ETH': 1.0, 'SOL-SOL': 1.0
};

const NU = 4; // Student-t degrees of freedom

function normalCDFApprox(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const c = 1 - (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)) * p;
    return x >= 0 ? c : 1 - c;
}

function tailDependence(rho, nu = NU) {
    if (rho <= -1) return 0;
    if (rho >= 1) return 1;
    const inner = Math.sqrt((nu + 1) * (1 - rho) / (1 + rho));
    const tVal = normalCDFApprox(-inner * Math.sqrt((nu + 1) / (nu + inner * inner)));
    return 2 * tVal;
}

export class CopulaRisk {
    analyzePortfolio(openPositions) {
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

                const corrKey = [assetA, assetB].sort().join('-');
                const rho = CORRELATIONS[corrKey] || 0;

                if (rho > 0.5) {
                    const lambda = tailDependence(rho, NU);
                    maxTailDep = Math.max(maxTailDep, lambda);
                    correlated.push({
                        pair: assetA + '+' + assetB,
                        correlation: rho,
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
