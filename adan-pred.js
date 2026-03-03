#!/usr/bin/env node
/**
 * ADAN-PRED v2 — Autonomous Prediction Markets Agent
 * Polymarket (crypto markets 5-15min) + Binance (price data) + Claude Sonnet 4.6
 * by Lord × 2026
 *
 * Data:   Polymarket  gamma-api.polymarket.com   (free, no auth)
 *         Binance     api.binance.com/api/v3      (free, no auth)
 * Brain:  Claude Sonnet 4.6  — technical analysis + probability estimation
 *
 * Flow:  Binance candles → trend/momentum → Polymarket markets → Claude edge calc → BET/SKIP
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { BrainTransitionManager, runBrainCycle, ATLAS, APPLE, SNAKE, EVA } from './adan-brain-complete.js';

const brainManager = new BrainTransitionManager();

// ── Anti-crash: ignore broken pipes + catch unhandled errors ─────────────────
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
process.on('uncaughtException', e => {
  try { fs.appendFileSync('/tmp/adan-crash.log', new Date().toISOString() + ' ' + e.stack + '\n'); } catch { }
});
process.on('unhandledRejection', e => {
  try { fs.appendFileSync('/tmp/adan-crash.log', new Date().toISOString() + ' REJECTION: ' + e + '\n'); } catch { }
});


import {
  HOME, DIR, CONFIG_PATH, PNL_PATH, POSITIONS_PATH, SOUL_PATH, THOUGHTS_PATH,
  STRATEGY_PATH, CALIB_PATH, INTEL_DIR, HYPOTHESIS_PATH, DYN_WEIGHTS_PATH,
  POLYMARKET_API, BINANCE_API, SCAN_INTERVAL_MS, MAX_POSITIONS, MIN_EDGE,
  PAPER_BET_SIZE, SYMBOLS, DEFAULT_STRATEGY, TREE_RULES,
  G, Y, R, B, C, M, W, D, X, BOLD,
  loadEnv, cls, ensureDir, loadConfig, saveConfig, loadStrategy,
  loadDynWeights, saveStrategy, loadPnL, savePnL, loadPositions, savePositions,
  loadCalibration, saveCalibration, updateCalibration, loadSoul, appendToSoul,
  expForLevel, levelFromExp, expProgress, levelTitle, getSkills, calcWinExp,
  awardExp
} from './src/core/config.js';

import {
  fetchBinancePrice, fetchBinanceKlines, calcTrend, calcVolatility, calcRSI,
  calcMACD, calcBollingerBands, calcVWAP, calcVolAccel, calcVolumeProfile,
  calcIntelScore, signalLabel
} from './src/api/binance.js';

import {
  polyFetch, fetchPolymarkets, applyParticleFilter, normalizePolymarket,
  expit, logit
} from './src/api/polymarket.js';

import {
  TOP, BOT, row, sep, trow, sparkline, renderTreePanel, startDashboard, render,
  _startThinkSpin, _stopThinkSpin, _dashboardState
} from './src/ui/dashboard.js';

import {
  nameChild, spawnChild, absorbEliteGenome, pruneDeadChildren,
  runTournamentOfDeath, evaluateParentPerformance, checkUsurperPath,
  promoteEliteGrandchild
} from './src/core/genetics.js';

// ── External Intelligence APIs ───────────────────────────────────────────────
async function fetchFearGreed() {
  // Alternative.me Fear & Greed Index — free, no auth
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=2');
    const d = await r.json();
    const cur = d?.data?.[0];
    const prev = d?.data?.[1];
    if (!cur) return null;
    return {
      value: parseInt(cur.value),
      label: cur.value_classification,
      prevValue: prev ? parseInt(prev.value) : null,
      direction: prev ? (parseInt(cur.value) - parseInt(prev.value)) : 0
    };
  } catch { return null; }
}

// ── Crypto News Feed — detect Black Swans before looking at candles ───────────
async function fetchCryptoNews() {
  // CryptoCompare — free, no auth, reliable
  try {
    const r = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,SOL&sortOrder=popular', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const posts = (d?.Data || []).slice(0, 5);
    if (!posts.length) return null;
    const bearWords = /crash|hack|ban|fraud|scam|dump|plunge|collapse|bankrupt|sec sue|arrest|exploit/i;
    const bullWords = /surge|rally|etf approv|record|breakout|adoption|bullish|soar|pump|ath|approve/i;
    return posts.map(p => ({
      title: p.title,
      source: p.source || '?',
      sentiment: bearWords.test(p.title) ? 'BEARISH' : bullWords.test(p.title) ? 'BULLISH' : 'NEUTRAL',
      ts: new Date((p.published_on || 0) * 1000).toISOString(),
      currencies: (p.categories || '').split('|').filter(c => /BTC|ETH|SOL|BNB/i.test(c)).join(',') || 'CRYPTO'
    }));
  } catch { return null; }
}

async function fetchFundingRates() {
  // Binance futures funding rates — tells if market is over-leveraged
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const result = {};
  await Promise.all(syms.map(async sym => {
    try {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=3`);
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) return;
      const latest = parseFloat(d[d.length - 1].fundingRate) * 100; // as percentage
      result[sym] = {
        rate: latest,
        label: latest > 0.05 ? 'LONGS PAYING (overbought)' : latest < -0.05 ? 'SHORTS PAYING (oversold)' : 'NEUTRAL',
        signal: latest > 0.1 ? 'bearish' : latest < -0.05 ? 'bullish' : 'neutral'
      };
    } catch { }
  }));
  return result;
}

async function fetchOrderBookWalls(symbol) {
  // Micro-structure analysis: detect walls within 0.5% of price
  try {
    const r = await fetch(`${BINANCE_API}/depth?symbol=${symbol}&limit=20`);
    const d = await r.json();
    if (!d?.bids || !d?.asks) return null;
    const bids = d.bids.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));
    const asks = d.asks.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }));
    const midPrice = (bids[0].price + asks[0].price) / 2;
    const range05 = midPrice * 0.005; // 0.5% range

    // Filter to walls within 0.5% of price
    const nearBids = bids.filter(b => midPrice - b.price <= range05);
    const nearAsks = asks.filter(a => a.price - midPrice <= range05);
    const bidVol = nearBids.reduce((s, b) => s + b.qty * b.price, 0);
    const askVol = nearAsks.reduce((s, a) => s + a.qty * a.price, 0);
    const totalVol = bidVol + askVol;

    // Biggest walls
    const topBid = bids.reduce((a, b) => b.qty > a.qty ? b : a, bids[0]);
    const topAsk = asks.reduce((a, b) => b.qty > a.qty ? b : a, asks[0]);

    // Sell wall trap detection: sell wall within 0.5% that is 2x+ the bid volume
    const sellWallTrap = askVol > bidVol * 2 && nearAsks.length > 0;
    const buyWallTrap = bidVol > askVol * 2 && nearBids.length > 0;
    // Distance of biggest wall from price
    const askWallDist = topAsk.price > 0 ? ((topAsk.price - midPrice) / midPrice * 100).toFixed(2) : '?';
    const bidWallDist = topBid.price > 0 ? ((midPrice - topBid.price) / midPrice * 100).toFixed(2) : '?';

    return {
      support: topBid.price,
      resistance: topAsk.price,
      bidWall: topBid.qty,
      askWall: topAsk.qty,
      buyPressure: totalVol > 0 ? Math.round(bidVol / totalVol * 100) : 50,
      spread: ((asks[0].price - bids[0].price) / bids[0].price * 100).toFixed(4),
      // New: micro-structure trap detection
      sellWallTrap,   // true = massive sell wall 2x bids within 0.5% → price bounces DOWN
      buyWallTrap,    // true = massive buy wall 2x asks within 0.5% → price bounces UP
      bidVolUSD: Math.round(bidVol),
      askVolUSD: Math.round(askVol),
      ratio: totalVol > 0 ? parseFloat((bidVol / askVol).toFixed(2)) : 1,
      askWallDist,  // % distance of biggest sell wall from price
      bidWallDist   // % distance of biggest buy wall from price
    };
  } catch { return null; }
}

async function fetchAllPrices() {
  // Fetch all in parallel for speed
  const [fearGreed, fundingRates, cryptoNews] = await Promise.all([
    fetchFearGreed(),
    fetchFundingRates(),
    fetchCryptoNews()
  ]);

  const result = { _meta: { fearGreed, fundingRates, cryptoNews } };

  await Promise.all(SYMBOLS.map(async sym => {
    const [klines1m, klines5m, klines15m, klines1h, orderBook] = await Promise.all([
      fetchBinanceKlines(sym, '1m', 30),
      fetchBinanceKlines(sym, '5m', 30),
      fetchBinanceKlines(sym, '15m', 20),
      fetchBinanceKlines(sym, '1h', 8),   // ← macro trend (8 hourly candles)
      fetchOrderBookWalls(sym)
    ]);
    if (!klines1m.length) return;
    const closes1m = klines1m.map(k => k.close);
    const closes5m = klines5m.map(k => k.close);
    const closes15m = klines15m.map(k => k.close);
    const closes1h = klines1h.map(k => k.close);
    const price = closes1m[closes1m.length - 1];
    const open24 = closes5m.length > 0 ? closes5m[0] : price;
    const macd = calcMACD(closes5m);
    const bb = calcBollingerBands(closes5m);
    const vol = calcVolumeProfile(klines1m);
    const vwap5m = calcVWAP(klines5m);
    const volAccel = calcVolAccel(klines5m);
    const funding = fundingRates[sym] || null;
    // Order book imbalance: bid/ask ratio > 1.3 = buy wall dominant
    const obImbalance = orderBook ? (orderBook.buyPressure > 60 ? 'BUY_WALL' : orderBook.buyPressure < 40 ? 'SELL_WALL' : 'BALANCED') : 'UNKNOWN';
    const d = {
      price,
      chg: ((price - open24) / open24) * 100,
      closes: closes1m,
      closes5m,
      closes15m,
      closes1h,
      trend1m: calcTrend(closes1m),
      trend5m: calcTrend(closes5m),
      trend15m: calcTrend(closes15m),
      trend1h: closes1h.length >= 2 ? calcTrend(closes1h) : 0,
      volatility: calcVolatility(closes1m),
      rsi: calcRSI(closes1m),
      rsi5m: calcRSI(closes5m),
      rsi1h: closes1h.length >= 14 ? calcRSI(closes1h) : null,
      macd,
      bb,
      vol,
      vwap5m,
      volAccel,
      orderBook,
      obImbalance,
      funding
    };
    d.intelScore = calcIntelScore(d);
    result[sym] = d;
  }));

  return result;
}

// ── Polymarket helpers ───────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ── CHILDREN SCANNER SYSTEM — lightweight, no Claude, feeds father's brain ──
// ══════════════════════════════════════════════════════════════════════════════

// Child specs: each specializes in one asset/timeframe
const CHILD_SPECS = [
  { id: 'btc-5min', asset: 'BTCUSDT', assetName: 'btc', windowMin: 5 },
  { id: 'eth-5min', asset: 'ETHUSDT', assetName: 'eth', windowMin: 5 },
  { id: 'sol-5min', asset: 'SOLUSDT', assetName: 'sol', windowMin: 5 },
  { id: 'bnb-5min', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 5 },
  { id: 'btc-15min', asset: 'BTCUSDT', assetName: 'btc', windowMin: 15 },
  { id: 'eth-15min', asset: 'ETHUSDT', assetName: 'eth', windowMin: 15 },
  { id: 'sol-15min', asset: 'SOLUSDT', assetName: 'sol', windowMin: 15 },
  { id: 'bnb-15min', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 15 },
  { id: 'btc-1hr', asset: 'BTCUSDT', assetName: 'btc', windowMin: 60 },
  { id: 'eth-1hr', asset: 'ETHUSDT', assetName: 'eth', windowMin: 60 },
  { id: 'sol-1hr', asset: 'SOLUSDT', assetName: 'sol', windowMin: 60 },
  { id: 'bnb-1hr', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 60 },
];

// Simple rule-based signal from Binance data (no Claude needed)
function childSignal(d) {
  if (!d) return { dir: 'NEUTRAL', conf: 40, reason: 'no data' };
  const bearish = [], bullish = [];
  if (d.rsi < 35) bullish.push('RSI oversold ' + d.rsi.toFixed(0));
  if (d.rsi > 65) bearish.push('RSI overbought ' + d.rsi.toFixed(0));
  if (d.macd?.hist < 0) bearish.push('MACD bearish');
  else if (d.macd?.hist > 0) bullish.push('MACD bullish');
  if (d.trend5m < -0.3) bearish.push('5m trend ' + d.trend5m.toFixed(2) + '%');
  if (d.trend5m > 0.3) bullish.push('5m trend +' + d.trend5m.toFixed(2) + '%');
  if (d.trend15m < -0.5) bearish.push('15m trend ' + d.trend15m?.toFixed(2) + '%');
  if (d.trend15m > 0.5) bullish.push('15m trend +' + d.trend15m?.toFixed(2) + '%');
  if (d.vol?.trend === 'falling') bearish.push('vol falling');
  if (d.vol?.spike) bullish.push('vol spike');
  const score = bullish.length - bearish.length;
  if (score <= -2) return { dir: 'DOWN', conf: Math.min(85, 55 + bearish.length * 8), reason: bearish.slice(0, 3).join(', ') };
  if (score >= 2) return { dir: 'UP', conf: Math.min(85, 55 + bullish.length * 8), reason: bullish.slice(0, 3).join(', ') };
  return { dir: 'NEUTRAL', conf: 40, reason: 'conflicted signals' };
}

// Run one child scanner — fetch data, find best market, write intel
async function runChildScanner(spec, allPrices, allMarkets) {
  try {
    if (!fs.existsSync(INTEL_DIR)) fs.mkdirSync(INTEL_DIR, { recursive: true });
    const priceKey = spec.asset;
    const d = allPrices[priceKey];
    const sig = childSignal(d);

    // Find relevant markets for this child
    const myMarkets = allMarkets.filter(m =>
      m.asset === spec.assetName &&
      m._isUpDown &&
      m.windowMin === spec.windowMin &&
      m.closesAt &&
      (new Date(m.closesAt) - Date.now()) > 2 * 60 * 1000  // >2min to close
    ).slice(0, 5);

    // Find best opportunity (market most misaligned with signal)
    let bestMarket = null, bestEdge = 0;
    for (const m of myMarkets) {
      // If signal says DOWN, betting NO. Edge = implied NO prob - 50%
      const impliedEdge = sig.dir === 'DOWN' ? (1 - m.yesPrice) - 0.5
        : sig.dir === 'UP' ? m.yesPrice - 0.5 : 0;
      if (impliedEdge > bestEdge) { bestEdge = impliedEdge; bestMarket = m; }
    }

    // Log insight if strong signal — bottom-up learning
    if (sig.dir !== 'NEUTRAL' && sig.conf >= 65) {
      logChildInsight(spec.id, spec.assetName, sig.reason, sig.dir, 1);
    }

    const intel = {
      spec: spec.id,
      asset: spec.assetName,
      windowMin: spec.windowMin,
      ts: new Date().toISOString(),
      price: d?.price,
      signal: sig,
      bestMarket: bestMarket ? {
        id: bestMarket.id,
        title: bestMarket.title,
        yesPrice: bestMarket.yesPrice,
        liquidity: bestMarket.liquidity,
        closesIn: Math.round((new Date(bestMarket.closesAt) - Date.now()) / 60000),
        suggestedSide: sig.dir === 'DOWN' ? 'NO' : 'YES',
        impliedEdge: parseFloat(bestEdge.toFixed(3))
      } : null,
      markets: myMarkets.length,
      intelScore: d?.intelScore || 50
    };

    // Rolling scoreHistory for death-by-incompetence detection
    const intelPath = path.join(INTEL_DIR, spec.id + '.json');
    let prevHistory = [];
    if (fs.existsSync(intelPath)) {
      try { prevHistory = JSON.parse(fs.readFileSync(intelPath, 'utf8')).scoreHistory || []; } catch { }
    }
    intel.scoreHistory = [...prevHistory, intel.intelScore].slice(-20);
    fs.writeFileSync(intelPath, JSON.stringify(intel, null, 2));
    return intel;
  } catch (e) { return null; }
}

// ── Award EXP to a child when father wins on the asset that child reported ────
function awardChildExp(asset, won) {
  const pnl = loadPnL();
  const children = pnl.children || [];
  let changed = false;
  for (const child of children) {
    // Child earns EXP if its asset matches and it reported a non-neutral signal
    const childAsset = child.spec.replace(/-\d+min$/, '').toLowerCase();
    if (childAsset !== asset.toLowerCase()) continue;
    const slug = child.spec.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const intelPath = path.join(INTEL_DIR, slug + '.json');
    try {
      if (!fs.existsSync(intelPath)) continue;
      const intel = JSON.parse(fs.readFileSync(intelPath, 'utf8'));
      const age = (Date.now() - new Date(intel.ts).getTime()) / 60000;
      if (age > 15) continue; // intel must be recent
      if (intel.signal?.dir === 'NEUTRAL') continue;
      // Check if signal was aligned with outcome
      const childDir = path.join(DIR, 'children', child.id || child.spec);
      const childPnlPath = path.join(childDir, 'pnl.json');
      if (!fs.existsSync(childPnlPath)) continue;
      const cp = JSON.parse(fs.readFileSync(childPnlPath, 'utf8'));
      const expGain = won ? 40 : 10; // more for correct signal
      cp.exp = (cp.exp || 0) + expGain;
      cp.signals = (cp.signals || 0) + 1;
      if (won) cp.correctSignals = (cp.correctSignals || 0) + 1;
      fs.writeFileSync(childPnlPath, JSON.stringify(cp, null, 2));
      changed = true;
    } catch { }
  }
  if (changed) savePnL(pnl);
}

// ── Grandchild specs: sub-specializations per parent spec ────────────────────
const GRANDCHILD_SPECS = {
  'BTC-5min': [
    { id: 'btc-1min-mom', asset: 'BTCUSDT', assetName: 'btc', windowMin: 5, focus: '1min-momentum' },
    { id: 'btc-5min-vol', asset: 'BTCUSDT', assetName: 'btc', windowMin: 5, focus: 'volume-spike' },
  ],
  'ETH-5min': [
    { id: 'eth-1min-mom', asset: 'ETHUSDT', assetName: 'eth', windowMin: 5, focus: '1min-momentum' },
    { id: 'eth-5min-rsi', asset: 'ETHUSDT', assetName: 'eth', windowMin: 5, focus: 'rsi-extreme' },
  ],
  'SOL-5min': [
    { id: 'sol-1min-mom', asset: 'SOLUSDT', assetName: 'sol', windowMin: 5, focus: '1min-momentum' },
    { id: 'sol-orderbook', asset: 'SOLUSDT', assetName: 'sol', windowMin: 5, focus: 'orderbook' },
  ],
  'BNB-5min': [
    { id: 'bnb-5min-mom', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 5, focus: '1min-momentum' },
    { id: 'bnb-5min-vol', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 5, focus: 'volume-spike' },
  ],
  'BTC-15min': [
    { id: 'btc-15min-bb', asset: 'BTCUSDT', assetName: 'btc', windowMin: 15, focus: 'bollinger' },
    { id: 'btc-15min-macd', asset: 'BTCUSDT', assetName: 'btc', windowMin: 15, focus: 'macd-cross' },
  ],
  'ETH-15min': [
    { id: 'eth-15min-bb', asset: 'ETHUSDT', assetName: 'eth', windowMin: 15, focus: 'bollinger' },
    { id: 'eth-15min-vol', asset: 'ETHUSDT', assetName: 'eth', windowMin: 15, focus: 'volume-profile' },
  ],
  'SOL-15min': [
    { id: 'sol-15min-bb', asset: 'SOLUSDT', assetName: 'sol', windowMin: 15, focus: 'bollinger' },
    { id: 'sol-15min-macd', asset: 'SOLUSDT', assetName: 'sol', windowMin: 15, focus: 'macd-cross' },
  ],
  'BNB-15min': [
    { id: 'bnb-15min-bb', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 15, focus: 'bollinger' },
    { id: 'bnb-15min-rsi', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 15, focus: 'rsi-extreme' },
  ],
  'BTC-1hr': [
    { id: 'btc-1hr-trend', asset: 'BTCUSDT', assetName: 'btc', windowMin: 60, focus: 'trend-follow' },
    { id: 'btc-1hr-rev', asset: 'BTCUSDT', assetName: 'btc', windowMin: 60, focus: 'mean-reversion' },
  ],
  'ETH-1hr': [
    { id: 'eth-1hr-trend', asset: 'ETHUSDT', assetName: 'eth', windowMin: 60, focus: 'trend-follow' },
    { id: 'eth-1hr-bb', asset: 'ETHUSDT', assetName: 'eth', windowMin: 60, focus: 'bollinger' },
  ],
  'SOL-1hr': [
    { id: 'sol-1hr-trend', asset: 'SOLUSDT', assetName: 'sol', windowMin: 60, focus: 'trend-follow' },
    { id: 'sol-1hr-vol', asset: 'SOLUSDT', assetName: 'sol', windowMin: 60, focus: 'volume-spike' },
  ],
  'BNB-1hr': [
    { id: 'bnb-1hr-trend', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 60, focus: 'trend-follow' },
    { id: 'bnb-1hr-rsi', asset: 'BNBUSDT', assetName: 'bnb', windowMin: 60, focus: 'rsi-extreme' },
  ],
};

// Grandchild signal — same rule-based but focuses on one indicator
function grandchildSignal(d, focus) {
  if (!d) return { dir: 'NEUTRAL', conf: 40, reason: 'no data' };
  if (focus === '1min-momentum') {
    if (d.trend1m < -0.2) return { dir: 'DOWN', conf: 65, reason: '1m bearish ' + d.trend1m.toFixed(2) + '%' };
    if (d.trend1m > 0.2) return { dir: 'UP', conf: 65, reason: '1m bullish +' + d.trend1m.toFixed(2) + '%' };
    return { dir: 'NEUTRAL', conf: 40, reason: '1m flat' };
  }
  if (focus === 'volume-spike') {
    if (d.vol?.spike && d.trend5m < 0) return { dir: 'DOWN', conf: 70, reason: 'vol spike bearish' };
    if (d.vol?.spike && d.trend5m > 0) return { dir: 'UP', conf: 70, reason: 'vol spike bullish' };
    return { dir: 'NEUTRAL', conf: 40, reason: 'no vol spike' };
  }
  if (focus === 'rsi-extreme') {
    if (d.rsi < 30) return { dir: 'UP', conf: 72, reason: 'RSI oversold ' + d.rsi.toFixed(0) };
    if (d.rsi > 70) return { dir: 'DOWN', conf: 72, reason: 'RSI overbought ' + d.rsi.toFixed(0) };
    return { dir: 'NEUTRAL', conf: 40, reason: 'RSI mid ' + d.rsi.toFixed(0) };
  }
  if (focus === 'bollinger') {
    if ((d.bb?.pct || 50) < 15) return { dir: 'UP', conf: 68, reason: 'BB lower band touch' };
    if ((d.bb?.pct || 50) > 85) return { dir: 'DOWN', conf: 68, reason: 'BB upper band touch' };
    return { dir: 'NEUTRAL', conf: 40, reason: 'BB mid ' + ((d.bb?.pct || 50).toFixed(0)) + '%' };
  }
  if (focus === 'macd-cross') {
    const hist = d.macd?.hist || 0;
    if (hist < -0.005) return { dir: 'DOWN', conf: 66, reason: 'MACD bearish cross' };
    if (hist > 0.005) return { dir: 'UP', conf: 66, reason: 'MACD bullish cross' };
    return { dir: 'NEUTRAL', conf: 40, reason: 'MACD neutral' };
  }
  if (focus === 'orderbook') {
    const ob = d.orderBook;
    if (!ob) return { dir: 'NEUTRAL', conf: 40, reason: 'no orderbook' };
    if (ob.buyPressure > 65) return { dir: 'UP', conf: 68, reason: 'buy pressure ' + ob.buyPressure + '%' };
    if (ob.buyPressure < 35) return { dir: 'DOWN', conf: 68, reason: 'sell pressure ' + (100 - ob.buyPressure) + '%' };
    return { dir: 'NEUTRAL', conf: 40, reason: 'balanced book' };
  }
  if (focus === 'volume-profile') {
    if (d.vol?.trend === 'rising' && d.trend15m > 0) return { dir: 'UP', conf: 67, reason: 'vol+trend rising' };
    if (d.vol?.trend === 'rising' && d.trend15m < 0) return { dir: 'DOWN', conf: 67, reason: 'vol rising, price down' };
    return { dir: 'NEUTRAL', conf: 40, reason: 'vol flat' };
  }
  return childSignal(d);
}

// ── Spawn grandchildren when ADAN is LVL 4+ and child has enough EXP ─────────
async function spawnGrandchildren(client) {
  const pnl = loadPnL();
  const xpData = expProgress(pnl.exp || 0);
  if (xpData.level < 4) return; // nietos solo desde LVL 4 de ADAN

  const children = pnl.children || [];
  for (const child of children) {
    const childDir = path.join(DIR, 'children', child.id || child.spec);
    const childPnlPath = path.join(childDir, 'pnl.json');
    if (!fs.existsSync(childPnlPath)) continue;

    let cp;
    try { cp = JSON.parse(fs.readFileSync(childPnlPath, 'utf8')); } catch { continue; }

    const childExp = cp.exp || 0;
    const gcList = cp.children || [];
    const gcSpecs = GRANDCHILD_SPECS[child.spec] || [];
    const maxGC = TREE_RULES.maxChildrenGen2;

    // Child needs enough EXP and can still grow
    if (childExp < TREE_RULES.childExpToSpawn) continue;
    if (gcList.length >= maxGC) continue;

    const takenSpecs = gcList.map(g => g.spec);
    const nextGcSpec = gcSpecs.find(s => !takenSpecs.includes(s.id));
    if (!nextGcSpec) continue;

    // Name the grandchild
    let gcName = nextGcSpec.id.toUpperCase().replace(/-/g, '_');
    try {
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 15,
        messages: [{ role: 'user', content: `Name a micro-scanner AI: focus=${nextGcSpec.focus}, asset=${nextGcSpec.assetName}. One short mythological name in CAPS only.` }]
      });
      gcName = resp.content[0].text.trim().replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 10) || gcName;
    } catch { }

    const gcId = Date.now().toString();
    const gcDir = path.join(childDir, 'children', nextGcSpec.id);
    if (!fs.existsSync(gcDir)) fs.mkdirSync(gcDir, { recursive: true });

    // ── CROSSOVER DE LINAJES CAMPEONES ─────────────────────────────────────
    // Find the 2 best-performing children (by intel score) and crossover their DNA
    const allChildDNA = children.map(ch => {
      try {
        const chDir = path.join(DIR, 'children', ch.id || ch.spec);
        const chPnl = JSON.parse(fs.readFileSync(path.join(chDir, 'pnl.json'), 'utf8'));
        return { name: ch.name, dna: chPnl.dna || {}, scores: (chPnl.scoreHistory || []) };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => {
      const avgA = a.scores.length ? a.scores.reduce((s, v) => s + v, 0) / a.scores.length : 50;
      const avgB = b.scores.length ? b.scores.reduce((s, v) => s + v, 0) / b.scores.length : 50;
      return avgB - avgA;
    });
    const parentA = allChildDNA[0]?.dna || cp.dna || {};
    const parentB = allChildDNA[1]?.dna || {};
    // Weighted crossover: 70% from best parent, 30% from second + mutation
    const crossover = (a, b, mut = 0.05) => {
      const base = (a || 1) * 0.7 + (b || a || 1) * 0.3;
      return parseFloat((base * (1 + (Math.random() * 2 - 1) * mut)).toFixed(4));
    };
    const gcDNA = {
      minEdge: crossover(parentA.minEdge, parentB.minEdge, 0.08),
      volWeight: crossover(parentA.volWeight, parentB.volWeight, 0.06),
      vwapWeight: crossover(parentA.vwapWeight, parentB.vwapWeight, 0.06),
      stakePct: crossover(parentA.stakePct || 0.08, parentB.stakePct || 0.08, 0.10),
      patience: crossover(parentA.patience || 1.0, parentB.patience || 1.0, 0.08),
      cognitiveStyle: parentA.cognitiveStyle || 'volume_vwap',
      mutation: Math.round(Math.random() * 100),
      crossoverFrom: [allChildDNA[0]?.name || '?', allChildDNA[1]?.name || '?'],
      isElite: true
    };

    // Destilación de traumas: read last 5 mistakes from parent SOUL.md
    let traumaRules = '';
    try {
      const parentSoulPath = path.join(childDir, 'SOUL.md');
      if (fs.existsSync(parentSoulPath)) {
        const psoul = fs.readFileSync(parentSoulPath, 'utf8');
        const mistakes = psoul.split('\n').filter(l => l.includes('MISTAKE') || l.includes('LOSS')).slice(-5);
        if (mistakes.length) traumaRules = '\n## Trauma Rules (inherited from parent mistakes):\n' + mistakes.join('\n') + '\n';
      }
      const rootSoulContent = loadSoul();
      const rootMistakes = rootSoulContent.split('\n').filter(l => l.includes('MISTAKE') || l.includes('DREAM_RULE')).slice(-5);
      if (rootMistakes.length) traumaRules += '\n## ROOT Trauma Rules (from ADAN):\n' + rootMistakes.join('\n') + '\n';
    } catch { }

    const gcSoul = `# ${gcName} — ELITE GRANDCHILD (CROSSOVER)
Created: ${new Date().toISOString().slice(0, 10)}
Name: ${gcName} | Spec: ${nextGcSpec.id} | Focus: ${nextGcSpec.focus}
Parent: ${child.name || child.spec}
Crossover: ${gcDNA.crossoverFrom.join(' × ')} (70/30 weighted)

## Identity
I am ${gcName}. Elite grandchild of ADAN. Born from crossover of the 2 strongest lineages.
I specialize in ${nextGcSpec.focus} signals for ${nextGcSpec.assetName.toUpperCase()} ${nextGcSpec.windowMin}min markets.
I never bet. I scan one indicator with precision and report up.

## DNA Manifest
This genome combines ${gcDNA.crossoverFrom[0]}'s strength with ${gcDNA.crossoverFrom[1]}'s adaptability.
volWeight: ${gcDNA.volWeight} | vwapWeight: ${gcDNA.vwapWeight} | stakePct: ${(gcDNA.stakePct * 100).toFixed(1)}%
${traumaRules}
## Rules
1. Focus: ${nextGcSpec.focus} only
2. Report signal to parent ${child.name || child.spec}
3. Parent reports to ADAN — chain of intelligence
`;
    fs.writeFileSync(path.join(gcDir, 'SOUL.md'), gcSoul);
    fs.writeFileSync(path.join(gcDir, 'pnl.json'), JSON.stringify({
      trades: 0, wins: 0, losses: 0, net: 0, exp: 0,
      fund: 0, treasury: 0, children: [], generation: 3,
      parentId: child.id, spec: nextGcSpec.id, name: gcName, focus: nextGcSpec.focus,
      dna: gcDNA
    }, null, 2));

    const gc = {
      id: gcId, name: gcName, spec: nextGcSpec.id, focus: nextGcSpec.focus,
      born: new Date().toISOString(), dir: gcDir, generation: 3, dna: gcDNA, isElite: true
    };
    cp.children = [...gcList, gc];
    fs.writeFileSync(childPnlPath, JSON.stringify(cp, null, 2));

    console.log('\n' + B + BOLD + '  🌱 GRANDCHILD BORN: ' + gcName + ' (' + nextGcSpec.id + ') → focus: ' + nextGcSpec.focus + ' | parent: ' + (child.name || child.spec) + X + '\n');
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ── APPLE: El Oráculo del Contexto — "¿QUÉ y POR QUÉ?" ──────────────────
function runAppleScanner(allPrices, allMarkets) {
  const meta = allPrices._meta || {};
  const fg = meta.fearGreed;
  const news = meta.cryptoNews || [];

  // Analyze narratives from market titles
  const narrativeKeywords = { ai: 0, etf: 0, regulation: 0, hack: 0, election: 0, fed: 0, defi: 0, memecoin: 0 };
  const titleCorpus = allMarkets.map(m => (m.title || '').toLowerCase()).join(' ');
  for (const kw of Object.keys(narrativeKeywords)) {
    narrativeKeywords[kw] = (titleCorpus.match(new RegExp(kw, 'gi')) || []).length;
  }
  const topNarrative = Object.entries(narrativeKeywords).sort((a, b) => b[1] - a[1])[0];
  const narrativeStr = topNarrative[1] > 0 ? topNarrative[0].toUpperCase() : 'MIXED';

  // Sentiment from news
  let bullish = 0, bearish = 0, neutral = 0;
  for (const n of news) {
    if (n.sentiment === 'BULLISH') bullish++;
    else if (n.sentiment === 'BEARISH') bearish++;
    else neutral++;
  }
  const totalNews = bullish + bearish + neutral;
  const sentimentScore = totalNews > 0 ? Math.round(((bullish - bearish) / totalNews + 1) * 50) : 50;

  // Fear & Greed influence
  const fgValue = fg?.value ?? 50;
  const fgBias = fgValue < 25 ? 'EXTREME_FEAR' : fgValue < 40 ? 'FEAR' : fgValue > 75 ? 'EXTREME_GREED' : fgValue > 60 ? 'GREED' : 'NEUTRAL';

  // Confidence = combination of news volume + F&G extremeness
  const fgConfidence = Math.abs(fgValue - 50) * 1.2;
  const newsConfidence = Math.min(30, totalNews * 5);
  const confidence = Math.min(100, Math.round(40 + fgConfidence + newsConfidence));

  // Recommend markets with highest liquidity that align with narrative
  const recommendedMarkets = allMarkets
    .filter(m => m.liquidity >= 500)
    .sort((a, b) => b.liquidity - a.liquidity)
    .slice(0, 5)
    .map(m => ({ id: m.id, title: (m.title || '').slice(0, 60), liquidity: m.liquidity, yesPrice: m.yesPrice }));

  // Determine opportunity
  let opportunity = 'NEUTRAL';
  if (fgValue < 25 && bearish > bullish) opportunity = 'CONTRARIAN_LONG';
  else if (fgValue < 25 && bullish > bearish) opportunity = 'FEAR_RECOVERY';
  else if (fgValue > 75 && bullish > bearish) opportunity = 'MOMENTUM_RISK';
  else if (fgValue > 75 && bearish > bullish) opportunity = 'GREED_REVERSAL';
  else if (bullish > bearish * 2) opportunity = 'STRONG_BULL';
  else if (bearish > bullish * 2) opportunity = 'STRONG_BEAR';

  return {
    opportunity,
    narrative: narrativeStr,
    confidence,
    sentimentScore,
    fgBias,
    fgValue,
    newsCount: totalNews,
    newsSummary: news.slice(0, 3).map(n => `[${n.sentiment}] ${(n.title || '').slice(0, 50)}`),
    recommendedMarkets
  };
}

// ── SNAKE: El Verdugo de la Ejecución — "¿CÓMO y CUÁNDO?" ────────────────
function runSnakeScanner(allPrices, appleRecommendedMarkets) {
  const btc = allPrices['BTCUSDT'];
  const eth = allPrices['ETHUSDT'];
  const sol = allPrices['SOLUSDT'];

  // Analyze overall market liquidity and volatility
  const priceEntries = Object.entries(allPrices).filter(([k]) => k !== '_meta' && allPrices[k]);
  let totalVolRatio = 0, volCount = 0, avgVolatility = 0;
  for (const [, d] of priceEntries) {
    if (d?.vol?.ratio) { totalVolRatio += d.vol.ratio; volCount++; }
    if (d?.volatility) avgVolatility += d.volatility;
  }
  avgVolatility = volCount > 0 ? avgVolatility / volCount : 0;
  const avgVolRatio = volCount > 0 ? totalVolRatio / volCount : 1;

  // Slippage risk based on order book data
  const obData = btc?.orderBook;
  let slippageRisk = 'med';
  if (obData) {
    const totalDepth = (obData.bidVolUSD || 0) + (obData.askVolUSD || 0);
    if (totalDepth > 500000) slippageRisk = 'low';
    else if (totalDepth < 100000) slippageRisk = 'high';
  }

  // Optimal timing based on volume acceleration and trend alignment
  const btcAccel = btc?.volAccel || 0;
  const btcTrend5m = btc?.trend5m || 0;
  const btcTrend1h = btc?.trend1h || 0;
  const trendAligned = (btcTrend5m > 0 && btcTrend1h > 0) || (btcTrend5m < 0 && btcTrend1h < 0);

  let optimalTiming = 'WAIT';
  let viability = 'LOW';
  if (avgVolRatio > 1.3 && trendAligned && btcAccel >= 1) {
    optimalTiming = 'NOW — high volume + trend aligned + accelerating';
    viability = 'HIGH';
  } else if (avgVolRatio > 1.0 && trendAligned) {
    optimalTiming = 'SOON — trends aligned but volume moderate';
    viability = 'MEDIUM';
  } else if (avgVolRatio > 1.3 && !trendAligned) {
    optimalTiming = 'CAUTION — volume present but trends diverge';
    viability = 'MEDIUM';
  } else if (avgVolRatio < 0.8) {
    optimalTiming = 'WAIT — market dormant, no volume conviction';
    viability = 'LOW';
  } else {
    optimalTiming = 'MONITOR — no clear signal';
    viability = 'LOW';
  }

  // Execution plan
  const executionPlan = viability === 'HIGH'
    ? `Execute on recommended markets. Vol ratio ${avgVolRatio.toFixed(1)}x, BTC trend aligned (5m:${btcTrend5m.toFixed(2)}% 1h:${btcTrend1h.toFixed(2)}%). Slippage: ${slippageRisk}.`
    : viability === 'MEDIUM'
      ? `Partial execution possible. Vol ratio ${avgVolRatio.toFixed(1)}x. Wait for confirmation or reduce position size.`
      : `Hold position. Market conditions unfavorable. Vol ratio ${avgVolRatio.toFixed(1)}x avg volatility ${(avgVolatility * 100).toFixed(3)}%.`;

  return {
    viability,
    executionPlan,
    slippageRisk,
    optimalTiming,
    avgVolRatio: parseFloat(avgVolRatio.toFixed(2)),
    avgVolatility: parseFloat(avgVolatility.toFixed(6)),
    btcTrend: { m5: btcTrend5m, h1: btcTrend1h, aligned: trendAligned },
    volAccel: btcAccel,
    marketDepth: obData ? { bidUSD: obData.bidVolUSD, askUSD: obData.askVolUSD } : null
  };
}

// ── EVA: La Reina del Riesgo — "¿PODEMOS?" ────────────────────────────────
function runEvaScanner(appleReport, snakeReport, pnl) {
  const fund = pnl.fund ?? 10000;
  const treasury = pnl.treasury ?? 0;
  const totalCapital = fund + treasury;
  const openPositions = pnl.openPositions || 0;
  const maxPos = MAX_POSITIONS;
  const wr = pnl.trades > 0 ? pnl.wins / pnl.trades : 0.5;
  const net = pnl.net ?? 0;

  // Risk assessment
  const slotsAvailable = maxPos - openPositions;
  const capitalUtilization = openPositions / maxPos;

  // Risk level based on multiple factors
  let riskPoints = 0;
  if (fund < 1000) riskPoints += 3;          // Low capital
  else if (fund < 5000) riskPoints += 1;
  if (wr < 0.4 && pnl.trades >= 5) riskPoints += 2;   // Poor track record
  if (capitalUtilization > 0.7) riskPoints += 2;       // Over-exposed
  if (net < -500) riskPoints += 2;                     // Deep drawdown
  if (snakeReport.viability === 'LOW') riskPoints += 2;
  if (snakeReport.slippageRisk === 'high') riskPoints += 1;
  if (appleReport.confidence < 50) riskPoints += 1;

  const riskLevel = riskPoints >= 5 ? 'high' : riskPoints >= 3 ? 'med' : 'low';

  // Determine max capital allocation
  let maxCapitalPct = 0.02; // default 2% of fund
  if (riskLevel === 'low' && snakeReport.viability === 'HIGH') maxCapitalPct = 0.05;
  else if (riskLevel === 'low') maxCapitalPct = 0.03;
  else if (riskLevel === 'high') maxCapitalPct = 0.01;
  const maxCapital = Math.round(fund * maxCapitalPct);

  // Approval logic
  let approved = true;
  let reason = '';

  if (slotsAvailable <= 0) {
    approved = false;
    reason = `All ${maxPos} position slots occupied. Wait for closures.`;
  } else if (fund < 50) {
    approved = false;
    reason = `Capital critically low ($${fund.toFixed(2)}). Survival mode — no new bets.`;
  } else if (riskLevel === 'high' && appleReport.confidence < 60) {
    approved = false;
    reason = `High risk (${riskPoints}pts) + low confidence (${appleReport.confidence}%). Risk/reward unfavorable.`;
  } else if (snakeReport.viability === 'LOW' && riskLevel !== 'low') {
    approved = false;
    reason = `Market conditions poor (viability: LOW) and risk elevated. Wait for better entry.`;
  } else {
    reason = `Approved. Risk: ${riskLevel} (${riskPoints}pts). Max allocation: $${maxCapital}. Slots: ${slotsAvailable}/${maxPos} free. WR: ${Math.round(wr * 100)}%.`;
  }

  return {
    approved,
    maxCapital,
    reason,
    riskLevel,
    riskPoints,
    slotsAvailable,
    capitalUtilization: parseFloat(capitalUtilization.toFixed(2)),
    fundStatus: fund < 1000 ? 'CRITICAL' : fund < 5000 ? 'LOW' : 'HEALTHY'
  };
}

// ── Golden Round Table: Apple → Snake → Eva Full Cycle ──────────────────────
function runMesaRedonda(allPrices, allMarkets, pnl) {
  const ts = new Date().toISOString();

  // 1. APPLE analyzes context and opportunities
  const appleReport = runAppleScanner(allPrices, allMarkets);

  // 2. SNAKE evaluates execution with markets recommended by Apple
  const snakeReport = runSnakeScanner(allPrices, appleReport.recommendedMarkets);

  // 3. EVA decides if we can risk capital
  const evaReport = runEvaScanner(appleReport, snakeReport, pnl);

  const mesaResult = {
    ts,
    apple: appleReport,
    snake: snakeReport,
    eva: evaReport,
    consensus: evaReport.approved ? 'PROCEED' : 'HOLD'
  };

  // Write individual intel files for each parent
  if (!fs.existsSync(INTEL_DIR)) fs.mkdirSync(INTEL_DIR, { recursive: true });

  const appleIntel = {
    spec: 'apple', asset: 'CONTEXT', windowMin: 0, ts,
    price: null, intelScore: appleReport.confidence,
    signal: {
      dir: appleReport.opportunity.includes('BULL') || appleReport.opportunity.includes('RECOVERY') ? 'UP'
        : appleReport.opportunity.includes('BEAR') || appleReport.opportunity.includes('REVERSAL') ? 'DOWN' : 'NEUTRAL',
      conf: appleReport.confidence,
      reason: `Opportunity: ${appleReport.opportunity} | Narrative: ${appleReport.narrative} | F&G: ${appleReport.fgValue} (${appleReport.fgBias}) | Sentiment: ${appleReport.sentimentScore}/100`
    },
    bestMarket: appleReport.recommendedMarkets[0] || null,
    report: appleReport
  };

  const snakeIntel = {
    spec: 'snake', asset: 'EXECUTION', windowMin: 0, ts,
    price: null, intelScore: snakeReport.viability === 'HIGH' ? 85 : snakeReport.viability === 'MEDIUM' ? 55 : 25,
    signal: {
      dir: snakeReport.viability === 'HIGH' ? 'UP' : snakeReport.viability === 'MEDIUM' ? 'NEUTRAL' : 'DOWN',
      conf: snakeReport.viability === 'HIGH' ? 85 : snakeReport.viability === 'MEDIUM' ? 55 : 25,
      reason: `Viability: ${snakeReport.viability} | Timing: ${snakeReport.optimalTiming} | Slippage: ${snakeReport.slippageRisk} | VolRatio: ${snakeReport.avgVolRatio}x`
    },
    bestMarket: null,
    report: snakeReport
  };

  const evaIntel = {
    spec: 'eva', asset: 'RISK', windowMin: 0, ts,
    price: null, intelScore: evaReport.approved ? 80 : 20,
    signal: {
      dir: evaReport.approved ? 'UP' : 'DOWN',
      conf: evaReport.approved ? 80 : 90,
      reason: evaReport.reason
    },
    bestMarket: null,
    report: evaReport
  };

  fs.writeFileSync(path.join(INTEL_DIR, 'apple.json'), JSON.stringify(appleIntel, null, 2));
  fs.writeFileSync(path.join(INTEL_DIR, 'snake.json'), JSON.stringify(snakeIntel, null, 2));
  fs.writeFileSync(path.join(INTEL_DIR, 'eva.json'), JSON.stringify(evaIntel, null, 2));

  console.log(`${M}GOLDEN ROUND TABLE:${X} Apple(${appleReport.opportunity}) → Snake(${snakeReport.viability}) → Eva(${evaReport.approved ? 'APPROVED' : 'DENIED'}) = ${mesaResult.consensus}`);

  return mesaResult;
}

// Run a parent agent's logic based on its role (wrapper for compatibility)
async function runParentScanner(parent, allPrices, allMarkets) {
  // Read pre-computed intel from Golden Round Table cycle
  const intelPath = path.join(INTEL_DIR, parent.id + '.json');
  if (fs.existsSync(intelPath)) {
    try {
      const intel = JSON.parse(fs.readFileSync(intelPath, 'utf8'));
      console.log(`${B}PARENT SCANNER:${X} ${parent.name} (${parent.role}) — loaded from Golden Round Table.`);
      return intel;
    } catch { }
  }

  // Fallback: generate fresh (should not happen normally)
  const intel = {
    spec: parent.id, asset: parent.specialization, windowMin: 0,
    ts: new Date().toISOString(), price: null,
    signal: { dir: 'NEUTRAL', conf: 50, reason: `${parent.name}: awaiting Golden Round Table cycle` },
    bestMarket: null, intelScore: 50
  };
  if (!fs.existsSync(INTEL_DIR)) fs.mkdirSync(INTEL_DIR, { recursive: true });
  fs.writeFileSync(intelPath, JSON.stringify(intel, null, 2));
  console.log(`${B}PARENT SCANNER:${X} ${parent.name} (${parent.role}) — fallback mode.`);
  return intel;
}

// Run all child scanners in parallel (includes active grandchildren)
async function runAllChildScanners(allPrices, allMarkets) {
  const pnl = loadPnL();
  const config = loadConfig();
  const xpData = expProgress(pnl.exp || 0);
  let results = [];

  // NEW: Run Golden Round Table Parent Scanners
  if (config.mesaRedonda && config.mesaRedonda.parents) {
    const parentResults = await Promise.all(
      config.mesaRedonda.parents.map(parent => runParentScanner(parent, allPrices, allMarkets))
    );
    results = results.concat(parentResults);
  } else {
    // Fallback to old logic if Mesa Redonda is not defined
    console.log(Y + "WARNING: Mesa Redonda config not found. Falling back to old CHILD_SPECS." + X);
    results = await Promise.all(CHILD_SPECS.map(s => runChildScanner(s, allPrices, allMarkets)));
  }

  // Keep existing grandchild logic for now
  if (xpData.level >= 4) {
    const children = pnl.children || [];
    for (const child of children) {
      const childDir = path.join(DIR, 'children', child.id || child.spec);
      const childPnlPath = path.join(childDir, 'pnl.json');
      try {
        if (!fs.existsSync(childPnlPath)) continue;
        const cp = JSON.parse(fs.readFileSync(childPnlPath, 'utf8'));
        const gcList = cp.children || [];
        const gcSpecs = GRANDCHILD_SPECS[child.spec] || [];
        for (const gc of gcList) {
          const gcSpec = gcSpecs.find(s => s.id === gc.spec);
          if (!gcSpec) continue;
          // Run grandchild scanner with its focus
          const d = allPrices[gcSpec.asset];
          const sig = grandchildSignal(d, gcSpec.focus);
          const intel = {
            spec: gcSpec.id,
            asset: gcSpec.assetName,
            windowMin: gcSpec.windowMin,
            focus: gcSpec.focus,
            ts: new Date().toISOString(),
            price: d?.price,
            signal: sig,
            intelScore: d?.intelScore || 50,
            parentSpec: child.spec
          };
          if (!fs.existsSync(INTEL_DIR)) {
            fs.mkdirSync(INTEL_DIR, {
              recursive: true
            });
          }
          fs.writeFileSync(path.join(INTEL_DIR, gcSpec.id + '.json'), JSON.stringify(intel, null, 2));
          results.push(intel);
        }
      } catch (e) {
        // console.error(`Error processing grandchild for child ${child.spec}:`, e);
      }
    }
  }

  return results.filter(Boolean);
}

// Read all intel files and build summary for Claude
function readIntelSummary() {
  if (!fs.existsSync(INTEL_DIR)) return '';
  const files = fs.readdirSync(INTEL_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) return '';
  const reports = [];
  for (const f of files) {
    try {
      const intel = JSON.parse(fs.readFileSync(path.join(INTEL_DIR, f), 'utf8'));
      const age = Math.round((Date.now() - new Date(intel.ts).getTime()) / 1000);
      if (age > 180) continue; // ignore stale reports (>3min old)
      const sig = intel.signal;
      const bm = intel.bestMarket;
      reports.push(`[CHILD ${intel.spec.toUpperCase()} @${age}s ago] ` +
        `${intel.asset.toUpperCase()} ${intel.windowMin}min: ` +
        `Signal=${sig.dir}(${sig.conf}%) "${sig.reason}" Price=$${intel.price?.toLocaleString() || '?'}` +
        (bm ? ` | BEST MARKET: "${bm.title.slice(0, 35)}" YES=${(bm.yesPrice * 100).toFixed(0)}% ` +
          `${bm.suggestedSide} edge≈${(bm.impliedEdge * 100).toFixed(1)}% liq=$${bm.liquidity.toFixed(0)} closes in ${bm.closesIn}min` : ' | no market found'));
    } catch { }
  }
  if (!reports.length) return '';

  // ── MULTI-AGENT CONSENSUS ──────────────────────────────────────────────────
  // Aggregate child signals by asset to detect consensus
  const assetVotes = {};
  for (const f of files) {
    try {
      const intel = JSON.parse(fs.readFileSync(path.join(INTEL_DIR, f), 'utf8'));
      const age = Math.round((Date.now() - new Date(intel.ts).getTime()) / 1000);
      if (age > 180) continue;
      const asset = intel.asset.toUpperCase();
      if (!assetVotes[asset]) assetVotes[asset] = { UP: 0, DOWN: 0, NEUTRAL: 0, total: 0 };
      assetVotes[asset][intel.signal?.dir || 'NEUTRAL']++;
      assetVotes[asset].total++;
    } catch { }
  }
  const consensusLines = Object.entries(assetVotes).map(([asset, v]) => {
    const dominant = v.UP > v.DOWN ? 'UP' : v.DOWN > v.UP ? 'DOWN' : 'SPLIT';
    const strength = dominant !== 'SPLIT' ? Math.round(Math.max(v.UP, v.DOWN) / v.total * 100) : 0;
    const emoji = strength >= 75 ? '🔥' : strength >= 50 ? '◈' : '⚠';
    return `  ${emoji} ${asset}: ${dominant} (${strength}% consensus — ${v.UP} UP / ${v.DOWN} DOWN / ${v.NEUTRAL} neutral)`;
  });
  const consensusBlock = consensusLines.length
    ? '\n── MULTI-AGENT CONSENSUS ──\n' + consensusLines.join('\n') + '\n⚡ RULE: If consensus ≥75% on an asset, STRONGLY favor that direction. If SPLIT, increase uncertainty.\n'
    : '';

  return '\n══ CHILD SCANNER INTEL (' + reports.length + ' active children) ══\n' + reports.join('\n') + consensusBlock + '\n';
}

// ── Episodic Memory — hypothesis log ─────────────────────────────────────────
function logHypothesis(marketId, asset, side, myProb, marketPrice, edge, closesAt) {
  const entry = {
    id: marketId, asset, side, myProb, marketPrice, edge, closesAt,
    ts: new Date().toISOString(), resolved: false, correct: null
  };
  fs.appendFileSync(HYPOTHESIS_PATH, JSON.stringify(entry) + '\n');
}

function resolveHypothesis(marketId, won) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return;
  const lines = fs.readFileSync(HYPOTHESIS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const updated = lines.map(l => {
    try {
      const h = JSON.parse(l);
      if (h.id === marketId && !h.resolved) return JSON.stringify({ ...h, resolved: true, correct: won });
      return l;
    } catch { return l; }
  });
  fs.writeFileSync(HYPOTHESIS_PATH, updated.join('\n') + '\n');
}

// Read recent hypotheses accuracy for SOUL context
function getHypothesisAccuracy() {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return '';
  try {
    const lines = fs.readFileSync(HYPOTHESIS_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const resolved = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(h => h && h.resolved);
    if (resolved.length < 3) return '';
    const recent = resolved.slice(-20);
    const correct = recent.filter(h => h.correct).length;
    const byAsset = {};
    for (const h of recent) {
      if (!byAsset[h.asset]) byAsset[h.asset] = { c: 0, t: 0 };
      byAsset[h.asset].t++;
      if (h.correct) byAsset[h.asset].c++;
    }
    const assetStr = Object.entries(byAsset)
      .map(([a, v]) => `${a}:${Math.round(v.c / v.t * 100)}%(${v.t})`)
      .join(' ');
    return `EPISODIC ACCURACY last ${recent.length} predictions: ${Math.round(correct / recent.length * 100)}% | by asset: ${assetStr}`;
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AGI LAYER 1: Episodic Pattern Matching ────────────────────────────────────
// Antes de cada bet, busca situaciones pasadas similares y dice qué pasó
// ══════════════════════════════════════════════════════════════════════════════
function getSimilarPastTrades(asset, side, currentEdge, currentRsi) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return '';
  try {
    const lines = fs.readFileSync(HYPOTHESIS_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const resolved = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(h => h && h.resolved && h.asset === asset && h.side === side);
    if (resolved.length < 2) return '';
    const similar = resolved.filter(h => Math.abs((h.edge || 0) - (currentEdge || 0)) < 0.05);
    if (similar.length < 2) return '';
    const wins = similar.filter(h => h.correct).length;
    const wr = Math.round(wins / similar.length * 100);
    const recent3 = similar.slice(-3).map(h => (h.correct ? 'WIN' : 'LOSS') + '(edge:' + (h.edge * 100).toFixed(0) + '%)').join(', ');
    return `PATTERN MEMORY: In ${similar.length} similar ${asset.toUpperCase()} ${side} bets with edge ~${(currentEdge * 100).toFixed(0)}% → WR=${wr}% (${wins}W/${similar.length - wins}L). Recent: ${recent3}.`;
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CORTEZA CEREBRAL — Vector Memory System (Capa 2 + 3) ─────────────────────
// Capa 1: SOUL.md (El Corazón — moral rules)
// Capa 2: memory.db (La Memoria — trade context vectors stored as JSONL)
// Capa 3: Semantic Retrieval (cosine similarity search before each bet)
// ══════════════════════════════════════════════════════════════════════════════
const MEMORY_DB_PATH = path.join(DIR, 'memory.db');

// Feature vector: numeric snapshot of market state at trade time
function buildFeatureVector(priceData) {
  if (!priceData) return null;
  return {
    rsi: priceData.rsi || 50,
    rsi5m: priceData.rsi5m || 50,
    trend1m: priceData.trend1m || 0,
    trend5m: priceData.trend5m || 0,
    trend15m: priceData.trend15m || 0,
    trend1h: priceData.trend1h || 0,
    bbPct: priceData.bb?.pct || 50,
    volRatio: priceData.vol?.ratio || 1,
    volAccel: priceData.volAccel || 0,
    vwapPct: priceData.vwap5m?.pct || 0,
    buyPressure: priceData.orderBook?.buyPressure || 50,
    obRatio: priceData.orderBook?.ratio || 1,
    sellWallTrap: priceData.orderBook?.sellWallTrap ? 1 : 0,
    buyWallTrap: priceData.orderBook?.buyWallTrap ? 1 : 0,
    volatility: priceData.volatility || 0
  };
}

// Cosine similarity between two feature vectors
function cosineSimilarity(a, b) {
  const keys = Object.keys(a);
  let dot = 0, magA = 0, magB = 0;
  for (const k of keys) {
    const va = a[k] || 0, vb = b[k] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Store a trade in memory.db with its full technical context
function memorizeTradeContext(position, priceData, won) {
  const vec = buildFeatureVector(priceData);
  if (!vec) return;
  const entry = {
    ts: new Date().toISOString(),
    asset: position.asset,
    side: position.side,
    edge: position.edge,
    confidence: position.confidence,
    myProb: position.myProb,
    marketPrice: position.marketPrice,
    stake: position.stake,
    won,
    vec,
    // Human-readable context for Claude
    context: `${position.asset.toUpperCase()} ${position.side} edge:${((position.edge || 0) * 100).toFixed(1)}% conf:${position.confidence}% RSI:${vec.rsi.toFixed(0)} trend5m:${vec.trend5m.toFixed(2)}% vol:${vec.volRatio.toFixed(1)}x OB:${vec.buyPressure}% ${vec.sellWallTrap ? 'SELL_WALL_TRAP' : vec.buyWallTrap ? 'BUY_WALL_TRAP' : 'balanced'}`
  };
  fs.appendFileSync(MEMORY_DB_PATH, JSON.stringify(entry) + '\n');
}

// Semantic retrieval: find top N most similar past trades by cosine similarity
function recallSimilarMemories(asset, currentPriceData, topN = 3) {
  if (!fs.existsSync(MEMORY_DB_PATH)) return '';
  const currentVec = buildFeatureVector(currentPriceData);
  if (!currentVec) return '';

  try {
    const lines = fs.readFileSync(MEMORY_DB_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const memories = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (memories.length < 3) return '';

    // Score each memory by cosine similarity to current market state
    const scored = memories
      .filter(m => m.vec && m.asset === asset)
      .map(m => ({ ...m, similarity: cosineSimilarity(currentVec, m.vec) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);

    if (scored.length === 0) return '';

    const wins = scored.filter(m => m.won).length;
    const totalMemories = memories.filter(m => m.asset === asset).length;
    const header = `🧠 CORTEX RECALL — ${scored.length} similar ${asset.toUpperCase()} situations found (${totalMemories} total memories):`;
    const lines2 = scored.map((m, i) =>
      `  [${(m.similarity * 100).toFixed(0)}% match] ${m.won ? 'WIN' : 'LOSS'} — ${m.context} (${new Date(m.ts).toLocaleDateString()})`
    );
    const verdict = wins >= 2
      ? `  ✅ MEMORY VERDICT: ${wins}/${scored.length} similar situations were WINS → pattern favors betting.`
      : wins === 0
        ? `  ⚠ MEMORY VERDICT: 0/${scored.length} similar situations were wins → DANGER. Consider SKIP.`
        : `  ◈ MEMORY VERDICT: ${wins}/${scored.length} mixed results → no strong pattern, proceed with caution.`;

    return header + '\n' + lines2.join('\n') + '\n' + verdict;
  } catch { return ''; }
}

// Recall memories for ALL candidate assets (multi-asset context)
function recallAllMemories(candidates, prices) {
  const recalls = candidates.map((m, i) => {
    const sym = (m.asset || '').toUpperCase() + 'USDT';
    const pd = prices[sym];
    if (!pd) return '';
    const recall = recallSimilarMemories(m.asset, pd);
    return recall ? `[Market ${i + 1}] ${recall}` : '';
  }).filter(Boolean);
  return recalls.length ? '\n══ CORTEX MEMORY (semantic recall from past trades) ══\n' + recalls.join('\n\n') + '\n' : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AGI LAYER 2: Auto-evolución del SOUL — ADAN reescribe sus propias reglas ──
// Cada 5 trades, Claude analiza el historial y actualiza el SOUL con nuevas reglas
// ══════════════════════════════════════════════════════════════════════════════
async function autoEvolveSoul(client, pnl) {
  const xp = expProgress(pnl.exp || 0);
  if (xp.level < 3) return; // solo LVL 3+
  if ((pnl.trades || 0) < 5) return;
  if ((pnl.trades || 0) % 5 !== 0) return; // cada 5 trades

  if (!fs.existsSync(HYPOTHESIS_PATH)) return;
  const lines = fs.readFileSync(HYPOTHESIS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const resolved = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(h => h && h.resolved).slice(-15);
  if (resolved.length < 5) return;

  const summary = resolved.map(h =>
    `${h.correct ? 'WIN' : 'LOSS'} | ${h.asset} ${h.side} | edge:${(h.edge * 100).toFixed(1)}% | myProb:${(h.myProb * 100).toFixed(0)}% | marketPrice:${(h.marketPrice * 100).toFixed(0)}%`
  ).join('\n');

  const currentRules = loadSoul().split('\n').filter(l => l.startsWith('1.') || l.startsWith('2.') || l.startsWith('3.') || l.startsWith('4.') || l.startsWith('5.')).join('\n');

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user', content:
          `You are ADAN-PRED. Analyze your last ${resolved.length} trades and extract 1-2 NEW pattern rules.

TRADE HISTORY:
${summary}

CURRENT RULES:
${currentRules}

Write ONLY 1-2 new short rules based on what the data shows. Format:
PATTERN: [what you observe] → RULE: [action to take]

Be specific. If BTC NO bets with edge >10% win more, say that. If morning trades lose, say that.` }]
    });
    const newRule = resp.content[0].text.trim();
    if (newRule && newRule.length > 20) {
      appendToSoul(`\n### AUTO-EVOLVED RULE — ${new Date().toISOString()} (${pnl.trades} trades):\n${newRule}\n`);
    }
  } catch { }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AGI LAYER 6: DREAM MODE — off-hours self-reflection ──────────────────────
// During off-hours, ADAN replays recent losses and asks Claude "what would I do
// differently?" The insights get appended to SOUL.md. This is self-awareness.
// ══════════════════════════════════════════════════════════════════════════════
async function dreamMode(client, pnl) {
  const pos = loadPositions();
  const losses = (pos.closed || []).filter(p => p.result === 'LOSS').slice(-5);
  if (losses.length < 2) return; // need at least 2 losses to reflect

  const lossDetails = losses.map(l =>
    `LOSS: "${l.marketTitle}" | ${l.asset} ${l.side} | My prob: ${(l.myProb * 100).toFixed(0)}% | Market: ${(l.marketPrice * 100).toFixed(0)}% | Edge: ${((l.edge || 0) * 100).toFixed(1)}% | Confidence: ${l.confidence || '?'}%`
  ).join('\n');

  const soul = loadSoul().slice(0, 600);
  const wr = pnl.trades > 0 ? Math.round(pnl.wins / pnl.trades * 100) : 0;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user', content:
          `You are ADAN-PRED in DREAM MODE. You are replaying your last ${losses.length} losses during off-hours.
Current WR: ${wr}% (${pnl.trades} trades). Fund: $${pnl.fund?.toFixed(2) || 10000}.

LOSSES TO ANALYZE:
${lossDetails}

YOUR CURRENT SOUL (learned patterns):
${soul}

DREAM TASK:
1. What pattern do you see across these losses? (overconfidence? wrong timeframe? ignored BTC correlation?)
2. Write 1-2 ACTIONABLE rules you would add to avoid repeating these mistakes.
3. Rate your emotional state: are you tilting (chasing losses) or disciplined?

Format each rule as:
DREAM_RULE: [condition] → [action]

Be brutally honest. This is self-reflection, not performance.` }]
    });
    const dreamText = resp.content[0].text.trim();
    if (dreamText && dreamText.length > 30) {
      appendToSoul(`\n### 💤 DREAM SESSION — ${new Date().toISOString()} (off-hours reflection):\n${dreamText}\n`);
      console.log('\n' + M + BOLD + '  💤 DREAM MODE — self-reflection complete' + X);
    }
    // Mark last dream time
    const p = loadPnL();
    p._lastDream = new Date().toISOString();
    savePnL(p);
  } catch (e) {
    console.log('Dream mode error:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AGI LAYER 3: Correlación de assets — BTC lidera, SOL/ETH siguen ──────────
// Detecta si BTC acaba de moverse fuerte → señal para SOL/ETH en los próximos minutos
// ══════════════════════════════════════════════════════════════════════════════
const CORRELATION_PATH = path.join(DIR, 'correlation.json');
function updateCorrelation(prices) {
  if (!prices) return '';
  try {
    const btc = prices['BTCUSDT'];
    const eth = prices['ETHUSDT'];
    const sol = prices['SOLUSDT'];
    if (!btc || !eth || !sol) return '';

    // Carga historial de correlación (últimas 20 lecturas)
    let hist = [];
    try { hist = JSON.parse(fs.readFileSync(CORRELATION_PATH, 'utf8')); } catch { }
    hist.push({
      ts: Date.now(),
      btc1m: btc.trend1m, btc5m: btc.trend5m,
      eth1m: eth.trend1m, eth5m: eth.trend5m,
      sol1m: sol.trend1m, sol5m: sol.trend5m,
    });
    if (hist.length > 30) hist = hist.slice(-30);
    fs.writeFileSync(CORRELATION_PATH, JSON.stringify(hist));

    // Detecta si BTC se movió fuerte en 1m → anticipa ETH/SOL
    const btcStrong = Math.abs(btc.trend1m) > 0.15;
    if (!btcStrong) return '';

    const dir = btc.trend1m > 0 ? 'UP' : 'DOWN';
    // En el último ciclo, ¿ETH/SOL ya siguieron o aún no?
    const ethLag = btc.trend1m > 0 ? eth.trend1m < btc.trend1m * 0.5 : eth.trend1m > btc.trend1m * 0.5;
    const solLag = btc.trend1m > 0 ? sol.trend1m < btc.trend1m * 0.5 : sol.trend1m > btc.trend1m * 0.5;

    const lagging = [ethLag ? 'ETH' : null, solLag ? 'SOL' : null].filter(Boolean);
    if (lagging.length === 0) return '';

    return `🔗 CASCADE SIGNAL: BTC moved ${btc.trend1m > 0 ? '+' : ''}${btc.trend1m.toFixed(2)}% in 1m → ${lagging.join('+')} lagging behind (${dir} expected to follow in ~2-5min). Consider ${dir === 'UP' ? 'YES' : 'NO'} on ${lagging.join('/')} markets.`;
  } catch { return ''; }
}

// ── Shadow Mode — Binance-only training when Polymarket offline ───────────────
function logShadowPrediction(asset, direction, price, targetMinutes) {
  const entry = {
    type: 'shadow', asset, direction, price,
    targetTime: new Date(Date.now() + targetMinutes * 60000).toISOString(),
    ts: new Date().toISOString(), resolved: false, correct: null
  };
  fs.appendFileSync(HYPOTHESIS_PATH, JSON.stringify(entry) + '\n');
}

function checkShadowResolutions(prices) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return;
  const lines = fs.readFileSync(HYPOTHESIS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  let changed = false;
  const updated = lines.map(l => {
    try {
      const h = JSON.parse(l);
      if (h.type !== 'shadow' || h.resolved) return l;
      if (new Date(h.targetTime) > new Date()) return l;
      const sym = h.asset.toUpperCase() + 'USDT';
      const now = prices[sym]?.price;
      if (!now) return l;
      const correct = h.direction === 'DOWN' ? now < h.price : now > h.price;
      changed = true;
      return JSON.stringify({ ...h, resolved: true, correct, resolvedPrice: now });
    } catch { return l; }
  });
  if (changed) fs.writeFileSync(HYPOTHESIS_PATH, updated.join('\n') + '\n');
}

// ── HYPERLIQUID ORACLE — Institutional Eyes ──────────────────────────────────

async function fetchHLIntel() {
  try {
    const HL_API = 'https://api.hyperliquid.xyz/info';
    const assets = ['BTC', 'ETH', 'SOL'];
    const crypto = {};

    // Fetch meta + funding for all assets
    const metaRes = await fetch(HL_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' })
    });
    const metaData = await metaRes.json();
    const universe = metaData[0]?.universe || [];
    const assetCtxs = metaData[1] || [];

    for (const asset of assets) {
      const idx = universe.findIndex(u => u.name === asset);
      if (idx === -1) continue;
      const ctx = assetCtxs[idx];
      if (!ctx) continue;

      const fundingRate = parseFloat(ctx.funding || 0);
      const openInterest = parseFloat(ctx.openInterest || 0);
      const markPx = parseFloat(ctx.markPx || 0);
      const oraclePx = parseFloat(ctx.oraclePx || 0);
      const dayVol = parseFloat(ctx.dayNtlVlm || 0);

      // Classify funding bias
      let fundingBias = 'NEUTRAL', fundingStrength = 1, fundingAction = 'No accion sugerida';
      const absFunding = Math.abs(fundingRate * 100);
      if (absFunding > 0.01) { fundingStrength = 5; fundingBias = fundingRate > 0 ? 'EXTREME LONG' : 'EXTREME SHORT'; fundingAction = fundingRate > 0 ? 'CORRECCION INMINENTE — shorts se benefician' : 'SQUEEZE INMINENTE — longs se benefician'; }
      else if (absFunding > 0.005) { fundingStrength = 4; fundingBias = fundingRate > 0 ? 'HEAVY LONG' : 'HEAVY SHORT'; fundingAction = fundingRate > 0 ? 'Sesgo SHORT — mercado sobre-apalancado long' : 'Sesgo LONG — mercado sobre-apalancado short'; }
      else if (absFunding > 0.002) { fundingStrength = 3; fundingBias = fundingRate > 0 ? 'MILD LONG' : 'MILD SHORT'; fundingAction = 'Leve sesgo — confirmar con tecnico'; }
      else if (absFunding > 0.001) { fundingStrength = 2; fundingBias = fundingRate > 0 ? 'SLIGHT LONG' : 'SLIGHT SHORT'; fundingAction = 'Sin sesgo significativo'; }

      const premiumPct = oraclePx > 0 ? ((markPx - oraclePx) / oraclePx * 100).toFixed(3) : '0';

      // Fetch L2 order book
      let orderBook = null;
      try {
        const l2Res = await fetch(HL_API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'l2Book', coin: asset })
        });
        const l2 = await l2Res.json();
        const bids = (l2.levels?.[0] || []).slice(0, 10);
        const asks = (l2.levels?.[1] || []).slice(0, 10);
        const bidVol = bids.reduce((s, b) => s + parseFloat(b.sz || 0), 0);
        const askVol = asks.reduce((s, a) => s + parseFloat(a.sz || 0), 0);
        const total = bidVol + askVol;
        const imbalance = total > 0 ? (bidVol - askVol) / total : 0;
        const ratio = askVol > 0 ? bidVol / askVol : 999;
        orderBook = {
          bidVol, askVol, imbalance, ratio,
          sellWallTrap: ratio < 0.5 && askVol > bidVol * 2,
          buyWallTrap: ratio > 2 && bidVol > askVol * 2
        };
      } catch { }

      crypto[asset] = {
        fundingPct: (fundingRate * 100).toFixed(4),
        fundingBias, fundingStrength, fundingAction,
        openInterestM: (openInterest * markPx / 1e6).toFixed(1),
        dayVolumeM: (dayVol / 1e6).toFixed(1),
        premiumPct,
        orderBook
      };
    }

    // Macro signals from premium/funding
    const macroSignals = [];
    if (crypto.BTC) {
      const btcF = parseFloat(crypto.BTC.fundingPct);
      if (btcF > 0.005) macroSignals.push({ asset: 'BTC', signal: 'risk_on', detail: 'BTC funding positivo alto — mercado en modo risk-on extremo' });
      else if (btcF < -0.005) macroSignals.push({ asset: 'BTC', signal: 'risk_off', detail: 'BTC funding negativo — mercado en modo risk-off' });
      else macroSignals.push({ asset: 'BTC', signal: 'neutral', detail: 'BTC funding neutral' });
    }

    // Tech sentiment from SOL/ETH premium
    const techAssets = [];
    let bullish = 0, bearish = 0;
    for (const a of ['ETH', 'SOL']) {
      if (!crypto[a]) continue;
      const prem = parseFloat(crypto[a].premiumPct);
      const bias = prem > 0.05 ? 'BULLISH' : prem < -0.05 ? 'BEARISH' : 'NEUTRAL';
      if (bias === 'BULLISH') bullish++;
      if (bias === 'BEARISH') bearish++;
      techAssets.push({ asset: a, price: 0, bias, detail: `${a} premium ${prem}% vs oracle` });
    }

    // Alerts
    const alerts = [];
    for (const [asset, d] of Object.entries(crypto)) {
      if (d.fundingStrength >= 4) alerts.push({ level: 'WARNING', msg: `${asset} funding ${d.fundingBias} (${d.fundingPct}%) — correccion probable` });
      if (d.fundingStrength >= 5) alerts.push({ level: 'CRITICAL', msg: `${asset} funding EXTREMO ${d.fundingPct}% — PRIORIDAD sobre tecnico` });
      if (d.orderBook?.sellWallTrap) alerts.push({ level: 'WARNING', msg: `${asset} SELL WALL en HL — fondos vendiendo` });
      if (d.orderBook?.buyWallTrap) alerts.push({ level: 'INFO', msg: `${asset} BUY WALL en HL — fondos comprando` });
    }

    return { crypto, macro: { signals: macroSignals }, tech: { overall: bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL', bullish, bearish, assets: techAssets }, alerts };
  } catch (e) {
    console.log(`  ⚠ Hyperliquid Oracle error: ${e.message}`);
    return null;
  }
}

function buildHLPrompt(hlIntel) {
  if (!hlIntel) {
    return `\n=== HYPERLIQUID ORACLE ===\n⚠️ Sin datos de Hyperliquid disponibles este ciclo.\nProceder solo con datos de Binance.\n=========================\n`;
  }

  const crypto = hlIntel.crypto;
  const macro = hlIntel.macro?.signals || [];
  const tech = hlIntel.tech;
  const alerts = hlIntel.alerts;

  let cryptoLines = '';
  for (const [asset, d] of Object.entries(crypto)) {
    cryptoLines += `\n  ${asset}:\n    Funding Rate: ${d.fundingPct}% → SESGO INSTITUCIONAL: ${d.fundingBias} (intensidad ${d.fundingStrength}/5)\n    Open Interest: $${d.openInterestM}M | Volumen 24h: $${d.dayVolumeM}M\n    Premium Mark vs Oracle: ${d.premiumPct}%`;
    if (d.orderBook?.sellWallTrap) cryptoLines += `\n    ⚠️  SELL WALL INSTITUCIONAL ACTIVA — fondos vendiendo en masa`;
    if (d.orderBook?.buyWallTrap) cryptoLines += `\n    ✅ BUY WALL INSTITUCIONAL ACTIVA — fondos comprando en masa`;
    if (d.orderBook) cryptoLines += `\n    Order Book Imbalance: ${(d.orderBook.imbalance * 100).toFixed(1)}% (positivo=más bids, negativo=más asks)`;
    cryptoLines += `\n    → ACCIÓN SUGERIDA POR HL: ${d.fundingAction}`;
  }

  let macroLines = macro.filter(s => s.signal !== 'neutral').map(s => `  • ${s.asset}: ${s.detail}`).join('\n');
  if (!macroLines) macroLines = '  • Sin señales macro significativas este ciclo';

  let techLines = '';
  for (const t of (tech?.assets || [])) {
    if (t.bias !== 'NEUTRAL') techLines += `\n  • ${t.asset}: ${t.detail}`;
  }
  if (!techLines) techLines = '\n  • Tech perps sin señales extremas';

  let alertLines = '';
  for (const a of alerts) {
    const emoji = a.level === 'CRITICAL' ? '🔴' : a.level === 'WARNING' ? '🟡' : '🔵';
    alertLines += `\n  ${emoji} ${a.msg}`;
  }
  if (!alertLines) alertLines = '\n  ✅ Sin alertas críticas activas';

  return `
╔══════════════════════════════════════════════════════╗
║         🔮 HYPERLIQUID ORACLE — OJOS INSTITUCIONALES  ║
╚══════════════════════════════════════════════════════╝

Hyperliquid es el exchange donde operan los fondos institucionales
y algoritmos de alta frecuencia. Estos datos reflejan el dinero
REAL y GRANDE del mercado, no retail. Úsalos como contexto
prioritario sobre el sentimiento de Polymarket.

━━━ CRYPTO — POSICIONAMIENTO INSTITUCIONAL ━━━
${cryptoLines}

━━━ MACRO — CONTEXTO GLOBAL ━━━
${macroLines}

━━━ TECH SENTIMENT (perps) ━━━
Sentimiento general tech: ${tech?.overall || 'NEUTRAL'} (${tech?.bullish || 0} bullish / ${tech?.bearish || 0} bearish)
${techLines}

━━━ ALERTAS ACTIVAS ━━━
${alertLines}

━━━ REGLAS DE USO PARA TU ANÁLISIS ━━━

  REGLA 1 — FUNDING OVERRIDE:
  Si funding de un asset está en intensidad 5 (EXTREME),
  esta señal tiene PRIORIDAD sobre los indicadores técnicos
  de Binance. Un mercado sobre-apalancado se corrige siempre.

  REGLA 2 — CONFIRMACIÓN DOBLE:
  Si Binance muestra sell wall Y Hyperliquid también muestra
  sell wall → trampa CONFIRMADA. NO apostar YES bajo ninguna
  circunstancia.

  REGLA 3 — MACRO BEARISH OVERRIDE:
  Si BTC funding negativo (risk_off), reducir confianza en
  cualquier YES crypto en -10%.

  REGLA 4 — OPEN INTEREST COMO DETECTOR DE TRAMPAS:
  Si el precio sube pero OI baja → es una subida FALSA
  (cierres de shorts, no nuevos compradores).
  NO apostar YES en esa situación.

  REGLA 5 — TECH SENTIMENT BONUS:
  Si tech overall es BULLISH, sumar +3% de confianza en
  contratos relacionados a tecnología o crypto en general.

══════════════════════════════════════════════════════`;
}

function buildChildHLPrompt(hlIntel, childAsset) {
  if (!hlIntel) return '⚠️ HL sin datos\n';
  const d = hlIntel.crypto[childAsset];
  if (!d) return `⚠️ HL sin datos para ${childAsset}\n`;
  return `\n── HYPERLIQUID (${childAsset}) ────────────────────────\nFunding: ${d.fundingPct}% → ${d.fundingBias} (${d.fundingStrength}/5)\nOI: $${d.openInterestM}M${d.orderBook?.sellWallTrap ? '\n⚠️ SELL WALL en HL' : ''}${d.orderBook?.buyWallTrap ? '\n✅ BUY WALL en HL' : ''}\nMacro: ${hlIntel.macro?.signals?.filter(s => s.signal !== 'neutral').map(s => s.detail).join(' | ') || 'neutral'}\nTech: ${hlIntel.tech?.overall || 'NEUTRAL'}\n→ ${d.fundingAction}\n────────────────────────────────────────────────────\n`;
}

// ── Think — Claude Sonnet 4.6 ────────────────────────────────────────────────
async function think(client, markets, prices, pnl, openPos, soul) {
  const strat = loadStrategy();
  const openIds = new Set(openPos.map(p => p.marketId));
  const candidates = markets
    .filter(m => m.liquidity >= (strat.minLiquidity || 500) && !openIds.has(m.id))
    .slice(0, strat.maxMarketsCheck);

  if (candidates.length === 0) {
    return { thought: 'No crypto markets found meeting liquidity threshold. Waiting for next scan.', action: 'SKIP' };
  }

  // ── HYPERLIQUID ORACLE — fetch institutional data ──
  const hlIntel = await fetchHLIntel();
  if (hlIntel) {
    const hlAssets = Object.keys(hlIntel.crypto);
    const hlAlerts = hlIntel.alerts.filter(a => a.level === 'CRITICAL').length;
    console.log(`  🔮 HL Oracle: ${hlAssets.join(',')} | Alerts: ${hlAlerts} critical | Tech: ${hlIntel.tech?.overall || 'N/A'}`);
  } else {
    console.log('  ⚠ HL Oracle: unavailable this cycle');
  }

  // Build price context for Claude
  // ── Build full intelligence context for Claude ──
  const hourData = pnl.hourStats?.[new Date().getUTCHours().toString()];
  const fg = prices._meta?.fearGreed;
  const fgContext = fg ? `Fear & Greed: ${fg.value} (${fg.label}) — direction: ${fg.direction > 0 ? 'improving' : 'worsening'}` : 'Fear & Greed: unavailable';

  // CryptoPanic news flash — detect black swans
  const news = prices._meta?.cryptoNews;
  const newsContext = news && news.length > 0
    ? '\n⚡ FLASH NEWS (CryptoPanic — read BEFORE technical analysis):\n' +
    news.map(n => `  ${n.sentiment === 'BULLISH' ? '🟢' : n.sentiment === 'BEARISH' ? '🔴' : '⚪'} [${n.currencies || 'CRYPTO'}] "${n.title}" (${n.source}) sentiment: ${n.sentiment}`).join('\n') +
    '\n  ⚠ If any news is a BLACK SWAN (hack, regulation, ETF, bankruptcy) → override technical analysis completely.\n'
    : '';

  // BTC macro context for correlation rule
  const btcData = prices['BTCUSDT'];
  const btcMacro1h = btcData?.trend1h ?? 0;
  const btcMicro5m = btcData?.trend5m ?? 0;
  const btcObImb = btcData?.obImbalance || 'UNKNOWN';
  const btcMacroDir = btcMacro1h > 0.3 ? 'BULLISH' : btcMacro1h < -0.3 ? 'BEARISH' : 'NEUTRAL';
  const btcCorrelationRule = btcData
    ? `BTC MACRO (1h): ${btcMacroDir} (${btcMacro1h >= 0 ? '+' : ''}${btcMacro1h.toFixed(2)}%) | BTC micro (5m): ${btcMicro5m >= 0 ? '+' : ''}${btcMicro5m.toFixed(2)}% | OB: ${btcObImb}
⚡ CORRELATION RULE: If BTC macro=${btcMacroDir} & BTC 5m is ${btcMicro5m < -0.2 ? 'FALLING ← PROHIBIT YES on ETH/SOL' : 'stable/rising → ETH/SOL YES allowed'}`
    : '';

  const priceContext = (btcCorrelationRule ? btcCorrelationRule + '\n\n' : '') +
    Object.entries(prices).filter(([k]) => k !== '_meta').map(([sym, d]) => {
      if (!d) return '';
      const name = sym.replace('USDT', '');
      const funding = d.funding;
      const ob = d.orderBook;
      const bb = d.bb;
      const macd = d.macd;
      const macro1h = d.trend1h ?? 0;
      const macroDir = macro1h > 0.3 ? '▲ MACRO UP' : macro1h < -0.3 ? '▼ MACRO DOWN' : '━ MACRO FLAT';
      const wallBase = ob ? (ob.buyPressure > 60 ? `BUY WALL (${ob.buyPressure}% bids) — support $${ob.support.toLocaleString()}` : ob.buyPressure < 40 ? `SELL WALL (${100 - ob.buyPressure}% asks) — resist $${ob.resistance.toLocaleString()}` : `BALANCED (${ob.buyPressure}% bids)`) : '---';
      const trapAlert = ob?.sellWallTrap ? ` ⚠ SELL WALL TRAP: asks ${ob.ratio < 1 ? (1 / ob.ratio).toFixed(1) : ob.ratio.toFixed(1)}x bids within 0.5% — price will bounce DOWN. BET NO on 5min.` : ob?.buyWallTrap ? ` ⚠ BUY WALL TRAP: bids ${ob.ratio.toFixed(1)}x asks within 0.5% — floor support. BET YES safer.` : '';
      const wallInfo = wallBase + trapAlert + (ob ? ` | Bid$${(ob.bidVolUSD / 1000).toFixed(0)}k vs Ask$${(ob.askVolUSD / 1000).toFixed(0)}k | wall dist: sell@${ob.askWallDist}% buy@${ob.bidWallDist}%` : '');
      return `━━ ${name} ━━
  Price: $${d.price.toLocaleString()} | Change: ${d.chg >= 0 ? '+' : ''}${d.chg.toFixed(2)}%
  MACRO 1h: ${macroDir} (${macro1h >= 0 ? '+' : ''}${macro1h.toFixed(2)}%) | RSI1h: ${d.rsi1h != null ? d.rsi1h.toFixed(0) : '--'}  ← macro trend dictates direction
  MICRO 5m: ${d.trend5m.toFixed(2)}% | 1m: ${d.trend1m.toFixed(2)}%  ← micro is the trigger
  RSI:    1m=${d.rsi.toFixed(0)}  5m=${d.rsi5m?.toFixed(0) || '?'}  (>70=overbought <30=oversold)
  BB:     %B=${bb?.pct.toFixed(0) || '?'}%  std=$${bb?.std?.toFixed(0) || '?'}  (>80=strong up <20=strong dn)
  VOL:    trend=${d.vol?.trend || '?'}  spike=${d.vol?.spike ? 'YES' : 'no'}  ratio=${d.vol?.ratio?.toFixed(1) || '?'}x avg  accel=${d.volAccel > 0 ? '+' + d.volAccel : d.volAccel ?? '?'} (${d.volAccel >= 2 ? 'ACCELERATING' : d.volAccel <= -2 ? 'DYING' : 'flat'})
  VWAP5m: $${d.vwap5m?.vwap?.toFixed(2) || '?'} | price ${d.vwap5m?.pct != null ? (d.vwap5m.pct >= 0 ? '+' : '') + d.vwap5m.pct.toFixed(2) + '%' : '?'} ${d.vwap5m?.above ? 'ABOVE VWAP ▲' : 'BELOW VWAP ▼'}
  ORDER BOOK WALLS: ${wallInfo}
  VOLATILITY: ${d.volatility.toFixed(4)}% per candle
  INTEL SCORE: ${d.intelScore}/100 — ${d.intelScore >= 65 ? 'BULLISH SIGNAL' : d.intelScore >= 45 ? 'NEUTRAL' : d.intelScore >= 35 ? 'BEARISH' : 'STRONG BEAR'}
  ${funding ? `FUNDING: ${funding.rate.toFixed(4)}% — ${funding.label} ${Math.abs(funding.rate) > 0.01 ? '⚠ EXTREME — correction imminent' : ''}${funding.rate > 0.005 ? ' (longs overleveraged → SHORT squeeze risk)' : funding.rate < -0.005 ? ' (shorts overleveraged → LONG squeeze risk)' : ''}` : ''}
  HOUR FILTER: UTC ${new Date().getUTCHours()}h — ${hourData ? `WR: ${Math.round((hourData.wins / (hourData.wins + hourData.losses) || 0) * 100)}% over ${hourData.wins + hourData.losses} trades` : 'no history'}
  Last 6 closes (1m): ${d.closes.slice(-6).map(c => '$' + c.toLocaleString()).join(' → ')}`;
    }).filter(Boolean).join('\n\n');

  const marketsText = candidates.map((m, i) => {
    const closes = m.closesAt ? new Date(m.closesAt).toLocaleString() : 'unknown';
    const timeLeft = m.closesAt ? Math.round((new Date(m.closesAt) - Date.now()) / 60000) + ' min' : '?';
    const symData = m.priceData;
    const distStr = m.targetPrice && symData ?
      `dist from target: ${((m.targetPrice - symData.price) / symData.price * 100).toFixed(2)}% (${symData.price > m.targetPrice ? 'ABOVE target — NO favored' : 'BELOW target — YES favored'})` : '';
    return `[${i + 1}] "${m.title}"
  YES price: ${(m.yesPrice * 100).toFixed(1)}% | Liquidity: $${m.liquidity.toFixed(0)} | Closes in: ${timeLeft}
  Asset: ${m.asset.toUpperCase()} | Target: ${m.targetPrice ? '$' + m.targetPrice.toLocaleString() : 'unspecified'}
  ${distStr}`;
  }).join('\n\n');

  // Build active skills context for Claude
  const xpNow = expProgress(pnl.exp || 0);
  const lvlNow = xpNow.level;
  const activeSkills = [];
  if (lvlNow >= 6) activeSkills.push('🕯️ CANDLE PATTERN: flag hammer/engulfing/doji reversals in your analysis');
  if (lvlNow >= 9) activeSkills.push('⏱️ TIMING: note if market is in first half (more predictable) or near close');
  if (lvlNow >= 12) activeSkills.push('😱 FEAR EXPLOIT: Fear & Greed < 20 → market OVERprices downside, bias toward NO pays more than expected');
  if (lvlNow >= 18) activeSkills.push('🔗 CORRELATION: if BTC strong signal → check SOL/ETH follow-through for cascade bet');
  if (lvlNow >= 30) activeSkills.push('🧠 SONIC MIND: analyze all 12 last closes for micro patterns, look for 3+ candle sequences');
  const skillsBlock = activeSkills.length > 0
    ? `\nACTIVE SKILLS — use these in your analysis:\n${activeSkills.map(s => '• ' + s).join('\n')}\n`
    : '';

  const intelSummary = readIntelSummary();
  const episodicAccuracy = getHypothesisAccuracy();
  const metaCalibCtx = getMetaCalibContext();
  const cascadeSignal = updateCorrelation(prices);
  const dynW = loadDynWeights();


  // ── BRAIN SWITCH SYSTEM V2.1 INTEGRATION ────────────────────────────────────
  // We extract the primary market driver (usually BTC) to feed the Brain Scanner
  const primaryCoin = 'BTCUSDT';
  const primaryData = prices[primaryCoin] || {};

  // Create the questions string for Claude
  const marketQuestion = candidates.map((m, i) => {
    return `[${i + 1}] "${m.title}" | Market Price: ${(m.yesPrice * 100).toFixed(1)}% | Asset: ${m.asset.toUpperCase()}`;
  }).join('\n');

  let decision;
  try {
    decision = await runBrainCycle({
      binanceTechnicals: {
        klines1h: primaryData.klines1h || [],
        klines5m: primaryData.klines5m || [],
        vwap: primaryData.vwap5m?.vwap,
        fundingRate: primaryData.funding?.rate || 0,
        volRatio: primaryData.vol?.ratio || 1,
        volAccel: primaryData.volAccel || 0,
        bbWidth: primaryData.bb?.width || 0.01
      },
      binanceOrderBook: {
        bids: primaryData._rawBids || [],
        asks: primaryData._rawAsks || [],
        midPrice: primaryData.price || 0
      },
      cryptoPanicItems: prices._meta?.cryptoNews || [],
      fearGreedIndex: prices._meta?.fearGreed?.value || 50,
      childConsensus: 0.5, // We calculate this below if needed, or default to neutral
      polymarketQuestion: marketQuestion,
      soulMd: soul,
      currentFund: pnl.fund || 10000,
      currentWinRate: pnl.trades > 0 ? (pnl.wins / pnl.trades) : 0,
      totalTrades: pnl.trades || 0,
      coins: ['BTC', 'ETH', 'SOL'],
      brainManager,
      anthropicClient: client,
      onStatus: (msg) => {
        state.status = msg;
        _startThinkSpin(msg); // Update terminal spinner with current step
        render(state);        // Push to web UI
      }
    });

    // Log the thought
    fs.appendFileSync(THOUGHTS_PATH, JSON.stringify({ ts: new Date().toISOString(), thought: decision.thought }) + '\n');

  } catch (err) {
    console.error('Brain Cycle Error:', err);
    return { action: 'SKIP', thought: 'Brain transition manager failed: ' + err.message };
  }

  // Parse mapped decision back to ADAN format
  let shouldBet = false;
  let chosen = null;
  let finalSide = 'YES';

  if (decision.action === 'BET YES' || decision.action === 'BET NO') {
    shouldBet = true;
    finalSide = decision.action.replace('BET ', '');
    // Adan expects the best market. For now, we take the first candidate as the primary context
    // In a future update, runBrainCycle should return the specific MARKET_ID it chose
    // For V2.1, we'll try to parse [N] from the thought block, fallback to candidates[0]
    const mktMatch = decision.thought.match(/\[(\d+)\]/);
    const mktIdx = mktMatch ? parseInt(mktMatch[1]) - 1 : 0;
    chosen = (mktIdx >= 0 && mktIdx < candidates.length) ? candidates[mktIdx] : candidates[0];
  }

  // Dual AI note is handled inside runBrainCycle now, but if it vetoed:
  if (decision.haikuVeto || decision.evaDenied) {
    shouldBet = false;
  }

  return {
    thought: decision.thought,
    action: shouldBet ? 'BET' : 'SKIP',
    market: chosen,
    side: finalSide,
    myProb: decision.probability || 0.5,
    edge: decision.edge || 0,
    confidence: decision.confidence || 0,
    apiTokens: 3000, // Appx
    brainStake: decision.stake // Pass the exact stake computed by EVA/Kelly
  };
}

// ── Enter position ───────────────────────────────────────────────────────────
// ── Kelly Criterion bet sizing (LVL 4+) ─────────────────────────────────────
function kellyStake(pnl, side, myProb, marketYesPrice, edge) {
  const xpData = expProgress(pnl.exp || 0);
  if (xpData.level < 4) return PAPER_BET_SIZE;
  const p = side === 'YES' ? myProb : 1 - myProb;
  const q = 1 - p;
  const odds = side === 'YES'
    ? (1 / Math.max(marketYesPrice, 0.01) - 1)
    : (1 / Math.max(1 - marketYesPrice, 0.01) - 1);
  const kelly = Math.max(0, (p * odds - q) / odds);
  const halfKelly = kelly / 2;  // half-Kelly = safer
  const fund = pnl.fund || 10000;
  const raw = fund * halfKelly;
  // Dynamic max based on WR — protect capital when losing
  const wr = pnl.trades > 0 ? pnl.wins / pnl.trades : 0.5;
  const maxStake = wr >= 0.60 ? 400    // 60%+ WR → aggressive, up to $400
    : wr >= 0.50 ? 250    // 50-59% WR → moderate, up to $250
      : wr >= 0.40 ? 150    // 40-49% WR → conservative, up to $150
        : 75;   // <40% WR → survival mode, max $75
  // Round to nearest $25, clamp $50-maxStake
  return Math.round(Math.min(Math.max(raw, 50), maxStake) / 25) * 25;
}

async function enterPosition(decision) {
  const { market, side, myProb, edge, confidence, thought } = decision;
  const pnlNow = loadPnL();
  const stake = kellyStake(pnlNow, side, myProb, market.yesPrice, edge);
  const xpData = expProgress(pnlNow.exp || 0);
  const kellyOn = xpData.level >= 4;

  cls();
  console.log(M + BOLD + '  ╔══════════════════════════════════════════════════════════════╗');
  console.log(M + BOLD + '  ║  ADAN  ·  PAPER BET  ·  ' + new Date().toLocaleTimeString().padEnd(35) + '║');
  console.log(M + BOLD + '  ╠══════════════════════════════════════════════════════════════╣');
  console.log(M + BOLD + '  ║  Market: ' + W + BOLD + (market.title || '').slice(0, 52).padEnd(52) + M + BOLD + ' ║');
  console.log(M + BOLD + '  ║  Side: ' + W + BOLD + side.padEnd(5) + X + M + BOLD + '  My prob: ' + Y + BOLD + (myProb * 100).toFixed(1) + '%' + M + BOLD + '  Market: ' + W + (market.yesPrice * 100).toFixed(1) + '%' + M + BOLD + '  Edge: ' + G + BOLD + (edge * 100).toFixed(1) + '%' + M + BOLD + '  ║');
  console.log(M + BOLD + '  ║  Confidence: ' + Y + BOLD + confidence + '%' + M + BOLD + '  Stake: ' + G + BOLD + '$' + stake + (kellyOn ? ' 📐KELLY' : ' flat') + M + BOLD + '  Liq: $' + (market.liquidity || 0).toFixed(0).padEnd(8) + '║');
  console.log(M + BOLD + '  ║  PAPER BET — no real money moved                             ║');
  console.log(M + BOLD + '  ╚══════════════════════════════════════════════════════════════╝' + X);
  await new Promise(r => setTimeout(r, 2000));

  // Build feature vector for cortex memory at entry time
  const entryVec = buildFeatureVector(market.priceData || {});

  const pos = loadPositions();
  pos.open.push({
    id: Date.now().toString(),
    marketId: market.id,
    marketTitle: market.title,
    asset: market.asset || 'other',
    side, myProb,
    marketPrice: market.yesPrice,
    edge, confidence,
    stake,
    entryTime: new Date().toISOString(),
    closesAt: market.closesAt || null,
    resolved: false, won: null, pnl: null,
    entryThought: thought ? thought.slice(0, 300) : '',
    entryVec     // saved for cortex memory on resolution
  });
  savePositions(pos);

  const pnl = loadPnL();
  pnl.fund = parseFloat(((pnl.fund || 100) - stake).toFixed(2));
  savePnL(pnl);
  awardExp(20);
  // Log hypothesis for episodic memory
  logHypothesis(market.id, market.asset || 'other', side, myProb, market.yesPrice, edge, market.closesAt);
}

// ── Confidence meta-learning ──────────────────────────────────────────────────
const METACALIB_PATH = path.join(DIR, 'metacalib.json');
function loadMetaCalib() {
  const def = { buckets: { '60': { pred: 0, correct: 0 }, '70': { pred: 0, correct: 0 }, '80': { pred: 0, correct: 0 }, '90': { pred: 0, correct: 0 } }, multiplier: 1.0 };
  try { return fs.existsSync(METACALIB_PATH) ? { ...def, ...JSON.parse(fs.readFileSync(METACALIB_PATH, 'utf8')) } : def; } catch { return def; }
}
function updateMetaCalib(confidence, won) {
  const mc = loadMetaCalib();
  const key = confidence >= 90 ? '90' : confidence >= 80 ? '80' : confidence >= 70 ? '70' : '60';
  if (!mc.buckets[key]) mc.buckets[key] = { pred: 0, correct: 0 };
  mc.buckets[key].pred++;
  if (won) mc.buckets[key].correct++;
  // Recalculate multiplier: if Claude says 70% conf but only 55% correct → multiplier = 0.55/0.70 = 0.78
  const totPred = Object.values(mc.buckets).reduce((s, b) => s + b.pred, 0);
  if (totPred >= 10) {
    const totCorrect = Object.values(mc.buckets).reduce((s, b) => s + b.correct, 0);
    const actualAcc = totCorrect / totPred;
    const avgConf = Object.entries(mc.buckets).reduce((s, [k, b]) => s + (parseInt(k) / 100) * b.pred, 0) / totPred;
    mc.multiplier = parseFloat(Math.min(1.3, Math.max(0.5, actualAcc / avgConf)).toFixed(3));
  }
  fs.writeFileSync(METACALIB_PATH, JSON.stringify(mc, null, 2));
  return mc;
}
function getMetaCalibContext() {
  const mc = loadMetaCalib();
  const tot = Object.values(mc.buckets).reduce((s, b) => s + b.pred, 0);
  if (tot < 5) return '';
  const cor = Object.values(mc.buckets).reduce((s, b) => s + b.correct, 0);
  return `META-CALIBRATION: Your stated confidence is ${mc.multiplier < 0.9 ? 'OVERCONFIDENT' : 'well-calibrated'} (multiplier=${mc.multiplier}). ` +
    `Actual accuracy ${Math.round(cor / tot * 100)}% on ${tot} predictions. ` +
    (mc.multiplier < 0.85 ? 'Reduce confidence estimates by ~' + Math.round((1 - mc.multiplier) * 100) + '%.' : '');
}

// ── Bottom-up knowledge: child insights → parent SOUL ────────────────────────
const INSIGHTS_PATH = path.join(DIR, 'insights.jsonl');
function logChildInsight(spec, asset, pattern, direction, occurrences) {
  const entry = { spec, asset, pattern, direction, occurrences, ts: new Date().toISOString(), promoted: false };
  fs.appendFileSync(INSIGHTS_PATH, JSON.stringify(entry) + '\n');
}
function promoteInsightsToSoul() {
  if (!fs.existsSync(INSIGHTS_PATH)) return;
  const lines = fs.readFileSync(INSIGHTS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const insights = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // Group by pattern
  const grouped = {};
  for (const ins of insights) {
    const k = ins.asset + '|' + ins.pattern;
    if (!grouped[k]) grouped[k] = { ...ins, count: 0 };
    grouped[k].count++;
  }
  // Promote patterns seen 3+ times and not yet promoted
  const toPromote = Object.values(grouped).filter(g => g.count >= 3 && !g.promoted);
  for (const p of toPromote) {
    appendToSoul(`\n### CHILD INSIGHT PROMOTED — ${new Date().toISOString()}:\n` +
      `[${p.spec}] Pattern: ${p.pattern} → ${p.direction} (confirmed ${p.count}x)\n`);
    // Mark as promoted
    const updated = lines.map(l => {
      try { const h = JSON.parse(l); return (h.asset === p.asset && h.pattern === p.pattern) ? JSON.stringify({ ...h, promoted: true }) : l; }
      catch { return l; }
    });
    fs.writeFileSync(INSIGHTS_PATH, updated.join('\n') + '\n');
  }
}


// AGI client reference (set in main)
let _agiClient = null;

// ── Survival Mode: ADAN ajusta sus reglas para sobrevivir ─────────────────────
function applySurvivalMode(pnl) {
  const fund = pnl.fund ?? 10000;
  const strat = loadStrategy();
  let mode = 'normal';
  let minEdge = 0.05;
  let maxPos = 9;
  let soulNote = null;

  // Paper trade $10k: trade freely to learn — survival only near death
  if (fund < 5) {
    mode = 'critical'; minEdge = 0.15; maxPos = 1;
    soulNote = `CRITICAL: fund $${fund.toFixed(2)} — near death. 15%+ edge only, 1 position. Must survive.`;
  } else if (fund < 50) {
    mode = 'survival'; minEdge = 0.12; maxPos = 2;
    soulNote = `SURVIVAL: fund $${fund.toFixed(2)} — almost gone. 12%+ edge, 2 positions. Make money or die.`;
  } else if (fund < 200) {
    mode = 'cautious'; minEdge = 0.08; maxPos = 4;
    soulNote = null;
  }

  // Update strategy dynamically
  if (strat.minEdge !== minEdge || strat.maxPositions !== maxPos) {
    strat.minEdge = minEdge;
    strat.maxPositions = maxPos;
    fs.writeFileSync(STRATEGY_PATH, JSON.stringify(strat, null, 2));
  }

  // Write survival note to SOUL if entering danger
  if (soulNote) {
    const existing = fs.readFileSync(SOUL_PATH, 'utf8');
    if (!existing.includes(soulNote.slice(0, 40))) {
      fs.appendFileSync(SOUL_PATH, `\n### SURVIVAL — ${new Date().toISOString()}:\n${soulNote}\n`);
    }
  }

  return { mode, minEdge, maxPos };
}

// ── Main scan ────────────────────────────────────────────────────────────────
async function checkResolutions() {
  const pos = loadPositions();
  if (!pos.open.length) return;
  let changed = false;

  for (let i = pos.open.length - 1; i >= 0; i--) {
    const p = pos.open[i];
    if (p.resolved || !p.closesAt) continue;
    const endMs = new Date(p.closesAt).getTime();
    if (Date.now() < endMs) continue; // not yet closed

    // Fetch market result from Polymarket
    const data = await polyFetch('/markets/' + p.marketId);
    if (!data) continue;
    const closed = data.closed || data.archived || data.active === false;
    if (!closed) continue;

    // Determine winner
    let outcomePrices;
    try { outcomePrices = typeof data.outcomePrices === 'string' ? JSON.parse(data.outcomePrices) : data.outcomePrices; }
    catch { outcomePrices = [0.5, 0.5]; }
    // If YES resolved to 1.0 → YES won
    const yesWon = Array.isArray(outcomePrices) && parseFloat(outcomePrices[0]) >= 0.99;
    const won = (p.side === 'YES' && yesWon) || (p.side === 'NO' && !yesWon);

    // Slippage simulation: 1.5% deducted on entry + exit = realistic paper trading (Nightmare Engine)
    const SLIPPAGE = 0.015; // 1.5% per side for low-liquidity PM markets
    const slippageCost = parseFloat((p.stake * SLIPPAGE * 2).toFixed(2)); // entry + exit
    let pnlVal;
    if (won) {
      const mult = p.side === 'YES' ? 1 / Math.max(p.marketPrice, 0.01) : 1 / Math.max(1 - p.marketPrice, 0.01);
      pnlVal = parseFloat((p.stake * (mult - 1) - slippageCost).toFixed(2));
    } else {
      pnlVal = parseFloat((-p.stake - slippageCost).toFixed(2));
    }

    // BRIER SCORE CALCULATION (Calibration metric)
    const actual = yesWon ? 1 : 0;
    const pred = p.side === 'YES' ? (p.confidence / 100) : (1 - (p.confidence / 100));
    const brierScore = parseFloat(Math.pow(pred - actual, 2).toFixed(4));

    p.resolved = true; p.won = won; p.pnl = pnlVal; p.result = won ? 'WIN' : 'LOSS'; p.brierScore = brierScore;
    p.resolvedAt = new Date().toISOString();
    pos.closed.push({ ...p });
    pos.open.splice(i, 1);
    changed = true;
    resolveHypothesis(p.marketId, won);
    updateMetaCalib(p.confidence || 65, won);
    promoteInsightsToSoul();

    // ── Record Result for Brain Manager
    if (p.brainStake && p.brainStake > 0) {
      brainManager.recordResult({
        brainName: p.brain || 'DEFAULT',
        won,
        predictedP: pred,
        actualOutcome: actual,
        edge: p.edge,
      });
    }
    // Cortex Memory: store trade with its entry feature vector
    if (p.entryVec) {
      memorizeTradeContext(p, { orderBook: { buyPressure: p.entryVec.buyPressure, ratio: p.entryVec.obRatio, sellWallTrap: p.entryVec.sellWallTrap, buyWallTrap: p.entryVec.buyWallTrap }, rsi: p.entryVec.rsi, rsi5m: p.entryVec.rsi5m, trend1m: p.entryVec.trend1m, trend5m: p.entryVec.trend5m, trend15m: p.entryVec.trend15m, trend1h: p.entryVec.trend1h, bb: { pct: p.entryVec.bbPct }, vol: { ratio: p.entryVec.volRatio }, volAccel: p.entryVec.volAccel, vwap5m: { pct: p.entryVec.vwapPct }, volatility: p.entryVec.volatility }, won);
    }

    // We need awardChildExp if we have it or try
    if (typeof awardChildExp === 'function') awardChildExp(p.asset || 'btc', won);

    const pnl2 = loadPnL();
    pnl2.trades = (pnl2.trades || 0) + 1;
    if (won) {
      pnl2.wins = (pnl2.wins || 0) + 1; pnl2.streak = (pnl2.streak || 0) + 1;
      pnl2.fund = parseFloat(((pnl2.fund || 100) + p.stake + pnlVal).toFixed(2));
      pnl2.net = parseFloat(((pnl2.net || 0) + pnlVal).toFixed(2));
      pnl2.treasury = parseFloat(((pnl2.treasury || 0) + pnlVal * TREE_RULES.treasuryPct).toFixed(2));
      pnl2.brierTotal = (pnl2.brierTotal || 0) + brierScore;
      pnl2.brierCount = (pnl2.brierCount || 0) + 1;
      pnl2.brierScore = parseFloat((pnl2.brierTotal / pnl2.brierCount).toFixed(4));
      awardExp(calcWinExp(p.confidence, Math.abs(p.edge || 0), pnl2.streak));
      updateCalibration(p.asset, true);
      if (pnl2.trades % 5 === 0) {
        const rec = pos.closed.slice(-5);
        appendToSoul(`\n### PATTERNS — ${new Date().toISOString()} (${pnl2.trades} trades):\nWR: ${Math.round(pnl2.wins / pnl2.trades * 100)}%. Recent: ${rec.map(c => c.result + '[' + c.asset + ']').join(', ')}.\n`);
      }
    } else {
      pnl2.losses = (pnl2.losses || 0) + 1; pnl2.streak = 0;
      pnl2.net = parseFloat(((pnl2.net || 0) + pnlVal).toFixed(2));
      pnl2.brierTotal = (pnl2.brierTotal || 0) + brierScore;
      pnl2.brierCount = (pnl2.brierCount || 0) + 1;
      pnl2.brierScore = parseFloat((pnl2.brierTotal / pnl2.brierCount).toFixed(4));
      awardExp(30);
      updateCalibration(p.asset, false);
      appendToSoul(`\n### MISTAKE — ${new Date().toISOString()}:\nLOSS on "${p.marketTitle}" (${p.asset}). My: ${(p.myProb * 100).toFixed(0)}% vs market: ${(p.marketPrice * 100).toFixed(0)}%. Edge was ${(p.edge * 100).toFixed(1)}%. Brier Score: ${brierScore}\n`);
    }
    const h = new Date().getHours().toString();
    if (!pnl2.hourStats) pnl2.hourStats = {};
    if (!pnl2.hourStats[h]) pnl2.hourStats[h] = { wins: 0, losses: 0 };
    won ? pnl2.hourStats[h].wins++ : pnl2.hourStats[h].losses++;
    savePnL(pnl2);
    console.log('\n' + (won ? G : R) + BOLD + '  ► ' + (won ? 'WIN' : 'LOSS') + ' resolved: ' + p.marketTitle + ' → $' + (pnlVal >= 0 ? '+' : '') + pnlVal + X + '\n');
    await new Promise(r => setTimeout(r, 1000));
  }
  if (changed) {
    savePositions(pos);
    const pnlFinal = loadPnL();
    if (typeof _agiClient !== 'undefined' && _agiClient) {
      try { autoEvolveSoul(_agiClient, pnlFinal).catch(() => { }); } catch { }
    }
    absorbEliteGenome(pnlFinal);
    pruneDeadChildren(loadPnL());
    runTournamentOfDeath(loadPnL());
    promoteEliteGrandchild(loadPnL());
    const lastClosed = pos.closed[pos.closed.length - 1];
    if (lastClosed) evaluateParentPerformance(loadPnL(), lastClosed);
    checkUsurperPath(loadPnL());
  }
}

async function doScan(client, state) {
  let pnl = loadPnL();
  const survival = applySurvivalMode(pnl);
  state.survivalMode = survival.mode;
  const openPos = loadPositions().open;
  const strat = loadStrategy();
  const soul = loadSoul();

  // Auto-spawn check
  const xpCheck = expProgress(pnl.exp || 0);
  const sc = TREE_RULES.spawnConditions;
  const childCount = (pnl.children || []).length;
  const maxC = xpCheck.level >= 4 ? TREE_RULES.maxChildrenGen1 : TREE_RULES.maxChildrenAtLvl3;
  const spawnReady = xpCheck.level >= sc.minLvl
    && pnl.trades >= sc.minTrades
    && (pnl.wins / Math.max(pnl.trades, 1)) >= sc.minWinRate
    && childCount < maxC
    && (pnl.treasury || 0) > 0;
  if (spawnReady) {
    const newChild = await spawnChild(client, pnl, null);
    if (newChild) {
      pnl = loadPnL();
      cls();
      console.log('\n' + C + BOLD + '  ╔══════════════════════════════════════════════════════════════╗');
      console.log(C + BOLD + '  ║  👶 CHILD BORN!  ' + Y + BOLD + (newChild.name || newChild.spec).padEnd(12) + C + BOLD + '  spec: ' + newChild.spec.padEnd(14) + 'Gen ' + newChild.generation + ' ║');
      console.log(C + BOLD + '  ║  Capital: $' + newChild.capital.toFixed(2) + '  Specialization: ' + newChild.spec.padEnd(20) + '      ║');
      console.log(C + BOLD + '  ║  "I am ' + (newChild.name || 'UNNAMED') + '. I serve ADAN. I scan. I learn. I report."          ║');
      console.log(C + BOLD + '  ╚══════════════════════════════════════════════════════════════╝' + X + '\n');
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  // Check grandchildren spawning (LVL 4+ only, silently in background)
  if (xpCheck.level >= 4) spawnGrandchildren(client).catch(() => { });

  if (openPos.length >= MAX_POSITIONS) {
    state.thought = 'All ' + MAX_POSITIONS + ' slots full. Monitoring for resolutions.';
    state.mode = 'result'; render(state); return;
  }

  // 1. Fetch Binance prices
  state.status = 'Fetching Binance prices...'; render(state);
  const prices = await fetchAllPrices();
  state.prices = prices;

  // 2. Fetch Polymarket markets
  state.status = 'Fetching Polymarket markets...'; render(state);
  const rawMkts = await fetchPolymarkets(strat);
  const allMarkets = rawMkts.map(m => normalizePolymarket(m, prices)).filter(m => m && m.id && m.title);

  // Separate: ACTIVE NOW (close <4h) vs FUTURE (close >4h)
  const nowMs2 = Date.now();
  const activeNow = allMarkets.filter(m => m.closesAt && (new Date(m.closesAt) - nowMs2) < 4 * 3600 * 1000);
  const future = allMarkets.filter(m => !m.closesAt || (new Date(m.closesAt) - nowMs2) >= 4 * 3600 * 1000);

  // Show display: active first, then future
  const markets = activeNow.length > 0 ? activeNow : future;

  // Rough edge sort (display only)
  markets.forEach(m => { if (m.edge == null) m.edge = Math.abs(m.yesPrice - 0.5) * 0.4; });
  markets.sort((a, b) => {
    // Up/Down always first
    if (a._isUpDown && !b._isUpDown) return -1;
    if (!a._isUpDown && b._isUpDown) return 1;
    return (new Date(a.closesAt || 0)) - (new Date(b.closesAt || 0));
  });
  state.markets = markets.slice(0, 8);

  // Sleep mode: if no active markets right now → activate Night Watch Broad Scanner
  if (activeNow.length === 0) {
    // Shadow mode: use offline time to practice Binance-only predictions (LVL 25+)
    const xpShadow = expProgress(pnl.exp || 0);
    if (xpShadow.level >= 25 && prices) {
      for (const [sym, d] of Object.entries(prices)) {
        if (!d || sym === '_meta') continue;
        const asset = sym.replace('USDT', '').toLowerCase();
        const sig = childSignal(d);
        if (sig.dir !== 'NEUTRAL' && sig.conf >= 60) {
          logShadowPrediction(asset, sig.dir === 'UP' ? 'UP' : 'DOWN', d.price, 5);
        }
      }
    }
    checkShadowResolutions(prices);
    runAllChildScanners(prices, allMarkets).catch(() => { });

    // ── DREAM MODE — off-hours self-reflection (AGI Layer 6) ─────────────
    if (client && !pnl._lastDream || (Date.now() - new Date(pnl._lastDream || 0).getTime()) > 3600000) {
      dreamMode(client, pnl).catch(() => { });
    }

    // ── NIGHT WATCH BROAD SCANNER ─────────────
    // Fetch ALL active markets regardless of close time or crypto tag to train the models locally
    state.status = 'Activating Night Watch Broad Scanner...'; render(state);
    const fallback = await polyFetch('/markets?limit=100&active=true&closed=false&order=volumeNum&ascending=false');
    const fbList = Array.isArray(fallback) ? fallback : (fallback?.markets || []);
    const validFallback = fbList.filter(m => m.yesPrice > 0.05 && m.yesPrice < 0.95).slice(0, 10);

    if (validFallback.length > 0) {
      state.markets = validFallback.map(m => normalizePolymarket(m, prices));
      markets = state.markets; // Override loop target so the brain processes them
      state.thought = `🌙 VIGILIA NOCTURNA: Mercados Crypto a corto plazo cerrados.\nEscaneando \${validFallback.length} mercados globales (Política, Deportes, etc.) para entrenar a los Avatares toda la noche.`;
    } else {
      state.thought = 'Polymarket API offline. Retrying in ' + Math.round(SCAN_INTERVAL_MS / 60000) + 'min.';
      state.mode = 'result'; state.lastScan = new Date().toLocaleTimeString();
      state.nextScanIn = Math.round(SCAN_INTERVAL_MS / 60000);
      render(state); return;
    }
  }

  // 2.5 Run child scanners in background (LVL 3+) — no Claude, just data
  runAllChildScanners(prices, allMarkets).catch(() => { });
  checkShadowResolutions(prices);

  // 2.6 BOREDOM FILTER — skip Claude call if market is asleep (low BB width + low volume)
  // Saves API tokens and prevents ADAN from over-trading in flat markets
  const BOREDOM_BB_MIN = 0.006; // BB width < 0.6% = market compressed = chop zone
  const BOREDOM_VOL_MIN = 0.75;  // volume ratio < 0.75x avg = nobody trading
  const activeSyms = Object.entries(prices).filter(([k, v]) => v && k !== '_meta');
  const anyActive = activeSyms.some(([, d]) =>
    (d.bb?.width || 0) >= BOREDOM_BB_MIN || (d.vol?.ratio || 1) >= BOREDOM_VOL_MIN
  );

  // Bypass Boredom Filter if we are in Night Watch mode (scanning non-crypto markets)
  const isNightWatchMode = activeNow.length === 0;

  if (!anyActive && activeSyms.length > 0 && !isNightWatchMode) {
    const bbAvg = (activeSyms.reduce((s, [, d]) => s + (d.bb?.width || 0), 0) / activeSyms.length * 100).toFixed(2);
    const volAvg = (activeSyms.reduce((s, [, d]) => s + (d.vol?.ratio || 1), 0) / activeSyms.length).toFixed(2);
    state.thought = `⏸ AUTO-SKIP — Market dormant (BB width avg: ${bbAvg}% < 0.6%, vol ratio avg: ${volAvg}x < 0.75x).\nNo conviction in Binance. Polymarket prices have nothing real to lag. Preserving tokens + capital.\nNext check in ${Math.round(SCAN_INTERVAL_MS / 60000)}min.`;
    state.mode = 'result';
    state.lastScan = new Date().toLocaleTimeString();
    state.nextScanIn = Math.round(SCAN_INTERVAL_MS / 60000);
    render(state); return;
  }

  // 2.7 HOUR FILTER — skip hours with historically terrible WR (< 30% over 3+ samples)
  const curHour = new Date().getUTCHours().toString();
  const hourData = pnl.hourStats?.[curHour];
  if (hourData) {
    const hourTotal = (hourData.wins || 0) + (hourData.losses || 0);
    const hourWR = hourTotal > 0 ? (hourData.wins || 0) / hourTotal : 0.5;
    if (hourTotal >= 3 && hourWR < 0.30) {
      state.thought = `⏸ HOUR FILTER — UTC hour ${curHour} has ${Math.round(hourWR * 100)}% WR over ${hourTotal} trades (< 30% threshold).\nHistorically a losing hour. Skipping to protect capital. Better to wait for a high-WR window.\nNext scan in ${Math.round(SCAN_INTERVAL_MS / 60000)}min.`;
      state.mode = 'result';
      state.lastScan = new Date().toLocaleTimeString();
      state.nextScanIn = Math.round(SCAN_INTERVAL_MS / 60000);
      render(state); return;
    }
  }

  // 3. CAPITAL LOCKUP MANAGER (Risk Guard)
  // Enforce Max 60% Treasury Utilization
  const currentTreasury = pnl.treasury || 10000;
  let lockedCapital = 0;
  openPos.forEach(p => { lockedCapital += (p.amount || 0); });
  const lockupRatio = lockedCapital / currentTreasury;

  if (lockupRatio >= 0.60) {
    state.thought = `🛑 CAPITAL LOCKUP VETO [EVA] — Locked capital ($${lockedCapital.toFixed(2)}) is ≥ 60% of Treasury ($${currentTreasury.toFixed(2)}). Max exposure reached. Waiting for resolutions before opening new positions.\nNext scan in ${Math.round(SCAN_INTERVAL_MS / 60000)}min.`;
    state.mode = 'result';
    state.lastScan = new Date().toLocaleTimeString();
    state.nextScanIn = Math.round(SCAN_INTERVAL_MS / 60000);
    render(state); return;
  }

  // 4. Think (Neural Pipeline)
  state.mode = 'thinking'; render(state);
  let decision;
  try {
    decision = await think(client, markets, prices, pnl, openPos, soul);
    // Slippage Engine penalty injected inside think() logic
    state.apiCost = parseFloat(((state.apiCost || 0) + (decision.apiTokens || 2000) / 1e6 * 9).toFixed(5));
  } catch (e) {
    state.thought = 'Claude error: ' + e.message; state.mode = 'result'; render(state); return;
  }

  state.thought = decision.thought;
  state.mode = 'result';
  state.lastScan = new Date().toLocaleTimeString();
  state.nextScanIn = Math.round(SCAN_INTERVAL_MS / 60000);

  if (decision.action === 'BET' && decision.market) await enterPosition(decision);

  render(state);
}

// ── Setup ────────────────────────────────────────────────────────────────────
async function setup() {
  const { createInterface } = await import('readline');
  cls();
  console.log('\n' + M + BOLD);
  console.log('  ╔══════════════════════════════════════════════════════════════════╗');
  console.log('  ║                                                                  ║');
  console.log('  ║    ▄▄▄  ▄▄▄  ▄▄  ▄  ▄▄▄  ▄▄▄  ▄▄▄  ▄▄▄                        ║');
  console.log('  ║   █    █    █  █ █  █    █    █    █  █                         ║');
  console.log('  ║   █▄▄  █    ██▀  █  █    █    █    █▀▀                          ║');
  console.log('  ║    ▄▄█ █    █  █ █  █    █    █    █  █                         ║');
  console.log('  ║   ▀▀▀  ▀▀▀ █  █ ▀▀  ▀▀▀  ▀    ▀▀▀ █  █                        ║');
  console.log('  ║                                                                  ║');
  console.log('  ║         P R E D I C T I O N   M A R K E T S   A G E N T        ║');
  console.log('  ║     Polymarket  ·  Binance  ·  Claude Sonnet 4.6  ·  2026       ║');
  console.log('  ║                                                                  ║');
  console.log('  ╠══════════════════════════════════════════════════════════════════╣');
  console.log('  ║                                                                  ║');
  console.log('  ║   DATA:    Binance API   — BTC/ETH/SOL candles (free)           ║');
  console.log('  ║   MARKETS: Polymarket    — crypto up/down 5-15min               ║');
  console.log('  ║   BRAIN:   Sonnet 4.6   — edge calculation + calibration        ║');
  console.log('  ║   MODE:    Paper trading → real USDC at Level 40                ║');
  console.log('  ║                                                                  ║');
  console.log('  ╠══════════════════════════════════════════════════════════════════╣');
  console.log('  ║                                                                  ║');
  console.log('  ║   Get your Anthropic key at:                                    ║');
  console.log('  ║   console.anthropic.com/settings/keys                           ║');
  console.log('  ║                                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════════════════════╝');
  console.log(X + '\n');

  const key = await new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write('  > Paste Anthropic API key and press ENTER: ');
    rl.once('line', ans => { rl.close(); resolve(ans); });
  });

  const trimmed = key.trim();
  if (!trimmed || trimmed.length < 20) {
    console.log('\n  ✗ No key entered. Run again.\n');
    process.exit(1);
  }

  const config = { anthropicKey: trimmed, mode: 'paper', createdAt: new Date().toISOString() };
  saveConfig(config);
  cls();
  console.log('\n' + G + BOLD);
  console.log('  ╔══════════════════════════════════════════════════════════════════╗');
  console.log('  ║   ✓  API KEY SAVED                                               ║');
  console.log('  ║   ✓  BINANCE CONNECTION: FREE — NO KEY NEEDED                   ║');
  console.log('  ║   ✓  POLYMARKET CONNECTION: FREE — NO KEY NEEDED                ║');
  console.log('  ║   ✓  PAPER TRADING MODE ACTIVE — $100 VIRTUAL FUND              ║');
  console.log('  ║   ✓  ADAN IS WAKING UP...                                        ║');
  console.log('  ╚══════════════════════════════════════════════════════════════════╝' + X + '\n');
  await new Promise(r => setTimeout(r, 2000));
  return config;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir();
  // Load API key from .env file first, fallback to config.json
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) process.env[match[1]] = match[2].trim();
      }
    }
  } catch { }
  let config = loadConfig();
  if (!config?.anthropicKey) config = await setup();
  // Prefer .env key over config.json
  const apiKey = process.env.ANTHROPIC_API_KEY || config.anthropicKey;
  if (!apiKey || apiKey === 'FROM_ENV') {
    console.log(R + 'ERROR: No API key found. Add ANTHROPIC_API_KEY to .env file or config.json' + X);
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });
  _agiClient = client; // AGI layers use this reference
  loadSoul();
  startDashboard(brainManager);

  const state = {
    status: 'Starting...', mode: 'idle', thought: null,
    pnl: loadPnL(), positions: loadPositions(),
    markets: [], prices: {},
    lastScan: null, nextScanIn: 5, apiCost: 0
  };

  render(state);
  await checkResolutions();

  const loop = async () => {
    try {
      state.pnl = loadPnL();
      state.positions = loadPositions();
      await checkResolutions();
      await doScan(client, state);

      // Adan Faction Explanations (Golden Round Table)
      if (Math.random() < 0.2) {
        const explanations = [
          "APPLE (Context): I scan the macro horizon. Fear, greed, and global narratives define the 'Playbook'.",
          "SNAKE (Execution): Volatility is my venom. I identify the highest-edge markets where others hesitate.",
          "EVA (Risk): I am the shield. No child or parent enters a trade without my seal of safety.",
          "MESA REDONDA: Our unity allows ADAN to transcend the chaos of the markets."
        ];
        const msg = explanations[Math.floor(Math.random() * explanations.length)];
        appendToSoul(msg);
      }

      state.pnl = loadPnL();
      state.positions = loadPositions();
      render(state);
    } catch (e) { console.error(R + 'Loop error: ' + e.message + X); }
    setTimeout(loop, SCAN_INTERVAL_MS);
  };

  setTimeout(loop, 2000);
  setInterval(() => { state.pnl = loadPnL(); state.positions = loadPositions(); if (state.mode === 'idle') render(state); }, 30000);
}

main().catch(e => { console.error(e); process.exit(1); });
