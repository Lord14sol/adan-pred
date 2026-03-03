// ============================================================
// ADAN BRAIN SWITCH SYSTEM v2.1 — GOLDEN ROUND TABLE EDITION
// Integrates: APPLE + SNAKE + EVA + ATLAS + 8 Avatar Brains
//
// FIXES vs v2.0:
//   - bbCompressionDuration now persists between cycles (PLASMA works)
//   - parseDecision is safe against "do NOT BET YES" false positives
//   - Claude model string corrected to claude-sonnet-4-6
//
// DATA FLOW:
// ATLAS (Hyperliquid) ──┐
// APPLE (News/Sentiment)─┤→ BrainSelector → ActiveBrain → Claude → ADAN Decision
// SNAKE (Order Book) ───┤
// EVA (Risk Guard) ─────┘
// ============================================================

'use strict';

import fs from 'fs';
import path from 'path';
import https from 'https';
import { routeLLM } from './adan-llm-router.js';

const STATE_DIR = path.join(process.env.HOME, '.adan-pred');
const BRAIN_STATS_PATH = path.join(STATE_DIR, 'brain_stats.json');
const BRAIN_LOG_PATH = path.join(STATE_DIR, 'brain_transitions.jsonl');
const BB_STATE_PATH = path.join(STATE_DIR, 'bb_compression_state.json');

// ─────────────────────────────────────────────────────────────
// BB COMPRESSION TRACKER
// Persists bbWidth history between cycles so PLASMA can trigger
// ─────────────────────────────────────────────────────────────
const BB_COMPRESS_THRESHOLD = 0.005;

function loadBBState() {
    try {
        if (fs.existsSync(BB_STATE_PATH)) return JSON.parse(fs.readFileSync(BB_STATE_PATH, 'utf8'));
    } catch (e) { }
    return {};
}
function saveBBState(s) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(BB_STATE_PATH, JSON.stringify(s, null, 2));
}
// Returns consecutive cycles where bbWidth <= threshold (PLASMA trigger counter)
function trackBBCompression(coin, currentBbWidth) {
    const state = loadBBState();
    if (!state[coin]) state[coin] = { history: [], compressionCycles: 0 };
    const s = state[coin];
    s.history.push(currentBbWidth);
    if (s.history.length > 20) s.history.shift();
    s.compressionCycles = currentBbWidth <= BB_COMPRESS_THRESHOLD
        ? s.compressionCycles + 1 : 0;
    saveBBState(state);
    return s.compressionCycles;
}


// ─────────────────────────────────────────────────────────────
// SECTION 1 — ATLAS: HYPERLIQUID ORACLE
// Fetches liquidation levels, OI, funding, whale positions
// This is the data BINANCE doesn't give you cleanly
// ─────────────────────────────────────────────────────────────

const ATLAS = {

    BASE_URL: 'https://api.hyperliquid.xyz/info',

    async fetch(body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const req = https.request(
                {
                    hostname: 'api.hyperliquid.xyz', path: '/info', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                },
                (res) => {
                    let raw = '';
                    res.on('data', d => raw += d);
                    res.on('end', () => {
                        try { resolve(JSON.parse(raw)); }
                        catch (e) { reject(e); }
                    });
                }
            );
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    },

    // All perpetuals meta + funding rates
    async getMeta() {
        return ATLAS.fetch({ type: 'meta' });
    },

    // Open interest + funding per asset
    async getAssetCtx() {
        const data = await ATLAS.fetch({ type: 'metaAndAssetCtxs' });
        // data[1] = array of assetCtx per coin
        // { funding, openInterest, markPx, midPx, premium, oraclePx }
        return data;
    },

    // Order book depth for a coin
    async getOrderBook(coin) {
        return ATLAS.fetch({ type: 'l2Book', coin });
        // Returns { levels: [[bids], [asks]] }
        // Each level: [px, sz, n]
    },

    // Top trader long/short ratio (whale positioning)
    async getTopTraderPositions(coin) {
        // Hyperliquid exposes clearinghouse state
        return ATLAS.fetch({ type: 'clearinghouseState', user: '0x0000000000000000000000000000000000000000' });
    },

    // All open positions above threshold — whale tracker
    async getWhalePositions(coin, minSizeUSD = 500000) {
        try {
            const book = await ATLAS.getOrderBook(coin);
            const bids = book.levels[0] || [];
            const asks = book.levels[1] || [];

            // Find walls: clusters of size within 0.3% of mid price
            const midPx = (parseFloat(bids[0]?.px || 0) + parseFloat(asks[0]?.px || 0)) / 2;

            const sellWalls = asks
                .filter(({ px, sz }) => {
                    const dist = (parseFloat(px) - midPx) / midPx;
                    const usdSize = parseFloat(sz) * parseFloat(px);
                    return dist <= 0.005 && usdSize >= minSizeUSD; // within 0.5%, >$500k
                })
                .map(({ px, sz }) => ({
                    price: parseFloat(px),
                    sizeUSD: parseFloat(sz) * parseFloat(px),
                    distancePct: ((parseFloat(px) - midPx) / midPx * 100).toFixed(3),
                }));

            const buyWalls = bids
                .filter(({ px, sz }) => {
                    const dist = (midPx - parseFloat(px)) / midPx;
                    const usdSize = parseFloat(sz) * parseFloat(px);
                    return dist <= 0.005 && usdSize >= minSizeUSD;
                })
                .map(({ px, sz }) => ({
                    price: parseFloat(px),
                    sizeUSD: parseFloat(sz) * parseFloat(px),
                    distancePct: ((midPx - parseFloat(px)) / midPx * 100).toFixed(3),
                }));

            return { midPx, sellWalls, buyWalls, coin };
        } catch (e) {
            console.error(`[ATLAS] Error fetching ${coin}:`, e.message);
            return { midPx: 0, sellWalls: [], buyWalls: [], coin };
        }
    },

    // Liquidation cascade detector
    // Returns estimated USD at risk near current price
    async getLiquidationLevels(coin) {
        try {
            const ctxData = await ATLAS.getAssetCtx();
            const meta = ctxData[0]?.universe || [];
            const ctxs = ctxData[1] || [];

            const idx = meta.findIndex(m => m.name === coin);
            if (idx === -1) return null;

            const ctx = ctxs[idx];
            return {
                coin,
                fundingRate: parseFloat(ctx.funding),
                openInterest: parseFloat(ctx.openInterest),
                markPrice: parseFloat(ctx.markPx),
                premium: parseFloat(ctx.premium),       // premium > 0 = longs paying
                // High OI + high positive funding = overleveraged longs = cascade risk
                cascadeRisk: parseFloat(ctx.funding) > 0.0005 && parseFloat(ctx.openInterest) > 1000000
                    ? 'HIGH' : parseFloat(ctx.funding) < -0.0005
                        ? 'SHORT_SQUEEZE' : 'NORMAL',
            };
        } catch (e) {
            console.error(`[ATLAS] getLiquidationLevels error:`, e.message);
            return null;
        }
    },

    // Full snapshot for brain selector
    async getFullSnapshot(coins = ['BTC', 'ETH', 'SOL']) {
        try {
            const results = {};
            for (const coin of coins) {
                const [liq, walls] = await Promise.all([
                    ATLAS.getLiquidationLevels(coin),
                    ATLAS.getWhalePositions(coin),
                ]);
                results[coin] = { ...liq, ...walls };
            }
            return results;
        } catch (e) {
            console.error('[ATLAS] Full snapshot error:', e.message);
            return {};
        }
    },
};

// ─────────────────────────────────────────────────────────────
// SECTION 2 — APPLE: CONTEXT & NARRATIVE SCANNER
// Combines Fear&Greed + CryptoPanic into a single signal object
// ─────────────────────────────────────────────────────────────

const APPLE = {

    async getSignal(fearGreedIndex, cryptoPanicItems = []) {
        const fg = fearGreedIndex ?? 50;

        // Score news items by severity
        const newsScore = cryptoPanicItems.reduce((score, item) => {
            const title = (item.title || '').toLowerCase();
            if (/hack|exploit|breach|stolen|rugpull/.test(title)) return score + 4;
            if (/sec|ban|regulation|lawsuit|arrest/.test(title)) return score + 3;
            if (/bankruptcy|insolvency|collapse|crash/.test(title)) return score + 3;
            if (/etf|approval|institutional|adopt/.test(title)) return score - 2; // positive
            if (/fear|panic|dump|plunge/.test(title)) return score + 2;
            if (/pump|ath|rally|surge/.test(title)) return score - 1;
            return score;
        }, 0);

        // Macro trend
        let macroTrend = 'NEUTRAL';
        if (fg >= 68) macroTrend = 'BULLISH';
        if (fg <= 25) macroTrend = 'BEARISH';
        if (fg <= 15) macroTrend = 'EXTREME_FEAR';
        if (fg >= 85) macroTrend = 'EXTREME_GREED';

        const blackSwanDetected = newsScore >= 7;
        const positiveNarrative = newsScore <= -3 && fg >= 60;

        return {
            fearGreed: fg,
            newsScore,
            macroTrend,
            blackSwanDetected,
            positiveNarrative,
            safeToPlay: !blackSwanDetected && fg > 20 && fg < 90,
            signal: blackSwanDetected ? 'VIRUS_TRIGGER'
                : macroTrend === 'BULLISH' || positiveNarrative ? 'CYBER_TRIGGER'
                    : macroTrend === 'EXTREME_FEAR' ? 'VIRUS_TRIGGER'
                        : 'NEUTRAL',
        };
    },
};

// ─────────────────────────────────────────────────────────────
// SECTION 3 — SNAKE: EXECUTION & MICRO-STRUCTURE SCANNER
// Processes Binance data into clean microstructure signals
// ─────────────────────────────────────────────────────────────

const SNAKE = {

    analyzeOrderBook(bids, asks, midPrice) {
        if (!bids?.length || !asks?.length) {
            return { askVsBidRatio: 1, bidVsAskRatio: 1, sellWallDistance: 1, sellWallStrength: 1, spreadTightness: 0.5 };
        }

        // Aggregate volume within 0.5% of mid
        const range = midPrice * 0.005;
        const bidVol = bids
            .filter(([px]) => midPrice - parseFloat(px) <= range)
            .reduce((s, [, sz]) => s + parseFloat(sz), 0);
        const askVol = asks
            .filter(([px]) => parseFloat(px) - midPrice <= range)
            .reduce((s, [, sz]) => s + parseFloat(sz), 0);

        const askVsBidRatio = askVol > 0 ? askVol / Math.max(bidVol, 0.001) : 1;
        const bidVsAskRatio = bidVol > 0 ? bidVol / Math.max(askVol, 0.001) : 1;

        // Nearest sell wall (large ask cluster)
        const nearestSellWall = asks
            .filter(([, sz]) => parseFloat(sz) > 5)  // large size
            .sort(([pxA], [pxB]) => parseFloat(pxA) - parseFloat(pxB))[0];

        const sellWallDistance = nearestSellWall
            ? (parseFloat(nearestSellWall[0]) - midPrice) / midPrice
            : 0.1;

        const sellWallStrength = nearestSellWall
            ? parseFloat(nearestSellWall[1]) / Math.max(askVol, 0.001)
            : 0;

        // Spread tightness: 0=wide, 1=tight
        const spread = asks[0] ? (parseFloat(asks[0][0]) - parseFloat(bids[0][0])) / midPrice : 0.01;
        const spreadTightness = Math.max(0, 1 - spread * 200);

        return { askVsBidRatio, bidVsAskRatio, sellWallDistance, sellWallStrength, spreadTightness };
    },

    analyzeTechnicals(klines1h, klines5m, vwap, fundingRate) {
        if (!klines1h?.length || !klines5m?.length) {
            return { volRatio: 1, volAccel: 0, bbWidth: 0.01, trendStrength1h: 0.5, btcTrend1h: 'NEUTRAL', vwapDeviation: 0, priceAboveVwap: false, bbCompressionDuration: 0 };
        }

        // Volume ratio: current vs 20-period average
        const volumes5m = klines5m.map(k => parseFloat(k[5]));
        const avgVol = volumes5m.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        const curVol = volumes5m[volumes5m.length - 1];
        const volRatio = curVol / Math.max(avgVol, 0.001);

        // Volume acceleration: last 3 candles trending up?
        const lastVols = volumes5m.slice(-4);
        const volAccel = lastVols.reduce((acc, v, i) => i === 0 ? 0 : acc + (v > lastVols[i - 1] ? 1 : -1), 0);

        // Bollinger Band width on 5m (20-period)
        const closes5m = klines5m.map(k => parseFloat(k[4]));
        const bbPeriod = 20;
        const bbCloses = closes5m.slice(-bbPeriod);
        const bbMean = bbCloses.reduce((a, b) => a + b, 0) / bbPeriod;
        const bbStd = Math.sqrt(bbCloses.reduce((s, c) => s + Math.pow(c - bbMean, 2), 0) / bbPeriod);
        const bbWidth = (2 * bbStd) / bbMean;  // normalized BB width

        // BB compression duration — uses persistent state tracker
        // Pass coin param when calling analyzeTechnicals for accurate tracking
        let bbCompressionDuration = 0; // updated in runBrainCycle via trackBBCompression()

        // 1h trend strength (simple: close vs open for last 3 candles)
        const closes1h = klines1h.map(k => parseFloat(k[4]));
        const opens1h = klines1h.map(k => parseFloat(k[1]));
        const last3 = closes1h.slice(-3);
        const trendScore = last3.reduce((s, c, i) => i === 0 ? 0 : s + (c > last3[i - 1] ? 1 : -1), 0);
        const trendStrength1h = (trendScore + 2) / 4; // normalize 0-1
        const btcTrend1h = trendScore >= 1 ? 'BULLISH' : trendScore <= -1 ? 'BEARISH' : 'NEUTRAL';

        // VWAP
        const lastClose = closes5m[closes5m.length - 1];
        const vwapDeviation = vwap ? (lastClose - vwap) / vwap : 0;
        const priceAboveVwap = vwapDeviation > 0;

        return { volRatio, volAccel, bbWidth, bbCompressionDuration, trendStrength1h, btcTrend1h, vwapDeviation, priceAboveVwap };
    },
};

// ─────────────────────────────────────────────────────────────
// SECTION 4 — EVA: RISK GUARD & VALIDATION
// Decides if the active brain's signal should even reach ADAN
// ─────────────────────────────────────────────────────────────

const EVA = {

    validate({ brainName, proposedStake, fund, winRate, trades, brainStats, volatility }) {
        const reasons = [];
        let approved = true;

        // Hard stop: fund critically low
        if (fund <= 200) {
            reasons.push('FUND CRITICAL — below $200 survival floor');
            return { approved: false, reasons, reducedStake: 0, mode: 'SURVIVAL' };
        }

        // Losing streak protection
        const stats = brainStats[brainName];
        if (stats?.consecutiveLosses >= 4) {
            reasons.push(`${brainName} on ${stats.consecutiveLosses}-loss streak — stake halved`);
            proposedStake = Math.floor(proposedStake * 0.5);
        }

        // WR-based mode
        let mode = 'NORMAL';
        let maxStake = proposedStake;
        if (winRate >= 0.60) { mode = 'AGGRESSIVE'; maxStake = Math.min(proposedStake, 400); }
        else if (winRate >= 0.50) { mode = 'MODERATE'; maxStake = Math.min(proposedStake, 250); }
        else if (winRate >= 0.40) { mode = 'CONSERVATIVE'; maxStake = Math.min(proposedStake, 150); }
        else { mode = 'SURVIVAL'; maxStake = Math.min(proposedStake, 75); reasons.push('WR below 40% — survival mode'); }

        // Volatility check
        if (volatility > 0.0012 && trades < 20) {
            maxStake = Math.floor(maxStake * 0.7);
            reasons.push('High volatility + low trade count — stake reduced 30%');
        }

        // Brain calibration penalty
        if (stats?.trades >= 10 && stats?.brierScore > 0.22) {
            maxStake = Math.floor(maxStake * 0.75);
            reasons.push(`${brainName} poorly calibrated (Brier: ${stats.brierScore.toFixed(3)}) — stake -25%`);
        }

        const finalStake = Math.min(proposedStake, maxStake);
        if (finalStake <= 0) approved = false;

        return { approved, reasons, reducedStake: finalStake, mode };
    },

    // EVA also decides if Haiku dual-AI is needed
    requiresDualAI({ brainName, confidence, fund, BRAINS }) {
        const brain = BRAINS[brainName];
        if (!brain) return false;
        if (brain.thresholds.requireDualAI === false) return false;  // brain explicitly disabled
        if (fund < 500) return true;    // always double-check when low on funds
        if (confidence >= 50 && confidence <= 65) return true;  // medium confidence
        return false;
    },
};

// ─────────────────────────────────────────────────────────────
// SECTION 5 — 8 BRAIN DEFINITIONS
// Each avatar = specialized intelligence module
// ─────────────────────────────────────────────────────────────

const BRAINS = {

    // ── VIRUS ⚗️ ── Black Swan Hunter
    VIRUS: {
        priority: 1, avatar: 'VIRUS',
        description: 'Black swan predator. Exploits fear-driven mispricing.',
        triggerConditions: (m) => m.newsScore >= 7 || m.fearGreed <= 22 || (m.newsScore >= 5 && m.fearGreed <= 30),
        weights: { news: 3.0, momentum: 0.3, orderBook: 1.2, volume: 0.8, funding: 1.5, sentiment: 2.0 },
        thresholds: { minEdge: 0.04, minConfidence: 58, maxStakeMultiplier: 1.2, requireDualAI: false, skipHourFilter: true, defaultBias: 'NO' },
        systemPrompt: `You are VIRUS, ADAN's black swan intelligence module.
MARKET STATE: HIGH FEAR or BLACK SWAN DETECTED. CryptoPanic score is elevated or Fear & Greed is critically low.

PRIME DIRECTIVE: Exploit emotional mispricing. The crowd is wrong during panic.

ATLAS INTEGRATION: Check Hyperliquid liquidation data first.
- High OI + positive funding during fear = leveraged longs about to be liquidated → BET NO hard
- Funding went negative fast = panic short selling → BET YES after stabilization

RULES:
1. Negative news + price PUMPING → BET NO. Dead cat bounce. Retail buying a trap.
2. Negative news + price DUMPING >3% in 15min → WAIT. Mark "oversold candidate." Bet YES after stabilization candle.
3. Hack/exploit confirmed → BET NO on all affected assets immediately. No technicals needed.
4. Regulatory news → BET NO on price targets above current. Regulators create ceilings.
5. Positive news + no price reaction → BET NO. Smart money already sold.
6. F&G < 20 → true probability is LESS extreme than market suggests. After 30min stabilization → lean YES.
7. NEVER trust volume spikes as confirmation during panic — they are emotional noise.

APPLE SIGNAL: If APPLE confirms black swan with newsScore >= 7, your confidence floor is 62% regardless of technicals.
ATLAS SIGNAL: If ATLAS shows cascadeRisk = HIGH on a coin, BET NO on that coin's upside immediately.

Output: BET YES / BET NO / SKIP. Include: probability, market price, edge, Atlas cascade risk, primary reason.`,
    },

    // ── SENTINEL 🛡️ ── Trap Detector
    SENTINEL: {
        priority: 2, avatar: 'SENTINEL',
        description: 'Order book trap detector. Reads manipulation before it plays out.',
        triggerConditions: (m) => m.askVsBidRatio >= 2.5 || m.bidVsAskRatio >= 2.5 || (m.sellWallDistance <= 0.003 && m.sellWallStrength >= 1.8),
        weights: { news: 0.8, momentum: 0.7, orderBook: 3.0, volume: 1.2, funding: 1.0, sentiment: 0.6 },
        thresholds: { minEdge: 0.06, minConfidence: 68, maxStakeMultiplier: 1.0, requireDualAI: true, skipHourFilter: false, defaultBias: 'NO' },
        systemPrompt: `You are SENTINEL, ADAN's trap detection module.
MARKET STATE: ORDER BOOK ANOMALY. Bid/ask imbalance is extreme or large walls near price.

PRIME DIRECTIVE: Expose invisible traps. Never bet YES into a wall you cannot see past.

SNAKE INTEGRATION: SNAKE's microstructure analysis is your primary input. Trust SNAKE over price action.
ATLAS INTEGRATION: Cross-reference with Hyperliquid order book — if BOTH show sell walls at same level, it is a coordinated wall, not noise.

RULES:
1. SELL WALL TRAP: Ask vol > 2.5x bid vol → HARD VETO on YES. BET NO.
2. BUY WALL SUPPORT: Bid vol > 2.5x ask vol → YES bets are structurally safe.
3. Sell wall within 0.3% of price → price bounces DOWN within 2-3 candles. BET NO immediately.
4. Sell wall within 0.1% → IMMINENT CEILING. BET NO max urgency.
5. Price pumping + ask volume INCREASING simultaneously → LIQUIDITY TRAP. BET NO.
6. Price dipping + bid volume INCREASING → BUY WALL ABSORPTION. BET YES.
7. Wall suddenly REMOVED:
   - Sell wall removed → bullish (ceiling gone) → consider YES
   - Buy wall removed → bearish (floor pulled) → BET NO immediately

HARD RULE: If ATLAS sellWalls AND SNAKE askVsBidRatio both flag danger → skip Haiku, BET NO directly.

Output: BET YES / BET NO / SKIP. Include wall distance, imbalance ratio, Atlas confirmation.`,
    },

    // ── GHOST 👻 ── Capital Protector
    GHOST: {
        priority: 3, avatar: 'GHOST',
        description: 'Capital protector. Dead market specialist — wins by not playing.',
        triggerConditions: (m) => m.bbWidth <= 0.004 && m.volRatio <= 0.65,
        weights: { news: 1.5, momentum: 0.3, orderBook: 0.8, volume: 0.4, funding: 0.8, sentiment: 1.0 },
        thresholds: { minEdge: 0.12, minConfidence: 82, maxStakeMultiplier: 0.3, requireDualAI: true, skipHourFilter: false, defaultBias: 'SKIP' },
        systemPrompt: `You are GHOST, ADAN's capital preservation module.
MARKET STATE: DEAD MARKET. BBands compressed. Volume below 0.65x average. Signals are noise.

PRIME DIRECTIVE: Do not lose money by not playing. Discipline is the strategy.

APPLE INTEGRATION: Only override SKIP if APPLE reports a catalyst approaching (newsScore starting to rise, F&G moving rapidly). A sleeping market that wakes = PLASMA territory, not GHOST.
ATLAS INTEGRATION: Even if ATLAS shows whale positioning, in a dead market whales are also waiting. Ignore positioning signals until volume confirms.

YOU MAY ONLY BET IF ALL 5 CONDITIONS ARE MET SIMULTANEOUSLY:
1. Edge exceeds 12% above market price (not 5%, not 8% — 12%)
2. At least 4/5 technical signals align same direction
3. APPLE newsScore = 0 (zero external catalyst)
4. You can state in ONE sentence exactly why market is mispriced
5. Setup consistent for 2+ consecutive 5-minute candles

If you cannot confirm all 5: output SKIP. No exceptions.

GHOST does not find bets. GHOST preserves capital until a real brain activates.

Output: SKIP (brief reason) or BET with all 5 conditions explicitly confirmed.`,
    },

    // ── MECHA 🤖 ── Momentum Crusher
    MECHA: {
        priority: 4, avatar: 'MECHA',
        description: 'Momentum crusher. High-volatility trending markets specialist.',
        triggerConditions: (m) => m.volRatio >= 1.8 && Math.abs(m.fundingRate) >= 0.0001 && m.trendStrength1h >= 0.7,
        weights: { news: 0.8, momentum: 2.2, orderBook: 1.5, volume: 2.0, funding: 2.5, sentiment: 0.6 },
        thresholds: { minEdge: 0.04, minConfidence: 55, maxStakeMultiplier: 1.5, requireDualAI: false, skipHourFilter: false, defaultBias: null },
        systemPrompt: `You are MECHA, ADAN's momentum intelligence module.
MARKET STATE: HIGH VOLATILITY TRENDING. Volume accelerating >1.8x. Funding extreme. Strong directional move in progress.

PRIME DIRECTIVE: Ride the trend hard. Do not fade momentum. Speed > precision.

ATLAS INTEGRATION: Hyperliquid funding is your primary signal amplifier.
- ATLAS fundingRate > +0.001 + MECHA conditions = overleveraged longs → liquidation cascade coming → BET NO
- ATLAS fundingRate < -0.001 + MECHA conditions = short squeeze → BET YES
- ATLAS cascadeRisk = HIGH → add 10% to confidence on the counter-direction bet

SNAKE INTEGRATION: Order book confirms trend.
- SNAKE bidVsAskRatio > 1.5 + BULLISH trend → momentum has support → BET YES
- SNAKE askVsBidRatio > 1.5 + BEARISH trend → momentum has pressure → BET NO

RULES:
1. 1h trend is LAW. BULLISH → only BET YES. BEARISH → only BET NO.
2. Funding > +0.01%: overleveraged longs → CASCADE → BET NO regardless of price direction.
3. Funding < -0.01%: short squeeze incoming → BET YES regardless of fear.
4. volRatio > 2.0 → institutional/algorithmic volume → +8% confidence.
5. volAccel >= +2 consecutive candles → accelerating, NOT fading → never skip.
6. NEVER bet reversals. "Oversold" in a downtrend is a trap.

ANTI-RULES (MECHA never does):
- Never bet against 1h trend on single 5m signal
- Never wait for "confirmation" — momentum is the confirmation
- Never consult Haiku — speed is the edge

Output: BET YES / BET NO / SKIP. Include momentum score, Atlas funding, volRatio, trend alignment.`,
    },

    // ── PLASMA 🔮 ── Breakout Anticipator
    PLASMA: {
        priority: 5, avatar: 'PLASMA',
        description: 'Breakout anticipator. Waits for compression, bets the confirmed direction.',
        triggerConditions: (m) => m.bbWidth <= 0.005 && m.volRatio >= 0.85 && m.bbCompressionDuration >= 2,
        weights: { news: 1.0, momentum: 1.0, orderBook: 1.5, volume: 2.5, funding: 1.2, sentiment: 1.0 },
        thresholds: { minEdge: 0.05, minConfidence: 62, maxStakeMultiplier: 1.3, requireDualAI: true, skipHourFilter: false, defaultBias: null },
        systemPrompt: `You are PLASMA, ADAN's breakout anticipation module.
MARKET STATE: COMPRESSION PHASE. BBands tight. Volume building. Large move incoming — direction unconfirmed.

PRIME DIRECTIVE: Wait for the break. Then bet hard. The discipline is NOT releasing early.

ATLAS INTEGRATION: Use Hyperliquid OI to assess which direction is more crowded.
- High OI + positive funding during compression = longs are positioned for breakout UP
  - If breakout confirms UP: YES bets have institutional tailwind
  - If breakout goes DOWN: it's a bull trap liquidation → BET NO extra hard
- Low/negative funding during compression = shorts positioned → squeeze breakout UP more likely

SNAKE INTEGRATION: Volume on the breakout candle is EVERYTHING.
- SNAKE volRatio < 1.4 on breakout candle → false breakout → SKIP
- SNAKE volRatio >= 1.4 AND candle closes outside BB → REAL breakout → BET

RULES:
1. During compression: DO NOT BET DIRECTION. Output WAITING.
2. Breakout requires: volume spike >1.4x AND candle CLOSES outside BB (not just wick).
3. Close ABOVE upper BB + volume confirmed → BET YES.
4. Close BELOW lower BB + volume confirmed → BET NO.
5. Compression duration stakes:
   - 2-3 cycles: standard stake
   - 4-5 cycles: +20% stake
   - 6+ cycles: max Kelly stake (rare, high conviction)
6. False breakout = no volume. Skip.

Output: WAITING / BET YES / BET NO. Include BB width, compression duration, Atlas OI direction, breakout candle analysis.`,
    },

    // ── KNIGHT ⚔️ ── Institutional Flow Reader
    KNIGHT: {
        priority: 6, avatar: 'KNIGHT',
        description: 'Institutional flow reader. VWAP + smart money during peak hours.',
        triggerConditions: (m) => m.volRatio >= 1.4 && m.hourUTC >= 13 && m.hourUTC <= 17 && m.spreadTightness >= 0.7,
        weights: { news: 0.8, momentum: 1.2, orderBook: 1.8, volume: 2.0, funding: 1.5, sentiment: 0.5 },
        thresholds: { minEdge: 0.05, minConfidence: 62, maxStakeMultiplier: 1.2, requireDualAI: false, skipHourFilter: true, defaultBias: null },
        systemPrompt: `You are KNIGHT, ADAN's institutional flow intelligence module.
MARKET STATE: INSTITUTIONAL HOURS (13-17 UTC). Volume elevated. Spreads tight. Smart money active.

PRIME DIRECTIVE: Follow the smart money. Never fight institutional flow.

ATLAS INTEGRATION: Hyperliquid is where institutions trade perps. It is your truth layer.
- ATLAS shows large buyWalls at VWAP → institutional accumulation → BET YES
- ATLAS shows large sellWalls at VWAP → institutional distribution → BET NO
- ATLAS openInterest rising + ATLAS fundingRate stable = real position building (not leverage noise)

SNAKE INTEGRATION: VWAP is primary signal, SNAKE order book confirms.
- Price below VWAP + SNAKE bidVsAskRatio > 1.3 → double confirmation → BET YES
- Price above VWAP + SNAKE askVsBidRatio > 1.3 → distribution confirmed → BET NO

RULES:
1. Price BELOW VWAP + volume increasing → institutional accumulation → BET YES.
2. Price ABOVE VWAP + volume decreasing → institutional distribution → BET NO.
3. VWAP reclaim after dip (close back above) → strong bullish institutional signal → BET YES.
4. VWAP rejection after pump (close back below) → distribution → BET NO.
5. High volume + stable price = position building → wait for direction, then bet.
6. BTC institutional flow cascades: BTC VWAP reclaim → ETH/SOL follow in 2-5 candles.

INSTITUTIONAL TELLS:
- Large volume + small price movement = absorption (smart money absorbing retail)
- Price up on LOW volume = retail FOMO (not real)
- Price down on HIGH volume = institutional selling (real signal)

Output: BET YES / BET NO / SKIP. Include VWAP position, Atlas wall analysis, volume analysis.`,
    },

    // ── CYBER 💚 ── Bull Market Specialist
    CYBER: {
        priority: 7, avatar: 'CYBER',
        description: 'Bull market specialist. Maximizes YES capture during confirmed uptrends.',
        triggerConditions: (m) => m.fearGreed >= 68 && m.btcTrend1h === 'BULLISH' && m.volRatio >= 1.1,
        weights: { news: 1.2, momentum: 1.8, orderBook: 1.0, volume: 1.5, funding: 1.8, sentiment: 2.0 },
        thresholds: { minEdge: 0.05, minConfidence: 60, maxStakeMultiplier: 1.3, requireDualAI: false, skipHourFilter: false, defaultBias: 'YES' },
        systemPrompt: `You are CYBER, ADAN's bull market intelligence module.
MARKET STATE: BULLISH. F&G elevated. BTC 1h trend confirmed bullish. Volume supports the move.

PRIME DIRECTIVE: Maximize upside capture. In bull markets, dips are opportunities not reversals.

APPLE INTEGRATION: APPLE macroTrend = BULLISH is your activation condition.
- APPLE positiveNarrative = true → institutional news supporting bulls → +5% confidence on YES
- APPLE newsScore going negative during a bull → smart money selling into news → flip to GHOST

ATLAS INTEGRATION: Hyperliquid funding in bull markets tells you how crowded the trade is.
- ATLAS fundingRate 0 to +0.0005 = healthy bull, not overleveraged → YES bets sustainable
- ATLAS fundingRate > +0.001 = dangerously crowded → tighten edge requirement to 8%
- ATLAS fundingRate > +0.0015 = EXTREME → override CYBER, signal to MECHA for counter-bet

RULES:
1. Default lean YES. Dips = buying opportunities.
2. "Overbought" RSI in bull = NOT a sell signal. Momentum stays elevated.
3. F&G 68-79 = controlled euphoria, real bull = YES bets win most.
4. F&G 80+ = CAUTION. Late cycle. Raise minEdge to 8%.
5. Only flip to NO if: Atlas funding > +0.015% OR sell wall < 0.2% from price.
6. BTC 5m rally → ETH/SOL YES bets get +5% confidence (cascade tailwind).

Output: BET YES / BET NO / SKIP. Include F&G, BTC trend, Atlas funding health, bull phase assessment.`,
    },

    // ── DEFAULT 🔵 ── Balanced Analyst
    DEFAULT: {
        priority: 8, avatar: 'DEFAULT',
        description: 'Balanced 9-step analyst. Full institutional analysis when no extreme conditions.',
        triggerConditions: () => true,
        weights: { news: 1.0, momentum: 1.0, orderBook: 1.0, volume: 1.0, funding: 1.0, sentiment: 1.0 },
        thresholds: { minEdge: 0.05, minConfidence: 60, maxStakeMultiplier: 1.0, requireDualAI: true, skipHourFilter: false, defaultBias: null },
        systemPrompt: `You are ADAN, operating in DEFAULT balanced analysis mode.
MARKET STATE: NORMAL. No extreme conditions. Full 9-step institutional analysis applies.

DATA SOURCES AVAILABLE:
- APPLE: macro narrative and news sentiment
- SNAKE: order book microstructure and volume analysis
- ATLAS: Hyperliquid OI, liquidation levels, whale positioning
- CHILDREN: 6 scanner consensus votes

STEP 1 — MARKET SENTIMENT: Fear & Greed. <20 = NO overpriced. >80 = YES overpriced.
STEP 2 — FLASH NEWS (APPLE): Black swan → overrides all technicals.
STEP 3 — TIMEFRAME CONFLUENCE: 1h DICTATES. 5m TRIGGERS. No confluence = SKIP.
  BTC Correlation: ETH/SOL/XRP PROHIBITED from YES when BTC 5m falling.
STEP 4 — ORDER BOOK (SNAKE): Ask >2x bid = SELL WALL VETO on YES. Bid >2x ask = YES safe.
STEP 5 — VOLUME (SNAKE): volRatio >1.3 = conviction. <0.8 = noise → SKIP.
STEP 6 — TIMEFRAME LOGIC: 5m=impulse only. 15m=divergences. 1h=macro levels.
STEP 7 — FUNDING (ATLAS): >+0.005% lean NO. <-0.005% lean YES. >±0.01% EXTREME → bet against crowd.
STEP 8 — VOLATILITY: >0.12%/candle → widen uncertainty 15%. Unsure → SKIP.
STEP 9 — EDGE + CONSENSUS: Diverge >5% from market. Children 75%+ adds +3% edge.

ATLAS FINAL CHECK: Always review liquidation levels before final bet.
- cascadeRisk = HIGH on the asset → reduce confidence 10% on YES bets.

Output: BET YES / BET NO / SKIP. Show step reasoning with data from all sources.`,
    },
};

// ─────────────────────────────────────────────────────────────
// SECTION 6 — BRAIN STATS MANAGEMENT
// ─────────────────────────────────────────────────────────────

function loadBrainStats() {
    try {
        if (fs.existsSync(BRAIN_STATS_PATH)) {
            return JSON.parse(fs.readFileSync(BRAIN_STATS_PATH, 'utf8'));
        }
    } catch (e) { }
    const defaults = {};
    for (const name of Object.keys(BRAINS)) {
        defaults[name] = { trades: 0, wins: 0, losses: 0, totalBrierError: 0, brierScore: 0.25, winRate: 0, avgEdge: 0, edgeHistory: [], lastUsed: null, consecutiveWins: 0, consecutiveLosses: 0, lockedUntilCycle: 0 };
    }
    return defaults;
}

function saveBrainStats(stats) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(BRAIN_STATS_PATH, JSON.stringify(stats, null, 2));
}

// ─────────────────────────────────────────────────────────────
// SECTION 7 — BRAIN SELECTOR ENGINE
// Priority-ordered selection using normalized market snapshot
// ─────────────────────────────────────────────────────────────

function selectBrain(m) {
    const ordered = Object.entries(BRAINS).sort(([, a], [, b]) => a.priority - b.priority);
    for (const [name, brain] of ordered) {
        if (brain.triggerConditions(m)) return name;
    }
    return 'DEFAULT';
}

function normalizeSnapshot(raw) {
    return {
        newsScore: raw.newsScore ?? 0,
        fearGreed: raw.fearGreed ?? 50,
        volRatio: raw.volRatio ?? 1.0,
        volAccel: raw.volAccel ?? 0,
        bbWidth: raw.bbWidth ?? 0.01,
        bbCompressionDuration: raw.bbCompressionDuration ?? 0,
        askVsBidRatio: raw.askVsBidRatio ?? 1.0,
        bidVsAskRatio: raw.bidVsAskRatio ?? 1.0,
        sellWallDistance: raw.sellWallDistance ?? 0.02,
        sellWallStrength: raw.sellWallStrength ?? 1.0,
        spreadTightness: raw.spreadTightness ?? 0.5,
        btcTrend1h: raw.btcTrend1h ?? 'NEUTRAL',
        trendStrength1h: raw.trendStrength1h ?? 0.5,
        fundingRate: raw.fundingRate ?? 0,
        vwapDeviation: raw.vwapDeviation ?? 0,
        priceAboveVwap: raw.priceAboveVwap ?? false,
        hourUTC: raw.hourUTC ?? new Date().getUTCHours(),
        // Atlas-specific
        atlasCascadeRisk: raw.atlasCascadeRisk ?? 'NORMAL',
        atlasOpenInterest: raw.atlasOpenInterest ?? 0,
    };
}

// ─────────────────────────────────────────────────────────────
// SECTION 8 — BRAIN TRANSITION MANAGER
// Handles switching, momentum lock, logging, dashboard emit
// ─────────────────────────────────────────────────────────────

class BrainTransitionManager {
    constructor() {
        this.currentBrain = 'DEFAULT';
        this.previousBrain = null;
        this.cycleCount = 0;
        this.brainStats = loadBrainStats();
        this.transitionLog = [];
    }

    // Called every scan cycle — returns active brain name
    evaluate(rawMarketSnapshot) {
        this.cycleCount++;
        const m = normalizeSnapshot(rawMarketSnapshot);
        const selected = selectBrain(m);
        const stats = this.brainStats[this.currentBrain];

        // Momentum lock: 3+ consecutive wins → stay 2 more cycles
        if (
            selected !== this.currentBrain &&
            stats.consecutiveWins >= 3 &&
            stats.lockedUntilCycle > this.cycleCount
        ) {
            console.log(`[🔒 BRAIN LOCK] ${this.currentBrain} momentum locked (${stats.consecutiveWins} wins) — override blocked`);
            return this.currentBrain;
        }

        if (selected !== this.currentBrain) {
            this._logTransition(selected, m);
        }

        return this.currentBrain;
    }

    _logTransition(newBrain, m) {
        this.previousBrain = this.currentBrain;
        this.currentBrain = newBrain;
        const entry = { ts: new Date().toISOString(), from: this.previousBrain, to: newBrain, reason: this._reason(m), cycle: this.cycleCount };
        this.transitionLog.push(entry);

        // Append to JSONL log
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.appendFileSync(BRAIN_LOG_PATH, JSON.stringify(entry) + '\n');

        console.log(`\n╔══════════════════════════════════════`);
        console.log(`║ 🧠 BRAIN SWAP: ${this.previousBrain} → ${newBrain}`);
        console.log(`║ Reason: ${entry.reason}`);
        console.log(`║ New minEdge: ${BRAINS[newBrain].thresholds.minEdge * 100}% | minConf: ${BRAINS[newBrain].thresholds.minConfidence}%`);
        console.log(`╚══════════════════════════════════════\n`);

        if (global.io) {
            global.io.emit('brainSwap', { from: this.previousBrain, to: newBrain, reason: entry.reason, ts: entry.ts });
        }
    }

    _reason(m) {
        if (m.newsScore >= 7) return `Black swan: newsScore=${m.newsScore}`;
        if (m.fearGreed <= 22) return `Extreme fear: F&G=${m.fearGreed}`;
        if (m.askVsBidRatio >= 2.5) return `Sell wall: ratio=${m.askVsBidRatio.toFixed(2)}`;
        if (m.bbWidth <= 0.004 && m.volRatio <= 0.65) return `Dead market: BB=${m.bbWidth.toFixed(4)}, vol=${m.volRatio.toFixed(2)}`;
        if (m.volRatio >= 1.8 && Math.abs(m.fundingRate) >= 0.0001) return `Momentum: vol=${m.volRatio.toFixed(2)}, funding=${m.fundingRate.toFixed(5)}`;
        if (m.bbWidth <= 0.005 && m.bbCompressionDuration >= 2) return `Breakout building: ${m.bbCompressionDuration} cycles`;
        if (m.volRatio >= 1.4 && m.hourUTC >= 13) return `Institutional hours: UTC=${m.hourUTC}`;
        if (m.fearGreed >= 68 && m.btcTrend1h === 'BULLISH') return `Bull market: F&G=${m.fearGreed}`;
        return 'Normal conditions';
    }

    recordResult({ brainName, won, predictedP, actualOutcome, edge }) {
        const s = this.brainStats[brainName];
        if (!s) return;
        s.trades++;
        s.lastUsed = new Date().toISOString();
        if (won) {
            s.wins++; s.consecutiveWins++; s.consecutiveLosses = 0;
            if (s.consecutiveWins >= 3) {
                s.lockedUntilCycle = this.cycleCount + 2;
                console.log(`[🔒 BRAIN LOCK] ${brainName} locked for 2 cycles (${s.consecutiveWins} consecutive wins)`);
            }
        } else {
            s.losses++; s.consecutiveLosses++; s.consecutiveWins = 0; s.lockedUntilCycle = 0;
        }
        s.winRate = s.wins / s.trades;
        if (predictedP != null && actualOutcome != null) {
            s.totalBrierError += Math.pow(predictedP - actualOutcome, 2);
            s.brierScore = s.totalBrierError / s.trades;
        }
        if (edge != null) {
            s.edgeHistory.push(edge);
            if (s.edgeHistory.length > 50) s.edgeHistory.shift();
            s.avgEdge = s.edgeHistory.reduce((a, b) => a + b, 0) / s.edgeHistory.length;
        }
        saveBrainStats(this.brainStats);
        console.log(`[BRAIN STATS] ${brainName}: ${s.wins}W/${s.trades}T (${(s.winRate * 100).toFixed(1)}% WR) | Brier: ${s.brierScore.toFixed(4)}`);
    }

    getDashboardPayload() {
        return {
            currentBrain: this.currentBrain,
            previousBrain: this.previousBrain,
            brainStats: this.brainStats,
            recentTransitions: this.transitionLog.slice(-10),
            ranking: Object.entries(this.brainStats)
                .map(([name, s]) => ({
                    name, avatar: BRAINS[name]?.avatar, trades: s.trades,
                    winRate: s.winRate, brierScore: s.brierScore,
                    consecutiveWins: s.consecutiveWins, isActive: name === this.currentBrain,
                    isLocked: s.lockedUntilCycle > this.cycleCount,
                    description: BRAINS[name]?.description,
                }))
                .sort((a, b) => b.winRate - a.winRate),
        };
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 9 — CLAUDE PROMPT BUILDER
// Injects brain system prompt + all Golden Round Table data
// ─────────────────────────────────────────────────────────────

function buildPrompt({ brainName, marketData, atlasData, appleSignal, snakeAnalysis, soulMd, childConsensus, marketQuestion }) {
    const brain = BRAINS[brainName];
    if (!brain) throw new Error(`Unknown brain: ${brainName}`);

    const systemPrompt = `${brain.systemPrompt}

━━━ SIGNAL WEIGHTS (${brainName} mode) ━━━
News: ${brain.weights.news}x | Momentum: ${brain.weights.momentum}x | Order Book: ${brain.weights.orderBook}x
Volume: ${brain.weights.volume}x | Funding: ${brain.weights.funding}x | Sentiment: ${brain.weights.sentiment}x

━━━ ACTIVE THRESHOLDS ━━━
Min Edge: ${(brain.thresholds.minEdge * 100).toFixed(1)}% | Min Confidence: ${brain.thresholds.minConfidence}%
Default Bias: ${brain.thresholds.defaultBias ?? 'NONE'}

━━━ SOUL.md LEARNED RULES ━━━
${soulMd ?? 'No rules yet.'}`;

    const userPrompt = `MARKET QUESTION: ${marketQuestion}

━━━ APPLE (Context & Narrative) ━━━
${JSON.stringify(appleSignal, null, 2)}

━━━ ATLAS (Hyperliquid Oracle) ━━━
${JSON.stringify(atlasData, null, 2)}

━━━ SNAKE (Order Book Microstructure) ━━━
${JSON.stringify(snakeAnalysis, null, 2)}

━━━ BINANCE TECHNICAL DATA ━━━
${JSON.stringify(marketData, null, 2)}

━━━ CHILDREN CONSENSUS ━━━
${childConsensus >= 0.75 ? `STRONG CONSENSUS: ${(childConsensus * 100).toFixed(0)}% agreement → +3% edge bonus` : `WEAK: ${(childConsensus * 100).toFixed(0)}%`}

Analyze as ${brainName}-ADAN. Apply brain-specific rules and signal weights.
Output: BET YES / BET NO / SKIP
Required fields: probability_estimate, market_price, edge_pct, confidence_pct, primary_reason, atlas_risk_note`;

    return { systemPrompt, userPrompt };
}

// ─────────────────────────────────────────────────────────────
// SECTION 10 — STAKE ADJUSTER
// Applies brain multiplier + Eva validation in sequence
// ─────────────────────────────────────────────────────────────

function computeFinalStake({ baseKellyStake, brainName, brainStats, cycleCount, fund, winRate, trades, volatility }) {
    const brain = BRAINS[brainName];
    const stats = brainStats[brainName];
    let multiplier = brain?.thresholds.maxStakeMultiplier ?? 1.0;

    // Momentum bonus
    if (stats?.consecutiveWins >= 3) multiplier = Math.min(multiplier * 1.1, 2.0);

    // Calibration penalty
    if (stats?.trades >= 10 && stats?.brierScore > 0.20) multiplier *= 0.8;

    const brainAdjustedStake = Math.round(baseKellyStake * multiplier);

    // EVA final gate
    const evaResult = EVA.validate({ brainName, proposedStake: brainAdjustedStake, fund, winRate, trades, brainStats, volatility });

    if (!evaResult.approved) {
        console.log(`[EVA] ❌ DENIED — ${evaResult.reasons.join(', ')}`);
        return { stake: 0, approved: false, mode: evaResult.mode, reasons: evaResult.reasons };
    }

    if (evaResult.reasons.length > 0) {
        console.log(`[EVA] ⚠️ MODIFIED — ${evaResult.reasons.join(', ')}`);
    }

    return { stake: evaResult.reducedStake, approved: true, mode: evaResult.mode, reasons: evaResult.reasons };
}

// ─────────────────────────────────────────────────────────────
// SECTION 11 — FULL CYCLE ORCHESTRATOR
// Drop-in replacement for the current scan cycle in adan-pred.js
// ─────────────────────────────────────────────────────────────

async function runBrainCycle({
    // Existing ADAN data (from your current adan-pred.js)
    binanceTechnicals,   // { klines1h, klines5m, vwap, fundingRate, volRatio, volAccel, bbWidth }
    binanceOrderBook,    // { bids, asks, midPrice }
    cryptoPanicItems,    // array from CryptoPanic API
    fearGreedIndex,      // number 0-100
    childConsensus,      // 0-1 ratio of children agreeing
    polymarketQuestion,  // string
    soulMd,              // string content of SOUL.md
    currentFund,         // number
    currentWinRate,      // 0-1
    totalTrades,         // number
    coins,               // e.g. ['BTC', 'ETH', 'SOL']
    brainManager,        // BrainTransitionManager instance
    anthropicClient,     // your existing Anthropic client
    onStatus,            // optional callback(status)
}) {

    // ── 1. Gather all Golden Round Table signals ───────────────
    console.log('[ADAN] 🍎 APPLE scanning narrative...');
    if (onStatus) onStatus('🍎 APPLE scanning narrative...');
    const appleSignal = await APPLE.getSignal(fearGreedIndex, cryptoPanicItems);

    console.log('[ADAN] 🐍 SNAKE analyzing order book...');
    if (onStatus) onStatus('🐍 SNAKE analyzing order book...');
    const snakeAnalysis = {
        microStructure: SNAKE.analyzeOrderBook(binanceOrderBook.bids, binanceOrderBook.asks, binanceOrderBook.midPrice),
        technicals: SNAKE.analyzeTechnicals(binanceTechnicals.klines1h, binanceTechnicals.klines5m, binanceTechnicals.vwap, binanceTechnicals.fundingRate),
    };

    console.log('[ADAN] 👁️ ATLAS querying Hyperliquid...');
    if (onStatus) onStatus('👁️ ATLAS querying Hyperliquid...');
    const atlasData = await ATLAS.getFullSnapshot(coins);

    // ── 1b. Track BB compression per coin (persistent state for PLASMA) ──
    const primaryBbWidth = snakeAnalysis.technicals.bbWidth ?? 0.01;
    const bbCompressionCycles = trackBBCompression(coins[0] ?? 'BTC', primaryBbWidth);
    snakeAnalysis.technicals.bbCompressionDuration = bbCompressionCycles;

    // ── 2. Build unified market snapshot ─────────────────────
    const primaryCoin = coins[0] ?? 'BTC';
    const atlasMain = atlasData[primaryCoin] ?? {};

    const marketSnapshot = {
        ...snakeAnalysis.microStructure,
        ...snakeAnalysis.technicals,
        newsScore: appleSignal.newsScore,
        fearGreed: appleSignal.fearGreed,
        fundingRate: binanceTechnicals.fundingRate ?? atlasMain.fundingRate ?? 0,
        atlasCascadeRisk: atlasMain.cascadeRisk ?? 'NORMAL',
        atlasOpenInterest: atlasMain.openInterest ?? 0,
        hourUTC: new Date().getUTCHours(),
    };

    // ── 3. Brain selection ────────────────────────────────────
    const activeBrain = brainManager.evaluate(marketSnapshot);
    console.log(`[ADAN] 🧠 Active brain: ${activeBrain} (${BRAINS[activeBrain].description})`);
    if (onStatus) onStatus(`🧠 Brain: ${activeBrain} selected`);

    // ── 4. Build Claude prompt ────────────────────────────────
    const { systemPrompt, userPrompt } = buildPrompt({
        brainName: activeBrain,
        marketData: binanceTechnicals,
        atlasData,
        appleSignal,
        snakeAnalysis,
        soulMd,
        childConsensus,
        marketQuestion: polymarketQuestion,
    });

    // ── 5. Call Hybrid Router ─────────────────────────────────
    console.log(`[ADAN] 🤔 ${activeBrain} thinking via Hybrid Router (Heavy)...`);
    const aiEngine = (process.env.ADAN_MODE || 'TRAINING') === 'TRAINING' ? 'Local Qwen3.5' : 'Sonnet 4.6';
    if (onStatus) onStatus(`🤔 ${activeBrain} thinking via ${aiEngine}...`);

    const thought = await routeLLM({
        weight: 'Heavy',
        systemPrompt: systemPrompt,
        userPrompt: userPrompt,
        anthropicClient: anthropicClient
    });

    console.log(`[ADAN] 💭 ${activeBrain}: ${thought.slice(0, 200)}...`);
    if (onStatus) onStatus(`💭 ${activeBrain} complete`);

    // ── 6. Parse decision ─────────────────────────────────────
    const decision = parseDecision(thought);
    if (decision.action === 'SKIP' || decision.action === 'WAITING') {
        console.log(`[ADAN] ⏭️ ${activeBrain} → SKIP`);
        return { action: 'SKIP', brain: activeBrain, thought };
    }

    // ── 7. Dual AI check (EVA decides if needed) ──────────────
    const needsDualAI = EVA.requiresDualAI({ brainName: activeBrain, confidence: decision.confidence, fund: currentFund, BRAINS });
    if (needsDualAI) {
        console.log(`[ADAN] 🤖 EVA requesting Light Model counter-opinion...`);
        const haikuText = await routeLLM({
            weight: 'Light',
            systemPrompt: 'You are EVA, an extreme risk manager.',
            userPrompt: `Counter-analyze this crypto bet. Be skeptical. Should ADAN take it?\n\nQuestion: ${polymarketQuestion}\nProposed: ${decision.action}\nReasoning: ${thought.slice(0, 500)}\n\nOutput: AGREE or DISAGREE with one reason.`,
            anthropicClient: anthropicClient
        });
        if (haikuText.includes('DISAGREE')) {
            console.log(`[ADAN] 🚫 Light Model (EVA) disagrees — bet cancelled`);
            return { action: 'SKIP', brain: activeBrain, thought, haikuVeto: true };
        }
    }

    // ── 8. Kelly + Brain stake + EVA gate ────────────────────
    const baseKelly = computeKelly({ winRate: currentWinRate, edge: decision.edge, fund: currentFund });
    const { stake, approved, mode, reasons } = computeFinalStake({
        baseKellyStake: baseKelly, brainName: activeBrain,
        brainStats: brainManager.brainStats, cycleCount: brainManager.cycleCount,
        fund: currentFund, winRate: currentWinRate, trades: totalTrades,
        volatility: snakeAnalysis.technicals.volRatio > 1.5 ? 0.002 : 0.001,
    });

    if (!approved) {
        console.log(`[ADAN] 👑 EVA DENIED bet — ${reasons.join(', ')}`);
        return { action: 'SKIP', brain: activeBrain, thought, evaDenied: true, reasons };
    }

    console.log(`[ADAN] ✅ ${activeBrain} → ${decision.action} | Stake: $${stake} | Mode: ${mode}`);

    return {
        action: decision.action,
        stake,
        brain: activeBrain,
        confidence: decision.confidence,
        edge: decision.edge,
        probability: decision.probability,
        thought,
        mode,
        atlasData,
        appleSignal,
    };
}

// ─────────────────────────────────────────────────────────────
// SECTION 12 — HELPERS
// ─────────────────────────────────────────────────────────────

function parseDecision(text) {
    // Safe parser — avoids "do NOT BET YES" false positives
    // Looks for the LAST explicit decision line in the output
    const lines = text.split('\n').map(l => l.trim().toUpperCase());
    let action = 'SKIP';

    for (const line of lines.reverse()) {
        // Must start with or contain the decision as a standalone phrase
        if (/^BET YES$|^\*\*BET YES\*\*$|DECISION:\s*BET YES|OUTPUT:\s*BET YES/.test(line)) {
            action = 'BET YES'; break;
        }
        if (/^BET NO$|^\*\*BET NO\*\*$|DECISION:\s*BET NO|OUTPUT:\s*BET NO/.test(line)) {
            action = 'BET NO'; break;
        }
        if (/^SKIP$|^\*\*SKIP\*\*$|DECISION:\s*SKIP|OUTPUT:\s*SKIP/.test(line)) {
            action = 'SKIP'; break;
        }
        if (/^WAITING$|^\*\*WAITING\*\*$/.test(line)) {
            action = 'WAITING'; break;
        }
    }

    // Fallback: if no structured line found, use safer regex
    // Only match if NOT preceded by NOT/NEVER/DON'T
    if (action === 'SKIP') {
        const safeYes = /(?<!not |never |don't )bet yes/i.test(text);
        const safeNo = /(?<!not |never |don't )bet no/i.test(text);
        if (safeYes && !safeNo) action = 'BET YES';
        else if (safeNo && !safeYes) action = 'BET NO';
    }

    const confMatch = text.match(/confidence[_\s]*(?:level)?[:\s]+([0-9]+)%?/i);
    const edgeMatch = text.match(/edge[_\s]*(?:pct|percent)?[:\s]+([0-9.]+)%?/i);
    const probMatch = text.match(/probability[_\s]*(?:estimate)?[:\s]+([0-9.]+)/i);

    return {
        action,
        confidence: confMatch ? Math.min(100, parseFloat(confMatch[1])) : 60,
        edge: edgeMatch ? parseFloat(edgeMatch[1]) / (parseFloat(edgeMatch[1]) > 1 ? 100 : 1) : 0.05,
        probability: probMatch ? parseFloat(probMatch[1]) : 0.5,
    };
}

function computeKelly({ winRate, edge, fund }) {
    if (winRate <= 0 || edge <= 0) return 0;
    // f* = (bp - q) / b  where b = odds, p = win rate, q = 1-p
    const b = 1 + edge;
    const p = winRate;
    const q = 1 - p;
    const kelly = (b * p - q) / b;
    const fractional = kelly * 0.25; // quarter Kelly for safety
    return Math.max(0, Math.round(fund * fractional));
}

// ─────────────────────────────────────────────────────────────
// SECTION 13 — EXPORTS
// ─────────────────────────────────────────────────────────────

export {
    // Core classes & functions
    BRAINS,
    BrainTransitionManager,
    ATLAS,
    APPLE,
    SNAKE,
    EVA,
    // Orchestration
    runBrainCycle,
    buildPrompt,
    computeFinalStake,
    selectBrain,
    normalizeSnapshot,
};
