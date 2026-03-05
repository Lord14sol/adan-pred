// src/core/oracle_front_run.js
// Oracle Front-Running Module — Detect CEX price moves before Polymarket reacts
// The 30-90 second lag between Binance and Polymarket is the edge
//
// How it works:
// 1. Track rolling 1-min candles from Binance (already fetched by fetchAllPrices)
// 2. Detect significant moves: >0.3% in 2 min, >0.5% in 3 min
// 3. Generate directional signal: "BTC dropped 0.6% in 2 min → bet NO on BTC Up/Down"
// 4. Assign confidence based on move magnitude, momentum, and volume confirmation
// 5. Signal decays after 90 seconds (the lag window)

export class OracleFrontRunner {
    constructor() {
        this.priceHistory = {}; // { BTCUSDT: [ { price, ts }, ... ] }
        this.lastSignals = {};  // { BTCUSDT: { direction, magnitude, ts, ... } }
        this.MAX_HISTORY = 30;  // Keep last 30 price snapshots
        this.stats = { signals: 0, totalMagnitude: 0 };
    }

    // Record a new price point from Binance (called every cycle)
    recordPrice(symbol, priceData) {
        if (!priceData || !priceData.price) return;

        if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
        this.priceHistory[symbol].push({
            price: priceData.price,
            ts: Date.now(),
            rsi: priceData.rsi || 50,
            vol: priceData.vol?.ratio || 1,
            trend1m: priceData.trend1m || 0,
            trend5m: priceData.trend5m || 0,
            obImbalance: priceData.obImbalance || 'BALANCED',
            closes: priceData.closes || []
        });

        // Cap history
        if (this.priceHistory[symbol].length > this.MAX_HISTORY) {
            this.priceHistory[symbol].shift();
        }
    }

    // Analyze recent Binance price action for a symbol
    analyze(symbol) {
        const history = this.priceHistory[symbol];
        if (!history || history.length < 2) {
            return { hasSignal: false, reason: 'INSUFFICIENT_DATA' };
        }

        const now = Date.now();
        const current = history[history.length - 1];

        // ── Short-term delta from 1-min klines (most accurate) ──
        const closes = current.closes || [];
        let delta2min = 0, delta3min = 0, delta5min = 0;

        if (closes.length >= 3) {
            const last = closes[closes.length - 1];
            const two_ago = closes[closes.length - 3]; // 2 candles ago = ~2 min
            delta2min = ((last - two_ago) / two_ago) * 100;
        }
        if (closes.length >= 4) {
            const last = closes[closes.length - 1];
            const three_ago = closes[closes.length - 4];
            delta3min = ((last - three_ago) / three_ago) * 100;
        }
        if (closes.length >= 6) {
            const last = closes[closes.length - 1];
            const five_ago = closes[closes.length - 6];
            delta5min = ((last - five_ago) / five_ago) * 100;
        }

        // ── Cross-snapshot delta (scan cycle to scan cycle) ──
        let cycleDelta = 0;
        if (history.length >= 2) {
            const prev = history[history.length - 2];
            cycleDelta = ((current.price - prev.price) / prev.price) * 100;
        }

        // ── Detect significant moves ──
        const absD2 = Math.abs(delta2min);
        const absD3 = Math.abs(delta3min);
        const absD5 = Math.abs(delta5min);
        const absCycle = Math.abs(cycleDelta);

        // Movement thresholds — tuned for crypto volatility
        const THRESHOLDS = {
            FLASH_MOVE: { min2: 0.50, min3: 0.70, confidence: 92 },  // Strong flash move
            STRONG_MOVE: { min2: 0.30, min3: 0.45, confidence: 82 },  // Clear direction
            MODERATE_MOVE: { min2: 0.20, min3: 0.30, confidence: 70 },  // Moderate signal
            WEAK_MOVE: { min2: 0.12, min3: 0.18, confidence: 58 },  // Marginal signal
        };

        let signalType = null;
        let baseConfidence = 0;

        if (absD2 >= THRESHOLDS.FLASH_MOVE.min2 || absD3 >= THRESHOLDS.FLASH_MOVE.min3) {
            signalType = 'FLASH_MOVE';
            baseConfidence = THRESHOLDS.FLASH_MOVE.confidence;
        } else if (absD2 >= THRESHOLDS.STRONG_MOVE.min2 || absD3 >= THRESHOLDS.STRONG_MOVE.min3) {
            signalType = 'STRONG_MOVE';
            baseConfidence = THRESHOLDS.STRONG_MOVE.confidence;
        } else if (absD2 >= THRESHOLDS.MODERATE_MOVE.min2 || absD3 >= THRESHOLDS.MODERATE_MOVE.min3) {
            signalType = 'MODERATE_MOVE';
            baseConfidence = THRESHOLDS.MODERATE_MOVE.confidence;
        } else if (absD2 >= THRESHOLDS.WEAK_MOVE.min2 || absD3 >= THRESHOLDS.WEAK_MOVE.min3) {
            signalType = 'WEAK_MOVE';
            baseConfidence = THRESHOLDS.WEAK_MOVE.confidence;
        }

        if (!signalType) {
            return {
                hasSignal: false,
                reason: 'NO_SIGNIFICANT_MOVE',
                delta2min: parseFloat(delta2min.toFixed(3)),
                delta3min: parseFloat(delta3min.toFixed(3)),
                delta5min: parseFloat(delta5min.toFixed(3)),
                cycleDelta: parseFloat(cycleDelta.toFixed(3)),
                price: current.price
            };
        }

        // ── Direction ──
        // The primary move determines the Polymarket bet
        const primaryDelta = absD2 > absD3 / 1.5 ? delta2min : delta3min;
        const direction = primaryDelta > 0 ? 'UP' : 'DOWN';
        const magnitude = Math.abs(primaryDelta);

        // ── Confidence adjustments ──
        let confidence = baseConfidence;

        // Momentum confirmation: 5min trend aligns
        if ((direction === 'UP' && current.trend5m > 0.1) ||
            (direction === 'DOWN' && current.trend5m < -0.1)) {
            confidence += 5; // Trend confirms
        } else if ((direction === 'UP' && current.trend5m < -0.1) ||
            (direction === 'DOWN' && current.trend5m > 0.1)) {
            confidence -= 8; // Counter-trend — more risky
        }

        // Volume confirmation
        if (current.vol > 1.5) confidence += 4; // High volume = real move
        if (current.vol < 0.5) confidence -= 5; // Low volume = possibly noise

        // RSI extreme = possible reversal (reduce confidence on continuation)
        if (direction === 'UP' && current.rsi > 75) confidence -= 6;
        if (direction === 'DOWN' && current.rsi < 25) confidence -= 6;

        // Order book confirmation
        if (direction === 'UP' && current.obImbalance === 'BUY_WALL') confidence += 3;
        if (direction === 'DOWN' && current.obImbalance === 'SELL_WALL') confidence += 3;
        if (direction === 'UP' && current.obImbalance === 'SELL_WALL') confidence -= 4;
        if (direction === 'DOWN' && current.obImbalance === 'BUY_WALL') confidence -= 4;

        confidence = Math.max(40, Math.min(98, confidence));

        // ── Signal lag window ──
        // Signal is most valuable in first 60 seconds, degrades after 90 seconds
        const signal = {
            hasSignal: true,
            signalType,
            direction,        // 'UP' or 'DOWN'
            polySide: direction === 'UP' ? 'YES' : 'NO', // Polymarket bet side
            magnitude: parseFloat(magnitude.toFixed(3)),
            confidence: Math.round(confidence),
            delta2min: parseFloat(delta2min.toFixed(3)),
            delta3min: parseFloat(delta3min.toFixed(3)),
            delta5min: parseFloat(delta5min.toFixed(3)),
            cycleDelta: parseFloat(cycleDelta.toFixed(3)),
            price: current.price,
            rsi: current.rsi,
            vol: current.vol,
            obImbalance: current.obImbalance,
            generatedAt: now,
            expiresAt: now + 90000, // 90 second validity window
            reason: `${signalType}: ${symbol.replace('USDT', '')} moved ${direction} ${magnitude.toFixed(2)}% in 2min`
        };

        // Cache signal
        this.lastSignals[symbol] = signal;
        this.stats.signals++;
        this.stats.totalMagnitude += magnitude;

        console.log(`[ORACLE] ⚡ ${signal.reason} | Conf: ${signal.confidence}% | RSI: ${current.rsi?.toFixed(0)} | Vol: ${current.vol?.toFixed(1)}x`);

        return signal;
    }

    // Check if a signal is still valid (within the lag window)
    isSignalValid(symbol) {
        const signal = this.lastSignals[symbol];
        if (!signal || !signal.hasSignal) return false;
        return Date.now() < signal.expiresAt;
    }

    // Get the recommended side for a specific Polymarket market
    getRecommendation(marketTitle, prices) {
        if (!marketTitle || !prices) return null;

        // Match market to asset
        const titleLow = marketTitle.toLowerCase();
        let symbol = null;
        if (titleLow.includes('bitcoin') || titleLow.includes('btc')) symbol = 'BTCUSDT';
        else if (titleLow.includes('ethereum') || titleLow.includes('eth')) symbol = 'ETHUSDT';
        else if (titleLow.includes('solana') || titleLow.includes('sol')) symbol = 'SOLUSDT';
        if (!symbol) return null;

        // Record latest price
        if (prices[symbol]) this.recordPrice(symbol, prices[symbol]);

        // Analyze
        const signal = this.analyze(symbol);
        if (!signal.hasSignal) return null;

        return {
            symbol,
            side: signal.polySide,
            direction: signal.direction,
            confidence: signal.confidence,
            magnitude: signal.magnitude,
            signalType: signal.signalType,
            reason: signal.reason,
            isValid: Date.now() < signal.expiresAt
        };
    }

    // Generate prompt context for LLM
    getPromptContext(prices) {
        const signals = [];
        for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
            if (prices[sym]) this.recordPrice(sym, prices[sym]);
            const analysis = this.analyze(sym);
            if (analysis.hasSignal) {
                signals.push(analysis);
            }
        }

        if (signals.length === 0) return '';

        const lines = ['━━━ ORACLE FRONT-RUN INTELLIGENCE ━━━'];
        for (const s of signals) {
            lines.push(`⚡ ${s.reason}`);
            lines.push(`  → Bet ${s.polySide} on ${s.direction === 'UP' ? 'Up' : 'Down'} market | Confidence: ${s.confidence}%`);
            lines.push(`  → 2min Δ: ${s.delta2min > 0 ? '+' : ''}${s.delta2min}% | 5min Δ: ${s.delta5min > 0 ? '+' : ''}${s.delta5min}%`);
            lines.push(`  → RSI: ${s.rsi?.toFixed(0)} | Vol: ${s.vol?.toFixed(1)}x | Book: ${s.obImbalance}`);
        }
        lines.push('⚠️ Signals expire after 90 seconds — act fast or ignore');
        return lines.join('\n');
    }

    // Stats for API/dashboard
    getStats() {
        const activeSignals = Object.entries(this.lastSignals)
            .filter(([_, s]) => s.hasSignal && Date.now() < s.expiresAt)
            .map(([sym, s]) => ({ symbol: sym, ...s }));

        return {
            totalSignalsGenerated: this.stats.signals,
            avgMagnitude: this.stats.signals > 0
                ? parseFloat((this.stats.totalMagnitude / this.stats.signals).toFixed(3))
                : 0,
            activeSignals,
            priceHistoryDepth: Object.fromEntries(
                Object.entries(this.priceHistory).map(([k, v]) => [k, v.length])
            )
        };
    }
}

export const oracle = new OracleFrontRunner();
