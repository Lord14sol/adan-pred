// src/core/metabolism.js
// Tracks API costs vs revenue — metabolic health of the organism
// Part of Mother Code v2.0
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const META_FILE = path.join(DIR, 'metabolism.json');

export class Metabolism {
    constructor() {
        this.data = { totalCost: 0, totalRevenue: 0, cycles: 0, bets: 0 };
        try { this.data = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { }
    }

    getStakeMultiplier(fund, humanState) {
        let mult = 1.0;

        // Fund-based scaling (use fund not treasury)
        if (fund < 100) mult = 0;
        else if (fund < 500) mult = 0.3;
        else if (fund < 1000) mult = 0.6;

        // Human state adjustments
        if (humanState === 'SLEEPING_HERD') mult *= 0.7;
        if (humanState === 'NEWS_SHOCK') mult = 0;
        if (humanState === 'DEAD_ZONE_TRAP') mult *= 0.3;

        return parseFloat(mult.toFixed(3));
    }

    recordCycleCost(cost) {
        this.data.totalCost += cost;
        this.data.cycles++;
        this._save();
    }

    recordTradePnL(pnl) {
        this.data.totalRevenue += pnl;
        this.data.bets++;
        this._save();
    }

    isMetabolicPositive() {
        return this.data.totalRevenue > this.data.totalCost;
    }

    shouldHibernateChildren(fund) {
        return fund < 500;
    }

    status() {
        const netPnL = this.data.totalRevenue - this.data.totalCost;
        const costPerCycle = this.data.cycles > 0 ? this.data.totalCost / this.data.cycles : 0;
        return {
            netPnL: parseFloat(netPnL.toFixed(4)),
            totalCost: parseFloat(this.data.totalCost.toFixed(4)),
            totalRevenue: parseFloat(this.data.totalRevenue.toFixed(4)),
            cycles: this.data.cycles,
            bets: this.data.bets,
            costPerCycle: parseFloat(costPerCycle.toFixed(6)),
            isPositive: netPnL > 0
        };
    }

    _save() {
        try { fs.writeFileSync(META_FILE, JSON.stringify(this.data, null, 2)); } catch { }
    }
}

export const metabolism = new Metabolism();
