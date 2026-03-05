// src/core/human_event_layer.js
// Detects human market psychology states: PANIC, FOMO, RATIONAL, etc.
// Part of Mother Code v2.0
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const HUMAN_LOG = path.join(DIR, 'human_events.jsonl');

const HUMAN_STATES = {
    HERD_PANIC: { edgeMultiplier: 1.4, stakeMultiplier: 0.8, signal: 'CONTRARIAN_BUY' },
    HERD_FOMO: { edgeMultiplier: 0.7, stakeMultiplier: 0.6, signal: 'FADE_RALLY' },
    NEWS_SHOCK: { edgeMultiplier: 0.0, stakeMultiplier: 0.0, signal: 'SKIP_ENTIRELY' },
    SLEEPING_HERD: { edgeMultiplier: 1.1, stakeMultiplier: 0.7, signal: 'TRUST_TECHNICALS' },
    RATIONAL_MARKET: { edgeMultiplier: 1.0, stakeMultiplier: 1.0, signal: 'NORMAL_RULES' },
    DEAD_ZONE_TRAP: { edgeMultiplier: 0.5, stakeMultiplier: 0.3, signal: 'BOT_WASH_TRADING' }
};

export class HumanEventLayer {
    classify({ fearGreedIndex, volRatio, priceChange1h, utcH, isBlackSwan = false }) {
        let state = 'RATIONAL_MARKET';

        const isHumanAsleep = utcH >= 2 && utcH < 8;
        const isBotHour = (utcH >= 22 || utcH < 2);

        if (isBlackSwan) {
            state = 'NEWS_SHOCK';
        } else if (fearGreedIndex !== null && fearGreedIndex < 15 && volRatio > 2) {
            state = 'HERD_PANIC';
        } else if (fearGreedIndex !== null && fearGreedIndex > 80 && volRatio > 2) {
            state = 'HERD_FOMO';
        } else if (isBotHour && volRatio > 1.5) {
            state = 'DEAD_ZONE_TRAP';
        } else if (isHumanAsleep) {
            state = 'SLEEPING_HERD';
        }

        const profile = HUMAN_STATES[state];

        const entry = {
            t: new Date().toISOString(), state, fearGreedIndex,
            volRatio, priceChange1h, utcH, ...profile
        };

        try { fs.appendFileSync(HUMAN_LOG, JSON.stringify(entry) + '\n'); } catch { }

        const icons = {
            HERD_PANIC: '🔴', HERD_FOMO: '🟡', NEWS_SHOCK: '⛔',
            SLEEPING_HERD: '😴', RATIONAL_MARKET: '🟢', DEAD_ZONE_TRAP: '🤖'
        };

        console.log('[HUMAN]', icons[state], 'State:', state,
            '| Edge:', profile.edgeMultiplier + 'x',
            '| Stake:', profile.stakeMultiplier + 'x',
            '| Signal:', profile.signal);

        return { state, ...profile };
    }
}

export const humanEventLayer = new HumanEventLayer();
