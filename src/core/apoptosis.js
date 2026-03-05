// src/core/apoptosis.js
// Controlled shutdown — prevents catastrophic loss
// Part of Mother Code v2.0 — activates at LVL 10+
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const INITIAL_DEPOSIT = 10000; // ADAN's starting capital

export class Apoptosis {
    constructor() {
        this._apoptosisInProgress = false;
    }

    shouldTrigger(fund, consecutiveLosses, level) {
        if (level < 10) return false;
        // Adjusted threshold: 30% of initial deposit, not absolute $5000
        if (fund < INITIAL_DEPOSIT * 0.30) return { trigger: true, reason: 'FUND_BELOW_30PCT_INITIAL' };
        if (consecutiveLosses >= 10) return { trigger: true, reason: '10_CONSECUTIVE_LOSSES' };
        return false;
    }

    async triggerApoptosis(reason, positions, pnlData) {
        if (this._apoptosisInProgress) return;
        this._apoptosisInProgress = true;

        console.log('\n[APOPTOSIS] ☠️  CONTROLLED SHUTDOWN INITIATED');
        console.log('[APOPTOSIS] Reason:', reason);

        // Step 1: Mark open positions as resolved
        if (positions?.open?.length > 0) {
            positions.open.forEach(pos => {
                pos.status = 'apoptosis_closed';
                pos.estimatedLoss = pos.stake * 0.5;
            });
            try {
                fs.writeFileSync(path.join(DIR, 'positions.json'), JSON.stringify(positions, null, 2));
            } catch { }
            console.log('[APOPTOSIS] Step 1: Closed', positions.open.length, 'open positions');
        }

        // Step 2: Save final state snapshot
        const snapshot = {
            t: new Date().toISOString(),
            reason,
            pnl: pnlData,
            apoptosis: true
        };
        try {
            fs.writeFileSync(path.join(DIR, 'apoptosis_snapshot.json'), JSON.stringify(snapshot, null, 2));
        } catch { }
        console.log('[APOPTOSIS] Step 2: State snapshot saved');

        // Step 3: Reset quota
        try {
            const quotaPath = path.join(DIR, 'quota.json');
            const fresh = { calls: 0, resetAt: Date.now() + 86400000 };
            fs.writeFileSync(quotaPath, JSON.stringify(fresh));
        } catch { }
        console.log('[APOPTOSIS] Step 3: Quota reset');

        // Step 4: Write log and exit
        const log = `[APOPTOSIS] ${new Date().toISOString()} — Reason: ${reason}\n`;
        try { fs.appendFileSync(path.join(DIR, 'apoptosis.log'), log); } catch { }
        console.log('[APOPTOSIS] Step 4: Log written. Exiting cleanly.\n');

        setTimeout(() => process.exit(0), 1000);
    }
}

export const apoptosis = new Apoptosis();
