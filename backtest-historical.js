#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ADAN HISTORICAL BACKTESTER                                          ║
 * ║  Downloads resolved Polymarket crypto markets from Gamma API          ║
 * ║  Simulates ADAN decisions based on historical per-asset/hour WR       ║
 * ║  Run: node backtest-historical.js                                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import https from 'https';
import http from 'http';
import fs from 'fs';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m';
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const ADAN_API = 'http://localhost:3141';
const CACHE_FILE = './data/polymarket_history.json';

function httpGet(url, isHttps = true) {
    return new Promise((resolve, reject) => {
        const mod = isHttps ? https : http;
        mod.get(url, { headers: { 'Accept': 'application/json' } }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Parse error')); }
            });
        }).on('error', reject);
    });
}

// ── Session Logic ──
const SESSIONS = {
    SYDNEY: { utcStart: 22, utcEnd: 7, stakeMult: 0.70 },
    TOKYO: { utcStart: 0, utcEnd: 9, stakeMult: 0.75 },
    LONDON: { utcStart: 8, utcEnd: 17, stakeMult: 0.90 },
    NEW_YORK: { utcStart: 13, utcEnd: 22, stakeMult: 1.00 },
    DEAD_ZONE: { utcStart: 22, utcEnd: 2, stakeMult: 0.40 },
};

function isActive(s, h) {
    if (s.utcStart < s.utcEnd) return h >= s.utcStart && h < s.utcEnd;
    return h >= s.utcStart || h < s.utcEnd;
}

function getStakeMult(utcH) {
    let best = 0.5;
    for (const s of Object.values(SESSIONS)) {
        if (isActive(s, utcH) && s.stakeMult > best) best = s.stakeMult;
    }
    return best;
}

// ── Statistical Functions ──
function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return x >= 0 ? 1 - poly * Math.exp(-x * x) : -(1 - poly * Math.exp(-x * x));
}

function pValue(wins, total) {
    if (total === 0) return 1;
    const z = (wins / total - 0.5) / Math.sqrt(0.25 / total);
    return z < 0 ? 1 : 1 - 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function sharpeRatio(returns) {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1));
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0; // Annualized
}

function maxDrawdown(equity) {
    let peak = equity[0], maxDD = 0;
    for (const v of equity) {
        if (v > peak) peak = v;
        const dd = (peak - v) / peak * 100;
        if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
}

async function downloadMarkets() {
    console.log(`${C}Downloading resolved crypto markets from Polymarket...${X}`);

    // Check cache
    if (fs.existsSync(CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const age = Date.now() - (cached.downloadedAt || 0);
        if (age < 3600000) { // Cache for 1 hour
            console.log(`${D}Using cached data (${cached.markets.length} markets, ${Math.round(age / 60000)} min old)${X}`);
            return cached.markets;
        }
    }

    const allMarkets = [];
    let offset = 0;
    const limit = 100;

    // Download in pages
    while (offset < 2000) { // Max 2000 markets
        try {
            const url = `${GAMMA_API}/markets?closed=true&limit=${limit}&offset=${offset}&order=endDate&ascending=false`;
            const markets = await httpGet(url);
            if (!markets || markets.length === 0) break;

            // Filter: crypto Up/Down markets only
            const cryptoMarkets = markets.filter(m => {
                const q = (m.question || '').toLowerCase();
                return (q.includes('up or down') || q.includes('above') || q.includes('below')) &&
                    (q.includes('bitcoin') || q.includes('btc') || q.includes('ethereum') || q.includes('eth') ||
                        q.includes('solana') || q.includes('sol'));
            });

            allMarkets.push(...cryptoMarkets);
            offset += limit;

            if (markets.length < limit) break;
            process.stdout.write(`\r  Downloaded ${offset} markets, ${allMarkets.length} crypto matches...`);

            // Rate limit
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.log(`\n${Y}Warning: API error at offset ${offset}: ${e.message}${X}`);
            break;
        }
    }
    console.log('');

    // Cache results
    try {
        const dir = './data';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ downloadedAt: Date.now(), markets: allMarkets }, null, 2));
    } catch (e) { }

    console.log(`${G}✓${X} Downloaded ${B}${allMarkets.length}${X} resolved crypto markets from Polymarket\n`);
    return allMarkets;
}

async function getAdanProfile() {
    // Get ADAN's historical stats to simulate accuracy
    try {
        const state = await httpGet(`${ADAN_API}/api/state`, false);
        const closed = state.positions?.closed || [];

        const hourWR = {};
        const assetWR = {};

        for (const t of closed) {
            const h = new Date(t.entryTime).getUTCHours();
            const asset = (t.asset || '').toUpperCase() ||
                (t.marketTitle?.includes('Bitcoin') ? 'BTC' :
                    t.marketTitle?.includes('Ethereum') ? 'ETH' :
                        t.marketTitle?.includes('Solana') ? 'SOL' : 'OTHER');

            if (!hourWR[h]) hourWR[h] = { w: 0, l: 0 };
            if (t.won) hourWR[h].w++; else hourWR[h].l++;

            if (!assetWR[asset]) assetWR[asset] = { w: 0, l: 0 };
            if (t.won) assetWR[asset].w++; else assetWR[asset].l++;
        }

        return { hourWR, assetWR, totalTrades: closed.length };
    } catch (e) {
        console.log(`${Y}Could not fetch ADAN stats. Using defaults.${X}`);
        return {
            hourWR: {},
            assetWR: { BTC: { w: 66, l: 64 }, ETH: { w: 31, l: 23 }, SOL: { w: 59, l: 50 } },
            totalTrades: 0
        };
    }
}

function row(text, width = 76) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - clean.length - 4);
    return `║ ${text}${' '.repeat(pad)} ║`;
}

function hr(width = 76) {
    return `╟${'─'.repeat(width - 2)}╢`;
}

async function run() {
    console.log('\n');
    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${M}  ADAN HISTORICAL BACKTESTER${X}`));
    console.log(row(`${D}  Simulating ADAN strategies on resolved Polymarket markets${X}`));
    console.log(`╚${'═'.repeat(74)}╝`);
    console.log('');

    const [markets, profile] = await Promise.all([downloadMarkets(), getAdanProfile()]);

    if (markets.length === 0) {
        console.log(`${R}No resolved crypto markets found!${X}`);
        return;
    }

    console.log(`${D}ADAN profile: ${profile.totalTrades} real trades used for accuracy modeling${X}\n`);

    // ── Simulate 3 strategies ──
    const strategies = {
        BUY_ALWAYS: {
            name: 'Naive: Always bet YES $100',
            decideFn: () => ({ bet: true, side: 'YES', stake: 100 })
        },
        ADAN_RAW: {
            name: 'ADAN Raw (no filters)',
            decideFn: (market, profile) => {
                const asset = market.question.includes('Bitcoin') ? 'BTC' :
                    market.question.includes('Ethereum') ? 'ETH' :
                        market.question.includes('Solana') ? 'SOL' : 'OTHER';
                const prices = JSON.parse(market.outcomePrices || '[0.5,0.5]');
                const yesPrice = parseFloat(prices[0]) || 0.5;
                const edge = Math.abs(yesPrice - 0.5);
                if (edge < 0.03) return { bet: false }; // Skip if no edge
                const side = yesPrice < 0.5 ? 'YES' : 'NO';
                return { bet: true, side, stake: 100 };
            }
        },
        ADAN_MC: {
            name: 'ADAN + Mother Code',
            decideFn: (market, profile) => {
                const asset = market.question.includes('Bitcoin') ? 'BTC' :
                    market.question.includes('Ethereum') ? 'ETH' :
                        market.question.includes('Solana') ? 'SOL' : 'OTHER';
                const endDate = new Date(market.endDate);
                const utcH = endDate.getUTCHours();
                const prices = JSON.parse(market.outcomePrices || '[0.5,0.5]');
                const yesPrice = parseFloat(prices[0]) || 0.5;
                const edge = Math.abs(yesPrice - 0.5);

                // Hour filter: skip toxic hours
                const hwr = profile.hourWR[utcH];
                if (hwr && (hwr.w + hwr.l) >= 5 && hwr.w / (hwr.w + hwr.l) < 0.35) {
                    return { bet: false, reason: 'HOUR_FILTER' };
                }

                // Edge filter
                if (edge < 0.03) return { bet: false, reason: 'LOW_EDGE' };

                // Session stake adjustment
                const stakeMult = getStakeMult(utcH);

                // Asset-based Kelly sizing
                const awr = profile.assetWR[asset];
                let stake = 100;
                if (awr) {
                    const wr = awr.w / (awr.w + awr.l);
                    if (wr > 0.55) stake = 200; // Full stake for strong assets
                    else if (wr < 0.50) stake = 50; // Reduce for weak assets
                }
                stake = Math.round(stake * stakeMult / 25) * 25;
                stake = Math.max(25, Math.min(400, stake));

                const side = yesPrice < 0.5 ? 'YES' : 'NO';
                return { bet: true, side, stake };
            }
        }
    };

    const results = {};

    for (const [key, strategy] of Object.entries(strategies)) {
        let balance = 10000;
        let wins = 0, losses = 0, skipped = 0;
        const equity = [balance];
        const returns = [];

        for (const market of markets) {
            const decision = strategy.decideFn(market, profile);
            if (!decision.bet) { skipped++; continue; }

            // Simulate result using ADAN's historical accuracy
            const asset = market.question.includes('Bitcoin') ? 'BTC' :
                market.question.includes('Ethereum') ? 'ETH' :
                    market.question.includes('Solana') ? 'SOL' : 'OTHER';
            const utcH = new Date(market.endDate).getUTCHours();
            const awr = profile.assetWR[asset] || { w: 53, l: 47 };
            const hwr = profile.hourWR[utcH] || { w: 54, l: 46 };

            // Blended accuracy: 60% asset WR + 40% hour WR
            const assetAcc = awr.w / Math.max(awr.w + awr.l, 1);
            const hourAcc = hwr.w / Math.max(hwr.w + hwr.l, 1);
            const blendedAcc = 0.6 * assetAcc + 0.4 * hourAcc;

            // Simulate win/loss based on blended accuracy
            const won = Math.random() < blendedAcc;

            const prices = JSON.parse(market.outcomePrices || '[0.5,0.5]');
            const price = decision.side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
            const pnl = won ? decision.stake * (1 / Math.max(price, 0.01) - 1) : -decision.stake;

            balance += pnl;
            returns.push(pnl / decision.stake);
            if (won) wins++; else losses++;
            equity.push(balance);
        }

        const totalTrades = wins + losses;
        results[key] = {
            name: strategy.name,
            balance, wins, losses, skipped,
            totalTrades,
            wr: totalTrades > 0 ? (wins / totalTrades * 100) : 0,
            net: balance - 10000,
            equity,
            pValue: pValue(wins, totalTrades),
            sharpe: sharpeRatio(returns),
            maxDD: maxDrawdown(equity)
        };
    }

    // ── Print Results ──
    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${C}  HISTORICAL BACKTEST · ${markets.length} Resolved Markets${X}`));
    console.log(`╠${'═'.repeat(74)}╣`);

    for (const [key, r] of Object.entries(results)) {
        const color = r.net >= 0 ? G : R;
        const netStr = r.net >= 0 ? `+$${r.net.toFixed(0)}` : `-$${Math.abs(r.net).toFixed(0)}`;
        const sigStr = r.pValue < 0.01 ? `${G}SIGNIFICANT ✓✓✓${X}` :
            r.pValue < 0.05 ? `${G}SIGNIFICANT ✓${X}` :
                r.pValue < 0.10 ? `${Y}MARGINAL${X}` : `${R}NOT SIGNIFICANT${X}`;

        console.log(row(`${B}${r.name}${X}`));
        console.log(row(`  Trades: ${r.totalTrades} (${r.skipped} skipped) | ${r.wins}W/${r.losses}L | WR: ${B}${r.wr.toFixed(1)}%${X}`));
        console.log(row(`  Balance: ${color}$${r.balance.toFixed(0)}${X} | Net: ${color}${B}${netStr}${X}`));
        console.log(row(`  Sharpe: ${r.sharpe > 0.5 ? G : r.sharpe > 0 ? Y : R}${r.sharpe.toFixed(2)}${X} | MaxDD: ${R}${r.maxDD.toFixed(1)}%${X} | p: ${r.pValue.toFixed(4)} → ${sigStr}`));
        console.log(hr());
    }

    // ── Equity Curve ──
    const origEq = results.ADAN_RAW.equity;
    const mcEq = results.ADAN_MC.equity;
    const naiveEq = results.BUY_ALWAYS.equity;
    const allVals = [...origEq, ...mcEq, ...naiveEq];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = maxV - minV || 1;
    const chartH = 10;
    const chartW = Math.min(70, Math.max(origEq.length, mcEq.length, naiveEq.length));

    console.log(row(`${B}${M}  EQUITY CURVES${X}`));
    console.log(hr());

    for (let ri = chartH; ri >= 0; ri--) {
        const val = minV + (ri / chartH) * range;
        let line = `${D}$${(val).toFixed(0).padStart(6)}${X} `;
        const step1 = Math.max(1, Math.floor(origEq.length / chartW));
        const step2 = Math.max(1, Math.floor(mcEq.length / chartW));

        for (let col = 0; col < chartW; col++) {
            const idx1 = Math.min(col * step1, origEq.length - 1);
            const idx2 = Math.min(col * step2, mcEq.length - 1);
            const norm1 = Math.round(((origEq[idx1] || 10000) - minV) / range * chartH);
            const norm2 = Math.round(((mcEq[idx2] || 10000) - minV) / range * chartH);

            if (norm1 === ri && norm2 === ri) line += `${Y}◆${X}`;
            else if (norm2 === ri) line += `${G}█${X}`;
            else if (norm1 === ri) line += `${R}░${X}`;
            else line += ' ';
        }
        console.log(`║ ${line} ║`);
    }
    console.log(row(`${D}  ${G}█ Mother Code${X}  ${R}░ Raw ADAN${X}  ${Y}◆ Overlap${X}`));

    console.log(`╚${'═'.repeat(74)}╝`);

    // ── Verdict ──
    const mc = results.ADAN_MC;
    const raw = results.ADAN_RAW;
    console.log('');
    console.log(`╔${'═'.repeat(74)}╗`);
    console.log(row(`${B}${M}  HISTORICAL VERDICT${X}`));
    console.log(`╠${'═'.repeat(74)}╣`);
    console.log(row(`  Markets analyzed: ${M}${markets.length}${X}`));
    console.log(row(`  Raw ADAN:        ${raw.net >= 0 ? G : R}$${raw.net.toFixed(0)}${X} (${raw.wr.toFixed(1)}% WR, ${raw.totalTrades} trades, Sharpe ${raw.sharpe.toFixed(2)})`));
    console.log(row(`  Mother Code:     ${mc.net >= 0 ? G : R}$${mc.net.toFixed(0)}${X} (${mc.wr.toFixed(1)}% WR, ${mc.totalTrades} trades, Sharpe ${mc.sharpe.toFixed(2)})`));
    const improvement = mc.net - raw.net;
    console.log(row(`  MC improvement:  ${improvement >= 0 ? G : R}$${improvement >= 0 ? '+' : ''}${improvement.toFixed(0)}${X}`));
    console.log(`╚${'═'.repeat(74)}╝\n`);
}

run().catch(err => {
    console.error(`${R}Error: ${err.message}${X}`);
    process.exit(1);
});
