// src/core/smart_money.js
// Feature 1: Smart Money Tracking via Polymarket Gamma API
// Detects whale flow and volume anomalies as confirmation signals

import https from 'https';

const GAMMA_API = 'https://gamma-api.polymarket.com';

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

export class SmartMoneyTracker {
    constructor() {
        this.cache = new Map(); // slug -> { data, timestamp }
        this.CACHE_TTL = 60000; // 1 min cache
    }

    async getMarketData(slug) {
        // Check cache
        const cached = this.cache.get(slug);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }

        try {
            const markets = await httpGet(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}&limit=1`);
            if (markets && markets.length > 0) {
                const data = markets[0];
                this.cache.set(slug, { data, timestamp: Date.now() });
                return data;
            }
        } catch (e) { }
        return null;
    }

    async analyzeMarket(marketTitle, marketSlug) {
        const data = marketSlug ? await this.getMarketData(marketSlug) : null;

        if (!data) {
            return {
                available: false,
                flowDirection: 'UNKNOWN',
                volumeSpike: 0,
                liquiditySkew: 1,
                smartMoneyConfidence: 0,
                signal: 'NO_DATA'
            };
        }

        const volume24h = parseFloat(data.volume24hr) || 0;
        const volume1wk = parseFloat(data.volume1wk) || 0;
        const volume1mo = parseFloat(data.volume1mo) || 0;
        const liquidity = parseFloat(data.liquidityNum) || 1;
        const bestBid = parseFloat(data.bestBid) || 0.5;
        const bestAsk = parseFloat(data.bestAsk) || 0.5;
        const lastPrice = parseFloat(data.lastTradePrice) || 0.5;
        const oneDayChange = parseFloat(data.oneDayPriceChange) || 0;
        const oneHourChange = parseFloat(data.oneHourPriceChange) || 0;
        const spread = parseFloat(data.spread) || 0;

        // ── Volume Spike Detection ──
        const avgDailyVolume = volume1wk > 0 ? volume1wk / 7 : volume1mo / 30;
        const volumeSpike = avgDailyVolume > 0 ? volume24h / avgDailyVolume : 0;

        // ── Liquidity Analysis ──
        const midPrice = (bestBid + bestAsk) / 2;
        // If price > 0.5, money flowingYES. If < 0.5, flowing NO.
        const liquiditySkew = midPrice > 0 ? midPrice / 0.5 : 1;

        // ── Flow Direction ──
        let flowDirection = 'NEUTRAL';
        if (oneHourChange > 0.03) flowDirection = 'STRONG_YES_FLOW';
        else if (oneHourChange > 0.01) flowDirection = 'YES_FLOW';
        else if (oneHourChange < -0.03) flowDirection = 'STRONG_NO_FLOW';
        else if (oneHourChange < -0.01) flowDirection = 'NO_FLOW';

        // ── Smart Money Confidence ──
        // High volume + strong directional move = smart money
        let smConfidence = 0;
        if (volumeSpike > 3) smConfidence += 30; // 3× volume = unusual
        else if (volumeSpike > 2) smConfidence += 15;
        else if (volumeSpike > 1.5) smConfidence += 5;

        if (Math.abs(oneHourChange) > 0.05) smConfidence += 30; // 5%+ move in 1h
        else if (Math.abs(oneHourChange) > 0.02) smConfidence += 15;

        if (volume24h > 10000) smConfidence += 10; // Significant absolute volume
        if (liquidity > 5000) smConfidence += 10; // Deep liquidity = institutional

        smConfidence = Math.min(100, smConfidence);

        // ── Signal ──
        let signal = 'NEUTRAL';
        if (smConfidence >= 50) {
            signal = flowDirection.includes('YES') ? 'SMART_MONEY_YES' :
                flowDirection.includes('NO') ? 'SMART_MONEY_NO' : 'WHALE_ACTIVITY';
        } else if (volumeSpike > 2) {
            signal = 'VOLUME_ANOMALY';
        }

        // ── VPIN Kill Switch (Toxic Flow Detector) ──
        // If volume is > 4x average AND price moved > 4% in 1 hour, it's informed toxic flow
        const isVPINToxic = volumeSpike > 4.0 && Math.abs(oneHourChange) > 0.04;

        return {
            available: true,
            flowDirection,
            volumeSpike: parseFloat(volumeSpike.toFixed(2)),
            liquiditySkew: parseFloat(liquiditySkew.toFixed(3)),
            smartMoneyConfidence: smConfidence,
            isVPINToxic,
            signal,
            spread: parseFloat(spread.toFixed(4)),
            volume24h: Math.round(volume24h),
            liquidity: Math.round(liquidity),
            bestBid, bestAsk, lastPrice,
            oneDayChange, oneHourChange
        };
    }

    getPromptContext(analysis) {
        if (!analysis.available) return '';
        const parts = [
            `━━━ SMART MONEY INTELLIGENCE ━━━`,
            `Flow: ${analysis.flowDirection} | Signal: ${analysis.signal}`,
            `Volume Spike: ${analysis.volumeSpike}× average | 24h: $${analysis.volume24h.toLocaleString()}`,
            `Liquidity: $${analysis.liquidity.toLocaleString()} | Spread: ${(analysis.spread * 100).toFixed(2)}%`,
            `Smart Money Confidence: ${analysis.smartMoneyConfidence}%`,
            `Price: Bid ${analysis.bestBid} / Ask ${analysis.bestAsk} | 1h change: ${(analysis.oneHourChange * 100).toFixed(1)}%`,
        ];
        if (analysis.smartMoneyConfidence >= 50) {
            parts.push(`⚠️ HIGH SMART MONEY ACTIVITY DETECTED — validate your thesis against the flow`);
        }
        if (analysis.isVPINToxic) {
            parts.push(`🛑 VPIN TOXIC FLOW WARNING: Extreme volume+price action. Highly informed traders are positioning. CAUTION.`);
        }
    }

    async getWhaleConsensus(marketId) {
        if (!marketId) return { signal: 'NEUTRAL', weight: 0 };
        try {
            // Simulated whale tracking via activity endpoint
            // In a real implementation, we would fetch: https://gamma-api.polymarket.com/activity?market_id=...
            const activity = await httpGet(`${GAMMA_API}/activity?market_id=${marketId}&limit=50`);
            if (!activity || !Array.isArray(activity)) return { signal: 'NEUTRAL', weight: 0 };

            const whales = activity.filter(a => parseFloat(a.size) > 5000); // $5k+ is a whale on small markets
            if (whales.length === 0) return { signal: 'NEUTRAL', weight: 0 };

            let yesVol = 0, noVol = 0;
            whales.forEach(w => {
                if (w.side === 'BUY') {
                    if (w.outcome === 'YES') yesVol += parseFloat(w.size);
                    else noVol += parseFloat(w.size);
                }
            });

            const total = yesVol + noVol;
            if (total < 10000) return { signal: 'NEUTRAL', weight: 0 };

            const yesPct = yesVol / total;
            if (yesPct > 0.7) return { signal: 'BULLISH', weight: Math.min(100, (yesPct - 0.5) * 200) };
            if (yesPct < 0.3) return { signal: 'BEARISH', weight: Math.min(100, (0.5 - yesPct) * 200) };

            return { signal: 'MIXED', weight: 0 };
        } catch (e) {
            return { signal: 'NEUTRAL', weight: 0 };
        }
    }
}

export const smartMoney = new SmartMoneyTracker();
