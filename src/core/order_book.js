// src/core/order_book.js
// Feature 2: Order Book Intelligence via Polymarket Gamma API
// Reads bid/ask spread, depth, and execution cost

export class OrderBookIntel {
    analyze(marketData) {
        if (!marketData || !marketData.bestBid) {
            return {
                available: false,
                spread: 0,
                spreadPct: 0,
                executionCost: 0,
                depthRatio: 1,
                recommendation: 'NO_DATA'
            };
        }

        const bestBid = parseFloat(marketData.bestBid) || 0;
        const bestAsk = parseFloat(marketData.bestAsk) || 0;
        const liquidity = parseFloat(marketData.liquidity) || 0;
        const volume24h = parseFloat(marketData.volume24h) || 0;

        // Spread calculation
        const spread = bestAsk - bestBid;
        const midPrice = (bestBid + bestAsk) / 2;
        const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

        // Execution cost = half spread (you pay crossing the spread)
        const executionCost = spreadPct / 2;

        // Depth ratio: volume relative to liquidity
        // High vol/liq = lots of trading relative to depth = potential slippage
        const turnover = liquidity > 0 ? volume24h / liquidity : 0;
        const depthRatio = turnover;

        // Edge adjustment: reduce effective edge by execution cost
        const edgeAdjustment = executionCost / 100;

        // Recommendation
        let recommendation = 'PROCEED';
        let warning = '';
        if (spreadPct > 5) {
            recommendation = 'AVOID_WIDE_SPREAD';
            warning = `⚠️ Spread too wide: ${spreadPct.toFixed(1)}% — execution cost eats edge`;
        } else if (spreadPct > 3) {
            recommendation = 'REDUCE_SIZE';
            warning = `Spread elevated: ${spreadPct.toFixed(1)}% — reduce stake`;
        } else if (liquidity < 500) {
            recommendation = 'LOW_LIQUIDITY';
            warning = `⚠️ Low liquidity: $${liquidity} — large orders will move price`;
        }

        return {
            available: true,
            bestBid,
            bestAsk,
            spread: parseFloat(spread.toFixed(4)),
            spreadPct: parseFloat(spreadPct.toFixed(2)),
            executionCost: parseFloat(executionCost.toFixed(3)),
            edgeAdjustment: parseFloat(edgeAdjustment.toFixed(4)),
            liquidity: Math.round(liquidity),
            volume24h: Math.round(volume24h),
            turnover: parseFloat(turnover.toFixed(2)),
            recommendation,
            warning
        };
    }

    adjustEdge(rawEdge, orderBookAnalysis) {
        if (!orderBookAnalysis.available) return rawEdge;
        const adjusted = rawEdge - orderBookAnalysis.edgeAdjustment;
        return Math.max(0, adjusted);
    }

    getPromptContext(analysis) {
        if (!analysis.available) return '';
        return [
            `━━━ ORDER BOOK INTELLIGENCE ━━━`,
            `Bid: ${analysis.bestBid} | Ask: ${analysis.bestAsk} | Spread: ${analysis.spreadPct}%`,
            `Execution Cost: ${analysis.executionCost}% per side | Liquidity: $${analysis.liquidity}`,
            `Turnover: ${analysis.turnover}× | Recommendation: ${analysis.recommendation}`,
            analysis.warning || ''
        ].filter(Boolean).join('\n');
    }
}

export const orderBook = new OrderBookIntel();
