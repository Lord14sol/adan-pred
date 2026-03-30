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

// ─── PERP RISK MONITOR (Hyperliquid) ─────────────────────────────────────────
// Extends base RoR with liquidation monitoring, portfolio leverage caps, drawdown circuit breaker.
// CRITICAL: In perps, max loss ≠ bet size. Max loss = ENTIRE MARGIN (or worse with socialized loss).

export class PerpRiskMonitor {
    constructor({
        maxDrawdownPct = 0.15,
        maxOpenPositions = 5,   // One per focus coin (BTC, ETH, SOL, DOGE, kPEPE)
        maxPortfolioLeverage = 5,
        liqWarningBuffer = 0.05,
        maxMarginPerTrade = 500,
    } = {}) {
        this.config = { maxDrawdownPct, maxOpenPositions, maxPortfolioLeverage, liqWarningBuffer, maxMarginPerTrade };
        this.isCircuitBreakerOpen = false;
    }

    /**
     * Pre-trade risk check — call BEFORE every new perp position.
     * @param {Object} account  from hlConnector.getAccountState()
     * @param {Array}  positions from hlConnector.getOpenPositions()
     * @returns {{ approved: boolean, reason: string, stakeMultiplier: number }}
     */
    checkPreTrade(account, positions) {
        // ── 1. Drawdown circuit breaker ──
        if (account.drawdown > this.config.maxDrawdownPct) {
            this.isCircuitBreakerOpen = true;
            return {
                approved: false,
                reason: `CIRCUIT BREAKER: Drawdown ${(account.drawdown * 100).toFixed(1)}% exceeds max ${(this.config.maxDrawdownPct * 100)}%`,
                stakeMultiplier: 0,
            };
        }

        // Reset circuit breaker if drawdown recovered
        if (this.isCircuitBreakerOpen && account.drawdown < this.config.maxDrawdownPct * 0.5) {
            this.isCircuitBreakerOpen = false;
            console.log('[PERP-RoR] Circuit breaker reset — drawdown recovered');
        }

        if (this.isCircuitBreakerOpen) {
            return { approved: false, reason: 'CIRCUIT BREAKER ACTIVE', stakeMultiplier: 0 };
        }

        // ── 2. Max open positions ──
        if (positions.length >= this.config.maxOpenPositions) {
            return {
                approved: false,
                reason: `Max perp positions: ${positions.length}/${this.config.maxOpenPositions}`,
                stakeMultiplier: 0,
            };
        }

        // ── 3. Available margin check ──
        if (account.availableMargin < 50) {
            return {
                approved: false,
                reason: `Insufficient margin: $${account.availableMargin.toFixed(2)}`,
                stakeMultiplier: 0,
            };
        }

        // ── 4. Portfolio leverage cap ──
        const portfolioLeverage = account.equity > 0 ? account.totalNtl / account.equity : 0;
        if (portfolioLeverage > this.config.maxPortfolioLeverage) {
            return {
                approved: false,
                reason: `Portfolio leverage ${portfolioLeverage.toFixed(1)}x exceeds max ${this.config.maxPortfolioLeverage}x`,
                stakeMultiplier: 0,
            };
        }

        // ── 5. Scaled stake based on proximity to limits ──
        let stakeMultiplier = 1.0;
        if (portfolioLeverage > this.config.maxPortfolioLeverage * 0.7) {
            stakeMultiplier = 0.5; // getting close to limit
        }
        if (account.drawdown > this.config.maxDrawdownPct * 0.7) {
            stakeMultiplier *= 0.5; // getting close to circuit breaker
        }

        return { approved: true, reason: 'OK', stakeMultiplier };
    }

    /**
     * Correlation check — don't stack same-direction trades on correlated assets.
     * @param {Array} positions  current open perp positions
     * @param {string} newCoin   coin being considered
     * @param {string} newSide   'LONG' | 'SHORT'
     */
    checkCorrelationRisk(positions, newCoin, newSide) {
        const CORRELATED = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'ARB', 'OP'];
        if (!CORRELATED.includes(newCoin)) return { approved: true, reason: 'uncorrelated' };

        const sameDir = positions.filter(p =>
            CORRELATED.includes(p.coin) && p.direction === newSide
        );
        if (sameDir.length >= 2) {
            return {
                approved: false,
                reason: `Correlation risk: already ${newSide} on ${sameDir.map(p => p.coin).join(', ')}`,
            };
        }
        return { approved: true, reason: 'OK' };
    }

    /**
     * Validate Kelly-computed margin for perps.
     * Caps at 50% of available margin and hard max per trade.
     */
    validateMargin(kellyMarginUSD, account) {
        const maxFromAvailable = account.availableMargin * 0.5;
        const capped = Math.min(kellyMarginUSD, maxFromAvailable, this.config.maxMarginPerTrade);
        return Math.max(50, capped); // minimum $50 (meaningful position size)
    }

    /**
     * Dashboard string for perp risk.
     */
    getDashboardStr(account, positions) {
        const dd = (account.drawdown * 100).toFixed(1);
        const portLev = account.equity > 0 ? (account.totalNtl / account.equity).toFixed(1) : '0.0';
        const open = positions.length;
        const breaker = this.isCircuitBreakerOpen ? '🔴 BREAKER' : '🟢 OK';
        return `DD: ${dd}% | Lev: ${portLev}x | Open: ${open}/${this.config.maxOpenPositions} | ${breaker}`;
    }
}

export const riskOfRuin = new RiskOfRuin();
export const perpRisk = new PerpRiskMonitor();
