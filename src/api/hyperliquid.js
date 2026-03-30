/**
 * ADAN — src/api/hyperliquid.js
 * -----------------------------------------------
 * Hyperliquid L1 connector for perpetual futures.
 * Phase 1: PAPER TRADING — reads real mainnet data, simulates execution.
 * Phase 2: Will add real execution via EIP-712 signing.
 *
 * Reuses ATLAS (already in adan-brain-complete.js) for /info reads.
 * This module adds: position simulation, bracket tracking, PnL resolution.
 *
 * Does NOT require the `hyperliquid` npm package.
 * Uses native HTTPS (same pattern as ATLAS) for maximum compatibility.
 */

'use strict';

import https from 'https';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';

const DIR = path.join(process.env.HOME, '.adan-pred');
const PERP_POSITIONS_PATH = path.join(DIR, 'positions_perp.json');
const PERP_PNL_PATH = path.join(DIR, 'pnl_perp.json');
const PERP_TRADES_LOG = path.join(DIR, 'perp_trades.jsonl');

// ─── Ensure directories exist ─────────────────────────────────────────────────
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

// ─── HTTP Helper (same pattern as ATLAS) ──────────────────────────────────────

const HL_BASE = 'api.hyperliquid.xyz';

function hlFetch(body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: HL_BASE,
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`HL parse error: ${raw.slice(0, 200)}`)); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('HL timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Data Persistence ─────────────────────────────────────────────────────────

function loadPerpPositions() {
  try {
    if (fs.existsSync(PERP_POSITIONS_PATH)) return JSON.parse(fs.readFileSync(PERP_POSITIONS_PATH, 'utf8'));
  } catch {}
  return { open: [], closed: [] };
}

function savePerpPositions(data) {
  fs.writeFileSync(PERP_POSITIONS_PATH, JSON.stringify(data, null, 2));
}

function loadPerpPnL() {
  try {
    if (fs.existsSync(PERP_PNL_PATH)) return JSON.parse(fs.readFileSync(PERP_PNL_PATH, 'utf8'));
  } catch {}
  return {
    trades: 0, wins: 0, losses: 0, net: 0,
    fund: 10000, // paper fund
    peakEquity: 10000,
    hourStats: {},
    totalFunding: 0,
    largestWin: 0, largestLoss: 0,
    children: [], generation: 1, exp: 0,
  };
}

function savePerpPnL(pnl) {
  fs.writeFileSync(PERP_PNL_PATH, JSON.stringify(pnl, null, 2));
}

function logPerpTrade(entry) {
  try {
    fs.appendFileSync(PERP_TRADES_LOG, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n');
  } catch {}
}

// ─── HyperliquidConnector ─────────────────────────────────────────────────────

class HyperliquidConnector extends EventEmitter {

  constructor() {
    super();
    this.markPrices = new Map();    // coin → latest mark price
    this.fundingRates = new Map();  // coin → funding rate
    this.assetMeta = new Map();     // coin → { maxLeverage, szDecimals }
    this.lastContext = null;        // cache of last getMarketContext()
    this.paperMode = true;          // Phase 1: always paper
    this._monitorInterval = null;
  }

  // ───────────────────────── Market Data (Real from Mainnet) ──────────────────

  /**
   * Fetch all perp metadata + asset contexts (funding, OI, mark, oracle).
   * This is the same call ATLAS.getAssetCtx() makes.
   */
  async getMarketContext() {
    const data = await hlFetch({ type: 'metaAndAssetCtxs' });
    const universe = data[0]?.universe || [];
    const ctxData = data[1] || [];

    const result = universe.map((asset, i) => {
      const ctx = ctxData[i] || {};
      this.markPrices.set(asset.name, parseFloat(ctx.markPx || 0));
      this.fundingRates.set(asset.name, parseFloat(ctx.funding || 0));
      this.assetMeta.set(asset.name, { maxLeverage: asset.maxLeverage, szDecimals: asset.szDecimals });
      return {
        coin: asset.name,
        maxLeverage: asset.maxLeverage,
        markPx: parseFloat(ctx.markPx || 0),
        oraclePx: parseFloat(ctx.oraclePx || 0),
        funding: parseFloat(ctx.funding || 0),
        openInterest: parseFloat(ctx.openInterest || 0),
        dayVolume: parseFloat(ctx.dayNtlVlm || 0),
        premium: parseFloat(ctx.premium || 0),
      };
    });

    this.lastContext = result;

    // Cache for web dashboard API
    try {
      const cachePath = path.join(DIR, 'hl_market_cache.json');
      fs.writeFileSync(cachePath, JSON.stringify({ ts: Date.now(), data: result }));
    } catch {}

    return result;
  }

  /**
   * L2 order book snapshot — used by SNAKE for bid/ask imbalance.
   */
  async getOrderBook(coin) {
    const book = await hlFetch({ type: 'l2Book', coin });
    const bids = (book.levels?.[0] || []).map(l => ({
      price: parseFloat(l.px), size: parseFloat(l.sz), n: l.n
    }));
    const asks = (book.levels?.[1] || []).map(l => ({
      price: parseFloat(l.px), size: parseFloat(l.sz), n: l.n
    }));
    return { bids, asks, timestamp: Date.now() };
  }

  /**
   * OHLCV candles from Hyperliquid.
   */
  async getCandles(coin, interval = '5m', startTime = Date.now() - 86_400_000) {
    const candles = await hlFetch({
      type: 'candleSnapshot',
      req: { coin, interval, startTime, endTime: Date.now() },
    });
    return (candles || []).map(c => ({
      ts: c.t,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
      trades: c.n,
    }));
  }

  /**
   * Funding rate history for a coin.
   */
  async getFundingHistory(coin, startTime = Date.now() - 7 * 86_400_000) {
    const history = await hlFetch({ type: 'fundingHistory', coin, startTime });
    return (history || []).map(h => ({
      coin: h.coin,
      time: h.time,
      funding: parseFloat(h.fundingRate),
      premium: parseFloat(h.premium),
    }));
  }

  /**
   * All mid prices (lightweight call).
   */
  async getAllMids() {
    const mids = await hlFetch({ type: 'allMids' });
    for (const [coin, px] of Object.entries(mids || {})) {
      this.markPrices.set(coin, parseFloat(px));
    }
    return mids;
  }

  /**
   * Predicted funding rates.
   */
  async getPredictedFunding() {
    return hlFetch({ type: 'predictedFundings' });
  }

  // ───────────────────────── Paper Execution ──────────────────────────────────

  /**
   * Open a PAPER position — simulates bracket order (entry + SL + TP).
   * All 22+ quant gates from evaluate_and_trade should pass before calling this.
   *
   * @param {Object} params
   * @param {string}  params.coin          'BTC' | 'ETH' | 'SOL'
   * @param {string}  params.direction     'LONG' | 'SHORT'
   * @param {number}  params.marginUSD     from Kelly sizing
   * @param {number}  params.leverage      1-20
   * @param {number}  params.stopLossPct   0.8-3.0
   * @param {number}  params.takeProfitPct
   * @param {string}  params.brain         which brain made the decision
   * @param {number}  params.confidence    0-100
   * @param {string}  params.regime        'TREND' | 'MEAN_REVERT'
   * @param {string}  params.reasoning     LLM reasoning
   */
  openPaperPosition({
    coin, direction, marginUSD, leverage, stopLossPct, takeProfitPct,
    brain, confidence, regime, reasoning,
  }) {
    const markPx = this.markPrices.get(coin);
    if (!markPx || markPx <= 0) {
      console.error(`[HL-PAPER] No mark price for ${coin}`);
      return null;
    }

    // Clamp leverage to asset max
    const meta = this.assetMeta.get(coin);
    const maxLev = meta?.maxLeverage || 20;
    const clampedLev = Math.min(leverage, maxLev);

    // Position size
    const notional = marginUSD * clampedLev;
    const size = notional / markPx;
    const isBuy = direction === 'LONG';

    // SL / TP prices
    const slPx = isBuy
      ? markPx * (1 - stopLossPct / 100)
      : markPx * (1 + stopLossPct / 100);
    const tpPx = isBuy
      ? markPx * (1 + takeProfitPct / 100)
      : markPx * (1 - takeProfitPct / 100);

    const position = {
      id: `perp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      coin,
      direction,
      side: direction,
      size: isBuy ? size : -size,
      entryPx: markPx,
      marginUSD,
      leverage: clampedLev,
      notional,
      stopLossPx: parseFloat(slPx.toFixed(2)),
      takeProfitPx: parseFloat(tpPx.toFixed(2)),
      stopLossPct,
      takeProfitPct,
      liquidationPx: isBuy
        ? markPx * (1 - 0.9 / clampedLev) // approximate liq price
        : markPx * (1 + 0.9 / clampedLev),
      brain,
      confidence,
      regime,
      reasoning,
      entryTime: new Date().toISOString(),
      unrealizedPnl: 0,
      fundingPaid: 0,
      status: 'OPEN',
      marginMode: 'isolated', // Always isolated — each position has independent margin/liq
    };

    // Save to positions file
    const positions = loadPerpPositions();
    positions.open.push(position);
    savePerpPositions(positions);

    // Log trade
    logPerpTrade({ type: 'OPEN', ...position });

    console.log(`[HL-PAPER] 📄 PAPER ${direction} ${size.toFixed(4)} ${coin} @ ${markPx.toFixed(2)} | ${clampedLev}x | SL: ${slPx.toFixed(2)} | TP: ${tpPx.toFixed(2)} | Margin: $${marginUSD.toFixed(0)}`);

    this.emit('paper_open', position);
    return position;
  }

  /**
   * Close a paper position (manual or by SL/TP hit).
   */
  closePaperPosition(positionId, reason, closePx = null) {
    const positions = loadPerpPositions();
    const idx = positions.open.findIndex(p => p.id === positionId);
    if (idx === -1) return null;

    const pos = positions.open[idx];
    const exitPx = closePx || this.markPrices.get(pos.coin) || pos.entryPx;

    // Calculate PnL
    const priceDelta = pos.direction === 'LONG'
      ? (exitPx - pos.entryPx) / pos.entryPx
      : (pos.entryPx - exitPx) / pos.entryPx;
    const pnl = priceDelta * pos.notional;

    // Move to closed
    pos.exitPx = exitPx;
    pos.exitTime = new Date().toISOString();
    pos.closedPnl = parseFloat(pnl.toFixed(2));
    pos.closeReason = reason;
    pos.won = pnl > 0;
    pos.status = 'CLOSED';

    positions.open.splice(idx, 1);
    positions.closed.push(pos);
    savePerpPositions(positions);

    // Update PnL tracker
    const perpPnl = loadPerpPnL();
    perpPnl.trades++;
    if (pnl > 0) {
      perpPnl.wins++;
      perpPnl.largestWin = Math.max(perpPnl.largestWin, pnl);
    } else {
      perpPnl.losses++;
      perpPnl.largestLoss = Math.min(perpPnl.largestLoss, pnl);
    }
    perpPnl.net += pnl;
    perpPnl.fund += pnl;
    perpPnl.peakEquity = Math.max(perpPnl.peakEquity, perpPnl.fund);

    // Hour stats
    const hour = new Date().getUTCHours().toString();
    if (!perpPnl.hourStats[hour]) perpPnl.hourStats[hour] = { wins: 0, losses: 0 };
    if (pnl > 0) perpPnl.hourStats[hour].wins++;
    else perpPnl.hourStats[hour].losses++;

    savePerpPnL(perpPnl);

    // Log
    logPerpTrade({ type: 'CLOSE', id: pos.id, coin: pos.coin, pnl, reason, exitPx });

    const pnlColor = pnl >= 0 ? '+' : '';
    console.log(`[HL-PAPER] 📄 CLOSED ${pos.coin} ${pos.direction} | PnL: ${pnlColor}$${pnl.toFixed(2)} | Reason: ${reason} | Exit: ${exitPx.toFixed(2)}`);

    this.emit('paper_close', { ...pos, closedPnl: pnl });
    return pos;
  }

  // ───────────────────────── Paper Position Monitor ───────────────────────────

  /**
   * Check all open paper positions against current mark prices.
   * Resolves SL/TP hits and accumulates funding.
   */
  async monitorPaperPositions() {
    // Refresh prices
    try {
      await this.getAllMids();
    } catch (e) {
      console.error('[HL-PAPER] Price refresh error:', e.message);
      return;
    }

    const positions = loadPerpPositions();
    const toClose = [];

    for (const pos of positions.open) {
      const markPx = this.markPrices.get(pos.coin);
      if (!markPx) continue;

      // Update unrealized PnL
      const priceDelta = pos.direction === 'LONG'
        ? (markPx - pos.entryPx) / pos.entryPx
        : (pos.entryPx - markPx) / pos.entryPx;
      pos.unrealizedPnl = parseFloat((priceDelta * pos.notional).toFixed(2));
      pos.currentPx = markPx;

      // Accumulate funding (approximate: 8h intervals)
      const fundingRate = this.fundingRates.get(pos.coin) || 0;
      const hoursSinceEntry = (Date.now() - new Date(pos.entryTime).getTime()) / 3_600_000;
      const fundingPeriods = Math.floor(hoursSinceEntry / 8);
      const estimatedFunding = fundingRate * pos.notional * fundingPeriods;
      pos.fundingPaid = parseFloat(estimatedFunding.toFixed(4));

      // ── Check SL hit ──
      if (pos.direction === 'LONG' && markPx <= pos.stopLossPx) {
        toClose.push({ id: pos.id, reason: 'STOP_LOSS', px: pos.stopLossPx });
      } else if (pos.direction === 'SHORT' && markPx >= pos.stopLossPx) {
        toClose.push({ id: pos.id, reason: 'STOP_LOSS', px: pos.stopLossPx });
      }

      // ── Check TP hit ──
      if (pos.direction === 'LONG' && markPx >= pos.takeProfitPx) {
        toClose.push({ id: pos.id, reason: 'TAKE_PROFIT', px: pos.takeProfitPx });
      } else if (pos.direction === 'SHORT' && markPx <= pos.takeProfitPx) {
        toClose.push({ id: pos.id, reason: 'TAKE_PROFIT', px: pos.takeProfitPx });
      }

      // ── Liquidation proximity warning ──
      const liqDist = Math.abs(markPx - (pos.liquidationPx || 0)) / markPx;
      if (liqDist < 0.05 && pos.liquidationPx) {
        console.warn(`[HL-PAPER] ⚠️ LIQUIDATION WARNING: ${pos.coin} ${(liqDist * 100).toFixed(2)}% from liq`);
        this.emit('liquidation_warning', { ...pos, liqDistPct: liqDist * 100 });
      }

      this.emit('position_update', pos);
    }

    // Save updated unrealized PnL
    savePerpPositions(positions);

    // Close positions that hit SL/TP
    for (const close of toClose) {
      this.closePaperPosition(close.id, close.reason, close.px);
    }
  }

  /**
   * Start the paper position monitor loop.
   */
  startMonitor(intervalMs = 30_000) {
    console.log(`[HL-PAPER] Position monitor started — checking every ${intervalMs / 1000}s`);
    this._monitorInterval = setInterval(() => {
      this.monitorPaperPositions().catch(e => console.error('[HL-PAPER] Monitor error:', e.message));
    }, intervalMs);

    // Also run immediately
    this.monitorPaperPositions().catch(e => console.error('[HL-PAPER] Initial monitor error:', e.message));
  }

  stopMonitor() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }

  // ───────────────────────── Utility ──────────────────────────────────────────

  getOpenPositions() {
    return loadPerpPositions().open;
  }

  getClosedPositions() {
    return loadPerpPositions().closed;
  }

  getPerpPnL() {
    return loadPerpPnL();
  }

  /** Get paper account state (mirrors real account structure) */
  getAccountState() {
    const pnl = loadPerpPnL();
    const positions = loadPerpPositions();
    const totalMargin = positions.open.reduce((s, p) => s + (p.marginUSD || 0), 0);
    const totalUnrealized = positions.open.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const totalNtl = positions.open.reduce((s, p) => s + Math.abs(p.notional || 0), 0);

    return {
      equity: pnl.fund + totalUnrealized,
      marginUsed: totalMargin,
      totalNtl,
      unrealizedPnl: totalUnrealized,
      availableMargin: pnl.fund - totalMargin,
      drawdown: pnl.peakEquity > 0 ? (pnl.peakEquity - pnl.fund) / pnl.peakEquity : 0,
    };
  }

  /** Get mark price for a coin */
  getMarkPrice(coin) {
    return this.markPrices.get(coin) || 0;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const hlConnector = new HyperliquidConnector();

export { hlConnector, loadPerpPositions, savePerpPositions, loadPerpPnL, savePerpPnL };
