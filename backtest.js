#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ADAN BACKTESTER · Mother Code Retroactive Analysis                  ║
 * ║  Replays actual trades through Mother Code filters                    ║
 * ║  Shows: what-if equity curve, filter impact, statistical significance ║
 * ║  Run: node backtest.js                                                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import http from 'http';

const API = 'http://localhost:3141';

// ── ANSI Colors ──
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m';
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m';

function fetch(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// ── Session Logic (replicated from market_sessions.js) ──
const SESSIONS = {
    SYDNEY: { utcStart: 22, utcEnd: 7, edgeMult: 0.85, stakeMult: 0.70, type: 'RETAIL_ASIA_LIGHT' },
    TOKYO: { utcStart: 0, utcEnd: 9, edgeMult: 0.90, stakeMult: 0.75, type: 'INSTITUTIONAL_ASIA' },
    SHANGHAI: { utcStart: 1, utcEnd: 9, edgeMult: 0.95, stakeMult: 0.80, type: 'CHINA_VOLUME' },
    LONDON: { utcStart: 8, utcEnd: 17, edgeMult: 1.10, stakeMult: 0.90, type: 'INSTITUTIONAL_EU' },
    BUENOS_AIRES: { utcStart: 12, utcEnd: 21, edgeMult: 1.00, stakeMult: 0.85, type: 'LATAM_RETAIL' },
    NEW_YORK: { utcStart: 13, utcEnd: 22, edgeMult: 1.30, stakeMult: 1.00, type: 'US_DOMINANT' },
    LOS_ANGELES: { utcStart: 16, utcEnd: 1, edgeMult: 0.95, stakeMult: 0.85, type: 'TECH_VC' },
    DEAD_ZONE: { utcStart: 22, utcEnd: 2, edgeMult: 0.60, stakeMult: 0.40, type: 'BOT_DOMINATED' },
};

function isActive(s, h) {
    if (s.utcStart < s.utcEnd) return h >= s.utcStart && h < s.utcEnd;
    return h >= s.utcStart || h < s.utcEnd;
}

function getDominantSession(utcH) {
    let best = null, bestEdge = 0;
    for (const [name, s] of Object.entries(SESSIONS)) {
        if (isActive(s, utcH) && s.edgeMult > bestEdge) {
            best = { name, ...s };
            bestEdge = s.edgeMult;
        }
    }
    return best || { name: 'DEAD_ZONE', ...SESSIONS.DEAD_ZONE };
}

function hasOverlap(utcH) {
    return isActive(SESSIONS.LONDON, utcH) && isActive(SESSIONS.NEW_YORK, utcH);
}

// ── Polymerase Gate (simplified replay) ──
function polymeraseGateCheck(trade) {
    const entryTime = new Date(trade.entryTime);
    const closesAt = new Date(trade.closesAt);
    const windowHours = (closesAt - entryTime) / (1000 * 60 * 60);

    // Gate 1: Close window invalid (< 1.5 minutes = trap)
    if (windowHours < 0.025) return { blocked: true, reason: 'CLOSE_WINDOW_INVALID' };
    // Gate 2: Close window dangerously short (< 2 minutes)
    if (windowHours < 0.033) return { blocked: true, reason: 'CLOSE_WINDOW_TOO_SHORT' };
    // Gate 3: Edge too small (< 3%)
    if (Math.abs(trade.edge) < 0.03) return { blocked: true, reason: 'EDGE_BELOW_MINIMUM' };
    // Gate 4: Confidence too low
    if (trade.confidence < 55) return { blocked: true, reason: 'CONFIDENCE_TOO_LOW' };

    return { blocked: false };
}

// ── Hour Filter ──
function hourFilterCheck(utcH, hourStats) {
    const hs = hourStats[utcH];
    if (!hs) return { blocked: false };
    const total = hs.wins + hs.losses;
    if (total < 5) return { blocked: false }; // Not enough data
    const wr = hs.wins / total;
    if (wr < 0.30) return { blocked: true, reason: `HOUR_${utcH}_WR_${(wr * 100).toFixed(0)}%`, historicalWR: wr };
    return { blocked: false };
}

// ── Historical Kelly ──
function historicalKelly(asset, assetStats, defaultEdge) {
    const stats = assetStats[asset];
    if (!stats || stats.total < 10) return defaultEdge; // Not enough data
    const wr = stats.wins / stats.total;
    const edge = wr - 0.5; // Binary market: edge = WR - 0.5
    return Math.max(0, edge);
}

// ── Statistical Significance ──
function pValue(wins, total) {
    if (total === 0) return 1;
    // For small samples (N < 30), use exact binomial
    if (total < 30) {
        let pVal = 0;
        for (let k = wins; k <= total; k++) {
            pVal += binomCoeff(total, k) * Math.pow(0.5, total);
        }
        return Math.min(1, pVal);
    }
    // Normal approximation for large n
    const p0 = 0.5;
    const z = (wins / total - p0) / Math.sqrt(p0 * (1 - p0) / total);
    if (z < 0) return 1;
    return 1 - 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function binomCoeff(n, k) {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let i = 0; i < Math.min(k, n - k); i++) {
        result *= (n - i) / (i + 1);
    }
    return Math.round(result);
}

function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const result = 1 - poly * Math.exp(-x * x);
    return x >= 0 ? result : -result;
}

function row(text, width = 76) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - clean.length - 4);
    return `║ ${text}${' '.repeat(pad)} ║`;
}

function hr(width = 76) {
    return `╟${'─'.repeat(width - 2)}╢`;
}

// ── MAIN ──
async function run() {
    console.log('\n');
    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${M}  ADAN BACKTESTER · Mother Code Retroactive Analysis${X}`));
    console.log(row(`${D}  Replaying actual trades through quant filters${X}`));
    console.log(`╚${'═'.repeat(74)}╝`);
    console.log('');

    // Fetch data
    console.log(`${D}Fetching trade data from ADAN API...${X}`);
    const state = await fetch(`${API}/api/state`);
    const closed = state.positions?.closed || [];
    const pnlData = state.pnl || {};
    const hourStats = {};

    if (closed.length === 0) {
        console.log(`${R}No closed trades found. ADAN needs to trade first!${X}`);
        return;
    }

    console.log(`${G}✓${X} Found ${B}${closed.length}${X} closed trades to analyze\n`);

    // Build hour stats progressively (as ADAN would have known at each point)
    const rollingHourStats = {};
    const assetStats = {};

    // ── Run 3 scenarios ──
    const scenarios = {
        ORIGINAL: { name: 'Original (no filters)', trades: [], equity: [], filters: {} },
        HOUR_FILTER: { name: 'Hour Filter only', trades: [], equity: [], filters: { hour: true } },
        FULL_MC: { name: 'Full Mother Code', trades: [], equity: [], filters: { hour: true, session: true, polymerase: true, kelly: true } },
    };

    for (const [key, scenario] of Object.entries(scenarios)) {
        let balance = 10000; // Starting balance
        let wins = 0, losses = 0;
        const tempHourStats = {};
        const tempAssetStats = {};

        for (const trade of closed) {
            const entryDate = new Date(trade.entryTime);
            const utcH = entryDate.getUTCHours();
            const asset = (trade.asset || '').toUpperCase() ||
                (trade.marketTitle?.includes('Bitcoin') ? 'BTC' :
                    trade.marketTitle?.includes('Ethereum') ? 'ETH' :
                        trade.marketTitle?.includes('Solana') ? 'SOL' : 'OTHER');

            let blocked = false;
            let blockReason = '';
            let stakeMultiplier = 1.0;

            // Hour Filter
            if (scenario.filters.hour) {
                const hf = hourFilterCheck(utcH, tempHourStats);
                if (hf.blocked) {
                    blocked = true;
                    blockReason = hf.reason;
                }
            }

            // Session Filter
            if (!blocked && scenario.filters.session) {
                const session = getDominantSession(utcH);
                stakeMultiplier *= session.stakeMult;
                if (hasOverlap(utcH)) stakeMultiplier *= 1.1;
            }

            // Polymerase
            if (!blocked && scenario.filters.polymerase) {
                const pg = polymeraseGateCheck(trade);
                if (pg.blocked) {
                    blocked = true;
                    blockReason = pg.reason;
                }
            }

            // Historical Kelly
            let adjustedStake = parseFloat(trade.stake) || 100;
            if (!blocked && scenario.filters.kelly) {
                const histEdge = historicalKelly(asset, tempAssetStats, trade.edge);
                if (histEdge <= 0.01) {
                    adjustedStake *= 0.25; // Minimum
                } else {
                    adjustedStake *= Math.min(1.5, histEdge / Math.max(trade.edge, 0.01));
                }
                adjustedStake *= stakeMultiplier;
                adjustedStake = Math.round(Math.max(25, adjustedStake) / 25) * 25;
            }

            if (!blocked) {
                const effectivePrice = trade.side === 'YES' ? trade.marketPrice : (1 - trade.marketPrice);
                const tradeProfit = trade.won
                    ? adjustedStake * (1 / Math.max(effectivePrice, 0.01) - 1)
                    : -adjustedStake;
                // Use proportional PnL if stake was adjusted by Kelly
                const pnlActual = scenario.filters.kelly
                    ? tradeProfit
                    : parseFloat(trade.pnl) || 0;

                balance += pnlActual;
                if (trade.won) wins++; else losses++;

                scenario.trades.push({ ...trade, adjustedPnl: pnlActual, adjustedStake });
            }

            scenario.equity.push(balance);

            // Update rolling stats (for progressive lookback)
            if (!tempHourStats[utcH]) tempHourStats[utcH] = { wins: 0, losses: 0 };
            if (trade.won) tempHourStats[utcH].wins++; else tempHourStats[utcH].losses++;

            if (!tempAssetStats[asset]) tempAssetStats[asset] = { wins: 0, losses: 0, total: 0 };
            tempAssetStats[asset].total++;
            if (trade.won) tempAssetStats[asset].wins++; else tempAssetStats[asset].losses++;
        }

        scenario.finalBalance = balance;
        scenario.wins = wins;
        scenario.losses = losses;
        scenario.totalTrades = wins + losses;
        scenario.blockedTrades = closed.length - scenario.totalTrades;
        scenario.wr = scenario.totalTrades > 0 ? (wins / scenario.totalTrades * 100) : 0;
        scenario.net = balance - 10000;
        scenario.pValue = pValue(wins, scenario.totalTrades);
        scenario.maxDrawdown = calculateMaxDrawdown(scenario.equity);
    }

    // ── Print Results ──
    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${C}  BACKTEST RESULTS · ${closed.length} Historical Trades${X}`));
    console.log(`╠${'═'.repeat(74)}╣`);

    for (const [key, s] of Object.entries(scenarios)) {
        const color = s.net >= 0 ? G : R;
        const netStr = s.net >= 0 ? `+$${s.net.toFixed(0)}` : `-$${Math.abs(s.net).toFixed(0)}`;
        const sigStr = s.pValue < 0.01 ? `${G}SIGNIFICANT ✓✓✓${X}` :
            s.pValue < 0.05 ? `${G}SIGNIFICANT ✓${X}` :
                s.pValue < 0.10 ? `${Y}MARGINAL${X}` : `${R}NOT SIGNIFICANT${X}`;

        console.log(row(`${B}${s.name}${X}`));
        console.log(row(`  Trades: ${s.totalTrades} (${s.blockedTrades} blocked) | ${s.wins}W/${s.losses}L | WR: ${B}${s.wr.toFixed(1)}%${X}`));
        console.log(row(`  Balance: ${color}$${s.finalBalance.toFixed(0)}${X} | Net: ${color}${B}${netStr}${X} | MaxDD: ${R}${s.maxDrawdown.toFixed(1)}%${X}`));
        console.log(row(`  p-value: ${s.pValue.toFixed(6)} → ${sigStr}`));
        console.log(hr());
    }

    // ── Equity Curve (ASCII) ──
    console.log(row(`${B}${M}  EQUITY CURVES${X}`));
    console.log(hr());

    const origEq = scenarios.ORIGINAL.equity;
    const mcEq = scenarios.FULL_MC.equity;
    const allVals = [...origEq, ...mcEq];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = maxV - minV || 1;
    const chartH = 12;
    const chartW = Math.min(70, closed.length);
    const step = Math.max(1, Math.floor(closed.length / chartW));

    for (let row_i = chartH; row_i >= 0; row_i--) {
        const val = minV + (row_i / chartH) * range;
        let line = `${D}${val >= 10000 ? '+' : ' '}$${Math.abs(val - 10000).toFixed(0).padStart(4)}${X} `;

        for (let col = 0; col < chartW; col++) {
            const idx = col * step;
            const origNorm = Math.round(((origEq[idx] || 10000) - minV) / range * chartH);
            const mcNorm = Math.round(((mcEq[idx] || 10000) - minV) / range * chartH);

            if (origNorm === row_i && mcNorm === row_i) line += `${Y}◆${X}`;
            else if (mcNorm === row_i) line += `${G}█${X}`;
            else if (origNorm === row_i) line += `${R}░${X}`;
            else line += ' ';
        }
        console.log(`║ ${line} ║`);
    }
    console.log(row(`${D}  ${G}█ Mother Code${X}  ${R}░ Original${X}  ${Y}◆ Overlap${X}`));
    console.log(hr());

    // ── Filter Breakdown ──
    console.log(row(`${B}${C}  FILTER IMPACT ANALYSIS${X}`));
    console.log(hr());

    // Hour analysis
    const hourWR = {};
    for (const trade of closed) {
        const utcH = new Date(trade.entryTime).getUTCHours();
        if (!hourWR[utcH]) hourWR[utcH] = { w: 0, l: 0 };
        if (trade.won) hourWR[utcH].w++; else hourWR[utcH].l++;
    }

    const badHours = [];
    const goodHours = [];
    for (const [h, v] of Object.entries(hourWR).sort((a, b) => a[0] - b[0])) {
        const total = v.w + v.l;
        const wr = v.w / total * 100;
        if (wr < 35 && total >= 5) badHours.push({ h, wr, total, w: v.w, l: v.l });
        if (wr >= 65 && total >= 5) goodHours.push({ h, wr, total, w: v.w, l: v.l });
    }

    if (badHours.length > 0) {
        console.log(row(`${R}  ✗ TOXIC HOURS (< 35% WR, 5+ trades):${X}`));
        for (const h of badHours) {
            console.log(row(`    UTC ${h.h.toString().padStart(2, '0')}: ${h.wr.toFixed(0)}% WR (${h.w}W/${h.l}L = ${h.total} trades) ← ${R}BLEEDING MONEY${X}`));
        }
    }
    if (goodHours.length > 0) {
        console.log(row(`${G}  ✓ GOLDEN HOURS (≥ 65% WR, 5+ trades):${X}`));
        for (const h of goodHours) {
            console.log(row(`    UTC ${h.h.toString().padStart(2, '0')}: ${h.wr.toFixed(0)}% WR (${h.w}W/${h.l}L = ${h.total} trades) ← ${G}PRINTING MONEY${X}`));
        }
    }

    console.log(hr());

    // Asset analysis
    console.log(row(`${B}${C}  PER-ASSET HISTORICAL KELLY VALUES${X}`));
    console.log(hr());
    const assetBreakdown = {};
    for (const trade of closed) {
        const asset = (trade.asset || '').toUpperCase() || 'OTHER';
        if (!assetBreakdown[asset]) assetBreakdown[asset] = { w: 0, l: 0, pnl: 0 };
        if (trade.won) assetBreakdown[asset].w++; else assetBreakdown[asset].l++;
        assetBreakdown[asset].pnl += parseFloat(trade.pnl) || 0;
    }
    for (const [asset, v] of Object.entries(assetBreakdown).sort((a, b) => b[1].w + b[1].l - a[1].w - a[1].l)) {
        const total = v.w + v.l;
        const wr = v.w / total * 100;
        const edge = (wr - 50);
        const kellyFrac = edge > 0 ? (edge / 100 / 1).toFixed(3) : '0.000';
        const color = wr > 55 ? G : wr > 50 ? Y : R;
        const recStake = wr > 55 ? 'FULL STAKE' : wr > 50 ? 'HALF STAKE' : 'AVOID';
        console.log(row(`  ${B}${asset}${X}: ${color}${wr.toFixed(1)}%${X} WR (${total}t) | Edge: ${color}${edge > 0 ? '+' : ''}${edge.toFixed(1)}%${X} | Kelly f*: ${kellyFrac} | → ${color}${recStake}${X}`));
        console.log(row(`    P&L: ${v.pnl >= 0 ? G : R}$${v.pnl.toFixed(0)}${X} over ${total} trades`));
    }

    console.log(`╚${'═'.repeat(74)}╝`);

    // ── Final Verdict ──
    console.log('');
    const mc = scenarios.FULL_MC;
    const orig = scenarios.ORIGINAL;
    const improvement = mc.net - orig.net;

    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${M}  VERDICT${X}`));
    console.log(`╠${'═'.repeat(74)}╣`);
    console.log(row(`  Original P&L:    ${orig.net >= 0 ? G : R}${B}$${orig.net.toFixed(0)}${X} (${orig.wr.toFixed(1)}% WR, ${orig.totalTrades} trades)`));
    console.log(row(`  Mother Code P&L: ${mc.net >= 0 ? G : R}${B}$${mc.net.toFixed(0)}${X} (${mc.wr.toFixed(1)}% WR, ${mc.totalTrades} trades)`));
    console.log(row(`  Improvement:     ${improvement >= 0 ? G : R}${B}$${improvement >= 0 ? '+' : ''}${improvement.toFixed(0)}${X}`));
    console.log(hr());

    if (mc.pValue < 0.05) {
        console.log(row(`  ${G}${B}✓ EDGE IS STATISTICALLY SIGNIFICANT${X}`));
        console.log(row(`  ${G}  p-value: ${mc.pValue.toFixed(6)} — less than 5% chance this is luck${X}`));
    } else if (mc.pValue < 0.10) {
        console.log(row(`  ${Y}${B}⚠ EDGE IS MARGINALLY SIGNIFICANT${X}`));
        console.log(row(`  ${Y}  p-value: ${mc.pValue.toFixed(6)} — need more trades to confirm${X}`));
    } else {
        console.log(row(`  ${R}${B}✗ EDGE IS NOT STATISTICALLY SIGNIFICANT YET${X}`));
        console.log(row(`  ${R}  p-value: ${mc.pValue.toFixed(6)} — could be luck, need 500+ trades${X}`));
    }

    const tradesNeeded = estimateTradesNeeded(mc.wr);
    console.log(row(`  Trades needed for 95% confidence: ~${tradesNeeded}`));
    console.log(`╚${'═'.repeat(74)}╝\n`);
}

function calculateMaxDrawdown(equity) {
    let peak = equity[0];
    let maxDD = 0;
    for (const val of equity) {
        if (val > peak) peak = val;
        const dd = (peak - val) / peak * 100;
        if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
}

function estimateTradesNeeded(wr) {
    // How many trades needed for p < 0.05 at this win rate
    const p0 = 50;
    const edge = wr - p0;
    if (edge <= 0) return '∞ (no edge)';
    // z = 1.645 for 95% confidence one-tailed
    // n = (z * sqrt(p*(1-p)) / edge)^2
    const p = wr / 100;
    const n = Math.ceil(Math.pow(1.645 * Math.sqrt(p * (1 - p)) / (edge / 100), 2));
    return n;
}

run().catch(err => {
    console.error(`${R}Error: ${err.message}${X}`);
    console.error(`${Y}Make sure ADAN is running at ${API}${X}`);
    process.exit(1);
});
