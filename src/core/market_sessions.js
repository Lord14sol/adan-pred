// src/core/market_sessions.js
// 8 global market sessions with behavioral intelligence
// Part of Mother Code v2.0

const SESSIONS = {
    SYDNEY: {
        name: 'Sydney',
        utcStart: 22, utcEnd: 7,
        type: 'RETAIL_ASIA_LIGHT',
        edgeMultiplier: 0.85,
        stakeMultiplier: 0.7,
        strategy: 'Thin liquidity. Meme season starts here. Small sizes only.',
        warningFlags: ['LOW_LIQUIDITY', 'MEME_MANIPULATION_RISK']
    },
    TOKYO: {
        name: 'Tokyo',
        utcStart: 0, utcEnd: 9,
        type: 'INSTITUTIONAL_ASIA',
        edgeMultiplier: 0.90,
        stakeMultiplier: 0.75,
        strategy: 'Nikkei correlation active. JPY carry trade watch. More reliable than Sydney.',
        warningFlags: ['JPY_CARRY_RISK']
    },
    SHANGHAI: {
        name: 'Shanghai',
        utcStart: 1, utcEnd: 9,
        type: 'CHINA_VOLUME',
        edgeMultiplier: 0.95,
        stakeMultiplier: 0.80,
        strategy: 'PBOC CNY fix at 01:15 UTC = BTC signal. High crypto volume.',
        warningFlags: ['PBOC_FIX_RISK'],
        recurringEvents: [{ utcH: 1, utcM: 15, label: 'PBOC_CNY_FIX', impact: 'HIGH' }]
    },
    LONDON: {
        name: 'London',
        utcStart: 8, utcEnd: 17,
        type: 'INSTITUTIONAL_EU',
        edgeMultiplier: 1.10,
        stakeMultiplier: 0.90,
        strategy: 'Largest FX market. Best EU liquidity. Trust technicals.',
        warningFlags: []
    },
    BUENOS_AIRES: {
        name: 'Buenos Aires',
        utcStart: 12, utcEnd: 21,
        type: 'LATAM_RETAIL_HIGH_CRYPTO',
        edgeMultiplier: 1.00,
        stakeMultiplier: 0.85,
        strategy: 'Highest crypto adoption per capita. BCRA peso moves = USDT demand surge.',
        warningFlags: ['LATAM_PESO_RISK']
    },
    NEW_YORK: {
        name: 'New York',
        utcStart: 13, utcEnd: 22,
        type: 'INSTITUTIONAL_US_DOMINANT',
        edgeMultiplier: 1.30,
        stakeMultiplier: 1.00,
        polymarketBoost: 1.40,
        strategy: 'PRIME SESSION. Fed speakers, CPI/PPI/NFP. CME futures. S&P500 correlation peak. BEST TIME TO BET.',
        warningFlags: [],
        criticalEvents: [
            { utcH: 13, utcM: 0, label: 'NYSE_OPEN', impact: 'VERY_HIGH' },
            { utcH: 14, utcM: 30, label: 'US_ECONOMIC_DATA', impact: 'EXTREME' },
            { utcH: 16, utcM: 0, label: 'CME_FUTURES_OPEN', impact: 'HIGH' },
            { utcH: 19, utcM: 0, label: 'RETAIL_FOMO_HOUR', impact: 'HIGH' },
            { utcH: 20, utcM: 0, label: 'NASDAQ_CLOSE', impact: 'MEDIUM' }
        ]
    },
    LOS_ANGELES: {
        name: 'Los Angeles',
        utcStart: 16, utcEnd: 1,
        type: 'TECH_VC_CRYPTO_TWITTER',
        edgeMultiplier: 0.95,
        stakeMultiplier: 0.85,
        strategy: 'Silicon Valley VCs. Influencer tweets most impactful here. Social manipulation risk.',
        warningFlags: ['SOCIAL_MANIPULATION_RISK']
    },
    DEAD_ZONE: {
        name: 'Dead Zone',
        utcStart: 22, utcEnd: 2,
        type: 'BOT_DOMINATED',
        edgeMultiplier: 0.60,
        stakeMultiplier: 0.40,
        strategy: 'Humans sleeping globally. Stop hunts, wash trading, false breakouts. AVOID or minimal size.',
        warningFlags: ['BOT_WASH_TRADING', 'STOP_HUNT_RISK', 'FALSE_BREAKOUT_RISK']
    }
};

function isSessionActive(session, utcH) {
    const { utcStart, utcEnd } = session;
    if (utcStart < utcEnd) return utcH >= utcStart && utcH < utcEnd;
    return utcH >= utcStart || utcH < utcEnd;
}

export class MarketSessionEngine {
    getCurrentSessions() {
        const utcH = new Date().getUTCHours();
        return Object.values(SESSIONS).filter(s => isSessionActive(s, utcH));
    }

    getDominantSession() {
        const active = this.getCurrentSessions();
        if (active.length === 0) return SESSIONS.DEAD_ZONE;
        return active.reduce((best, s) => s.edgeMultiplier > best.edgeMultiplier ? s : best);
    }

    getSessionOverlap() {
        const utcH = new Date().getUTCHours();
        const londonActive = isSessionActive(SESSIONS.LONDON, utcH);
        const nyActive = isSessionActive(SESSIONS.NEW_YORK, utcH);
        if (londonActive && nyActive) {
            return {
                overlap: true,
                name: 'LONDON_NY_OVERLAP',
                edgeBoost: 1.20,
                description: 'Peak liquidity window 13:00-17:00 UTC. Best signal reliability.'
            };
        }
        return { overlap: false };
    }

    getUpcomingEvents(windowMinutes = 120) {
        const now = new Date();
        const utcH = now.getUTCHours();
        const utcM = now.getUTCMinutes();
        const nowMinutes = utcH * 60 + utcM;
        const events = [];

        for (const session of Object.values(SESSIONS)) {
            const evts = [...(session.criticalEvents || []), ...(session.recurringEvents || [])];
            evts.forEach(evt => {
                const evtMinutes = evt.utcH * 60 + (evt.utcM || 0);
                const diff = ((evtMinutes - nowMinutes) + 1440) % 1440;
                if (diff > 0 && diff <= windowMinutes) {
                    events.push({ ...evt, minutesUntil: diff, session: session.name });
                }
            });
        }
        return events.sort((a, b) => a.minutesUntil - b.minutesUntil);
    }

    getSessionAdjustments() {
        const dominant = this.getDominantSession();
        const overlap = this.getSessionOverlap();
        const upcoming = this.getUpcomingEvents(60);

        let edgeMultiplier = dominant.edgeMultiplier;
        let stakeMultiplier = dominant.stakeMultiplier;

        if (overlap.overlap) {
            edgeMultiplier *= overlap.edgeBoost;
            stakeMultiplier = Math.min(1.0, stakeMultiplier * 1.1);
        }

        // Zero stake 30min before EXTREME events
        const extremeImminent = upcoming.find(e => e.impact === 'EXTREME' && e.minutesUntil <= 30);
        if (extremeImminent) {
            stakeMultiplier = 0;
            console.log('[SESSION] ⚠️ EXTREME event in', extremeImminent.minutesUntil, 'min:',
                extremeImminent.label, '— stake zeroed');
        }

        return {
            sessionName: dominant.name,
            sessionType: dominant.type,
            edgeMultiplier: parseFloat(edgeMultiplier.toFixed(3)),
            stakeMultiplier: parseFloat(stakeMultiplier.toFixed(3)),
            strategy: dominant.strategy,
            warningFlags: dominant.warningFlags,
            overlapActive: overlap.overlap,
            upcomingEvents: upcoming
        };
    }

    getPromptContext() {
        const adj = this.getSessionAdjustments();
        const overlap = this.getSessionOverlap();
        return `━━━ MARKET SESSION INTELLIGENCE ━━━
Current Session: ${adj.sessionName} (${adj.sessionType})
Edge Quality: ${adj.edgeMultiplier}x | Stake Quality: ${adj.stakeMultiplier}x
Strategy: ${adj.strategy}
${overlap.overlap ? '⚡ LONDON+NY OVERLAP ACTIVE: Peak liquidity, maximum signal reliability' : ''}
${adj.warningFlags.length ? '⚠️ Warnings: ' + adj.warningFlags.join(', ') : ''}
${adj.upcomingEvents.length ? 'Upcoming: ' + adj.upcomingEvents.map(e =>
            e.label + ' in ' + e.minutesUntil + 'min [' + e.impact + ']').join(' | ') : 'No critical events next 2h'}`;
    }
}

export const marketSessions = new MarketSessionEngine();
