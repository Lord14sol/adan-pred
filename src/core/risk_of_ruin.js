// src/core/risk_of_ruin.js
// Risk of Ruin Calculator — probability of going broke given current stats
// Formula: RoR = ((1 - edge) / (1 + edge))^(bankroll / unit)
// If RoR > 5%, automatically reduce stakes
// Part of Mother Code v2.0 — Quant Intelligence Layer

export class RiskOfRuin {
    constructor() {
        this.MAX_ACCEPTABLE_ROR = 0.05; // 5% max acceptable risk of ruin
    }

    /**
     * Calculate probability of ruin
     * @param {number} winRate - Current win rate (0-1)
     * @param {number} avgWin - Average win amount ($)
     * @param {number} avgLoss - Average loss amount ($)
     * @param {number} bankroll - Current bankroll ($)
     * @param {number} unitStake - Current unit stake size ($)
     * @returns {object} Risk analysis
     */
    calculate(winRate, avgWin, avgLoss, bankroll, unitStake) {
        if (winRate <= 0 || winRate >= 1 || bankroll <= 0 || unitStake <= 0) {
            return { ror: 1, safe: false, stakeMultiplier: 0.25, reason: 'INVALID_INPUTS' };
        }

        // Edge = expected profit per unit risked
        const edge = (winRate * avgWin - (1 - winRate) * avgLoss) / avgLoss;

        if (edge <= 0) {
            return {
                ror: 1.0,
                safe: false,
                edge: parseFloat(edge.toFixed(4)),
                stakeMultiplier: 0.25,
                reason: 'NEGATIVE_EDGE',
                recommendation: 'STOP trading — negative expectancy'
            };
        }

        // Risk of Ruin formula
        const units = bankroll / unitStake;
        const ror = Math.pow((1 - edge) / (1 + edge), units);

        // Stake adjustment
        let stakeMultiplier = 1.0;
        let recommendation = '';

        if (ror > 0.20) {
            stakeMultiplier = 0.25;
            recommendation = 'CRITICAL: 20%+ ruin probability. Cut stakes to 25%.';
        } else if (ror > 0.10) {
            stakeMultiplier = 0.50;
            recommendation = 'HIGH RISK: 10%+ ruin probability. Cut stakes to 50%.';
        } else if (ror > this.MAX_ACCEPTABLE_ROR) {
            stakeMultiplier = 0.75;
            recommendation = 'ELEVATED: 5%+ ruin probability. Reduce stakes 25%.';
        } else if (ror > 0.01) {
            stakeMultiplier = 1.0;
            recommendation = 'ACCEPTABLE: Ruin risk under control.';
        } else {
            stakeMultiplier = 1.0;
            recommendation = 'LOW: Excellent risk management.';
        }

        return {
            ror: parseFloat(ror.toFixed(6)),
            rorPct: (ror * 100).toFixed(2) + '%',
            safe: ror <= this.MAX_ACCEPTABLE_ROR,
            edge: parseFloat(edge.toFixed(4)),
            units: parseFloat(units.toFixed(1)),
            stakeMultiplier,
            recommendation
        };
    }

    /**
     * Quick check from PnL object
     */
    fromPnL(pnl, currentStake = 100) {
        const trades = pnl.trades || 0;
        if (trades < 10) return { ror: 0, safe: true, stakeMultiplier: 1.0, reason: 'INSUFFICIENT_DATA' };

        const winRate = (pnl.wins || 0) / trades;
        const avgWin = pnl.net > 0 ? (pnl.net / (pnl.wins || 1)) : currentStake * 0.5;
        const avgLoss = currentStake; // Binary market: loss = stake
        const bankroll = pnl.fund || 10000;

        return this.calculate(winRate, avgWin, avgLoss, bankroll, currentStake);
    }

    /**
     * Dashboard display string
     */
    getDashboardStr(pnl, currentStake = 100) {
        const result = this.fromPnL(pnl, currentStake);
        if (result.reason === 'INSUFFICIENT_DATA') return 'RoR: building data...';
        const color = result.safe ? '' : '⚠️ ';
        return `${color}RoR: ${result.rorPct} | Edge: ${(result.edge * 100).toFixed(1)}% | ${result.recommendation.split(':')[0]}`;
    }
}

export const riskOfRuin = new RiskOfRuin();
