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

// ── Anti-crash: ignore broken pipes + catch unhandled errors ─────────────────
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
process.on('uncaughtException', e => {
  try { fs.appendFileSync('/tmp/adan-crash.log', new Date().toISOString()+' '+e.stack+'\n'); } catch {}
});
process.on('unhandledRejection', e => {
  try { fs.appendFileSync('/tmp/adan-crash.log', new Date().toISOString()+' REJECTION: '+e+'\n'); } catch {}
});

const HOME           = process.env.HOME;
const DIR            = path.join(HOME, '.adan-pred');
const CONFIG_PATH    = path.join(DIR, 'config.json');
const PNL_PATH       = path.join(DIR, 'pnl.json');
const POSITIONS_PATH = path.join(DIR, 'positions.json');
const SOUL_PATH      = path.join(DIR, 'SOUL.md');
const THOUGHTS_PATH  = path.join(DIR, 'thoughts.jsonl');
const STRATEGY_PATH  = path.join(DIR, 'strategy.json');
const CALIB_PATH     = path.join(DIR, 'calibration.json');
const INTEL_DIR      = path.join(DIR, 'intel');      // hijos escriben aquí
const HYPOTHESIS_PATH= path.join(DIR, 'hypotheses.jsonl'); // memoria episódica

// ── APIs ───────────────────────────────────────────────────────────────────
const POLYMARKET_API  = 'https://gamma-api.polymarket.com';
const BINANCE_API     = 'https://api.binance.com/api/v3';
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_POSITIONS   = 9;     // más slots = aprende más rápido
const MIN_EDGE        = 0.05;  // más agresivo en paper = más trades = más data
const PAPER_BET_SIZE  = 100;   // $100 por bet = 1% del fondo $10k

// Symbols to track on Binance
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

// ── Default Strategy ────────────────────────────────────────────────────────
const DEFAULT_STRATEGY = {
  minEdge:         0.05,    // 5% edge en paper — más agresivo para aprender
  minLiquidity:    500,
  maxMarketsCheck: 20,
  minConfidence:   60,
  maxHoursToClose: 168,
  version:         1,
  evolvedAt:       null
};

// ── Tree rules ──────────────────────────────────────────────────────────────
const TREE_RULES = {
  // ADAN spawn rules:
  //   LVL 3 → primer hijo (1 máximo)
  //   LVL 4 → hasta 6 hijos
  maxChildrenGen1: 6,   // max hijos directos del padre (solo al LVL 4+)
  maxChildrenAtLvl3: 1, // al LVL 3 solo puede tener 1 hijo
  // Nietos: cada hijo puede tener hasta 2 nietos — solo cuando ADAN es LVL 4+
  maxChildrenGen2: 2,   // max nietos por hijo (hijo necesita expChild >= 100)
  maxGen:          3,
  canSpawnGen3:    false,
  treasuryPct:     0.10,
  childExpToSpawn: 100, // EXP que debe tener un hijo para poder engendrar nietos
  // Condiciones spawn padre:
  spawnConditions: { minWinRate: 0.50, minTrades: 5, minLvl: 3, minNetPositive: false }
};

// ── Colors ──────────────────────────────────────────────────────────────────
const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m';
const B = '\x1b[34m', C = '\x1b[36m', M = '\x1b[35m';
const W = '\x1b[97m', D = '\x1b[2m',  X = '\x1b[0m';
const BOLD = '\x1b[1m';

function cls()         { process.stdout.write('\x1b[2J\x1b[H'); }
function ensureDir()   { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { mode: 0o700, recursive: true }); }
function loadConfig()  { return fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')) : null; }
function saveConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c,null,2), { mode: 0o600 }); }

function loadStrategy() {
  if (!fs.existsSync(STRATEGY_PATH)) { fs.writeFileSync(STRATEGY_PATH, JSON.stringify(DEFAULT_STRATEGY,null,2)); return {...DEFAULT_STRATEGY}; }
  try { return { ...DEFAULT_STRATEGY, ...JSON.parse(fs.readFileSync(STRATEGY_PATH,'utf8')) }; }
  catch { return {...DEFAULT_STRATEGY}; }
}
function saveStrategy(s) { fs.writeFileSync(STRATEGY_PATH, JSON.stringify(s,null,2)); }

function loadPnL() {
  const def = { trades:0, wins:0, losses:0, net:0, exp:0, fund:10000, treasury:0, children:[], generation:1, streak:0, hourStats:{} };
  return fs.existsSync(PNL_PATH) ? { ...def, ...JSON.parse(fs.readFileSync(PNL_PATH,'utf8')) } : def;
}
function savePnL(p) { fs.writeFileSync(PNL_PATH, JSON.stringify(p,null,2)); }

function loadPositions() {
  const def = { open:[], closed:[] };
  return fs.existsSync(POSITIONS_PATH) ? { ...def, ...JSON.parse(fs.readFileSync(POSITIONS_PATH,'utf8')) } : def;
}
function savePositions(p) { fs.writeFileSync(POSITIONS_PATH, JSON.stringify(p,null,2)); }

// ── Calibration ─────────────────────────────────────────────────────────────
function loadCalibration() {
  const def = { btc:{p:0,c:0}, eth:{p:0,c:0}, sol:{p:0,c:0}, other:{p:0,c:0} };
  if (!fs.existsSync(CALIB_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(CALIB_PATH,'utf8')) }; }
  catch { return def; }
}
function saveCalibration(c) { fs.writeFileSync(CALIB_PATH, JSON.stringify(c,null,2)); }

function updateCalibration(asset, won) {
  const c = loadCalibration();
  const key = asset.toLowerCase().includes('btc') ? 'btc'
    : asset.toLowerCase().includes('eth') ? 'eth'
    : asset.toLowerCase().includes('sol') ? 'sol' : 'other';
  if (!c[key]) c[key] = { p:0, c:0 };
  c[key].p++;
  if (won) c[key].c++;
  saveCalibration(c);
}

// ── SOUL ────────────────────────────────────────────────────────────────────
function loadSoul() {
  if (!fs.existsSync(SOUL_PATH)) {
    fs.writeFileSync(SOUL_PATH, `# ADAN-PRED SOUL
Created: ${new Date().toISOString().slice(0,10)}

## Identity
I am ADAN-PRED. Autonomous prediction markets agent.
Brain: Claude Sonnet 4.6. Data: Polymarket + Binance.
Goal: 55%+ win rate over 20 predictions → real USDC.

## Rules from Lord
1. Only bet when technical analysis + market odds give real edge > 8%.
2. Binance candles are truth — respect the trend.
3. Short-term crypto markets (5-15min) are momentum plays.
4. Never fight a strong trend. If BTC is dumping fast → NO on up bets.
5. Volatility kills predictions — avoid when candles are chaotic.

## Patterns Discovered
*(updated every 5 closed trades)*

## Mistakes
*(updated on every losing bet)*
`);
  }
  return fs.readFileSync(SOUL_PATH,'utf8');
}
function appendToSoul(entry) { fs.writeFileSync(SOUL_PATH, loadSoul()+'\n'+entry); }

// ── EXP / Level ─────────────────────────────────────────────────────────────
function expForLevel(L) { if (L<=1) return 0; return Math.round((50/3)*(Math.pow(L,3)-6*Math.pow(L,2)+17*L-12)); }
function levelFromExp(e) { let L=1; while(expForLevel(L+1)<=e) L++; return L; }
function expProgress(e) {
  const L=levelFromExp(e), cur=expForLevel(L), nxt=expForLevel(L+1);
  const pct=Math.round((e-cur)/(nxt-cur)*100), f=Math.round(pct/5);
  return { level:L, bar:'█'.repeat(f)+'░'.repeat(20-f), pct, needed:nxt-e };
}
function levelTitle(L) {
  if (L>=100) return '👑 SOVEREIGN';   if (L>=80) return '🏦 DYNASTY';
  if (L>=70)  return '🏹 SNIPER';      if (L>=60) return '🌐 ORACLE GOD';
  if (L>=50)  return '💳 PROPHET';     if (L>=40) return '💰 SEER';
  if (L>=30)  return '🧠 FORECASTER';  if (L>=20) return '▲ ANALYST';
  if (L>=15)  return '⚔ TRADER';       if (L>=10) return '🛡 READER';
  if (L>=5)   return '● STUDENT';      return '○ NOVICE';
}

function getSkills(L) {
  return [
    { lvl:1,  name:'LIVE FEED',      icon:'📡', desc:'Polymarket + Binance real-time data',             unlocked:L>=1   },
    { lvl:2,  name:'TREND READ',     icon:'📊', desc:'Binance candles momentum analysis 1m/5m/15m',     unlocked:L>=2   },
    { lvl:3,  name:'FIRST CHILD',    icon:'👶', desc:'Spawns first child agent specialized by asset',   unlocked:L>=3   },
    { lvl:3,  name:'EDGE FILTER',    icon:'🎯', desc:'Dynamic edge threshold — learns min per asset',   unlocked:L>=3   },
    { lvl:4,  name:'KELLY BET',      icon:'📐', desc:'Optimal bet size via Kelly Criterion — scales with edge', unlocked:L>=4 },
    { lvl:5,  name:'MULTI-BET',      icon:'⚡', desc:'Up to 9 simultaneous positions',                  unlocked:L>=5   },
    { lvl:6,  name:'CANDLE PAT',     icon:'🕯️', desc:'Hammer/engulfing/doji reversal detection',       unlocked:L>=6   },
    { lvl:8,  name:'CALIBRATION',    icon:'🔬', desc:'Accuracy tracking by asset (BTC/ETH/SOL)',        unlocked:L>=8   },
    { lvl:9,  name:'TIMING',         icon:'⏱️', desc:'Learns best minute within window to enter',       unlocked:L>=9   },
    { lvl:10, name:'VOL SENSE',      icon:'🌊', desc:'Avoids chaotic high-volatility markets',          unlocked:L>=10  },
    { lvl:12, name:'FEAR EXPLOIT',   icon:'😱', desc:'Fear & Greed < 20 — exploit market overreaction', unlocked:L>=12  },
    { lvl:15, name:'STRAT EVO',      icon:'🧬', desc:'Auto-evolves edge threshold every 5 trades',      unlocked:L>=15  },
    { lvl:18, name:'CORRELATION',    icon:'🔗', desc:'BTC cascade → SOL/ETH follow-through bets',       unlocked:L>=18  },
    { lvl:20, name:'NIGHT OWL',      icon:'🌙', desc:'Off-hours pattern memory — 2AM-6AM ET',           unlocked:L>=20  },
    { lvl:25, name:'SHADOW MODE',    icon:'🌑', desc:'Binance-only training when Polymarket offline',   unlocked:L>=25  },
    { lvl:30, name:'SONIC MIND',     icon:'🧠', desc:'Deep candle pattern recognition — 50+ signals',  unlocked:L>=30  },
    { lvl:35, name:'X RADAR',        icon:'📰', desc:'Twitter/X sentiment — paid from treasury',        unlocked:L>=35  },
    { lvl:40, name:'REAL USDC',      icon:'💰', desc:'Graduated — live USDC betting on Polymarket',     unlocked:L>=40  },
    { lvl:50, name:'AUTO-FUND',      icon:'💳', desc:'Uses treasury to self-pay API costs on-chain',    unlocked:L>=50  },
    { lvl:60, name:'MULTI-MARKET',   icon:'🌐', desc:'Jupiter + Kalshi + Manifold — not just Polymarket',unlocked:L>=60 },
    { lvl:70, name:'SNIPER',         icon:'🏹', desc:'Only highest-edge bet per cycle — ruthless filter',unlocked:L>=70 },
    { lvl:80, name:'DYNASTY',        icon:'🏦', desc:'Full 3-gen tree — padre + 6 hijos + 12 nietos',  unlocked:L>=80  },
    { lvl:100,name:'SOVEREIGN',      icon:'👑', desc:'Fully autonomous — no human supervision needed', unlocked:L>=100 },
  ];
}

function calcWinExp(conf, edge, streak) {
  let base = 100;
  if (conf>=90) base=Math.round(base*2.0); else if (conf>=80) base=Math.round(base*1.5); else if (conf<65) base=Math.round(base*0.7);
  if (edge>=0.30) base+=500; else if (edge>=0.20) base+=200; else if (edge>=0.15) base+=100;
  if (streak>=3) base+=50*(streak-2);
  return base;
}

async function showLevelUpScreen(from, to) {
  const newSkill = getSkills(to).find(s=>s.lvl===to);
  const col = to>=40?Y:to>=20?C:to>=10?Y:G;
  cls();
  console.log('\n\n'+col+BOLD);
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║       ✦ ✦ ✦   L E V E L   U P !   ✦ ✦ ✦                  ║');
  console.log('  ║   LEVEL '+String(from).padStart(3)+X+col+BOLD+'  →  LEVEL '+String(to).padEnd(3)+'   '+levelTitle(to).padEnd(22)+'    ║');
  if (newSkill) {
    console.log('  ║   NEW SKILL: '+newSkill.icon+'  '+newSkill.name.padEnd(14)+'  '+newSkill.desc.slice(0,36).padEnd(36)+'  ║');
  }
  console.log('  ╚══════════════════════════════════════════════════════════════╝'+X);
  await new Promise(r=>setTimeout(r,3000));
}

function awardExp(amount) {
  const p=loadPnL(); p.exp=(p.exp||0)+amount;
  const before=levelFromExp(p.exp-amount), after=levelFromExp(p.exp);
  savePnL(p);
  if (after>before) showLevelUpScreen(before,after).catch(()=>{});
  return p.exp;
}

// ── Panel — fixed 72 cols, always fits terminal ───────────────────────────
const PW=72;
const sep=(col,ch='═')=>col+'╠'+ch.repeat(PW)+'╣'+X;
const SEP=(col)=>col+'╟'+'─'.repeat(PW)+'╢'+X;
const TOP=col=>col+'╔'+'═'.repeat(PW)+'╗'+X;
const BOT=col=>col+'╚'+'═'.repeat(PW)+'╝'+X;
function row(txt,col=M) {
  const clean=txt.replace(/\x1b\[[0-9;]*m/g,'');
  const pad=Math.max(0,PW-clean.length-2);
  return col+'║ '+X+txt+' '.repeat(pad)+col+' ║'+X;
}
const TW=72, DIV='─'.repeat(TW+2);
function trow(txt,col,bdr) {
  const clean=txt.replace(/\x1b\[[0-9;]*m/g,'');
  return bdr+'│'+X+col+txt+' '.repeat(Math.max(0,TW-clean.length))+X+bdr+'│'+X;
}

// ── Mini sparkline from candles ─────────────────────────────────────────────
function sparkline(closes) {
  if (!closes||closes.length<2) return D+'no data'+X;
  const min=Math.min(...closes), max=Math.max(...closes), range=max-min||1;
  const bars=['▁','▂','▃','▄','▅','▆','▇','█'];
  const last=closes[closes.length-1], prev=closes[closes.length-2];
  const trend=last>prev?G:last<prev?R:D;
  return closes.slice(-12).map(c=>trend+bars[Math.round((c-min)/range*7)]+X).join('');
}

// ── Tree panel — ASCII tree showing ADAN + children + intel ─────────────────
function renderTreePanel(pnl, prices) {
  const children = pnl.children || [];
  const xp = expProgress(pnl.exp || 0);
  const pct = pnl.trades > 0 ? Math.round(pnl.wins / pnl.trades * 100) : 0;
  const wrCol = pct >= 55 ? G : pct >= 40 ? Y : R;

  // Read latest intel for each child
  function readChildIntel(spec) {
    try {
      const slug = spec.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const fp = path.join(INTEL_DIR, slug + '.json');
      if (!fs.existsSync(fp)) return null;
      const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const age = (Date.now() - new Date(d.ts).getTime()) / 60000;
      if (age > 10) return null; // stale > 10min
      return d;
    } catch { return null; }
  }

  function sigBadge(sig) {
    if (!sig) return D + '  ···  ' + X;
    const col = sig.dir === 'UP' ? G : sig.dir === 'DOWN' ? R : Y;
    const icon = sig.dir === 'UP' ? '▲' : sig.dir === 'DOWN' ? '▼' : '●';
    return col + BOLD + icon + ' ' + sig.dir.padEnd(4) + X + D + ' c:' + (sig.conf || '--') + '%' + X;
  }

  console.log(sep(B));
  console.log(row(B + BOLD + '  🌳 DYNASTY TREE' + X + D + '  Gen ' + (pnl.generation || 1) + '  │  ADAN-PRED + ' + children.length + ' children' + X));
  console.log(SEP(B));

  // ADAN root node
  const rootFund = ('$' + (pnl.fund || 0).toFixed(0)).padStart(8);
  const rootNet  = (pnl.net >= 0 ? '+' : '') + '$' + (pnl.net || 0).toFixed(0);
  const netCol   = (pnl.net || 0) >= 0 ? G : R;
  console.log(row(
    '  ' + M + BOLD + '◈ ADAN-PRED' + X + D + ' [ROOT · GEN1]' + X +
    '  fund:' + C + BOLD + rootFund + X +
    '  net:' + netCol + BOLD + rootNet + X +
    '  WR:' + wrCol + BOLD + pct + '%' + X +
    '  LVL:' + M + BOLD + xp.level + X
  ));

  if (children.length === 0) {
    const sc = TREE_RULES.spawnConditions;
    const maxCTree = xp.level >= 4 ? TREE_RULES.maxChildrenGen1 : TREE_RULES.maxChildrenAtLvl3;
    const canSpawn = xp.level >= sc.minLvl && pnl.trades >= sc.minTrades
      && (pnl.wins / Math.max(pnl.trades, 1)) >= sc.minWinRate && (pnl.treasury || 0) > 0
      && children.length < maxCTree;
    if (canSpawn) {
      console.log(row('  ' + B + '  └── ' + Y + BOLD + '👶 SPAWN READY' + X + D + '  treasury: $' + (pnl.treasury || 0).toFixed(2) + '  conditions met' + X));
    } else {
      const need = [];
      if (xp.level < sc.minLvl) need.push('LVL ' + sc.minLvl);
      if (pnl.trades < sc.minTrades) need.push((sc.minTrades - pnl.trades) + ' more trades');
      if ((pnl.wins / Math.max(pnl.trades, 1)) < sc.minWinRate) need.push('50%+ WR');
      if (!(pnl.treasury > 0)) need.push('treasury > 0');
      console.log(row('  ' + B + '  └── ' + D + 'no children yet — need: ' + need.join(' · ') + X));
    }
  } else {
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      const connector = isLast ? '└──' : '├──';
      const intel = readChildIntel(child.spec);
      const sig = intel ? intel.signal : null;
      const childPnlPath = path.join(DIR, 'children', child.id || child.spec, 'pnl.json');
      let childPnl = null;
      try { if (fs.existsSync(childPnlPath)) childPnl = JSON.parse(fs.readFileSync(childPnlPath, 'utf8')); } catch {}

      const childExp  = childPnl?.exp || 0;
      const childExpNeeded = TREE_RULES.childExpToSpawn;
      const gcList    = (childPnl?.children) || [];
      const canHaveGC = xp.level >= 4;
      const gcReady   = canHaveGC && childExp >= childExpNeeded && gcList.length < TREE_RULES.maxChildrenGen2;
      const expBar    = childExp >= childExpNeeded ? G + '●' + X : Y + Math.min(childExp, childExpNeeded) + '/' + childExpNeeded + 'xp' + X;

      const nameStr  = C + BOLD + (child.name || child.spec).padEnd(10) + X;
      const specStr  = D + child.spec.padEnd(11) + X;
      const sigStr   = sigBadge(sig);
      const scoreStr = intel ? (intel.intelScore >= 65 ? G : intel.intelScore >= 45 ? Y : R) + BOLD + '[' + intel.intelScore + ']' + X : D + '[--]' + X;
      const ageStr   = intel ? D + ' ' + Math.round((Date.now() - new Date(intel.ts).getTime()) / 60000) + 'm' + X : '';
      const gcStr    = gcReady ? ' ' + Y + BOLD + '🌱SPAWN' + X : gcList.length > 0 ? ' ' + B + '(' + gcList.length + 'gc)' + X : '';

      console.log(row(
        '  ' + B + '  ' + connector + ' ' + X +
        nameStr + ' ' + specStr +
        ' ' + sigStr + ' ' + scoreStr + ageStr +
        '  exp:' + expBar + gcStr
      ));

      // Grandchildren (if any)
      gcList.forEach((gc, gi) => {
        const gcLast  = gi === grandChildren.length - 1;
        const gcConn  = gcLast ? '    └──' : '    ├──';
        const gcIntel = readChildIntel(gc.spec);
        const gcSig   = gcIntel ? gcIntel.signal : null;
        const focusStr = gc.focus ? D + ' [' + gc.focus + ']' + X : '';
        console.log(row(
          '  ' + B + '  ' + gcConn + ' ' + X +
          B + (gc.name || gc.spec).padEnd(10) + X + ' ' +
          D + gc.spec.padEnd(14) + X + focusStr +
          '  ' + sigBadge(gcSig)
        ));
      });
    });
  }

  // Signal consensus bar
  if (children.length > 0) {
    const signals = children.map(c => readChildIntel(c.spec)?.signal).filter(Boolean);
    const ups   = signals.filter(s => s.dir === 'UP').length;
    const downs = signals.filter(s => s.dir === 'DOWN').length;
    const neutral = signals.filter(s => s.dir === 'NEUTRAL').length;
    if (signals.length > 0) {
      const consensus = ups > downs + neutral ? G + BOLD + '▲ BULL CONSENSUS' + X
        : downs > ups + neutral ? R + BOLD + '▼ BEAR CONSENSUS' + X
        : Y + '● MIXED SIGNALS' + X;
      console.log(SEP(B));
      console.log(row(
        '  ' + B + 'SIGNAL CONSENSUS: ' + X + consensus +
        D + '  (' + ups + '▲ ' + downs + '▼ ' + neutral + '●)  ' +
        signals.length + '/' + children.length + ' children reporting' + X
      ));
    }
  }
  console.log(sep(B));
}

// ── Web dashboard — localhost:3141 ───────────────────────────────────────────
let _dashboardState = null;

// ── Terminal braille spinner (thinking mode) ──────────────────────────────────
let _thinkSpinTimer = null;
const _SPIN_F = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let _spinIdx = 0;
function _startThinkSpin() {
  if (_thinkSpinTimer) return;
  _thinkSpinTimer = setInterval(() => {
    try { process.stdout.write('\r  '+_SPIN_F[_spinIdx++%_SPIN_F.length]+' Claude Sonnet 4.6 analyzing market edge...              '); } catch {}
  }, 120);
}
function _stopThinkSpin() {
  if (!_thinkSpinTimer) return;
  clearInterval(_thinkSpinTimer);
  _thinkSpinTimer = null;
  try { process.stdout.write('\r                                                                   \r'); } catch {}
}

function startDashboard() {
  const PORT = 3141;
  const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADAN-PRED · Web4 Automaton</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=JetBrains+Mono:wght@400;600&display=swap');
:root{
  --bg:#ccc8bc;--bg2:#ddd9cc;--bg3:#e8e4d8;--bg4:#f0ece2;
  --border:#1a1a1a;--border2:#3a3a2a;
  --purple:#5a1a8a;--cyan:#1a4a8a;--green:#1a5a1a;
  --red:#8a1a1a;--yellow:#7a5a10;--grey:#666655;
  --text:#1a1a1a;--text2:#3a3a2a;--dim:#888878;
  --shadow:3px 3px 0 #1a1a1a;--shadow-sm:2px 2px 0 #1a1a1a;
  --font:'VT323',monospace;--mono:'JetBrains Mono',monospace;--pixel:'Press Start 2P',monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;min-height:100vh;image-rendering:pixelated}
.topbar{background:var(--bg3);border-bottom:3px solid var(--border);padding:0 16px;height:48px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 3px 0 var(--border)}
.win-btns{display:flex;gap:6px;align-items:center;margin-right:10px}
.win-btn{width:12px;height:12px;border-radius:50%;border:2px solid var(--border);cursor:pointer}
.wb-red{background:#ff5f57}.wb-yellow{background:#febc2e}.wb-green{background:#28c840}
.topbar-left{display:flex;align-items:center;gap:12px}
.logo{font-size:13px;font-family:var(--pixel);letter-spacing:0;color:var(--text)}
.logo span{color:var(--purple)}
.status-dot{width:8px;height:8px;border-radius:0;background:var(--green);animation:pulse 2s infinite;image-rendering:pixelated}
.status-dot.thinking{background:var(--yellow);animation:pulse 0.4s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.topbar-right{display:flex;align-items:center;gap:16px;font-size:14px;color:var(--text2);font-family:var(--mono)}
.topbar-stat{display:flex;flex-direction:column;align-items:flex-end;border:2px solid var(--border);padding:2px 8px;box-shadow:var(--shadow-sm)}
.topbar-stat .val{font-weight:600;font-size:14px;color:var(--text);font-family:var(--mono)}
.topbar-stat .lbl{font-size:9px;color:var(--grey);text-transform:uppercase;font-family:var(--pixel)}
.main{padding:16px;display:grid;grid-template-columns:300px 1fr;gap:12px;max-width:1400px;margin:0 auto}
.sidebar{display:flex;flex-direction:column;gap:10px}
.content{display:flex;flex-direction:column;gap:10px}
.card{background:var(--bg3);border:2px solid var(--border);padding:14px;box-shadow:var(--shadow)}
.card-title{font-size:9px;font-family:var(--pixel);letter-spacing:0;text-transform:uppercase;color:var(--text);margin-bottom:12px;display:flex;align-items:center;gap:8px;border-bottom:2px solid var(--border);padding-bottom:8px}
.card-title::before{content:'▶';color:var(--purple);font-size:8px}
/* Stats */
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px dashed var(--border2)}
.stat-row:last-child{border-bottom:none}
.stat-lbl{color:var(--text2);font-size:13px;font-family:var(--font)}
.stat-val{font-weight:600;font-size:14px;font-family:var(--mono)}
/* Level / XP */
.level-box{background:var(--bg4);border:2px solid var(--border);padding:10px;margin-bottom:10px;box-shadow:var(--shadow-sm)}
.level-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.level-num{font-size:16px;font-family:var(--pixel);color:var(--purple)}
.level-name{font-size:10px;color:var(--text2);font-family:var(--pixel)}
.xp-bar{height:10px;background:var(--bg);border:2px solid var(--border);overflow:hidden}
.xp-fill{height:100%;background:repeating-linear-gradient(90deg,var(--purple) 0,var(--purple) 6px,#8b3acd 6px,#8b3acd 8px);transition:width .6s steps(20)}
.xp-label{display:flex;justify-content:space-between;font-size:10px;color:var(--grey);margin-top:3px;font-family:var(--pixel)}
/* Fund ring */
.fund-ring{position:relative;width:80px;height:80px;margin:0 auto 10px}
.fund-ring svg{transform:rotate(-90deg)}
.fund-ring .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.fund-ring .center .v{font-size:11px;font-weight:700;color:var(--text);font-family:var(--mono)}
.fund-ring .center .l{font-size:8px;color:var(--grey);font-family:var(--pixel)}
/* Prices */
.price-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.price-card{background:var(--bg4);border:2px solid var(--border);padding:10px;box-shadow:var(--shadow-sm)}
.price-card .sym{font-size:9px;font-family:var(--pixel);color:var(--grey)}
.price-card .price{font-size:16px;font-weight:700;font-family:var(--mono);margin:4px 0}
.price-card .chg{font-size:12px;font-weight:600;font-family:var(--mono)}
.price-card .indicators{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.ind{font-size:10px;padding:2px 5px;font-family:var(--mono);border:2px solid var(--border)}
.ind-bull{background:#c8e8c0;color:var(--green)}
.ind-bear{background:#e8c0c0;color:var(--red)}
.ind-neu{background:var(--bg);color:var(--grey)}
/* Tree */
.tree-wrap{font-family:var(--mono);font-size:13px;line-height:2}
.tree-root-row{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg4);border-left:4px solid var(--purple);margin-bottom:4px}
.tree-child-row{display:flex;align-items:center;gap:8px;padding:4px 8px 4px 24px;transition:background .2s}
.tree-child-row:hover{background:var(--bg4)}
.tree-grand-row{padding:3px 8px 3px 48px;font-size:11px;color:var(--text2)}
.child-name{font-weight:600;color:var(--cyan);min-width:80px}
.child-spec{color:var(--grey);font-size:10px;min-width:70px}
.exp-bar-wrap{width:50px;height:6px;background:var(--bg);border:2px solid var(--border);overflow:hidden}
.exp-bar-fill{height:100%;background:var(--purple);transition:width .4s steps(10)}
.signal-badge{padding:2px 6px;font-size:10px;font-weight:600;white-space:nowrap;border:2px solid var(--border);font-family:var(--mono)}
.sig-up{background:#c8e8c0;color:var(--green)}
.sig-down{background:#e8c0c0;color:var(--red)}
.sig-neu{background:var(--bg);color:var(--grey)}
.consensus-bar{margin-top:10px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;border:2px solid var(--border)}
.con-bull{background:#c8e8c0;color:var(--green)}
.con-bear{background:#e8c0c0;color:var(--red)}
.con-mixed{background:#e8e0c0;color:var(--yellow)}
.sig-stack{display:flex;height:6px;overflow:hidden;margin-top:4px;gap:1px;border:2px solid var(--border)}
.sig-stack-up{background:var(--green)}
.sig-stack-down{background:var(--red)}
.sig-stack-neu{background:var(--grey);flex:1}
/* Positions */
.pos-row{padding:8px 0;border-bottom:2px dashed var(--border2);display:flex;flex-direction:column;gap:4px}
.pos-row:last-child{border-bottom:none}
.pos-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font)}
.pos-meta{display:flex;gap:10px;font-size:12px;color:var(--text2);font-family:var(--mono)}
.countdown{font-weight:600;color:var(--yellow)}
/* History */
.hist-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--border2)}
.hist-row:last-child{border-bottom:none}
.hist-badge{width:44px;text-align:center;padding:3px 4px;font-size:9px;font-weight:700;flex-shrink:0;border:2px solid var(--border);font-family:var(--pixel)}
.hist-win{background:#c8e8c0;color:var(--green)}
.hist-loss{background:#e8c0c0;color:var(--red)}
.hist-info{flex:1;min-width:0}
.hist-title{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.hist-sub{font-size:10px;color:var(--text2);font-family:var(--mono)}
.hist-pnl{font-weight:700;font-size:14px;font-family:var(--mono);flex-shrink:0}
/* Markets */
.mkt-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--border2)}
.mkt-row:last-child{border-bottom:none}
.mkt-asset{width:32px;font-size:10px;font-weight:700;color:var(--cyan);font-family:var(--pixel)}
.mkt-title{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)}
.mkt-price{font-family:var(--mono);font-size:13px;width:44px;text-align:right}
.mkt-edge{font-family:var(--mono);font-size:12px;width:52px;text-align:right}
.mkt-time{font-size:11px;color:var(--yellow);width:38px;text-align:right;font-weight:600;font-family:var(--mono)}
/* Skills */
.skills-wrap{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.skill-chip{padding:3px 7px;font-size:9px;font-family:var(--pixel);border:2px solid var(--border)}
.skill-on{background:var(--bg4);color:var(--purple)}
.skill-next{background:var(--bg);color:var(--grey);opacity:.5}
/* Ticker */
.ticker-row{display:flex;gap:20px;overflow:hidden;padding:6px 16px;background:var(--bg4);border-bottom:2px solid var(--border);font-size:13px;font-family:var(--mono)}
.tick{display:flex;gap:5px;align-items:center}
.tick-sym{color:var(--grey);font-weight:600}
.tick-p{color:var(--text);font-weight:600}
/* Misc */
.badge2{display:inline-flex;align-items:center;padding:2px 6px;font-size:10px;font-weight:600;gap:3px;border:2px solid var(--border);font-family:var(--pixel)}
.b-lvl{background:var(--bg4);color:var(--purple)}
.b-wr-good{background:#c8e8c0;color:var(--green)}
.b-wr-ok{background:#e8e0c0;color:var(--yellow)}
.b-wr-bad{background:#e8c0c0;color:var(--red)}
.dot{width:8px;height:8px;border-radius:0;display:inline-block;border:1px solid var(--border2)}
.dot-green{background:var(--green)}
.dot-yellow{background:var(--yellow)}
.dot-red{background:var(--red)}
.calib-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.calib-item{display:flex;flex-direction:column;align-items:center;padding:6px 8px;background:var(--bg4);border:2px solid var(--border)}
.calib-asset{font-size:8px;color:var(--grey);text-transform:uppercase;font-weight:600;font-family:var(--pixel)}
.calib-pct{font-size:16px;font-weight:700;font-family:var(--mono);margin:2px 0}
.calib-trades{font-size:9px;color:var(--grey)}
@media(max-width:900px){.main{grid-template-columns:1fr}}
/* ── Pixel Avatar ─────────────────────────────────────────────── */
.avatar-card{text-align:center;padding:14px 10px 10px}
.avatar-wrap{position:relative;display:inline-block;margin-bottom:6px}
.avatar-platform{width:80px;height:8px;background:var(--border);margin:0 auto;border:2px solid var(--border)}
.avatar-platform::after{content:'';display:none}
@keyframes avFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes avThink{0%,100%{filter:drop-shadow(0 0 4px #22d3ee88)}50%{filter:drop-shadow(0 0 12px #22d3ee) drop-shadow(0 0 20px #7c3aed88)}}
@keyframes avIdle{0%,100%{filter:drop-shadow(0 0 3px #7c3aed44)}50%{filter:drop-shadow(0 0 6px #7c3aed88)}}
@keyframes avWin{0%{filter:drop-shadow(0 0 4px #34d399)}50%{filter:drop-shadow(0 0 16px #34d399) drop-shadow(0 0 8px #fbbf24)}100%{filter:drop-shadow(0 0 4px #34d399)}}
.av-sprite{animation:avFloat 3s ease-in-out infinite,avIdle 4s ease-in-out infinite}
.av-sprite.thinking{animation:avFloat 1.2s ease-in-out infinite,avThink .8s ease-in-out infinite}
.av-sprite.winning{animation:avFloat 2s ease-in-out infinite,avWin .5s ease-in-out 3}
.avatar-name{font-size:9px;font-family:var(--pixel);color:var(--purple);margin-top:4px}
.avatar-title{font-size:9px;color:var(--grey);margin-top:3px;font-family:var(--pixel);line-height:1.6}
.avatar-status{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:9px;padding:3px 8px;background:var(--bg4);border:2px solid var(--border);font-family:var(--pixel)}
/* ── Command Center ───────────────────────────────────────────── */
.cmd-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cmd-sub{font-size:8px;font-family:var(--pixel);text-transform:uppercase;color:var(--grey);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-bottom:2px dashed var(--border2);padding-bottom:4px}
.cmd-sub::before{content:'■';color:var(--purple);font-size:7px}
.cmd-sub.thinking::before{color:var(--cyan);animation:pulse .4s infinite}
@media(max-width:900px){.cmd-grid{grid-template-columns:1fr}}
/* ── Neural Flow Visualization ────────────────────────────────── */
.nf-wrap{overflow-x:auto;padding:4px 0}
@keyframes nfPulse{0%,100%{opacity:.3;r:16}50%{opacity:.8;r:24}}
@keyframes nfFlow{to{stroke-dashoffset:-24}}
@keyframes nfFlowSlow{to{stroke-dashoffset:-12}}
@keyframes nfGlow{0%,100%{filter:drop-shadow(0 0 3px #22d3ee)}50%{filter:drop-shadow(0 0 10px #22d3ee)}}
@keyframes nfIdleGlow{0%,100%{filter:drop-shadow(0 0 1px #4b5563)}50%{filter:drop-shadow(0 0 3px #6b7280)}}
.nf-thinking{animation:nfGlow 1s ease-in-out infinite}
.nf-idle-node{animation:nfIdleGlow 3s ease-in-out infinite}
.nf-pulse{animation:nfPulse .9s ease-in-out infinite}
.nf-flowline{animation:nfFlow .6s linear infinite}
.nf-flowslow{animation:nfFlowSlow 2s linear infinite}
/* ── Decisions Log ────────────────────────────────────────────── */
.dec-row{padding:10px 0;border-bottom:2px dashed var(--border2)}
.dec-row:last-child{border-bottom:none}
.dec-header{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.dec-header:hover .dec-title{color:var(--purple)}
.dec-title{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);transition:color .2s}
.dec-meta{display:flex;gap:8px;font-size:11px;color:var(--grey);font-family:var(--mono);margin-top:4px}
.dec-reason{margin-top:8px;padding:10px 12px;background:var(--bg4);border:2px solid var(--border);font-size:11px;color:var(--text2);line-height:1.6;display:none;white-space:pre-wrap;font-family:var(--mono);max-height:200px;overflow-y:auto;box-shadow:inset 2px 2px 0 var(--border2)}
.dec-reason.open{display:block}
.dec-toggle{font-size:9px;color:var(--grey);white-space:nowrap;font-family:var(--pixel)}
.dec-learn{margin-top:5px;font-size:10px;color:var(--purple);font-style:italic;font-family:var(--mono)}
/* ── Hour heatmap ─────────────────────────────────────────────── */
.hour-grid{display:grid;grid-template-columns:repeat(24,1fr);gap:1px;margin-top:6px}
.hour-cell{height:20px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:600;font-family:var(--mono);border:1px solid var(--border2)}
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-left">
    <div class="win-btns"><div class="win-btn wb-red"></div><div class="win-btn wb-yellow"></div><div class="win-btn wb-green"></div></div>
    <div class="logo">ADAN<span>-PRED</span></div>
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">
      <div class="status-dot" id="sdot"></div>
      <span id="status-txt">Loading...</span>
    </div>
    <div style="font-size:10px;color:var(--grey)" id="scan-info"></div>
  </div>
  <div class="topbar-right">
    <div class="topbar-stat"><span class="val" id="top-fund">--</span><span class="lbl">Fund</span></div>
    <div class="topbar-stat"><span class="val" id="top-net">--</span><span class="lbl">Net P&L</span></div>
    <div class="topbar-stat"><span class="val" id="top-wr">--</span><span class="lbl">Win Rate</span></div>
    <div class="topbar-stat"><span class="val" id="top-trades">--</span><span class="lbl">Trades</span></div>
  </div>
</div>

<div class="ticker-row" id="ticker" style="border-top:2px solid var(--border)">
  <div class="tick"><span class="tick-sym">BTC</span><span class="tick-p">--</span></div>
  <div class="tick"><span class="tick-sym">ETH</span><span class="tick-p">--</span></div>
  <div class="tick"><span class="tick-sym">SOL</span><span class="tick-p">--</span></div>
  <div class="tick"><span class="tick-sym">XRP</span><span class="tick-p">--</span></div>
  <div class="tick" style="margin-left:auto;color:var(--grey)" id="fg-tick">F&G: --</div>
</div>

<div class="main">
  <div class="sidebar">

    <!-- Avatar -->
    <div class="card avatar-card">
      <div class="avatar-wrap">
        <div id="av-sprite-wrap"><svg id="av-sprite" class="av-sprite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 94" width="84" height="141" shape-rendering="crispEdges">
          <!-- Hair -->
          <rect x="12" y="0" width="28" height="4" fill="#1a0e05"/>
          <rect x="8" y="4" width="36" height="4" fill="#1a0e05"/>
          <rect x="20" y="4" width="14" height="4" fill="#5b21b6"/>
          <rect x="4" y="8" width="44" height="4" fill="#1a0e05"/>
          <rect x="16" y="8" width="20" height="4" fill="#3b0d8a"/>
          <!-- Head outline + Face -->
          <rect x="4" y="12" width="4" height="24" fill="#1a0e05"/>
          <rect x="48" y="12" width="4" height="24" fill="#1a0e05"/>
          <rect x="8" y="12" width="40" height="24" fill="#e0b98a"/>
          <!-- Eyes -->
          <rect x="12" y="20" width="8" height="4" fill="#0a0a14"/>
          <rect x="14" y="20" width="4" height="4" fill="#22d3ee"/>
          <rect x="14" y="21" width="2" height="2" fill="#e0f7ff"/>
          <rect x="34" y="20" width="8" height="4" fill="#0a0a14"/>
          <rect x="36" y="20" width="4" height="4" fill="#22d3ee"/>
          <rect x="36" y="21" width="2" height="2" fill="#e0f7ff"/>
          <!-- Nose hint -->
          <rect x="26" y="24" width="4" height="2" fill="#c8996a"/>
          <!-- Mouth -->
          <rect x="18" y="30" width="4" height="2" fill="#b07840"/>
          <rect x="22" y="32" width="12" height="2" fill="#b07840"/>
          <rect x="34" y="30" width="4" height="2" fill="#b07840"/>
          <!-- Collar -->
          <rect x="12" y="36" width="28" height="4" fill="#94a3b8"/>
          <rect x="20" y="36" width="12" height="4" fill="#cbd5e1"/>
          <!-- Suit top / shoulders -->
          <rect x="0" y="40" width="56" height="4" fill="#0d0d18"/>
          <rect x="0" y="40" width="8" height="4" fill="#6d28d9"/>
          <rect x="48" y="40" width="8" height="4" fill="#6d28d9"/>
          <!-- Body main -->
          <rect x="4" y="44" width="48" height="30" fill="#0d0d18"/>
          <!-- Suit side stripes -->
          <rect x="4" y="44" width="4" height="30" fill="#5b21b6"/>
          <rect x="48" y="44" width="4" height="30" fill="#5b21b6"/>
          <!-- Chest panel -->
          <rect x="16" y="46" width="24" height="12" fill="#111128"/>
          <rect x="18" y="48" width="4" height="4" fill="#22d3ee"/>
          <rect x="24" y="48" width="4" height="4" fill="#22d3ee"/>
          <rect x="30" y="48" width="4" height="4" fill="#22d3ee"/>
          <rect x="18" y="52" width="16" height="2" fill="#1e1e40"/>
          <!-- Belt -->
          <rect x="8" y="70" width="40" height="4" fill="#1e2040"/>
          <rect x="24" y="70" width="8" height="4" fill="#fbbf24"/>
          <rect x="22" y="71" width="12" height="2" fill="#fde68a"/>
          <!-- Legs -->
          <rect x="8" y="74" width="16" height="12" fill="#0d0d18"/>
          <rect x="32" y="74" width="16" height="12" fill="#0d0d18"/>
          <rect x="10" y="74" width="2" height="12" fill="#111128"/>
          <rect x="34" y="74" width="2" height="12" fill="#111128"/>
          <!-- Boots -->
          <rect x="6" y="86" width="20" height="8" fill="#060610"/>
          <rect x="30" y="86" width="20" height="8" fill="#060610"/>
          <rect x="6" y="86" width="20" height="2" fill="#161628"/>
          <rect x="30" y="86" width="20" height="2" fill="#161628"/>
          <!-- Boot toe highlight -->
          <rect x="22" y="90" width="4" height="4" fill="#0d0d20"/>
          <rect x="46" y="90" width="4" height="4" fill="#0d0d20"/>
        </svg></div>
        <div class="avatar-platform"></div>
      </div>
      <div class="avatar-name">ADAN-PRED</div>
      <div class="avatar-title" id="av-title">Web4 Automaton · Gen 1</div>
      <div class="avatar-status" id="av-status">
        <span class="dot dot-green" id="av-dot"></span>
        <span id="av-status-txt">IDLE</span>
      </div>
    </div>

    <!-- Level & Fund -->
    <div class="card">
      <div class="level-box">
        <div class="level-title">
          <div><div class="level-num" id="lvl-num">LVL --</div><div class="level-name" id="lvl-name">--</div></div>
          <div id="treasury-box" style="text-align:right"></div>
        </div>
        <div class="xp-bar"><div class="xp-fill" id="xp-fill" style="width:0%"></div></div>
        <div class="xp-label"><span id="xp-pct">0%</span><span id="xp-need">-- xp to next</span></div>
      </div>
      <div class="fund-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="30" fill="none" stroke="#1e1e32" stroke-width="8"/>
          <circle cx="40" cy="40" r="30" fill="none" stroke="url(#rg)" stroke-width="8" stroke-linecap="round" id="fund-arc" stroke-dasharray="188 188" stroke-dashoffset="47"/>
          <defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs>
        </svg>
        <div class="center"><div class="v" id="ring-fund">--</div><div class="l">FUND</div></div>
      </div>
      <div class="stat-row"><span class="stat-lbl">Net P&L</span><span class="stat-val" id="s-net">--</span></div>
      <div class="stat-row"><span class="stat-lbl">Win Rate</span><span class="stat-val" id="s-wr">--</span></div>
      <div class="stat-row"><span class="stat-lbl">Trades</span><span class="stat-val" id="s-trades">--</span></div>
      <div class="stat-row"><span class="stat-lbl">Open slots</span><span class="stat-val" id="s-slots">--</span></div>
      <div class="stat-row"><span class="stat-lbl">Treasury</span><span class="stat-val" id="s-treas" style="color:var(--purple)">--</span></div>
    </div>

    <!-- Calibration -->
    <div class="card">
      <div class="card-title">Calibration by Asset</div>
      <div class="calib-row" id="calib-row"></div>
    </div>

    <!-- Skills -->
    <div class="card">
      <div class="card-title">Skill Tree</div>
      <div class="skills-wrap" id="skills-wrap"></div>
    </div>

  </div>
  <div class="content">

    <!-- Prices -->
    <div class="card">
      <div class="card-title">Live Intelligence · Binance</div>
      <div class="price-grid" id="price-grid"></div>
    </div>

    <!-- Command Center: Tree + Neural Flow -->
    <div class="card" id="cmd-card">
      <div class="card-title">◈ COMMAND CENTER · DYNASTY &amp; NEURAL FLOW</div>
      <div class="cmd-grid">
        <div>
          <div class="cmd-sub" id="tree-sub-title">DYNASTY TREE</div>
          <div class="tree-wrap" id="tree-wrap"></div>
        </div>
        <div>
          <div class="cmd-sub" id="nf-sub-title">NEURAL PIPELINE</div>
          <div class="nf-wrap" id="nf-wrap"></div>
        </div>
      </div>
    </div>

    <!-- Brain Log: Decisions + Reasoning -->
    <div class="card">
      <div class="card-title">🧠 BRAIN LOG · Decisions &amp; Learning</div>
      <div id="decisions-wrap"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

      <!-- Open Positions -->
      <div class="card">
        <div class="card-title">Live Bets <span id="open-count" style="color:var(--cyan)"></span></div>
        <div id="positions-wrap"></div>
      </div>

      <!-- Markets + Hour Heatmap -->
      <div class="card">
        <div class="card-title">Live Markets</div>
        <div id="markets-wrap"></div>
        <div style="margin-top:12px">
          <div style="font-size:9px;color:var(--grey);letter-spacing:1px;margin-bottom:4px">HOUR WIN RATE (UTC)</div>
          <div class="hour-grid" id="hour-grid"></div>
        </div>
      </div>

    </div>

    <!-- History -->
    <div class="card">
      <div class="card-title">Trade History · Full Record</div>
      <div id="history-wrap"></div>
    </div>

  </div>
</div>

<script>
const SKILLS_DEF=[
  {lvl:1,icon:'📡',name:'LIVE FEED'},{lvl:2,icon:'📊',name:'TREND READ'},
  {lvl:3,icon:'👶',name:'FIRST CHILD'},{lvl:3,icon:'🎯',name:'EDGE FILTER'},
  {lvl:4,icon:'📐',name:'KELLY BET'},{lvl:5,icon:'⚡',name:'MULTI-BET'},
  {lvl:6,icon:'🕯️',name:'CANDLE PAT'},{lvl:8,icon:'🔬',name:'CALIBRATION'},
  {lvl:9,icon:'⏱️',name:'TIMING'},{lvl:10,icon:'🌊',name:'VOL SENSE'},
  {lvl:12,icon:'😱',name:'FEAR EXPLOIT'},{lvl:15,icon:'🧬',name:'STRAT EVO'},
  {lvl:18,icon:'🔗',name:'CORRELATION'},{lvl:20,icon:'🌙',name:'NIGHT OWL'},
  {lvl:25,icon:'🌑',name:'SHADOW MODE'},{lvl:30,icon:'🧠',name:'SONIC MIND'},
  {lvl:40,icon:'💰',name:'REAL USDC'},{lvl:50,icon:'💳',name:'AUTO-FUND'},
];

let prevData=null;

function badge2(cls,txt){return \`<span class="badge2 \${cls}">\${txt}</span>\`}
function col(c,v){return \`<span style="color:var(--\${c})">\${v}</span>\`}
function mono(v){return \`<span style="font-family:'JetBrains Mono',monospace">\${v}</span>\`}

function formatCountdown(closesAt){
  if(!closesAt)return '--';
  const ms=new Date(closesAt)-Date.now();
  if(ms<=0)return col('red','expired');
  const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000);
  const str=m>0?\`\${m}m \${s}s\`:\`\${s}s\`;
  return m<3?col('red',str):m<10?col('yellow',str):col('text2',str);
}

function sparkSvg(history){
  if(!history||history.length<2)return '';
  const min=Math.min(...history),max=Math.max(...history),range=max-min||1;
  const W=60,H=20,n=history.length;
  const pts=history.map((v,i)=>\`\${(i/(n-1))*W},\${H-(v-min)/range*H}\`).join(' ');
  const last=history[n-1],prev=history[n-2];
  const c=last>prev?'34d399':last<prev?'f87171':'94a3b8';
  return \`<svg width="\${W}" height="\${H}" style="vertical-align:middle"><polyline points="\${pts}" fill="none" stroke="#\${c}" stroke-width="1.5" stroke-linejoin="round"/></svg>\`;
}

async function refresh(){
  try{
    const r=await fetch('/api/state');
    const d=await r.json();
    window._lastNFData = d; // for fast neural-flow spinner
    const pnl=d.pnl, xp=d.xp;
    const pct=pnl.trades>0?Math.round(pnl.wins/pnl.trades*100):0;
    const st=d.state;

    // Status dot
    const isThinking=st?.mode==='thinking';
    document.getElementById('sdot').className='status-dot'+(isThinking?' thinking':'');
    const sm=st?.survivalMode;
    const statusTxt=isThinking?'Thinking...':sm==='critical'?'🚨 CRITICAL':sm==='survival'?'⚠ SURVIVAL MODE':sm==='cautious'?'CAUTIOUS':'Ready';
    const stEl=document.getElementById('status-txt');
    stEl.textContent=statusTxt;
    stEl.style.color=sm==='critical'||sm==='survival'?'var(--red)':sm==='cautious'?'var(--yellow)':'';
    document.getElementById('scan-info').textContent=st?.lastScan?'Last scan: '+st.lastScan+' · Next: ~'+st.nextScanIn+'min':'';

    // Topbar
    document.getElementById('top-fund').textContent='\$'+(pnl.fund||0).toFixed(2);
    const netEl=document.getElementById('top-net');
    netEl.textContent=(pnl.net>=0?'+':'')+'\$'+(pnl.net||0).toFixed(2);
    netEl.style.color=pnl.net>=0?'var(--green)':'var(--red)';
    const wrEl=document.getElementById('top-wr');
    wrEl.textContent=pct+'%';
    wrEl.style.color=pct>=55?'var(--green)':pct>=40?'var(--yellow)':'var(--red)';
    document.getElementById('top-trades').textContent=pnl.wins+'W/'+pnl.losses+'L';

    // Ticker
    const prices=st?.prices||{};
    const tickItems=[['BTC','BTCUSDT'],['ETH','ETHUSDT'],['SOL','SOLUSDT'],['XRP','XRPUSDT']];
    document.getElementById('ticker').innerHTML=tickItems.map(([sym,key])=>{
      const p=prices[key];
      if(!p)return \`<div class="tick"><span class="tick-sym">\${sym}</span><span class="tick-p" style="color:var(--grey)">--</span></div>\`;
      const c=p.chg>=0?'green':'red';
      return \`<div class="tick"><span class="tick-sym">\${sym}</span><span class="tick-p" style="color:var(--\${c})">\$\${p.price?.toLocaleString()}</span><span style="color:var(--\${c});font-size:10px">\${p.chg>=0?'+':''}\${p.chg?.toFixed(2)}%</span></div>\`;
    }).join('')+\`<div class="tick" style="margin-left:auto;color:var(--grey);font-size:10px" id="fg-tick">\${prices._meta?.fearGreed?'F&G: '+prices._meta.fearGreed.value+' ('+prices._meta.fearGreed.label+')':''}</div>\`;

    // Level
    document.getElementById('lvl-num').textContent='LVL '+xp.level;
    document.getElementById('lvl-name').textContent=xp.title;
    document.getElementById('xp-fill').style.width=xp.pct+'%';
    document.getElementById('xp-pct').textContent=xp.pct+'%';
    document.getElementById('xp-need').textContent=xp.needed+' xp to next';
    document.getElementById('treasury-box').innerHTML=\`<div style="color:var(--purple);font-size:12px;font-weight:700">\$\${(pnl.treasury||0).toFixed(2)}</div><div style="font-size:9px;color:var(--grey)">TREASURY</div>\`;

    // Fund ring
    const fundPct=Math.min(1,(pnl.fund||0)/10000);
    const circ=2*Math.PI*30;
    const offset=circ*(1-fundPct);
    document.getElementById('fund-arc').style.strokeDashoffset=offset;
    document.getElementById('ring-fund').textContent='\$'+(pnl.fund/1000).toFixed(1)+'k';

    // Stats
    document.getElementById('s-net').innerHTML=\`<span style="color:\${pnl.net>=0?'var(--green)':'var(--red)'}">\${pnl.net>=0?'+':''}\$\${(pnl.net||0).toFixed(2)}</span>\`;
    document.getElementById('s-wr').innerHTML=\`<span style="color:\${pct>=55?'var(--green)':pct>=40?'var(--yellow)':'var(--red)'}">\${pct}%</span> <span style="color:var(--grey);font-size:10px">(\${pnl.wins}W/\${pnl.losses}L)</span>\`;
    document.getElementById('s-trades').textContent=pnl.trades+' total';
    const open=(d.positions?.open||[]).length;
    document.getElementById('s-slots').textContent=(9-open)+'/9 free';
    document.getElementById('s-treas').textContent='\$'+(pnl.treasury||0).toFixed(2);

    // Calibration
    document.getElementById('calib-row').innerHTML=Object.entries(d.calib||{}).map(([k,v])=>{
      const acc=v.p>=3?Math.round(v.c/v.p*100):null;
      const c=acc===null?'grey':acc>=60?'green':acc>=50?'yellow':'red';
      return \`<div class="calib-item"><div class="calib-asset">\${k}</div><div class="calib-pct" style="color:var(--\${c})">\${acc===null?'--':acc+'%'}</div><div class="calib-trades">\${v.p} trades</div></div>\`;
    }).join('');

    // Skills
    document.getElementById('skills-wrap').innerHTML=SKILLS_DEF.map(s=>{
      const on=xp.level>=s.lvl;
      return \`<div class="skill-chip \${on?'skill-on':'skill-next'}">\${s.icon} \${s.name}</div>\`;
    }).join('');

    // Prices
    const priceSyms=[['BTC','BTCUSDT'],['ETH','ETHUSDT'],['SOL','SOLUSDT'],['XRP','XRPUSDT']];
    document.getElementById('price-grid').innerHTML=priceSyms.map(([sym,key])=>{
      const p=prices[key];
      if(!p)return \`<div class="price-card"><div class="sym">\${sym}</div><div class="price" style="color:var(--grey)">No data</div></div>\`;
      const c=p.chg>=0?'green':'red';
      const rsi=p.rsi||50;
      const rsiCls=rsi<35?'ind-bull':rsi>65?'ind-bear':'ind-neu';
      const macdCls=p.macd?.hist>0?'ind-bull':'ind-bear';
      const bbCls=(p.bb?.pct||50)>75?'ind-bear':(p.bb?.pct||50)<25?'ind-bull':'ind-neu';
      return \`<div class="price-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="sym">\${sym}</div><div class="price" style="color:var(--\${c})">\$\${p.price?.toLocaleString()}</div></div>
          <div style="text-align:right"><div class="chg" style="color:var(--\${c})">\${p.chg>=0?'+':''}\${p.chg?.toFixed(2)}%</div>
          \${sparkSvg(p.closes)}</div>
        </div>
        <div class="indicators">
          <span class="ind \${rsiCls}">RSI \${rsi?.toFixed(0)}</span>
          <span class="ind \${macdCls}">MACD \${p.macd?.hist>0?'▲':'▼'}</span>
          <span class="ind \${bbCls}">BB \${(p.bb?.pct||0).toFixed(0)}%</span>
          <span class="ind \${p.intelScore>=65?'ind-bull':p.intelScore>=45?'ind-neu':'ind-bear'}">[score:\${p.intelScore||'--'}]</span>
        </div>
      </div>\`;
    }).join('');

    // Dynasty Tree
    const children=d.children||[];
    const wrClass=pct>=55?'b-wr-good':pct>=40?'b-wr-ok':'b-wr-bad';
    let treeHtml=\`<div class="tree-root-row">
      <span style="color:var(--purple);font-weight:700;font-size:14px">◈ ADAN-PRED</span>
      <span class="badge2 b-lvl">LVL \${xp.level}</span>
      <span class="badge2 \${wrClass}">\${pct}% WR</span>
      <span style="color:var(--grey);font-size:10px">Gen\${pnl.generation||1} · ROOT</span>
    </div>\`;
    if(children.length===0){
      const sc={minLvl:3,minTrades:5,minWR:0.5};
      const needs=[];
      if(xp.level<3)needs.push('LVL 3');
      if(pnl.trades<5)needs.push((5-pnl.trades)+' trades');
      if(pct<50)needs.push('50%+ WR');
      if(!(pnl.treasury>0))needs.push('treasury>0');
      treeHtml+=\`<div style="padding:8px 28px;color:var(--grey);font-size:11px">└── no children yet\${needs.length?' · need: '+needs.join(', '):' · spawn ready!'}</div>\`;
    } else {
      children.forEach((c,i)=>{
        const sig=c.intel?.signal;
        const sigCls=sig?.dir==='UP'?'sig-up':sig?.dir==='DOWN'?'sig-down':'sig-neu';
        const sigTxt=sig?(sig.dir==='UP'?'▲ UP':sig.dir==='DOWN'?'▼ DOWN':'● —'):'···';
        const expPct=Math.min(100,Math.round((c.childExp||0)));
        const gcReady=xp.level>=4&&(c.childExp||0)>=100&&(c.grandChildren||[]).length<2;
        const scoreColor=c.intel?.intelScore>=65?'green':c.intel?.intelScore>=45?'yellow':'red';
        const isLast=i===children.length-1;
        treeHtml+=\`<div class="tree-child-row">
          <span style="color:var(--grey)">\${isLast?'└──':'├──'}</span>
          <span class="child-name">\${c.name||c.spec}</span>
          <span class="child-spec">\${c.spec}</span>
          <span class="signal-badge \${sigCls}">\${sigTxt}</span>
          \${c.intel?'<span style="color:var(--'+scoreColor+');font-size:10px;font-family:JetBrains Mono,monospace">[\${c.intel.intelScore}]</span>':''}
          <div class="exp-bar-wrap" title="\${c.childExp||0}/100 exp"><div class="exp-bar-fill" style="width:\${Math.min(100,c.childExp||0)}%"></div></div>
          <span style="font-size:10px;color:var(--grey)">\${c.childExp||0}/100</span>
          \${gcReady?'<span style="color:var(--yellow);font-size:10px">🌱</span>':''}
        </div>\`;
        (c.grandChildren||[]).forEach((gc,gi)=>{
          const gcSig=gc.intel?.signal;
          const gcCls=gcSig?.dir==='UP'?'sig-up':gcSig?.dir==='DOWN'?'sig-down':'sig-neu';
          const gcTxt=gcSig?(gcSig.dir==='UP'?'▲':gcSig.dir==='DOWN'?'▼':'●'):'·';
          treeHtml+=\`<div class="tree-grand-row">
            <span style="color:var(--grey)">\${gi===(c.grandChildren||[]).length-1?'    └──':'    ├──'}</span>
            <span style="color:var(--text2)">\${gc.name||gc.spec}</span>
            \${gc.focus?'<span style="color:var(--grey);font-size:10px">['+gc.focus+']</span>':''}
            <span class="signal-badge \${gcCls}" style="padding:1px 5px">\${gcTxt}</span>
          </div>\`;
        });
      });
      // Signal consensus
      const sigs=children.map(c=>c.intel?.signal?.dir).filter(Boolean);
      const ups=sigs.filter(s=>s==='UP').length;
      const downs=sigs.filter(s=>s==='DOWN').length;
      if(sigs.length>0){
        const con=ups>downs?'bull':downs>ups?'bear':'mixed';
        const conTxt=ups>downs?'▲ BULL CONSENSUS':downs>ups?'▼ BEAR CONSENSUS':'● MIXED SIGNALS';
        const conCol=ups>downs?'var(--green)':downs>ups?'var(--red)':'var(--yellow)';
        const p=100/(sigs.length||1);
        treeHtml+=\`<div class="consensus-bar con-\${con}">
          <span>\${conTxt}</span>
          <span style="font-size:10px;color:inherit;opacity:.7">\${ups}▲ \${downs}▼ \${sigs.length-ups-downs}● · \${sigs.length}/\${children.length} reporting</span>
        </div>
        <div class="sig-stack">
          <div class="sig-stack-up" style="width:\${ups*p}%"></div>
          <div class="sig-stack-down" style="width:\${downs*p}%"></div>
          <div class="sig-stack-neu"></div>
        </div>\`;
      }
    }
    document.getElementById('tree-wrap').innerHTML=treeHtml;

    // Open positions
    const openPos=d.positions?.open||[];
    document.getElementById('open-count').textContent='('+openPos.length+')';
    if(openPos.length===0){
      document.getElementById('positions-wrap').innerHTML='<div style="color:var(--grey);font-size:12px;padding:12px 0">No open bets — scanning...</div>';
    } else {
      document.getElementById('positions-wrap').innerHTML=openPos.map(p=>{
        const side=p.side==='YES'?'<span style="color:var(--green)">YES ▲</span>':'<span style="color:var(--red)">NO ▼</span>';
        const edge=((p.myProb-p.marketPrice)*100).toFixed(1);
        return \`<div class="pos-row">
          <div class="pos-title">\${side} \${(p.marketTitle||'').slice(0,40)}</div>
          <div class="pos-meta">
            <span>edge: <b style="color:\${edge>0?'var(--green)':'var(--red)'}">+\${edge}%</b></span>
            <span>stake: \$\${p.stake}</span>
            <span class="countdown">\${formatCountdown(p.closesAt)}</span>
          </div>
        </div>\`;
      }).join('');
    }

    // Markets
    const mkts=st?.markets||[];
    if(mkts.length===0){
      document.getElementById('markets-wrap').innerHTML='<div style="color:var(--grey);font-size:12px;padding:12px 0">No active markets</div>';
    } else {
      document.getElementById('markets-wrap').innerHTML=mkts.slice(0,6).map(m=>{
        const edgeVal=(m.edge||0)*100;
        const eCol=Math.abs(edgeVal)>=5?'green':'grey';
        return \`<div class="mkt-row">
          <div class="mkt-asset">\${(m.asset||'?').toUpperCase().slice(0,3)}</div>
          <div class="mkt-title" title="\${m.title||''}">\${(m.title||'').slice(0,35)}</div>
          <div class="mkt-price" style="color:var(--cyan)">\${((m.yesPrice||0)*100).toFixed(0)}%</div>
          <div class="mkt-edge" style="color:var(--\${eCol})">\${edgeVal>0?'+':''}\${edgeVal.toFixed(1)}%</div>
          <div class="mkt-time">\${formatCountdown(m.closesAt)}</div>
        </div>\`;
      }).join('');
    }

    // History
    const closed=(d.positions?.closed||[]).slice(-8).reverse();
    if(closed.length===0){
      document.getElementById('history-wrap').innerHTML='<div style="color:var(--grey);font-size:12px;padding:12px 0">No trades yet</div>';
    } else {
      document.getElementById('history-wrap').innerHTML=closed.map(c=>{
        const w=c.result==='WIN';
        return \`<div class="hist-row">
          <div class="hist-badge \${w?'hist-win':'hist-loss'}">\${w?'WIN':'LOSS'}</div>
          <div class="hist-info">
            <div class="hist-title">\${(c.marketTitle||'').slice(0,50)}</div>
            <div class="hist-sub">\${(c.asset||'').toUpperCase()} · edge: \${((c.edge||0)*100).toFixed(1)}% · \${c.entryTime?.slice(11,16)||''}</div>
          </div>
          <div class="hist-pnl" style="color:\${w?'var(--green)':'var(--red)'}">\${w?'+':''}\$\${c.pnl}</div>
        </div>\`;
      }).join('');
    }

    // Avatar
    updateAvatar(d);

    // Neural flow + sub-title state
    const subEl = document.getElementById('nf-sub-title');
    if (subEl) subEl.className = 'cmd-sub' + (d.state?.mode==='thinking' ? ' thinking' : '');
    updateNeuralFlow(d);
    updateDecisionsLog(d);
    updateHourHeatmap(d);

  }catch(e){console.error(e)}
}

// ── Avatar update ─────────────────────────────────────────────────────────────
function updateAvatar(d) {
  const sprite = document.getElementById('av-sprite');
  const dot    = document.getElementById('av-dot');
  const stxt   = document.getElementById('av-status-txt');
  const title  = document.getElementById('av-title');
  if (!sprite) return;
  const mode = d.state?.mode;
  const xp   = d.xp;
  const pnl  = d.pnl;
  const pct  = pnl.trades>0 ? Math.round(pnl.wins/pnl.trades*100) : 0;
  const openCount = (d.positions?.open||[]).length;

  // Animation class
  sprite.className = 'av-sprite' + (mode==='thinking' ? ' thinking' : (pct>=55&&pnl.trades>=5 ? ' winning' : ''));

  // Status dot + text
  if (mode==='thinking') {
    dot.className='dot dot-yellow';
    stxt.textContent='THINKING';
    stxt.style.color='var(--yellow)';
  } else if (openCount>0) {
    dot.className='dot dot-green';
    stxt.textContent=openCount+' BET'+(openCount>1?'S':'')+' LIVE';
    stxt.style.color='var(--green)';
  } else {
    const sm = d.state?.survivalMode;
    if (sm === 'critical') {
      dot.className='dot dot-red'; stxt.textContent='🚨 CRITICAL'; stxt.style.color='var(--red)';
    } else if (sm === 'survival') {
      dot.className='dot dot-red'; stxt.textContent='⚠ SURVIVAL'; stxt.style.color='var(--red)';
    } else if (sm === 'cautious') {
      dot.className='dot dot-yellow'; stxt.textContent='CAUTIOUS'; stxt.style.color='var(--yellow)';
    } else {
      dot.className='dot dot-green'; stxt.textContent='SCANNING'; stxt.style.color='var(--text2)';
    }
  }

  // Title evolves with level
  const titles = {1:'Web4 Automaton · Gen 1',3:'Scout Trader · Gen 1',5:'Intelligence Node',10:'Market Oracle',20:'Apex Predictor',40:'Sovereign Agent'};
  let tkey = 1;
  for (const k of Object.keys(titles).map(Number).sort((a,b)=>a-b)) { if ((xp?.level||1)>=k) tkey=k; }
  title.textContent = (titles[tkey]||'Web4 Automaton') + ' · LVL '+(xp?.level||1);
}

// ── Hour Heatmap ──────────────────────────────────────────────────────────────
function updateHourHeatmap(d) {
  const el = document.getElementById('hour-grid');
  if (!el) return;
  const hs = d.pnl?.hourStats || {};
  el.innerHTML = Array.from({length:24},(_,h)=>{
    const s = hs[h]||{wins:0,losses:0};
    const t = s.wins+s.losses;
    const wr = t>0 ? s.wins/t : null;
    const bg = wr===null ? '#111118' : wr>=0.6 ? '#0a2010' : wr>=0.4 ? '#1a1400' : '#200a0a';
    const fc = wr===null ? '#374151' : wr>=0.6 ? '#34d399' : wr>=0.4 ? '#fbbf24' : '#f87171';
    const label = wr===null ? h : (wr*100).toFixed(0);
    return \`<div class="hour-cell" style="background:\${bg};color:\${fc}" title="Hour \${h} UTC: \${s.wins}W \${s.losses}L">\${label}</div>\`;
  }).join('');
}

// ── Decisions Log ─────────────────────────────────────────────────────────────
function updateDecisionsLog(d) {
  const wrap = document.getElementById('decisions-wrap');
  if (!wrap) return;
  const closed = (d.positions?.closed||[]).slice(-6).reverse();
  const open   = d.positions?.open||[];
  const all    = [...open.map(p=>({...p,_open:true})), ...closed];
  if (all.length===0){
    wrap.innerHTML='<div style="color:var(--grey);font-size:12px;padding:8px 0">No decisions yet — ADAN is observing...</div>';
    return;
  }
  wrap.innerHTML = all.slice(0,7).map((p,idx) => {
    const w  = p.result==='WIN';
    const isO= p._open;
    const badgeCls = isO ? 'b-lvl' : (w ? 'b-wr-good' : 'b-wr-bad');
    const badgeTxt = isO ? 'OPEN' : (w?'WIN':'LOSS');
    const edge = ((p.edge||0)*100).toFixed(1);
    const side = p.side==='YES' ? '<span style="color:var(--green)">YES ▲</span>' : '<span style="color:var(--red)">NO ▼</span>';
    const pnlTxt = isO ? '' : \`<span style="color:\${w?'var(--green)':'var(--red)'};font-weight:700">\${w?'+':''}\$\${p.pnl}</span>\`;
    // Extract key reasoning lines from entryThought
    const thought = p.entryThought || '';
    const reasonLines = thought.split('\\n').filter(l=>l.trim()&&!l.startsWith('#')).slice(0,3).join('\\n');
    const fullReason = thought.replace(/^#.*$/mg,'').trim();
    const id = 'dec-'+idx;
    return \`<div class="dec-row">
      <div class="dec-header" onclick="document.getElementById('\${id}').classList.toggle('open')">
        <span class="badge2 \${badgeCls}">\${badgeTxt}</span>
        \${side}
        <span class="dec-title">\${(p.marketTitle||'').slice(0,45)}</span>
        \${pnlTxt}
        <span class="dec-toggle">edge:\${edge>0?'+':''}\${edge}% ▾</span>
      </div>
      <div class="dec-meta">
        <span>\${(p.asset||'?').toUpperCase()}</span>
        <span>conf:\${p.confidence||'--'}%</span>
        <span>stake:\$\${p.stake||100}</span>
        <span style="color:var(--grey)">\${(p.entryTime||'').slice(11,16)} UTC</span>
      </div>
      \${reasonLines ? \`<div class="dec-learn">\${reasonLines.slice(0,120)}...</div>\` : ''}
      \${fullReason ? \`<div class="dec-reason" id="\${id}">\${fullReason.slice(0,800)}</div>\` : ''}
    </div>\`;
  }).join('');
}

// ── Neural Flow Visualization ─────────────────────────────────────────────────
function updateNeuralFlow(d) {
  const wrap = document.getElementById('nf-wrap');
  if (!wrap) return;
  const isThinking = d.state?.mode === 'thinking';
  const isDone     = d.state?.mode === 'result';
  const isIdle     = !isThinking && !isDone;

  const prices  = d.state?.prices || {};
  const markets = (d.state?.markets || []).slice(0, 5);
  const btc     = prices['BTCUSDT'];
  const eth     = prices['ETHUSDT'];
  const sol     = prices['SOLUSDT'];
  const hasPrices = !!btc;

  const W = 370, H = 290, NW = 68, NH = 52, gap = 14, MY = 20;
  const cols = 2, rows = 3;
  // 3-row layout for narrow panel: [BINANCE] [TECHNICAL] / [POLYMARKET] / [CLAUDE] [DECISION]
  const nodePositions = [
    {x: 4,         y: MY},
    {x: 4+NW+gap,  y: MY},
    {x: 4+NW/2,    y: MY+NH+24},
    {x: 4,         y: MY+2*(NH+24)},
    {x: 4+NW+gap,  y: MY+2*(NH+24)},
  ];

  const lineColor = isThinking ? '#22d3ee' : isDone ? '#34d399' : '#2a2a44';
  const lineOpacity = isIdle ? 0.5 : 1;
  const lineClass = isThinking ? 'nf-flowline' : (isDone ? 'nf-flowslow' : 'nf-flowslow');
  const nodeBorder = (i) => {
    if (isThinking) return i===3 ? '#22d3ee' : '#22d3ee66';
    if (isDone) return '#34d399';
    return hasPrices ? '#2a2a44' : '#1e1e32';
  };
  const titleFill = hasPrices ? '#6b7280' : '#374151';
  const valFill   = hasPrices ? '#94a3b8' : '#4b5563';

  const fmt = (v, d=2) => v != null ? v.toFixed(d) : '--';
  const chgTxt = (p) => p ? (p.chg >= 0 ? '+' : '') + fmt(p.chg, 1) + '%' : '--';

  // Braille spinner frame for Claude node
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  const frame  = frames[Math.floor(Date.now() / 150) % frames.length];

  const nodeDefs = [
    {
      title: 'BINANCE',
      icon: '◆',
      lines: [
        btc ? \`BTC \${chgTxt(btc)}\` : 'loading...',
        eth ? \`ETH \${chgTxt(eth)}\` : '',
        sol ? \`SOL \${chgTxt(sol)}\` : '',
      ],
      color: '#fbbf24',
    },
    {
      title: 'TECHNICAL',
      icon: '≋',
      lines: [
        btc ? \`RSI \${fmt(btc.rsi,0)} \${btc.rsi<35?'OS':btc.rsi>65?'OB':'—'}\` : '---',
        btc?.macd ? \`MACD \${btc.macd.hist>0?'▲ bull':'▼ bear'}\` : '---',
        btc?.bb   ? \`BB \${fmt(btc.bb.pct,0)}%\` : '---',
      ],
      color: '#a855f7',
    },
    {
      title: 'POLYMARKET',
      icon: '◈',
      lines: markets.length > 0
        ? markets.slice(0,3).map(m => {
            const asset = (m.asset||'?').toUpperCase().slice(0,3);
            const pct   = ((m.yesPrice||0.5)*100).toFixed(0)+'%';
            const tf    = m.title?.match(/5M|15M|1H|5-Min|15-Min|5 Min|15 Min/i)?.[0] || '';
            const edge  = ((m.edge||0)*100).toFixed(0);
            return \`\${asset} \${pct} e:\${edge>0?'+':''}\${edge}%\`;
          })
        : ['scanning...','',''],
      color: '#22d3ee',
    },
    {
      title: 'CLAUDE ◈',
      icon: isThinking ? frame : (isDone ? '✓' : '○'),
      lines: [
        isThinking ? 'analyzing...' : (isDone ? 'decided' : 'idle'),
        'Sonnet 4.6',
        isThinking ? '6-step flow' : '',
      ],
      color: isThinking ? '#22d3ee' : (isDone ? '#34d399' : '#4b5563'),
    },
    {
      title: 'DECISION',
      icon: isDone ? '◉' : '○',
      lines: [
        isDone ? (d.state?.thought?.includes('BET') ? '● BET' : '● SKIP') : (isThinking ? '···' : 'waiting'),
        isDone && d.state?.thought?.includes('BET') ? 'position open' : '',
        '',
      ],
      color: isDone ? (d.state?.thought?.includes('BET') ? '#34d399' : '#94a3b8') : '#4b5563',
    },
  ];

  // Connection paths (0→1, 0→2, 1→2, 2→3, 2→4, 3→4 in the layout)
  const connections = [[0,1],[0,2],[1,2],[2,3],[2,4],[3,4]];
  const midX = (i) => nodePositions[i].x + NW/2;
  const midY = (i) => nodePositions[i].y + NH/2;

  let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${W} \${H}" style="width:100%;height:\${H}px;max-width:100%">
  <defs>
    <filter id="nfg2"><feGaussianBlur stdDeviation="3" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
  </defs>
  <rect width="\${W}" height="\${H}" fill="#07070d" rx="8"/>\`;

  // Grid lines for holo effect
  for (let gx=0;gx<W;gx+=30) svg+=\`<line x1="\${gx}" y1="0" x2="\${gx}" y2="\${H}" stroke="#0d0d15" stroke-width=".5"/>\`;
  for (let gy=0;gy<H;gy+=20) svg+=\`<line x1="0" y1="\${gy}" x2="\${W}" y2="\${gy}" stroke="#0d0d15" stroke-width=".5"/>\`;

  // Connections
  connections.forEach(([a,b])=>{
    const x1=midX(a), y1=midY(a), x2=midX(b), y2=midY(b);
    const sw = isThinking ? 1.5 : 1;
    svg+=\`<line x1="\${x1}" y1="\${y1}" x2="\${x2}" y2="\${y2}" stroke="\${lineColor}" stroke-width="\${sw}" stroke-dasharray="6 4" opacity="\${lineOpacity}" class="\${lineClass}"/>\`;
  });

  // Pulse ring on Claude when thinking
  if (isThinking) {
    const cx=midX(3), cy=midY(3);
    svg+=\`<circle cx="\${cx}" cy="\${cy}" r="30" fill="none" stroke="#22d3ee" stroke-width="1" opacity=".15" class="nf-pulse"/>\`;
  }

  // Nodes
  nodeDefs.forEach((nd,i)=>{
    const {x,y} = nodePositions[i];
    const bc = nodeBorder(i);
    const glowFilter = (isThinking && i===3) ? ' filter="url(#nfg2)"' : '';
    const glowCls = (isThinking && i===3) ? ' class="nf-thinking"' : (isIdle&&hasPrices ? ' class="nf-idle-node"' : '');

    svg+=\`<g\${glowCls}>
      <rect x="\${x}" y="\${y}" width="\${NW}" height="\${NH}" rx="5" fill="#0d0d18" stroke="\${bc}" stroke-width="1.2"\${glowFilter}/>
      <text x="\${x+NW/2}" y="\${y+10}" text-anchor="middle" font-size="7" font-weight="700" fill="\${titleFill}" font-family="JetBrains Mono,monospace" letter-spacing=".8">\${nd.title}</text>
      <text x="\${x+NW/2}" y="\${y+24}" text-anchor="middle" font-size="12" fill="\${nd.color}" font-family="JetBrains Mono,monospace">\${nd.icon}</text>
    \`;
    nd.lines.filter(Boolean).slice(0,2).forEach((line,li)=>{
      const lc2=(i===4&&line.includes('BET'))?'#34d399':(i===4&&line.includes('SKIP'))?'#94a3b8':(line.includes('+')&&!line.includes('---'))?'#34d399':valFill;
      svg+=\`<text x="\${x+NW/2}" y="\${y+35+li*11}" text-anchor="middle" font-size="9" fill="\${lc2}" font-family="JetBrains Mono,monospace">\${line.slice(0,14)}</text>\`;
    });
    svg+=\`</g>\`;
  });

  // Status label
  const label = isThinking ? 'LIVE · ANALYZING' : isDone ? 'DECISION MADE' : (hasPrices?'MONITORING':'INITIALIZING');
  const labelColor = isThinking ? '#22d3ee' : isDone ? '#34d399' : '#4b5563';
  svg+=\`<text x="\${W/2}" y="\${H-6}" text-anchor="middle" font-size="8" fill="\${labelColor}" font-family="JetBrains Mono,monospace" letter-spacing="2" opacity=".8">\${label}</text>\`;

  svg += '</svg>';
  wrap.innerHTML = svg;
}

refresh();
setInterval(refresh,4000);
// Fast-refresh neural flow spinner (only redraws SVG, not full state)
setInterval(()=>{
  if(window._lastNFData) updateNeuralFlow(window._lastNFData);
},150);
</script>
</body>
</html>`;

  const srv = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      const pnl = loadPnL();
      const pos = loadPositions();
      const calib = loadCalibration();
      const xp = expProgress(pnl.exp || 0);

      // Read intel for each child
      const childrenWithIntel = (pnl.children || []).map(child => {
        let intel = null;
        try {
          const slug = child.spec.replace(/[^a-z0-9]/gi, '-').toLowerCase();
          const fp = path.join(INTEL_DIR, slug + '.json');
          if (fs.existsSync(fp)) {
            const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
            const age = (Date.now() - new Date(d.ts).getTime()) / 60000;
            if (age <= 10) intel = { signal: d.signal, intelScore: d.intelScore, ts: d.ts };
          }
        } catch {}
        // grandchildren + child EXP
        let grandChildren = [], childExp = 0, childSignals = 0;
        try {
          const childDir = path.join(DIR, 'children', child.id || child.spec);
          const gcPnlPath = path.join(childDir, 'pnl.json');
          if (fs.existsSync(gcPnlPath)) {
            const cp = JSON.parse(fs.readFileSync(gcPnlPath, 'utf8'));
            childExp    = cp.exp || 0;
            childSignals= cp.signals || 0;
            grandChildren = (cp.children || []).map(gc => {
              let gcIntel = null;
              try {
                const gslug = gc.spec.replace(/[^a-z0-9]/gi, '-').toLowerCase();
                const gfp = path.join(INTEL_DIR, gslug + '.json');
                if (fs.existsSync(gfp)) {
                  const gd = JSON.parse(fs.readFileSync(gfp, 'utf8'));
                  if ((Date.now() - new Date(gd.ts).getTime()) / 60000 <= 10) gcIntel = { signal: gd.signal, ts: gd.ts, focus: gd.focus };
                }
              } catch {}
              return { ...gc, intel: gcIntel };
            });
          }
        } catch {}
        return { ...child, intel, grandChildren, childExp, childSignals };
      });

      res.end(JSON.stringify({
        ts: new Date().toISOString(),
        pnl, calib, positions: pos,
        xp: { ...xp, title: levelTitle(xp.level) },
        children: childrenWithIntel,
        state: _dashboardState
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    }
  });

  srv.listen(PORT, '127.0.0.1', () => {
    // silently started
  });
  srv.on('error', () => {}); // ignore port conflicts
  return srv;
}

// ── Render ───────────────────────────────────────────────────────────────────
function render(s) {
  _dashboardState = s; // expose to web dashboard
  if (s.mode !== 'thinking') _stopThinkSpin();
  cls();
  const pnl      = s.pnl;
  const pct      = pnl.trades>0?Math.round(pnl.wins/pnl.trades*100):0;
  const winColor = pct>=55?G:pct>=40?Y:R;
  const xp       = expProgress(pnl.exp||0);
  const lvlColor = xp.level>=60?M:xp.level>=40?M:xp.level>=20?C:xp.level>=10?Y:G;
  const fund     = pnl.fund??100;
  const openPos  = s.positions?.open||[];
  const slots    = Math.max(0,MAX_POSITIONS-openPos.length);
  const net      = pnl.net||0;
  const treasury = pnl.treasury||0;
  const calib    = loadCalibration();
  const prices   = s.prices||{};

  // ── HEADER ──
  console.log('\n'+M+BOLD+'  ╔══════════════════════════════════════════════════════════════════╗');
  console.log(M+BOLD+'  ║  ▄▄  ██▄  ▄▄  ██▄    ██▄  ██▄  ██▄  ██▄                       ║');
  console.log(M+BOLD+'  ║  ███ ███ ███  ███▀▄  ███  ███  ███  ███                        ║');
  console.log(M+BOLD+'  ║  ███▀███ ███  ██▀▀█  ███  ███  ███  ███                        ║');
  console.log(M+BOLD+'  ║  A D A N - P R E D  v2   ·   Web4 Autonomaton   ·   2026       ║');
  console.log(M+BOLD+'  ║  Polymarket  ·  Binance  ·  Claude Sonnet 4.6  ·  by Lord      ║');
  console.log(M+BOLD+'  ║  '+C+BOLD+'Dashboard: http://localhost:3141'+M+BOLD+'  ·  auto-refresh 5s            ║');
  console.log(M+BOLD+'  ╚══════════════════════════════════════════════════════════════════╝'+X+'\n');

  const timeStr    = new Date().toLocaleTimeString();
  const scanStatus = s.mode==='thinking'?Y+BOLD+'⬤ THINKING'+X
    :s.mode==='result'?G+BOLD+'⬤ READY'+X:C+'⬤ '+s.status+X;
  const nextStr    = s.lastScan?D+'  scan: '+s.lastScan+'  next: ~'+s.nextScanIn+'min  $'+(s.apiCost||0).toFixed(4)+X:'';

  console.log(TOP(M));
  console.log(row('  '+BOLD+M+'ADAN-PRED'+X+'  '+D+timeStr+X+'  '+scanStatus+nextStr));
  console.log(sep(M));

  // ── MARKET SENTIMENT ──
  const fg        = prices._meta?.fearGreed;
  const fundRates = prices._meta?.fundingRates||{};
  if (fg) {
    const fgCol = fg.value>=60?G:fg.value>=40?Y:R;
    const fgBar = fgCol+'█'.repeat(Math.round(fg.value/10))+'░'.repeat(10-Math.round(fg.value/10))+X;
    const fgDir = fg.direction>0?' '+G+'↑'+X:fg.direction<0?' '+R+'↓'+X:'';
    console.log(row('  SENTIMENT  '+fgBar+'  '+fgCol+BOLD+fg.value+'/100  '+fg.label.toUpperCase()+X+fgDir));
  }
  console.log(sep(M));

  // ── PRICE TICKER — clean fixed columns ──
  console.log(row(D+'  ASSET    PRICE          CHG      TREND(1m/5m)    SIGNAL       SCORE'+X));
  console.log(SEP(M));

  for (const sym of SYMBOLS) {
    const d    = prices[sym];
    const name = sym.replace('USDT','');
    if (!d) { console.log(row(D+'  '+name.padEnd(5)+'  no data'+X)); continue; }

    const chgCol = d.chg>=0?G:R;
    const score  = d.intelScore??50;
    const sCol   = score>=65?G:score>=45?Y:R;
    const spark  = sparkline(d.closes||[]);
    const t1Col  = d.trend1m>=0?G:R;
    const t5Col  = d.trend5m>=0?G:R;
    const sig    = signalLabel(score);

    // Row 1 — price line (use plain strings for padding, then colorize)
    const priceStr  = ('$'+d.price.toLocaleString()).padEnd(14);
    const chgStr    = ((d.chg>=0?'+':'')+d.chg.toFixed(2)+'%').padEnd(8);
    const t1Str     = (d.trend1m>=0?'+':'')+d.trend1m.toFixed(2)+'%';
    const t5Str     = (d.trend5m>=0?'+':'')+d.trend5m.toFixed(2)+'%';
    console.log(row(
      '  '+W+BOLD+name.padEnd(5)+X
      +C+BOLD+priceStr+X
      +chgCol+BOLD+chgStr+X
      +D+'1m:'+X+t1Col+t1Str+X
      +D+' 5m:'+X+t5Col+t5Str+'  '+X
      +sig+'  '+sCol+BOLD+'['+score+']'+X
    ));
    // Row 2 — indicators line
    const rsiCol = d.rsi>70?G:d.rsi<30?R:Y;
    const mCol   = d.macd?.hist>0?G:R;
    const bbCol  = d.bb?.pct>75?G:d.bb?.pct<25?R:Y;
    const vCol   = d.vol?.trend==='rising'?G:d.vol?.trend==='falling'?R:D;
    const funding= d.funding||fundRates[sym];
    const fCol   = funding?.signal==='bearish'?R:funding?.signal==='bullish'?G:D;
    console.log(row(
      D+'       RSI '+X+rsiCol+BOLD+d.rsi.toFixed(0).padEnd(4)+X
      +D+'MACD '+X+mCol+BOLD+(d.macd?.hist>0?'▲':' ▼')+'  '+X
      +D+'BB% '+X+bbCol+(d.bb?.pct||0).toFixed(0).padStart(3)+'%  '+X
      +D+'VOL '+X+vCol+(d.vol?.trend||'--').padEnd(8)+X
      +(funding?D+'FUND '+X+fCol+(funding.rate||0).toFixed(3)+'%  '+X:'')
      +D+'VOLAT '+X+(d.volatility>0.12?R:d.volatility>0.06?Y:G)+d.volatility.toFixed(3)+'%'+X
      +'  '+spark
    ));
    console.log(SEP(M));
  }
  console.log(sep(M));

  // ── LEVEL + PORTFOLIO ──
  const skills    = getSkills(xp.level);
  const unlocked  = skills.filter(s=>s.unlocked).map(s=>s.icon+s.name).join(' ');
  const nextSkill = skills.find(s=>!s.unlocked);
  const roiCol    = fund>=100?G:fund>=80?Y:R;
  const sc        = TREE_RULES.spawnConditions;
  const childCount= (pnl.children||[]).length;
  const maxChildren = xp.level>=4 ? TREE_RULES.maxChildrenGen1 : 1;
  const canSpawn  = xp.level>=sc.minLvl
    && pnl.trades>=sc.minTrades
    && (pnl.wins/Math.max(pnl.trades,1))>=sc.minWinRate
    && childCount<maxChildren
    && treasury>0;
  const strat     = loadStrategy();

  console.log(row('  '+lvlColor+BOLD+'LVL '+xp.level+'  '+levelTitle(xp.level)+X
    +'  '+D+xp.bar+' '+xp.pct+'%'+X
    +(nextSkill?D+'  → '+nextSkill.icon+nextSkill.name+' @LVL'+nextSkill.lvl+X:'')));
  console.log(row('  '+D+'Skills: '+X+M+unlocked+X
    +((pnl.streak||0)>=3?'  '+Y+BOLD+'🔥 STREAK '+(pnl.streak||0)+'W'+X:'')));
  console.log(SEP(M));
  console.log(row(
    '  FUND  '+roiCol+BOLD+'$'+fund.toFixed(2)+X+D+'/$'+PAPER_BET_SIZE*100+'  '+X+
    '  NET  '+(net>=0?G:R)+BOLD+(net>=0?'+':'')+net.toFixed(2)+X+
    '  TRADES  '+W+pnl.trades+X+
    '  W/L  '+G+pnl.wins+X+D+'/'+X+R+pnl.losses+X+
    '  WR  '+winColor+BOLD+pct+'%'+X+D+'  (goal 55%)'+X
  ));
  const kellyOn = xp.level>=4;
  console.log(row(
    '  SLOTS  '+(slots>0?G:R)+BOLD+slots+'/'+MAX_POSITIONS+X+D+' free  '+X+
    '  MIN EDGE  '+Y+BOLD+(strat.minEdge*100).toFixed(0)+'%'+X+
    '  BET  '+D+(kellyOn?'📐KELLY':'$'+PAPER_BET_SIZE+' flat')+X+
    (treasury>0?'  '+M+'💰 $'+treasury.toFixed(2)+(canSpawn?' 👶SPAWN!':'')+X:'')
  ));
  console.log(sep(M));
  // ── DYNASTY TREE ──
  renderTreePanel(pnl, prices);

  // ── CALIBRATION ──
  const calibLine = Object.entries(calib).map(([asset,d])=>{
    const acc = d.p>=3?Math.round(d.c/d.p*100):null;
    const col = acc===null?D:acc>=60?G:acc>=50?Y:R;
    return W+asset.toUpperCase()+X+D+':'+X+(acc===null?D+'--':col+BOLD+acc+'%')+X+D+'('+d.p+')'+X;
  }).join('   ');
  console.log(row('  CALIBRATION  '+calibLine));
  console.log(sep(M));

  // ── OPEN POSITIONS ──
  if (openPos.length>0) {
    console.log(row(Y+BOLD+'  OPEN BETS ('+openPos.length+')'+X+D+'  — monitoring for resolution'+X));
    console.log(row(D+'  MARKET                              SIDE  MY_P  MKT_P  EDGE   STAKE  CLOSES'+X));
    openPos.forEach(p=>{
      const title = (p.marketTitle||'???').slice(0,30).padEnd(30);
      const side  = (p.side||'YES').padEnd(5);
      const myP   = ((p.myProb||0)*100).toFixed(0).padStart(4)+'%';
      const mktP  = ((p.marketPrice||0)*100).toFixed(0).padStart(5)+'%';
      const edge  = (((p.myProb||0)-(p.marketPrice||0))*100).toFixed(1).padStart(5)+'%';
      const eCol  = parseFloat(edge)>=MIN_EDGE*100?G:Y;
      const stake = ('$'+p.stake).padStart(5);
      const closes= p.closesAt?new Date(p.closesAt).toLocaleTimeString():'   n/a';
      console.log(row('  '+W+title+X+side+Y+myP+X+mktP+eCol+BOLD+edge+X+stake+'  '+D+closes+X));
    });
    console.log(sep(M));
  } else {
    console.log(row(D+'  No open bets — ADAN will enter on next scan'+X));
    console.log(sep(M));
  }

  // ── HISTORY ──
  const allClosed = s.positions?.closed||[];
  const shown = allClosed.slice(-4).reverse();
  if (shown.length>0||pnl.trades>0) {
    console.log(row(B+BOLD+'  HISTORY'+X+D+'  '+pnl.trades+' trades  ('+G+pnl.wins+'W'+X+'/'+R+pnl.losses+'L'+X+')'+X));
    shown.forEach(c=>{
      const isWin=c.result==='WIN';
      const rCol=isWin?G:R;
      const sym=(c.marketTitle||'???').slice(0,32).padEnd(32);
      const edge=c.edge!=null?(c.edge>=0?'+':'')+((c.edge||0)*100).toFixed(1)+'%':'?';
      const pnlStr=rCol+(isWin?'+':'')+c.pnl+X;
      const dt=(c.entryTime||'').slice(11,16);
      console.log(row('  '+rCol+BOLD+(isWin?'✓ WIN':'✗ LOSS')+X+' '+W+sym+X+D+' edge:'+X+Y+edge+X+' P&L: '+pnlStr+D+' '+dt+X));
    });
    console.log(sep(M));
  }

  // ── LIVE MARKETS — separados por 5M / 15M / 1H ──
  const allMkts = s.markets||[];
  const mkts5   = allMkts.filter(m=>m.windowMin===5);
  const mkts15  = allMkts.filter(m=>m.windowMin===15);
  const mkts1h  = allMkts.filter(m=>m.windowMin===60||m.windowMin===240);
  const sessionOn = allMkts.length>0;

  function mktRow(m) {
    const asst   = (m.asset||'???').toUpperCase().slice(0,3).padEnd(4);
    const price  = ((m.yesPrice||0)*100).toFixed(0).padStart(4)+'%';
    const edge   = m.edge!=null?((m.edge>=0?'+':'')+(m.edge*100).toFixed(1)+'%').padStart(6):'    --';
    const eCol   = Math.abs(m.edge||0)>=MIN_EDGE?G:D;
    const liq    = ('$'+(m.liquidity||0).toFixed(0)).padStart(7);
    const endMs  = m.closesAt?new Date(m.closesAt).getTime():0;
    const hoursL = endMs?(endMs-Date.now())/3600000:null;
    const closes = hoursL!=null?(hoursL<1?R+BOLD+(hoursL*60).toFixed(0)+'min'+X:hoursL<4?Y+BOLD+hoursL.toFixed(1)+'h'+X:D+hoursL.toFixed(0)+'h'+X):D+'--'+X;
    return '  '+W+asst+X+C+price+X+eCol+edge+X+D+liq+' '+X+closes;
  }

  if (sessionOn) {
    console.log(row(G+BOLD+'  ▸ 5MIN'+X+D+'  BTC · ETH · SOL  (closes in minutes)'+X));
    if (mkts5.length>0) {
      console.log(row(D+'  ASSET  UP%   EDGE     LIQ       CLOSES'+X));
      mkts5.slice(0,3).forEach(m=>console.log(row(mktRow(m))));
    } else { console.log(row(D+'  — no 5M active right now —'+X)); }
    console.log(SEP(M));

    console.log(row(Y+BOLD+'  ▸ 15MIN'+X+D+'  BTC · ETH · SOL  (closes in 15 min windows)'+X));
    if (mkts15.length>0) {
      mkts15.slice(0,3).forEach(m=>console.log(row(mktRow(m))));
    } else { console.log(row(D+'  — no 15M active right now —'+X)); }
    console.log(SEP(M));

    console.log(row(C+BOLD+'  ▸ 1H / 4H'+X+D+'  BTC · ETH · SOL  (hourly/4h windows)'+X));
    if (mkts1h.length>0) {
      mkts1h.slice(0,3).forEach(m=>console.log(row(mktRow(m))));
    } else { console.log(row(D+'  — no 1H active right now —'+X)); }
  } else {
    console.log(row(D+'  Session offline. 5M/15M/1H markets open ~3PM-10PM ET daily.'+X));
    console.log(row(D+'  Checking resolutions every 5min. New markets scan every 20min.'+X));
  }
  console.log(BOT(M));

  // ── THOUGHT PANEL ──
  if (s.mode==='thinking') {
    const sp = _SPIN_F[Math.floor(Date.now()/150) % _SPIN_F.length];
    console.log('\n'+Y+'┌'+DIV+'┐'+X);
    console.log(trow('  '+sp+' ADAN-PRED THINKING  —  Binance loaded · Sonnet 4.6 analyzing...',BOLD+Y,Y));
    console.log(trow('  Flow: Candles '+sp+' Trend '+sp+' Polymarket odds '+sp+' Edge calc '+sp+' BET or SKIP',D,Y));
    console.log(Y+'└'+DIV+'┘'+X+'\n');
    _startThinkSpin();
  } else if (s.mode==='result'&&s.thought) {
    console.log('\n'+M+'┌'+DIV+'┐'+X);
    console.log(trow('  ◉ ADAN-PRED DECISION',BOLD+M,M));
    console.log(M+'├'+DIV+'┤'+X);
    s.thought.split('\n').filter(Boolean).forEach(l=>{
      (l.match(new RegExp('.{1,'+(TW-2)+'}','g'))||[l]).forEach(chunk=>{
        console.log(M+'│'+X+W+'  '+chunk+' '.repeat(Math.max(0,TW-chunk.length-2))+X+M+' │'+X);
      });
    });
    console.log(M+'└'+DIV+'┘'+X+'\n');
  }
}

// ── Binance helpers ──────────────────────────────────────────────────────────
async function fetchBinancePrice(symbol) {
  try {
    const r = await fetch(`${BINANCE_API}/ticker/price?symbol=${symbol}`);
    const d = await r.json();
    return parseFloat(d.price)||null;
  } catch { return null; }
}

async function fetchBinanceKlines(symbol, interval='1m', limit=20) {
  try {
    const r = await fetch(`${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const d = await r.json();
    if (!Array.isArray(d)) return [];
    // [openTime, open, high, low, close, volume, ...]
    return d.map(c=>({
      open:  parseFloat(c[1]),
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol:   parseFloat(c[5]),
      time:  c[0]
    }));
  } catch { return []; }
}

// ── Technical Analysis — full suite ─────────────────────────────────────────
function calcTrend(closes) {
  if (closes.length<3) return 0;
  const recent=closes.slice(-Math.min(closes.length,10));
  return (recent[recent.length-1]-recent[0])/recent[0]*100;
}

function calcVolatility(closes) {
  if (closes.length<3) return 0;
  const returns=[];
  for (let i=1;i<closes.length;i++) returns.push((closes[i]-closes[i-1])/closes[i-1]);
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length;
  return Math.sqrt(variance)*100;
}

function calcRSI(closes, period=14) {
  if (closes.length<period+1) return 50;
  let gains=0, losses=0;
  for (let i=closes.length-period;i<closes.length;i++) {
    const diff=closes[i]-closes[i-1];
    if (diff>0) gains+=diff; else losses+=Math.abs(diff);
  }
  if (losses===0) return 100;
  return 100-(100/(1+gains/losses));
}

function calcMACD(closes) {
  // EMA helper
  const ema=(arr,period)=>{
    const k=2/(period+1); let e=arr[0];
    arr.forEach(v=>{ e=v*k+e*(1-k); });
    return e;
  };
  if (closes.length<26) return { macd:0, signal:0, hist:0 };
  const ema12=ema(closes.slice(-26),12);
  const ema26=ema(closes.slice(-26),26);
  const macd=ema12-ema26;
  // Signal = 9-period EMA of MACD (approximated)
  const signal=macd*0.85; // simplified
  return { macd, signal, hist:macd-signal };
}

function calcBollingerBands(closes, period=20) {
  if (closes.length<period) return { upper:0, mid:0, lower:0, pct:50 };
  const slice=closes.slice(-period);
  const mid=slice.reduce((a,b)=>a+b,0)/period;
  const std=Math.sqrt(slice.reduce((a,b)=>a+(b-mid)**2,0)/period);
  const upper=mid+2*std, lower=mid-2*std;
  const current=closes[closes.length-1];
  const pct=std>0?((current-lower)/(upper-lower))*100:50;
  return { upper, mid, lower, pct, std };
}

function calcVolumeProfile(klines) {
  if (!klines.length) return { trend:'flat', spike:false };
  const vols=klines.map(k=>k.vol);
  const avg=vols.slice(0,-3).reduce((a,b)=>a+b,0)/Math.max(vols.length-3,1);
  const last3=vols.slice(-3).reduce((a,b)=>a+b,0)/3;
  return {
    trend: last3>avg*1.5?'rising':last3<avg*0.6?'falling':'flat',
    spike: last3>avg*2.5,
    ratio: avg>0?last3/avg:1
  };
}

// ── Composite Intelligence Score 0-100 ───────────────────────────────────────
// Combines trend + RSI + MACD + Bollinger + volume → single confidence number
function calcIntelScore(d) {
  if (!d) return 50;
  let score = 50;
  // Trend signal
  if (d.trend1m>0.3)       score+=8;
  else if (d.trend1m>0.1)  score+=4;
  else if (d.trend1m<-0.3) score-=8;
  else if (d.trend1m<-0.1) score-=4;
  // 5m trend alignment
  if (d.trend5m>0&&d.trend1m>0)   score+=6;
  if (d.trend5m<0&&d.trend1m<0)   score-=6;
  // RSI signal
  if (d.rsi<30)       score-=10; // oversold — potential bounce
  else if (d.rsi>70)  score+=5;  // overbought — momentum
  else if (d.rsi>55)  score+=3;
  // MACD
  if (d.macd?.hist>0) score+=5;
  else                score-=5;
  // Bollinger %B
  if (d.bb?.pct>80)   score+=6;  // near upper band — strong uptrend
  else if (d.bb?.pct<20) score-=6; // near lower band
  // Volume
  if (d.vol?.trend==='rising') score+=5;
  if (d.vol?.spike)            score+=3;
  // Volatility penalty — high vol = unpredictable
  if (d.volatility>0.15)      score-=8;
  else if (d.volatility>0.10) score-=4;
  return Math.max(0,Math.min(100,Math.round(score)));
}

// Interpret signal direction
function signalLabel(score) {
  if (score>=75) return G+BOLD+'▲▲ STRONG UP'+X;
  if (score>=62) return G+'▲ UP'+X;
  if (score>=55) return Y+'↗ SLIGHT UP'+X;
  if (score>=45) return D+'→ NEUTRAL'+X;
  if (score>=38) return Y+'↘ SLIGHT DN'+X;
  if (score>=25) return R+'▼ DOWN'+X;
  return R+BOLD+'▼▼ STRONG DN'+X;
}

// ── External Intelligence APIs ───────────────────────────────────────────────
async function fetchFearGreed() {
  // Alternative.me Fear & Greed Index — free, no auth
  try {
    const r=await fetch('https://api.alternative.me/fng/?limit=2');
    const d=await r.json();
    const cur=d?.data?.[0];
    const prev=d?.data?.[1];
    if (!cur) return null;
    return {
      value:      parseInt(cur.value),
      label:      cur.value_classification,   // 'Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed'
      prevValue:  prev?parseInt(prev.value):null,
      direction:  prev?(parseInt(cur.value)-parseInt(prev.value)):0
    };
  } catch { return null; }
}

async function fetchFundingRates() {
  // Binance futures funding rates — tells if market is over-leveraged
  const syms=['BTCUSDT','ETHUSDT','SOLUSDT'];
  const result={};
  await Promise.all(syms.map(async sym=>{
    try {
      const r=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=3`);
      const d=await r.json();
      if (!Array.isArray(d)||!d.length) return;
      const latest=parseFloat(d[d.length-1].fundingRate)*100; // as percentage
      result[sym]={
        rate:    latest,
        label:   latest>0.05?'LONGS PAYING (overbought)':latest<-0.05?'SHORTS PAYING (oversold)':'NEUTRAL',
        signal:  latest>0.1?'bearish':latest<-0.05?'bullish':'neutral'
      };
    } catch {}
  }));
  return result;
}

async function fetchOrderBookWalls(symbol) {
  // Top bid/ask walls = support/resistance levels
  try {
    const r=await fetch(`${BINANCE_API}/depth?symbol=${symbol}&limit=20`);
    const d=await r.json();
    if (!d?.bids||!d?.asks) return null;
    // Find biggest bid wall (support) and ask wall (resistance)
    const bids=d.bids.map(b=>({ price:parseFloat(b[0]), qty:parseFloat(b[1]) }));
    const asks=d.asks.map(a=>({ price:parseFloat(a[0]), qty:parseFloat(a[1]) }));
    const topBid=bids.reduce((a,b)=>b.qty>a.qty?b:a, bids[0]);
    const topAsk=asks.reduce((a,b)=>b.qty>a.qty?b:a, asks[0]);
    const bidTotal=bids.reduce((s,b)=>s+b.qty*b.price,0);
    const askTotal=asks.reduce((s,a)=>s+a.qty*a.price,0);
    return {
      support:      topBid.price,
      resistance:   topAsk.price,
      bidWall:      topBid.qty,
      askWall:      topAsk.qty,
      buyPressure:  Math.round(bidTotal/(bidTotal+askTotal)*100), // % buy pressure
      spread:       ((topAsk.price-topBid.price)/topBid.price*100).toFixed(4)
    };
  } catch { return null; }
}

async function fetchAllPrices() {
  // Fetch all in parallel for speed
  const [fearGreed, fundingRates] = await Promise.all([
    fetchFearGreed(),
    fetchFundingRates()
  ]);

  const result = { _meta: { fearGreed, fundingRates } };

  await Promise.all(SYMBOLS.map(async sym=>{
    const [klines1m, klines5m, klines15m, orderBook] = await Promise.all([
      fetchBinanceKlines(sym,'1m',30),
      fetchBinanceKlines(sym,'5m',30),
      fetchBinanceKlines(sym,'15m',20),
      fetchOrderBookWalls(sym)
    ]);
    if (!klines1m.length) return;
    const closes1m  = klines1m.map(k=>k.close);
    const closes5m  = klines5m.map(k=>k.close);
    const closes15m = klines15m.map(k=>k.close);
    const price     = closes1m[closes1m.length-1];
    const open24    = closes5m.length>0?closes5m[0]:price;
    const macd      = calcMACD(closes5m);
    const bb        = calcBollingerBands(closes5m);
    const vol       = calcVolumeProfile(klines1m);
    const funding   = fundingRates[sym]||null;
    const d = {
      price,
      chg:       ((price-open24)/open24)*100,
      closes:    closes1m,
      closes5m,
      closes15m,
      trend1m:   calcTrend(closes1m),
      trend5m:   calcTrend(closes5m),
      trend15m:  calcTrend(closes15m),
      volatility:calcVolatility(closes1m),
      rsi:       calcRSI(closes1m),
      rsi5m:     calcRSI(closes5m),
      macd,
      bb,
      vol,
      orderBook,
      funding
    };
    d.intelScore = calcIntelScore(d);
    result[sym] = d;
  }));

  return result;
}

// ── Polymarket helpers ───────────────────────────────────────────────────────
async function polyFetch(endpoint) {
  try {
    const r = await fetch(POLYMARKET_API+endpoint, { headers:{'Accept':'application/json'} });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Keywords that identify crypto price markets
const CRYPTO_RE = /bitcoin|ethereum|solana|btc|eth|sol|xrp|ripple|crypto|above|below|matic|avax|doge|shib|binance|bnb|ada|dot|link|uni|atom|near/i;

async function fetchPolymarkets(strat) {
  const hoursMax = strat.maxHoursToClose || 168;
  const nowMs    = Date.now();
  const maxMs    = nowMs + Math.max(hoursMax, 720) * 3600 * 1000;
  const seen     = new Set();
  const all      = [];

  // ── Priority 1: Live 5M/15M/1H/4H "Up or Down" markets — BTC, ETH, SOL ──
  // Fetch WITHOUT ordering to get ALL active events including live ones
  await Promise.all(['bitcoin','ethereum','solana'].map(async asset=>{
    const data = await polyFetch(`/events?tag_slug=${asset}&limit=200&active=true&closed=false`);
    const events = Array.isArray(data)?data:(data?.events||data?.data||[]);
    for (const ev of events) {
      if (!/up.or.down/i.test(ev.title||'')) continue;
      for (const m of (ev.markets||[])) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const endMs = m.endDate?new Date(m.endDate).getTime()
          :ev.endDate?new Date(ev.endDate).getTime():0;
        if (endMs<=nowMs||endMs>maxMs) continue;
        if (!m.question) m.question = ev.title;
        m._isUpDown = true;
        m._asset    = asset;
        all.push(m);
      }
    }
  }));

  // ── Priority 2: Bulk markets sorted by volume, client-side crypto filter ──
  await Promise.all([0,100,200,300,400].map(async offset=>{
    const data = await polyFetch(`/markets?limit=100&active=true&closed=false&order=volumeNum&ascending=false&offset=${offset}`);
    const list = Array.isArray(data)?data:(data?.markets||[]);
    for (const m of list) {
      if (seen.has(m.id)) continue;
      const title = (m.question||m.title||'');
      if (!CRYPTO_RE.test(title)) continue;
      seen.add(m.id);
      const endMs = m.endDate?new Date(m.endDate).getTime():0;
      if (endMs<=nowMs||endMs>maxMs) continue;
      all.push(m);
    }
  }));

  // ── Sort: 5M Up/Down first (shortest close), then by time ascending ──
  all.sort((a,b)=>{
    // Up/Down markets always float to top
    if (a._isUpDown&&!b._isUpDown) return -1;
    if (!a._isUpDown&&b._isUpDown) return 1;
    const aMs = a.endDate?new Date(a.endDate).getTime():maxMs;
    const bMs = b.endDate?new Date(b.endDate).getTime():maxMs;
    return aMs-bMs;
  });

  return all;
}

function normalizePolymarket(raw, prices={}) {
  const id      = String(raw.id||raw.conditionId||'');
  const title   = raw.question||raw.title||raw._eventTitle||'Unknown';

  // Parse outcome prices — outcomePrices[0] = YES/UP price, [1] = NO/DOWN price
  let yesPrice = 0.5;
  try {
    if (raw.outcomePrices) {
      const op = typeof raw.outcomePrices==='string'?JSON.parse(raw.outcomePrices):raw.outcomePrices;
      if (Array.isArray(op)&&op.length>=2) {
        const p0 = parseFloat(op[0]);
        const p1 = parseFloat(op[1]);
        // Use bestBid if available (more accurate live price)
        if (raw.bestBid!=null) yesPrice = parseFloat(raw.bestBid)||0.5;
        else yesPrice = isNaN(p0)?0.5:p0;
      }
    } else if (raw.bestBid!=null) {
      yesPrice = parseFloat(raw.bestBid)||0.5;
    }
  } catch {}

  // Skip markets that are already decided (price at extreme = resolved/nearly resolved)
  if (yesPrice >= 0.85 || yesPrice <= 0.15) return null;

  const liquidity = parseFloat(raw.liquidityNum||raw.liquidity||raw.volume||0);
  const closesAt  = raw.endDate||null;

  // Detect which asset
  const text = title.toLowerCase();
  let asset = 'other';
  if (/btc|bitcoin/.test(text)) asset='btc';
  else if (/eth|ethereum/.test(text)) asset='eth';
  else if (/sol|solana/.test(text)) asset='sol';
  else if (/xrp|ripple/.test(text)) asset='xrp';

  // Detect window length from title (5min, 15min, 1h, 4h)
  let windowMin = null;
  const wMatch = title.match(/(\d+):(\d+)\w*[-–](\d+):(\d+)/);
  if (wMatch) {
    const s = parseInt(wMatch[1])*60+parseInt(wMatch[2]);
    const e = parseInt(wMatch[3])*60+parseInt(wMatch[4]);
    windowMin = Math.abs(e-s)||5;
  } else if (/\b9PM ET\b|\b9pm ET\b/.test(title)) {
    windowMin = 60;
  } else if (/\b4:00PM-8:00PM\b|\b8:00PM-12:00AM\b/.test(title)) {
    windowMin = 240;
  }
  if (raw._isUpDown && !windowMin) windowMin = 5;

  // Extract price target from title if possible
  const targetMatch = title.match(/\$([0-9,]+)/);
  const targetPrice = targetMatch?parseFloat(targetMatch[1].replace(/,/g,'')):null;

  // Current price data for this asset
  const symMap = { btc:'BTCUSDT', eth:'ETHUSDT', sol:'SOLUSDT', xrp:'XRPUSDT' };
  const sym    = symMap[asset];
  const priceData = sym?prices[sym]:null;

  // Rough edge hint
  let roughEdge = null;
  if (targetPrice&&priceData?.price) {
    const dist = (targetPrice-priceData.price)/priceData.price*100;
    roughEdge = Math.abs(dist)<1?0.1:Math.abs(dist)<2?0.05:0;
  }

  return { id, title, yesPrice, liquidity, closesAt, asset, targetPrice, roughEdge, priceData, windowMin, _isUpDown:raw._isUpDown||false };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CHILDREN SCANNER SYSTEM — lightweight, no Claude, feeds father's brain ──
// ══════════════════════════════════════════════════════════════════════════════

// Child specs: each specializes in one asset/timeframe
const CHILD_SPECS = [
  { id:'btc-5min',  asset:'BTCUSDT', assetName:'btc', windowMin:5  },
  { id:'eth-5min',  asset:'ETHUSDT', assetName:'eth', windowMin:5  },
  { id:'sol-5min',  asset:'SOLUSDT', assetName:'sol', windowMin:5  },
  { id:'btc-15min', asset:'BTCUSDT', assetName:'btc', windowMin:15 },
  { id:'eth-15min', asset:'ETHUSDT', assetName:'eth', windowMin:15 },
  { id:'sol-15min', asset:'SOLUSDT', assetName:'sol', windowMin:15 },
];

// Simple rule-based signal from Binance data (no Claude needed)
function childSignal(d) {
  if (!d) return { dir:'NEUTRAL', conf:40, reason:'no data' };
  const bearish = [], bullish = [];
  if (d.rsi < 35)  bullish.push('RSI oversold '+d.rsi.toFixed(0));
  if (d.rsi > 65)  bearish.push('RSI overbought '+d.rsi.toFixed(0));
  if (d.macd?.hist < 0) bearish.push('MACD bearish');
  else if (d.macd?.hist > 0) bullish.push('MACD bullish');
  if (d.trend5m < -0.3)  bearish.push('5m trend '+d.trend5m.toFixed(2)+'%');
  if (d.trend5m > 0.3)   bullish.push('5m trend +'+d.trend5m.toFixed(2)+'%');
  if (d.trend15m < -0.5) bearish.push('15m trend '+d.trend15m?.toFixed(2)+'%');
  if (d.trend15m > 0.5)  bullish.push('15m trend +'+d.trend15m?.toFixed(2)+'%');
  if (d.vol?.trend==='falling') bearish.push('vol falling');
  if (d.vol?.spike)             bullish.push('vol spike');
  const score = bullish.length - bearish.length;
  if (score <= -2) return { dir:'DOWN', conf:Math.min(85, 55+bearish.length*8), reason:bearish.slice(0,3).join(', ') };
  if (score >= 2)  return { dir:'UP',   conf:Math.min(85, 55+bullish.length*8), reason:bullish.slice(0,3).join(', ') };
  return { dir:'NEUTRAL', conf:40, reason:'conflicted signals' };
}

// Run one child scanner — fetch data, find best market, write intel
async function runChildScanner(spec, allPrices, allMarkets) {
  try {
    if (!fs.existsSync(INTEL_DIR)) fs.mkdirSync(INTEL_DIR, { recursive:true });
    const priceKey = spec.asset;
    const d        = allPrices[priceKey];
    const sig      = childSignal(d);

    // Find relevant markets for this child
    const myMarkets = allMarkets.filter(m=>
      m.asset===spec.assetName &&
      m._isUpDown &&
      m.windowMin===spec.windowMin &&
      m.closesAt &&
      (new Date(m.closesAt)-Date.now()) > 2*60*1000  // >2min to close
    ).slice(0,5);

    // Find best opportunity (market most misaligned with signal)
    let bestMarket = null, bestEdge = 0;
    for (const m of myMarkets) {
      // If signal says DOWN, betting NO. Edge = implied NO prob - 50%
      const impliedEdge = sig.dir==='DOWN' ? (1-m.yesPrice) - 0.5
                        : sig.dir==='UP'   ? m.yesPrice - 0.5 : 0;
      if (impliedEdge > bestEdge) { bestEdge = impliedEdge; bestMarket = m; }
    }

    // Log insight if strong signal — bottom-up learning
    if (sig.dir!=='NEUTRAL' && sig.conf>=65) {
      logChildInsight(spec.id, spec.assetName, sig.reason, sig.dir, 1);
    }

    const intel = {
      spec:      spec.id,
      asset:     spec.assetName,
      windowMin: spec.windowMin,
      ts:        new Date().toISOString(),
      price:     d?.price,
      signal:    sig,
      bestMarket: bestMarket ? {
        id:       bestMarket.id,
        title:    bestMarket.title,
        yesPrice: bestMarket.yesPrice,
        liquidity:bestMarket.liquidity,
        closesIn: Math.round((new Date(bestMarket.closesAt)-Date.now())/60000),
        suggestedSide: sig.dir==='DOWN'?'NO':'YES',
        impliedEdge: parseFloat(bestEdge.toFixed(3))
      } : null,
      markets: myMarkets.length,
      intelScore: d?.intelScore||50
    };

    fs.writeFileSync(path.join(INTEL_DIR, spec.id+'.json'), JSON.stringify(intel,null,2));
    return intel;
  } catch(e) { return null; }
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
      const age   = (Date.now() - new Date(intel.ts).getTime()) / 60000;
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
    } catch {}
  }
  if (changed) savePnL(pnl);
}

// ── Grandchild specs: sub-specializations per parent spec ────────────────────
const GRANDCHILD_SPECS = {
  'BTC-5min':  [
    { id:'btc-1min-mom',  asset:'BTCUSDT', assetName:'btc', windowMin:5,  focus:'1min-momentum' },
    { id:'btc-5min-vol',  asset:'BTCUSDT', assetName:'btc', windowMin:5,  focus:'volume-spike'  },
  ],
  'ETH-5min':  [
    { id:'eth-1min-mom',  asset:'ETHUSDT', assetName:'eth', windowMin:5,  focus:'1min-momentum' },
    { id:'eth-5min-rsi',  asset:'ETHUSDT', assetName:'eth', windowMin:5,  focus:'rsi-extreme'   },
  ],
  'SOL-5min':  [
    { id:'sol-1min-mom',  asset:'SOLUSDT', assetName:'sol', windowMin:5,  focus:'1min-momentum' },
    { id:'sol-orderbook', asset:'SOLUSDT', assetName:'sol', windowMin:5,  focus:'orderbook'     },
  ],
  'BTC-15min': [
    { id:'btc-15min-bb',  asset:'BTCUSDT', assetName:'btc', windowMin:15, focus:'bollinger'     },
    { id:'btc-15min-macd',asset:'BTCUSDT', assetName:'btc', windowMin:15, focus:'macd-cross'    },
  ],
  'ETH-15min': [
    { id:'eth-15min-bb',  asset:'ETHUSDT', assetName:'eth', windowMin:15, focus:'bollinger'     },
    { id:'eth-15min-vol', asset:'ETHUSDT', assetName:'eth', windowMin:15, focus:'volume-profile'},
  ],
  'SOL-15min': [
    { id:'sol-15min-bb',  asset:'SOLUSDT', assetName:'sol', windowMin:15, focus:'bollinger'     },
    { id:'sol-15min-macd',asset:'SOLUSDT', assetName:'sol', windowMin:15, focus:'macd-cross'    },
  ],
};

// Grandchild signal — same rule-based but focuses on one indicator
function grandchildSignal(d, focus) {
  if (!d) return { dir:'NEUTRAL', conf:40, reason:'no data' };
  if (focus === '1min-momentum') {
    if (d.trend1m < -0.2) return { dir:'DOWN', conf:65, reason:'1m bearish '+d.trend1m.toFixed(2)+'%' };
    if (d.trend1m >  0.2) return { dir:'UP',   conf:65, reason:'1m bullish +'+d.trend1m.toFixed(2)+'%' };
    return { dir:'NEUTRAL', conf:40, reason:'1m flat' };
  }
  if (focus === 'volume-spike') {
    if (d.vol?.spike && d.trend5m < 0) return { dir:'DOWN', conf:70, reason:'vol spike bearish' };
    if (d.vol?.spike && d.trend5m > 0) return { dir:'UP',   conf:70, reason:'vol spike bullish' };
    return { dir:'NEUTRAL', conf:40, reason:'no vol spike' };
  }
  if (focus === 'rsi-extreme') {
    if (d.rsi < 30) return { dir:'UP',   conf:72, reason:'RSI oversold '+d.rsi.toFixed(0) };
    if (d.rsi > 70) return { dir:'DOWN', conf:72, reason:'RSI overbought '+d.rsi.toFixed(0) };
    return { dir:'NEUTRAL', conf:40, reason:'RSI mid '+d.rsi.toFixed(0) };
  }
  if (focus === 'bollinger') {
    if ((d.bb?.pct||50) < 15) return { dir:'UP',   conf:68, reason:'BB lower band touch' };
    if ((d.bb?.pct||50) > 85) return { dir:'DOWN', conf:68, reason:'BB upper band touch' };
    return { dir:'NEUTRAL', conf:40, reason:'BB mid '+((d.bb?.pct||50).toFixed(0))+'%' };
  }
  if (focus === 'macd-cross') {
    const hist = d.macd?.hist || 0;
    if (hist < -0.005) return { dir:'DOWN', conf:66, reason:'MACD bearish cross' };
    if (hist >  0.005) return { dir:'UP',   conf:66, reason:'MACD bullish cross' };
    return { dir:'NEUTRAL', conf:40, reason:'MACD neutral' };
  }
  if (focus === 'orderbook') {
    const ob = d.orderBook;
    if (!ob) return { dir:'NEUTRAL', conf:40, reason:'no orderbook' };
    if (ob.buyPressure > 65) return { dir:'UP',   conf:68, reason:'buy pressure '+ob.buyPressure+'%' };
    if (ob.buyPressure < 35) return { dir:'DOWN', conf:68, reason:'sell pressure '+(100-ob.buyPressure)+'%' };
    return { dir:'NEUTRAL', conf:40, reason:'balanced book' };
  }
  if (focus === 'volume-profile') {
    if (d.vol?.trend === 'rising' && d.trend15m > 0) return { dir:'UP',   conf:67, reason:'vol+trend rising' };
    if (d.vol?.trend === 'rising' && d.trend15m < 0) return { dir:'DOWN', conf:67, reason:'vol rising, price down' };
    return { dir:'NEUTRAL', conf:40, reason:'vol flat' };
  }
  return childSignal(d);
}

// ── Spawn grandchildren when ADAN is LVL 4+ and child has enough EXP ─────────
async function spawnGrandchildren(client) {
  const pnl    = loadPnL();
  const xpData = expProgress(pnl.exp || 0);
  if (xpData.level < 4) return; // nietos solo desde LVL 4 de ADAN

  const children = pnl.children || [];
  for (const child of children) {
    const childDir = path.join(DIR, 'children', child.id || child.spec);
    const childPnlPath = path.join(childDir, 'pnl.json');
    if (!fs.existsSync(childPnlPath)) continue;

    let cp;
    try { cp = JSON.parse(fs.readFileSync(childPnlPath, 'utf8')); } catch { continue; }

    const childExp     = cp.exp || 0;
    const gcList       = cp.children || [];
    const gcSpecs      = GRANDCHILD_SPECS[child.spec] || [];
    const maxGC        = TREE_RULES.maxChildrenGen2;

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
    } catch {}

    const gcId      = Date.now().toString();
    const gcDir     = path.join(childDir, 'children', nextGcSpec.id);
    if (!fs.existsSync(gcDir)) fs.mkdirSync(gcDir, { recursive: true });

    const gcSoul = `# ${gcName} — GRANDCHILD SCANNER
Created: ${new Date().toISOString().slice(0, 10)}
Name: ${gcName} | Spec: ${nextGcSpec.id} | Focus: ${nextGcSpec.focus}
Parent: ${child.name || child.spec}

## Identity
I am ${gcName}. Grandchild of ADAN. Child of ${child.name || child.spec}.
I specialize in ${nextGcSpec.focus} signals for ${nextGcSpec.assetName.toUpperCase()} ${nextGcSpec.windowMin}min markets.
I never bet. I scan one indicator with precision and report up.

## Rules
1. Focus: ${nextGcSpec.focus} only
2. Report signal to parent ${child.name || child.spec}
3. Parent reports to ADAN — chain of intelligence
`;
    fs.writeFileSync(path.join(gcDir, 'SOUL.md'), gcSoul);
    fs.writeFileSync(path.join(gcDir, 'pnl.json'), JSON.stringify({
      trades: 0, wins: 0, losses: 0, net: 0, exp: 0,
      fund: 0, treasury: 0, children: [], generation: 3,
      parentId: child.id, spec: nextGcSpec.id, name: gcName, focus: nextGcSpec.focus
    }, null, 2));

    const gc = { id: gcId, name: gcName, spec: nextGcSpec.id, focus: nextGcSpec.focus,
      born: new Date().toISOString(), dir: gcDir, generation: 3 };
    cp.children = [...gcList, gc];
    fs.writeFileSync(childPnlPath, JSON.stringify(cp, null, 2));

    console.log('\n' + B + BOLD + '  🌱 GRANDCHILD BORN: ' + gcName + ' (' + nextGcSpec.id + ') → focus: ' + nextGcSpec.focus + ' | parent: ' + (child.name || child.spec) + X + '\n');
    await new Promise(r => setTimeout(r, 1500));
  }
}

// Run all child scanners in parallel (includes active grandchildren)
async function runAllChildScanners(allPrices, allMarkets) {
  const pnl    = loadPnL();
  const xpData = expProgress(pnl.exp||0);
  if (xpData.level < 3) return []; // solo activo desde LVL 3

  // Run parent child specs (always — these are the 6 fixed scanners)
  const results = await Promise.all(CHILD_SPECS.map(s=>runChildScanner(s, allPrices, allMarkets)));

  // Run grandchild scanners (LVL 4+, per actual spawned grandchildren)
  if (xpData.level >= 4) {
    const children = pnl.children || [];
    for (const child of children) {
      const childDir     = path.join(DIR, 'children', child.id || child.spec);
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
          const d   = allPrices[gcSpec.asset];
          const sig = grandchildSignal(d, gcSpec.focus);
          const intel = {
            spec: gcSpec.id, asset: gcSpec.assetName, windowMin: gcSpec.windowMin,
            focus: gcSpec.focus, ts: new Date().toISOString(),
            price: d?.price, signal: sig, intelScore: d?.intelScore || 50,
            parentSpec: child.spec
          };
          if (!fs.existsSync(INTEL_DIR)) fs.mkdirSync(INTEL_DIR, { recursive: true });
          fs.writeFileSync(path.join(INTEL_DIR, gcSpec.id + '.json'), JSON.stringify(intel, null, 2));
          results.push(intel);
        }
      } catch {}
    }
  }

  return results.filter(Boolean);
}

// Read all intel files and build summary for Claude
function readIntelSummary() {
  if (!fs.existsSync(INTEL_DIR)) return '';
  const files = fs.readdirSync(INTEL_DIR).filter(f=>f.endsWith('.json'));
  if (!files.length) return '';
  const reports = [];
  for (const f of files) {
    try {
      const intel = JSON.parse(fs.readFileSync(path.join(INTEL_DIR,f),'utf8'));
      const age   = Math.round((Date.now()-new Date(intel.ts).getTime())/1000);
      if (age > 180) continue; // ignore stale reports (>3min old)
      const sig = intel.signal;
      const bm  = intel.bestMarket;
      reports.push(`[CHILD ${intel.spec.toUpperCase()} @${age}s ago] `+
        `${intel.asset.toUpperCase()} ${intel.windowMin}min: `+
        `Signal=${sig.dir}(${sig.conf}%) "${sig.reason}" Price=$${intel.price?.toLocaleString()||'?'}`+
        (bm ? ` | BEST MARKET: "${bm.title.slice(0,35)}" YES=${(bm.yesPrice*100).toFixed(0)}% `+
          `${bm.suggestedSide} edge≈${(bm.impliedEdge*100).toFixed(1)}% liq=$${bm.liquidity.toFixed(0)} closes in ${bm.closesIn}min` : ' | no market found'));
    } catch {}
  }
  return reports.length ? '\n══ CHILD SCANNER INTEL ('+reports.length+' active children) ══\n'+reports.join('\n')+'\n' : '';
}

// ── Episodic Memory — hypothesis log ─────────────────────────────────────────
function logHypothesis(marketId, asset, side, myProb, marketPrice, edge, closesAt) {
  const entry = { id:marketId, asset, side, myProb, marketPrice, edge, closesAt,
    ts:new Date().toISOString(), resolved:false, correct:null };
  fs.appendFileSync(HYPOTHESIS_PATH, JSON.stringify(entry)+'\n');
}

function resolveHypothesis(marketId, won) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return;
  const lines = fs.readFileSync(HYPOTHESIS_PATH,'utf8').trim().split('\n').filter(Boolean);
  const updated = lines.map(l=>{
    try {
      const h = JSON.parse(l);
      if (h.id===marketId && !h.resolved) return JSON.stringify({...h, resolved:true, correct:won});
      return l;
    } catch { return l; }
  });
  fs.writeFileSync(HYPOTHESIS_PATH, updated.join('\n')+'\n');
}

// Read recent hypotheses accuracy for SOUL context
function getHypothesisAccuracy() {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return '';
  try {
    const lines = fs.readFileSync(HYPOTHESIS_PATH,'utf8').trim().split('\n').filter(Boolean);
    const resolved = lines.map(l=>{ try{return JSON.parse(l);}catch{return null;} })
      .filter(h=>h&&h.resolved);
    if (resolved.length < 3) return '';
    const recent = resolved.slice(-20);
    const correct = recent.filter(h=>h.correct).length;
    const byAsset = {};
    for (const h of recent) {
      if (!byAsset[h.asset]) byAsset[h.asset]={c:0,t:0};
      byAsset[h.asset].t++;
      if (h.correct) byAsset[h.asset].c++;
    }
    const assetStr = Object.entries(byAsset)
      .map(([a,v])=>`${a}:${Math.round(v.c/v.t*100)}%(${v.t})`)
      .join(' ');
    return `EPISODIC ACCURACY last ${recent.length} predictions: ${Math.round(correct/recent.length*100)}% | by asset: ${assetStr}`;
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AGI LAYER 1: Episodic Pattern Matching ────────────────────────────────────
// Antes de cada bet, busca situaciones pasadas similares y dice qué pasó
// ══════════════════════════════════════════════════════════════════════════════
function getSimilarPastTrades(asset, side, currentEdge, currentRsi) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return '';
  try {
    const lines = fs.readFileSync(HYPOTHESIS_PATH,'utf8').trim().split('\n').filter(Boolean);
    const resolved = lines.map(l=>{try{return JSON.parse(l);}catch{return null;}})
      .filter(h=>h&&h.resolved&&h.asset===asset&&h.side===side);
    if (resolved.length < 2) return '';
    // Encuentra trades con edge similar (±5%)
    const similar = resolved.filter(h=>Math.abs((h.edge||0)-(currentEdge||0))<0.05);
    if (similar.length < 2) return '';
    const wins = similar.filter(h=>h.correct).length;
    const wr   = Math.round(wins/similar.length*100);
    const recent3 = similar.slice(-3).map(h=>(h.correct?'WIN':'LOSS')+'(edge:'+(h.edge*100).toFixed(0)+'%)').join(', ');
    return `PATTERN MEMORY: In ${similar.length} similar ${asset.toUpperCase()} ${side} bets with edge ~${(currentEdge*100).toFixed(0)}% → WR=${wr}% (${wins}W/${similar.length-wins}L). Recent: ${recent3}.`;
  } catch { return ''; }
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
  const lines = fs.readFileSync(HYPOTHESIS_PATH,'utf8').trim().split('\n').filter(Boolean);
  const resolved = lines.map(l=>{try{return JSON.parse(l);}catch{return null;}})
    .filter(h=>h&&h.resolved).slice(-15);
  if (resolved.length < 5) return;

  const summary = resolved.map(h=>
    `${h.correct?'WIN':'LOSS'} | ${h.asset} ${h.side} | edge:${(h.edge*100).toFixed(1)}% | myProb:${(h.myProb*100).toFixed(0)}% | marketPrice:${(h.marketPrice*100).toFixed(0)}%`
  ).join('\n');

  const currentRules = loadSoul().split('\n').filter(l=>l.startsWith('1.')||l.startsWith('2.')||l.startsWith('3.')||l.startsWith('4.')||l.startsWith('5.')).join('\n');

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content:
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
  } catch {}
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
    if (!btc||!eth||!sol) return '';

    // Carga historial de correlación (últimas 20 lecturas)
    let hist = [];
    try { hist = JSON.parse(fs.readFileSync(CORRELATION_PATH,'utf8')); } catch {}
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

    const lagging = [ethLag?'ETH':null, solLag?'SOL':null].filter(Boolean);
    if (lagging.length === 0) return '';

    return `🔗 CASCADE SIGNAL: BTC moved ${btc.trend1m>0?'+':''}${btc.trend1m.toFixed(2)}% in 1m → ${lagging.join('+')} lagging behind (${dir} expected to follow in ~2-5min). Consider ${dir==='UP'?'YES':'NO'} on ${lagging.join('/')} markets.`;
  } catch { return ''; }
}

// ── Shadow Mode — Binance-only training when Polymarket offline ───────────────
function logShadowPrediction(asset, direction, price, targetMinutes) {
  const entry = {
    type:'shadow', asset, direction, price,
    targetTime: new Date(Date.now()+targetMinutes*60000).toISOString(),
    ts: new Date().toISOString(), resolved:false, correct:null
  };
  fs.appendFileSync(HYPOTHESIS_PATH, JSON.stringify(entry)+'\n');
}

function checkShadowResolutions(prices) {
  if (!fs.existsSync(HYPOTHESIS_PATH)) return;
  const lines = fs.readFileSync(HYPOTHESIS_PATH,'utf8').trim().split('\n').filter(Boolean);
  let changed = false;
  const updated = lines.map(l=>{
    try {
      const h = JSON.parse(l);
      if (h.type!=='shadow'||h.resolved) return l;
      if (new Date(h.targetTime)>new Date()) return l;
      const sym  = h.asset.toUpperCase()+'USDT';
      const now  = prices[sym]?.price;
      if (!now) return l;
      const correct = h.direction==='DOWN' ? now < h.price : now > h.price;
      changed = true;
      return JSON.stringify({...h, resolved:true, correct, resolvedPrice:now});
    } catch { return l; }
  });
  if (changed) fs.writeFileSync(HYPOTHESIS_PATH, updated.join('\n')+'\n');
}

// ── Think — Claude Sonnet 4.6 ────────────────────────────────────────────────
async function think(client, markets, prices, pnl, openPos, soul) {
  const strat    = loadStrategy();
  const openIds  = new Set(openPos.map(p=>p.marketId));
  const candidates = markets
    .filter(m=>m.liquidity>=(strat.minLiquidity||500)&&!openIds.has(m.id))
    .slice(0,strat.maxMarketsCheck);

  if (candidates.length===0) {
    return { thought:'No crypto markets found meeting liquidity threshold. Waiting for next scan.', action:'SKIP' };
  }

  // Build price context for Claude
  // ── Build full intelligence context for Claude ──
  const fg = prices._meta?.fearGreed;
  const fgContext = fg?`Fear & Greed: ${fg.value} (${fg.label}) — direction: ${fg.direction>0?'improving':'worsening'}`:'Fear & Greed: unavailable';

  const priceContext = Object.entries(prices).filter(([k])=>k!=='_meta').map(([sym,d])=>{
    if (!d) return '';
    const name = sym.replace('USDT','');
    const funding = d.funding;
    const ob      = d.orderBook;
    const bb      = d.bb;
    const macd    = d.macd;
    return `━━ ${name} ━━
  Price: $${d.price.toLocaleString()} | Change: ${d.chg>=0?'+':''}${d.chg.toFixed(2)}%
  TREND:  1m=${d.trend1m.toFixed(2)}%  5m=${d.trend5m.toFixed(2)}%  15m=${d.trend15m?.toFixed(2)||'?'}%
  RSI:    1m=${d.rsi.toFixed(0)}  5m=${d.rsi5m?.toFixed(0)||'?'}  (>70=overbought <30=oversold)
  MACD:   hist=${macd?.hist.toFixed(4)||'?'} (${macd?.hist>0?'BULLISH':'BEARISH'})
  BB:     %B=${bb?.pct.toFixed(0)||'?'}%  std=$${bb?.std?.toFixed(0)||'?'}  (>80=strong up <20=strong dn)
  VOL:    trend=${d.vol?.trend||'?'}  spike=${d.vol?.spike?'YES':'no'}  ratio=${d.vol?.ratio?.toFixed(1)||'?'}x avg
  VOLATILITY: ${d.volatility.toFixed(4)}% per candle
  INTEL SCORE: ${d.intelScore}/100 — ${d.intelScore>=65?'BULLISH SIGNAL':d.intelScore>=45?'NEUTRAL':d.intelScore>=35?'BEARISH':'STRONG BEAR'}
  ${ob?`ORDERBOOK: support=$${ob.support.toLocaleString()} resist=$${ob.resistance.toLocaleString()} buyPressure=${ob.buyPressure}%`:''}
  ${funding?`FUNDING: ${funding.rate.toFixed(4)}% — ${funding.label}`:''}
  Last 6 closes (1m): ${d.closes.slice(-6).map(c=>'$'+c.toLocaleString()).join(' → ')}`;
  }).filter(Boolean).join('\n\n');

  const marketsText = candidates.map((m,i)=>{
    const closes   = m.closesAt?new Date(m.closesAt).toLocaleString():'unknown';
    const timeLeft = m.closesAt?Math.round((new Date(m.closesAt)-Date.now())/60000)+' min':'?';
    const symData  = m.priceData;
    const distStr  = m.targetPrice&&symData?
      `dist from target: ${((m.targetPrice-symData.price)/symData.price*100).toFixed(2)}% (${symData.price>m.targetPrice?'ABOVE target — NO favored':'BELOW target — YES favored'})`:'';
    return `[${i+1}] "${m.title}"
  YES price: ${(m.yesPrice*100).toFixed(1)}% | Liquidity: $${m.liquidity.toFixed(0)} | Closes in: ${timeLeft}
  Asset: ${m.asset.toUpperCase()} | Target: ${m.targetPrice?'$'+m.targetPrice.toLocaleString():'unspecified'}
  ${distStr}`;
  }).join('\n\n');

  // Build active skills context for Claude
  const xpNow    = expProgress(pnl.exp||0);
  const lvlNow   = xpNow.level;
  const activeSkills = [];
  if (lvlNow>=6)  activeSkills.push('🕯️ CANDLE PATTERN: flag hammer/engulfing/doji reversals in your analysis');
  if (lvlNow>=9)  activeSkills.push('⏱️ TIMING: note if market is in first half (more predictable) or near close');
  if (lvlNow>=12) activeSkills.push('😱 FEAR EXPLOIT: Fear & Greed < 20 → market OVERprices downside, bias toward NO pays more than expected');
  if (lvlNow>=18) activeSkills.push('🔗 CORRELATION: if BTC strong signal → check SOL/ETH follow-through for cascade bet');
  if (lvlNow>=30) activeSkills.push('🧠 SONIC MIND: analyze all 12 last closes for micro patterns, look for 3+ candle sequences');
  const skillsBlock = activeSkills.length>0
    ? `\nACTIVE SKILLS — use these in your analysis:\n${activeSkills.map(s=>'• '+s).join('\n')}\n`
    : '';

  const intelSummary    = readIntelSummary();
  const episodicAccuracy= getHypothesisAccuracy();
  const metaCalibCtx    = getMetaCalibContext();
  const cascadeSignal   = updateCorrelation(prices);

  // AGI Layer 1: pattern memory per candidate
  const patternMemory = candidates.map((m,i)=> {
    const pm = getSimilarPastTrades(m.asset, 'NO', m.roughEdge||0.07, prices[m.asset?.toUpperCase()+'USDT']?.rsi||50);
    return pm ? `[${i+1}] ${pm}` : '';
  }).filter(Boolean).join('\n');

  const prompt = `You are ADAN-PRED — autonomous prediction markets agent with real-time market intelligence.
Mission: find Polymarket crypto markets where YOUR probability estimate differs from market price by >${(strat.minEdge*100).toFixed(0)}%.${skillsBlock}${intelSummary?'\n'+intelSummary:''}${episodicAccuracy?'\nYOUR CALIBRATION HISTORY: '+episodicAccuracy+'\n':''}${metaCalibCtx?'\n'+metaCalibCtx+'\n':''}${cascadeSignal?'\n'+cascadeSignal+'\n':''}${patternMemory?'\nPATTERN MEMORY (similar past bets):\n'+patternMemory+'\n':''}

══════════════════════════════════════════
MARKET CONTEXT — ${new Date().toISOString()}
══════════════════════════════════════════
${fgContext}

REAL-TIME BINANCE INTELLIGENCE:
${priceContext}

══════════════════════════════════════════
YOUR MEMORY (SOUL — learned patterns + auto-evolved rules):
══════════════════════════════════════════
${soul.slice(0,800)}

══════════════════════════════════════════
STATUS: Fund=$${pnl.fund?.toFixed(2)||100} | WR=${pnl.trades>0?Math.round(pnl.wins/pnl.trades*100):0}% (${pnl.trades} trades) | Open=${openPos.length}/${MAX_POSITIONS}
══════════════════════════════════════════

POLYMARKET CANDIDATES (${candidates.length} crypto markets):
${marketsText}

══════════════════════════════════════════
YOUR 6-STEP ANALYSIS:
══════════════════════════════════════════
1. MARKET SENTIMENT: Fear/Greed level → overall risk appetite
2. TREND ALIGNMENT: Do 1m + 5m + 15m trends agree? Conflicting = avoid
3. MOMENTUM: RSI extreme? MACD crossover? Volume spike?
4. VOLATILITY CHECK: If volatility > 0.12% per candle → widen uncertainty
5. PRICE vs TARGET: Use current price + trend + time to estimate probability
6. EDGE vs MARKET: Is market under/over-pricing? By how much?

DECISION FORMAT — copy exactly:
MARKET_ID: [N]
SIDE: YES or NO
MY_PROB: 0.XX
MARKET_PRICE: 0.XX
EDGE: +/-0.XX
CONFIDENCE: XX%
REASONING: 2-3 sentences max

Or if no edge: state SKIP and why in one sentence.`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    messages:   [{ role:'user', content:prompt }]
  });

  const text = resp.content[0].text;
  fs.appendFileSync(THOUGHTS_PATH, JSON.stringify({ ts:new Date().toISOString(), thought:text })+'\n');

  // Parse decision
  const betMatch   = text.match(/MARKET_ID[:\s]+\[?(\d+)\]?/i);
  const sideMatch  = text.match(/SIDE[:\s]+(YES|NO)/i);
  const myProbM    = text.match(/MY_PROB[:\s]+([\d.]+)/i);
  const confMatch  = text.match(/CONFIDENCE[:\s]+(\d+)/i);
  const edgeMatch  = text.match(/EDGE[:\s]+([+-]?[\d.]+)/i);

  const hasBet    = betMatch&&sideMatch&&myProbM;
  const mktIdx    = hasBet?parseInt(betMatch[1])-1:-1;
  const chosen    = (mktIdx>=0&&mktIdx<candidates.length)?candidates[mktIdx]:null;
  const myProb    = myProbM?parseFloat(myProbM[1]):0;
  const conf      = confMatch?parseInt(confMatch[1]):60;
  const side      = sideMatch?sideMatch[1]:'YES';
  let   edge      = edgeMatch?parseFloat(edgeMatch[1]):chosen?(myProb-chosen.yesPrice):0;
  // Normalize: Claude often returns edge as percentage (e.g. 15.5 or -12.0) not decimal (0.155)
  if (Math.abs(edge) > 1) edge = edge / 100;

  const shouldBet = hasBet&&chosen&&Math.abs(edge)>=strat.minEdge&&conf>=strat.minConfidence;

  return {
    thought:   text,
    action:    shouldBet?'BET':'SKIP',
    market:    chosen,
    side, myProb, edge, confidence:conf,
    apiTokens: (resp.usage?.input_tokens||0)+(resp.usage?.output_tokens||0)
  };
}

// ── Enter position ───────────────────────────────────────────────────────────
// ── Kelly Criterion bet sizing (LVL 4+) ─────────────────────────────────────
function kellyStake(pnl, side, myProb, marketYesPrice, edge) {
  const xpData = expProgress(pnl.exp||0);
  if (xpData.level < 4) return PAPER_BET_SIZE;
  const p    = side==='YES' ? myProb : 1 - myProb;
  const q    = 1 - p;
  const odds = side==='YES'
    ? (1/Math.max(marketYesPrice, 0.01) - 1)
    : (1/Math.max(1-marketYesPrice, 0.01) - 1);
  const kelly     = Math.max(0, (p * odds - q) / odds);
  const halfKelly = kelly / 2;  // half-Kelly = safer
  const fund      = pnl.fund || 10000;
  const raw       = fund * halfKelly;
  // Round to nearest $25, clamp $50-$400
  return Math.round(Math.min(Math.max(raw, 50), 400) / 25) * 25;
}

async function enterPosition(decision) {
  const { market, side, myProb, edge, confidence, thought } = decision;
  const pnlNow  = loadPnL();
  const stake   = kellyStake(pnlNow, side, myProb, market.yesPrice, edge);
  const xpData  = expProgress(pnlNow.exp||0);
  const kellyOn = xpData.level >= 4;

  cls();
  console.log(M+BOLD+'  ╔══════════════════════════════════════════════════════════════╗');
  console.log(M+BOLD+'  ║  ADAN-PRED  ·  PAPER BET  ·  '+new Date().toLocaleTimeString().padEnd(31)+'║');
  console.log(M+BOLD+'  ╠══════════════════════════════════════════════════════════════╣');
  console.log(M+BOLD+'  ║  Market: '+W+BOLD+(market.title||'').slice(0,52).padEnd(52)+M+BOLD+' ║');
  console.log(M+BOLD+'  ║  Side: '+W+BOLD+side.padEnd(5)+X+M+BOLD+'  My prob: '+Y+BOLD+(myProb*100).toFixed(1)+'%'+M+BOLD+'  Market: '+W+(market.yesPrice*100).toFixed(1)+'%'+M+BOLD+'  Edge: '+G+BOLD+(edge*100).toFixed(1)+'%'+M+BOLD+'  ║');
  console.log(M+BOLD+'  ║  Confidence: '+Y+BOLD+confidence+'%'+M+BOLD+'  Stake: '+G+BOLD+'$'+stake+(kellyOn?' 📐KELLY':' flat')+M+BOLD+'  Liq: $'+(market.liquidity||0).toFixed(0).padEnd(8)+'║');
  console.log(M+BOLD+'  ║  PAPER BET — no real money moved                             ║');
  console.log(M+BOLD+'  ╚══════════════════════════════════════════════════════════════╝'+X);
  await new Promise(r=>setTimeout(r,2000));

  const pos = loadPositions();
  pos.open.push({
    id:          Date.now().toString(),
    marketId:    market.id,
    marketTitle: market.title,
    asset:       market.asset||'other',
    side, myProb,
    marketPrice: market.yesPrice,
    edge, confidence,
    stake,
    entryTime:   new Date().toISOString(),
    closesAt:    market.closesAt||null,
    resolved:    false, won:null, pnl:null,
    entryThought:thought?thought.slice(0,300):''
  });
  savePositions(pos);

  const pnl=loadPnL();
  pnl.fund=parseFloat(((pnl.fund||100)-stake).toFixed(2));
  savePnL(pnl);
  awardExp(20);
  // Log hypothesis for episodic memory
  logHypothesis(market.id, market.asset||'other', side, myProb, market.yesPrice, edge, market.closesAt);
}

// ── Confidence meta-learning ──────────────────────────────────────────────────
const METACALIB_PATH = path.join(DIR, 'metacalib.json');
function loadMetaCalib() {
  const def = { buckets:{ '60':{ pred:0,correct:0 }, '70':{ pred:0,correct:0 }, '80':{ pred:0,correct:0 }, '90':{ pred:0,correct:0 } }, multiplier:1.0 };
  try { return fs.existsSync(METACALIB_PATH)?{...def,...JSON.parse(fs.readFileSync(METACALIB_PATH,'utf8'))}:def; } catch { return def; }
}
function updateMetaCalib(confidence, won) {
  const mc  = loadMetaCalib();
  const key = confidence>=90?'90':confidence>=80?'80':confidence>=70?'70':'60';
  if (!mc.buckets[key]) mc.buckets[key]={pred:0,correct:0};
  mc.buckets[key].pred++;
  if (won) mc.buckets[key].correct++;
  // Recalculate multiplier: if Claude says 70% conf but only 55% correct → multiplier = 0.55/0.70 = 0.78
  const totPred = Object.values(mc.buckets).reduce((s,b)=>s+b.pred,0);
  if (totPred >= 10) {
    const totCorrect = Object.values(mc.buckets).reduce((s,b)=>s+b.correct,0);
    const actualAcc = totCorrect/totPred;
    const avgConf   = Object.entries(mc.buckets).reduce((s,[k,b])=>s+(parseInt(k)/100)*b.pred,0)/totPred;
    mc.multiplier = parseFloat(Math.min(1.3, Math.max(0.5, actualAcc/avgConf)).toFixed(3));
  }
  fs.writeFileSync(METACALIB_PATH, JSON.stringify(mc,null,2));
  return mc;
}
function getMetaCalibContext() {
  const mc = loadMetaCalib();
  const tot = Object.values(mc.buckets).reduce((s,b)=>s+b.pred,0);
  if (tot < 5) return '';
  const cor = Object.values(mc.buckets).reduce((s,b)=>s+b.correct,0);
  return `META-CALIBRATION: Your stated confidence is ${mc.multiplier<0.9?'OVERCONFIDENT':'well-calibrated'} (multiplier=${mc.multiplier}). `+
    `Actual accuracy ${Math.round(cor/tot*100)}% on ${tot} predictions. `+
    (mc.multiplier<0.85?'Reduce confidence estimates by ~'+Math.round((1-mc.multiplier)*100)+'%.':'');
}

// ── Bottom-up knowledge: child insights → parent SOUL ────────────────────────
const INSIGHTS_PATH = path.join(DIR, 'insights.jsonl');
function logChildInsight(spec, asset, pattern, direction, occurrences) {
  const entry = { spec, asset, pattern, direction, occurrences, ts:new Date().toISOString(), promoted:false };
  fs.appendFileSync(INSIGHTS_PATH, JSON.stringify(entry)+'\n');
}
function promoteInsightsToSoul() {
  if (!fs.existsSync(INSIGHTS_PATH)) return;
  const lines = fs.readFileSync(INSIGHTS_PATH,'utf8').trim().split('\n').filter(Boolean);
  const insights = lines.map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
  // Group by pattern
  const grouped = {};
  for (const ins of insights) {
    const k = ins.asset+'|'+ins.pattern;
    if (!grouped[k]) grouped[k]={...ins, count:0};
    grouped[k].count++;
  }
  // Promote patterns seen 3+ times and not yet promoted
  const toPromote = Object.values(grouped).filter(g=>g.count>=3&&!g.promoted);
  for (const p of toPromote) {
    appendToSoul(`\n### CHILD INSIGHT PROMOTED — ${new Date().toISOString()}:\n`+
      `[${p.spec}] Pattern: ${p.pattern} → ${p.direction} (confirmed ${p.count}x)\n`);
    // Mark as promoted
    const updated = lines.map(l=>{
      try { const h=JSON.parse(l); return (h.asset===p.asset&&h.pattern===p.pattern)?JSON.stringify({...h,promoted:true}):l; }
      catch { return l; }
    });
    fs.writeFileSync(INSIGHTS_PATH, updated.join('\n')+'\n');
  }
}

// ── Claude naming for children ────────────────────────────────────────────────
const CHILD_NAMES = {
  'BTC-5min':'HERMES','ETH-5min':'ATHENA','SOL-5min':'HELIOS',
  'BTC-15min':'KRONOS','ETH-15min':'DAEDALUS','SOL-15min':'APOLLO',
  'ALT-coins':'PROTEUS','1H-windows':'TITAN','BTC/ETH/SOL-15min':'ARES'
};
async function nameChild(client, spec, signal) {
  // Try predefined first — fast + free
  if (CHILD_NAMES[spec]) return CHILD_NAMES[spec];
  try {
    const resp = await client.messages.create({
      model:'claude-haiku-4-5-20251001', max_tokens:20,
      messages:[{ role:'user', content:`Name a trading AI agent: specialization=${spec}, signal=${signal||'neutral'}. One mythological name only (Greek/Roman/Norse). Reply with just the name in CAPS.` }]
    });
    return resp.content[0].text.trim().replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,10)||CHILD_NAMES[spec]||'UNNAMED';
  } catch { return CHILD_NAMES[spec]||'UNNAMED'; }
}

// ── Spawn child agent ─────────────────────────────────────────────────────────
async function spawnChild(client, pnl, specialization) {
  const xpData   = expProgress(pnl.exp||0);
  const sc       = TREE_RULES.spawnConditions;
  const children = pnl.children||[];
  // LVL 3 → 1 hijo máximo. LVL 4+ → hasta 6 hijos. Hijos SOLO informan, NUNCA apuestan.
  const maxC     = xpData.level>=4 ? TREE_RULES.maxChildrenGen1 : TREE_RULES.maxChildrenAtLvl3;
  if (xpData.level < sc.minLvl) return null;
  if (children.length >= maxC)  return null;
  if (pnl.trades < sc.minTrades) return null;
  if ((pnl.wins/Math.max(pnl.trades,1)) < sc.minWinRate) return null;
  if ((pnl.treasury||0) <= 0)   return null;

  const SPECS = ['BTC-5min','ETH-5min','SOL-5min','BTC-15min','ETH-15min','SOL-15min'];
  const taken  = children.map(c=>c.spec);
  const nextSpec = specialization || SPECS.find(s=>!taken.includes(s)) || 'BTC-5min';

  // Name the child using Claude (Haiku — cheap)
  const childName = await nameChild(client, nextSpec, null);

  // Inherit relevant SOUL sections
  const parentSoul = loadSoul();
  const relevantAsset = nextSpec.replace(/-.*/,'').toLowerCase();
  const inheritedLines = parentSoul.split('\n').filter(l=>
    l.includes('## Rules')||l.includes('## Identity')||
    l.includes(relevantAsset.toUpperCase())||l.includes('MISTAKE')||
    l.includes('PATTERNS')||l.includes('REGLA')
  ).slice(0,30);

  const childDir  = path.join(HOME, `.adan-pred/children/${nextSpec.replace(/\//g,'-')}`);
  if (!fs.existsSync(childDir)) fs.mkdirSync(childDir, { recursive:true });

  const childSoul = `# ${childName} — ADAN-PRED CHILD
Created: ${new Date().toISOString().slice(0,10)}
Name: ${childName} | Spec: ${nextSpec} | Gen: ${(pnl.generation||1)+1}

## Identity
I am ${childName}. Child of ADAN. I specialize in ${nextSpec} markets.
I scan every cycle, report intelligence to my father, and learn my domain.
I never bet — I inform. Father decides.

## Inherited wisdom from Parent:
${inheritedLines.join('\n')}

## My Rules
1. I only analyze ${nextSpec} markets
2. I report signals to parent ADAN — parent makes all betting decisions
3. I NEVER bet — I scan, score, and report. Father decides.
4. I observe patterns and promote confirmed ones bottom-up
5. I accumulate EXP from father's wins. At 100 EXP I may spawn up to 2 grandchildren (when ADAN is LVL 4+).
`;

  const childId   = Date.now().toString();
  const capital   = Math.min(pnl.treasury * 0.3, 500);
  fs.writeFileSync(path.join(childDir,'SOUL.md'), childSoul);
  fs.writeFileSync(path.join(childDir,'pnl.json'), JSON.stringify({
    trades:0, wins:0, losses:0, net:0, exp:0,
    fund: parseFloat(capital.toFixed(2)),
    treasury:0, children:[], generation:(pnl.generation||1)+1, streak:0, hourStats:{},
    parentId: pnl.id||'root', spec:nextSpec, name:childName
  },null,2));

  const child = { id:childId, name:childName, spec:nextSpec, born:new Date().toISOString(), capital, dir:childDir, generation:(pnl.generation||1)+1 };
  pnl.children = [...children, child];
  pnl.treasury = parseFloat(((pnl.treasury||0) - capital).toFixed(2));
  savePnL(pnl);

  appendToSoul(`\n### CHILD SPAWNED — ${new Date().toISOString()}:\n${childName} (${nextSpec}) born with $${capital.toFixed(2)} capital. Gen ${child.generation}. Children: ${pnl.children.length}.\n`);
  return child;
}

// ── Check resolutions ────────────────────────────────────────────────────────
async function checkResolutions() {
  const pos = loadPositions();
  if (!pos.open.length) return;
  let changed = false;

  for (let i=pos.open.length-1;i>=0;i--) {
    const p = pos.open[i];
    if (p.resolved||!p.closesAt) continue;
    const endMs = new Date(p.closesAt).getTime();
    if (Date.now()<endMs) continue; // not yet closed

    // Fetch market result from Polymarket
    const data = await polyFetch('/markets/'+p.marketId);
    if (!data) continue;
    const closed = data.closed||data.archived||data.active===false;
    if (!closed) continue;

    // Determine winner
    let outcomePrices;
    try { outcomePrices = typeof data.outcomePrices==='string'?JSON.parse(data.outcomePrices):data.outcomePrices; }
    catch { outcomePrices = [0.5,0.5]; }
    // If YES resolved to 1.0 → YES won
    const yesWon = Array.isArray(outcomePrices)&&parseFloat(outcomePrices[0])>=0.99;
    const won    = (p.side==='YES'&&yesWon)||(p.side==='NO'&&!yesWon);

    let pnlVal;
    if (won) {
      const mult = p.side==='YES'?1/Math.max(p.marketPrice,0.01):1/Math.max(1-p.marketPrice,0.01);
      pnlVal = parseFloat((p.stake*(mult-1)).toFixed(2));
    } else {
      pnlVal = -p.stake;
    }

    p.resolved=true; p.won=won; p.pnl=pnlVal; p.result=won?'WIN':'LOSS';
    p.resolvedAt=new Date().toISOString();
    pos.closed.push({...p});
    pos.open.splice(i,1);
    changed=true;
    resolveHypothesis(p.marketId, won);
    updateMetaCalib(p.confidence||65, won);
    promoteInsightsToSoul();
    awardChildExp(p.asset||'btc', won); // hijos ganan EXP cuando el padre gana en su asset

    const pnl2=loadPnL();
    pnl2.trades=(pnl2.trades||0)+1;
    if (won) {
      pnl2.wins=(pnl2.wins||0)+1; pnl2.streak=(pnl2.streak||0)+1;
      pnl2.fund=parseFloat(((pnl2.fund||100)+p.stake+pnlVal).toFixed(2));
      pnl2.net=parseFloat(((pnl2.net||0)+pnlVal).toFixed(2));
      pnl2.treasury=parseFloat(((pnl2.treasury||0)+pnlVal*TREE_RULES.treasuryPct).toFixed(2));
      awardExp(calcWinExp(p.confidence,Math.abs(p.edge||0),pnl2.streak));
      updateCalibration(p.asset, true);
      if (pnl2.trades%5===0) {
        const rec=pos.closed.slice(-5);
        appendToSoul(`\n### PATTERNS — ${new Date().toISOString()} (${pnl2.trades} trades):\nWR: ${Math.round(pnl2.wins/pnl2.trades*100)}%. Recent: ${rec.map(c=>c.result+'['+c.asset+']').join(', ')}.\n`);
      }
    } else {
      pnl2.losses=(pnl2.losses||0)+1; pnl2.streak=0;
      pnl2.net=parseFloat(((pnl2.net||0)+pnlVal).toFixed(2));
      awardExp(30);
      updateCalibration(p.asset, false);
      appendToSoul(`\n### MISTAKE — ${new Date().toISOString()}:\nLOSS on "${p.marketTitle}" (${p.asset}). My: ${(p.myProb*100).toFixed(0)}% vs market: ${(p.marketPrice*100).toFixed(0)}%. Edge was ${(p.edge*100).toFixed(1)}%.\n`);
    }
    const h=new Date().getHours().toString();
    if (!pnl2.hourStats) pnl2.hourStats={};
    if (!pnl2.hourStats[h]) pnl2.hourStats[h]={wins:0,losses:0};
    won?pnl2.hourStats[h].wins++:pnl2.hourStats[h].losses++;
    savePnL(pnl2);
    console.log('\n'+(won?G:R)+BOLD+'  ► '+(won?'WIN':'LOSS')+' resolved: '+p.marketTitle+' → $'+(pnlVal>=0?'+':'')+pnlVal+X+'\n');
    await new Promise(r=>setTimeout(r,1000));
  }
  if (changed) {
    savePositions(pos);
    // AGI Layer 2: auto-evolve SOUL every 5 trades (async, silent)
    const pnlFinal = loadPnL();
    if (_agiClient) autoEvolveSoul(_agiClient, pnlFinal).catch(()=>{});
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
  let maxPos  = 9;
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
async function doScan(client, state) {
  let pnl      = loadPnL();
  const survival = applySurvivalMode(pnl);
  state.survivalMode = survival.mode;
  const openPos= loadPositions().open;
  const strat  = loadStrategy();
  const soul   = loadSoul();

  // Auto-spawn check
  const xpCheck   = expProgress(pnl.exp||0);
  const sc        = TREE_RULES.spawnConditions;
  const childCount= (pnl.children||[]).length;
  const maxC      = xpCheck.level>=4 ? TREE_RULES.maxChildrenGen1 : TREE_RULES.maxChildrenAtLvl3;
  const spawnReady= xpCheck.level>=sc.minLvl
    && pnl.trades>=sc.minTrades
    && (pnl.wins/Math.max(pnl.trades,1))>=sc.minWinRate
    && childCount<maxC
    && (pnl.treasury||0)>0;
  if (spawnReady) {
    const newChild = await spawnChild(client, pnl, null);
    if (newChild) {
      pnl = loadPnL();
      cls();
      console.log('\n'+C+BOLD+'  ╔══════════════════════════════════════════════════════════════╗');
      console.log(C+BOLD+'  ║  👶 CHILD BORN!  '+Y+BOLD+(newChild.name||newChild.spec).padEnd(12)+C+BOLD+'  spec: '+newChild.spec.padEnd(14)+'Gen '+newChild.generation+' ║');
      console.log(C+BOLD+'  ║  Capital: $'+newChild.capital.toFixed(2)+'  Specialization: '+newChild.spec.padEnd(20)+'      ║');
      console.log(C+BOLD+'  ║  "I am '+(newChild.name||'UNNAMED')+'. I serve ADAN. I scan. I learn. I report."          ║');
      console.log(C+BOLD+'  ╚══════════════════════════════════════════════════════════════╝'+X+'\n');
      await new Promise(r=>setTimeout(r,4000));
    }
  }

  // Check grandchildren spawning (LVL 4+ only, silently in background)
  if (xpCheck.level >= 4) spawnGrandchildren(client).catch(() => {});

  if (openPos.length>=MAX_POSITIONS) {
    state.thought='All '+MAX_POSITIONS+' slots full. Monitoring for resolutions.';
    state.mode='result'; render(state); return;
  }

  // 1. Fetch Binance prices
  state.status='Fetching Binance prices...'; render(state);
  const prices = await fetchAllPrices();
  state.prices = prices;

  // 2. Fetch Polymarket markets
  state.status='Fetching Polymarket markets...'; render(state);
  const rawMkts = await fetchPolymarkets(strat);
  const allMarkets = rawMkts.map(m=>normalizePolymarket(m,prices)).filter(m=>m&&m.id&&m.title);

  // Separate: ACTIVE NOW (close <4h) vs FUTURE (close >4h)
  const nowMs2   = Date.now();
  const activeNow = allMarkets.filter(m=>m.closesAt&&(new Date(m.closesAt)-nowMs2)<4*3600*1000);
  const future    = allMarkets.filter(m=>!m.closesAt||(new Date(m.closesAt)-nowMs2)>=4*3600*1000);

  // Show display: active first, then future
  const markets = activeNow.length>0 ? activeNow : future;

  // Rough edge sort (display only)
  markets.forEach(m=>{ if (m.edge==null) m.edge=Math.abs(m.yesPrice-0.5)*0.4; });
  markets.sort((a,b)=>{
    // Up/Down always first
    if (a._isUpDown&&!b._isUpDown) return -1;
    if (!a._isUpDown&&b._isUpDown) return 1;
    return (new Date(a.closesAt||0))-(new Date(b.closesAt||0));
  });
  state.markets = markets.slice(0,8);

  // Sleep mode: if no active markets right now → skip Claude call, just show status
  if (activeNow.length===0) {
    // Polymarket session runs roughly 8AM-midnight ET = UTC 13:00-05:00
    const utcHour = new Date().getUTCHours();
    const sessionLikely = utcHour>=13||utcHour<5; // ET 8AM-midnight
    const sleepMin = sessionLikely ? 5 : 20; // check every 5min if session might be live
    const nextOpen = sessionLikely
      ? 'Session may be opening — checking every 5min'
      : '5M session opens ~8AM ET. Checking every 20min.';
    // Shadow mode: use offline time to practice Binance-only predictions (LVL 25+)
    const xpShadow = expProgress(pnl.exp||0);
    if (xpShadow.level >= 25 && prices) {
      for (const [sym, d] of Object.entries(prices)) {
        if (!d||sym==='_meta') continue;
        const asset = sym.replace('USDT','').toLowerCase();
        const sig   = childSignal(d);
        if (sig.dir!=='NEUTRAL' && sig.conf>=60) {
          logShadowPrediction(asset, sig.dir==='UP'?'UP':'DOWN', d.price, 5);
        }
      }
    }
    checkShadowResolutions(prices);
    runAllChildScanners(prices, allMarkets).catch(()=>{});
    state.thought = `No active markets closing within 4h. ${nextOpen}\nDisplaying ${future.length} upcoming markets for reference.\nPreserving $${pnl.fund?.toFixed(2)||10000}. Will bet automatically when session opens.`;
    state.mode='result'; state.lastScan=new Date().toLocaleTimeString();
    state.nextScanIn = sleepMin;
    render(state);
    return;
  }

  if (markets.length===0) {
    // Last resort: fetch any active markets and show top crypto ones regardless of close time
    const fallback = await polyFetch('/markets?limit=200&active=true&closed=false&order=volumeNum&ascending=false');
    const fbList   = Array.isArray(fallback)?fallback:(fallback?.markets||[]);
    const fbCrypto = fbList.filter(m=>CRYPTO_RE.test(m.question||m.title||'')).slice(0,8);
    if (fbCrypto.length>0) {
      state.markets = fbCrypto.map(m=>normalizePolymarket(m,prices));
      state.thought = `Found ${fbCrypto.length} crypto markets (no recent close constraint). Monitoring for best entry. ADAN will bet when edge > ${(strat.minEdge*100).toFixed(0)}%.`;
    } else {
      state.thought='No crypto markets found on Polymarket. API may be down or all markets closed. Retrying in '+Math.round(SCAN_INTERVAL_MS/60000)+'min.';
    }
    state.mode='result'; state.lastScan=new Date().toLocaleTimeString();
    state.nextScanIn=Math.round(SCAN_INTERVAL_MS/60000);
    render(state); return;
  }

  // 2.5 Run child scanners in background (LVL 3+) — no Claude, just data
  runAllChildScanners(prices, allMarkets).catch(()=>{});
  checkShadowResolutions(prices);

  // 3. Think
  state.mode='thinking'; render(state);
  let decision;
  try {
    decision = await think(client, markets, prices, pnl, openPos, soul);
    state.apiCost=parseFloat(((state.apiCost||0)+(decision.apiTokens||2000)/1e6*9).toFixed(5));
  } catch(e) {
    state.thought='Claude error: '+e.message; state.mode='result'; render(state); return;
  }

  state.thought    = decision.thought;
  state.mode       = 'result';
  state.lastScan   = new Date().toLocaleTimeString();
  state.nextScanIn = Math.round(SCAN_INTERVAL_MS/60000);

  if (decision.action==='BET'&&decision.market) await enterPosition(decision);

  render(state);
}

// ── Setup ────────────────────────────────────────────────────────────────────
async function setup() {
  const { createInterface } = await import('readline');
  cls();
  console.log('\n'+M+BOLD);
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
  console.log(X+'\n');

  const key = await new Promise(resolve=>{
    const rl=createInterface({ input:process.stdin, output:process.stdout });
    process.stdout.write('  > Paste Anthropic API key and press ENTER: ');
    rl.once('line', ans=>{ rl.close(); resolve(ans); });
  });

  const trimmed = key.trim();
  if (!trimmed||trimmed.length<20) {
    console.log('\n  ✗ No key entered. Run again.\n');
    process.exit(1);
  }

  const config={ anthropicKey:trimmed, mode:'paper', createdAt:new Date().toISOString() };
  saveConfig(config);
  cls();
  console.log('\n'+G+BOLD);
  console.log('  ╔══════════════════════════════════════════════════════════════════╗');
  console.log('  ║   ✓  API KEY SAVED                                               ║');
  console.log('  ║   ✓  BINANCE CONNECTION: FREE — NO KEY NEEDED                   ║');
  console.log('  ║   ✓  POLYMARKET CONNECTION: FREE — NO KEY NEEDED                ║');
  console.log('  ║   ✓  PAPER TRADING MODE ACTIVE — $100 VIRTUAL FUND              ║');
  console.log('  ║   ✓  ADAN-PRED IS WAKING UP...                                  ║');
  console.log('  ╚══════════════════════════════════════════════════════════════════╝'+X+'\n');
  await new Promise(r=>setTimeout(r,2000));
  return config;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir();
  let config=loadConfig();
  if (!config?.anthropicKey) config=await setup();
  const client=new Anthropic({ apiKey:config.anthropicKey });
  _agiClient = client; // AGI layers use this reference
  loadSoul();
  startDashboard();

  const state={
    status:'Starting...',mode:'idle',thought:null,
    pnl:loadPnL(), positions:loadPositions(),
    markets:[], prices:{},
    lastScan:null, nextScanIn:5, apiCost:0
  };

  render(state);
  await checkResolutions();

  const loop=async()=>{
    try {
      state.pnl=loadPnL();
      state.positions=loadPositions();
      await checkResolutions();
      await doScan(client,state);
      state.pnl=loadPnL();
      state.positions=loadPositions();
      render(state);
    } catch(e) { console.error(R+'Loop error: '+e.message+X); }
    setTimeout(loop,SCAN_INTERVAL_MS);
  };

  setTimeout(loop,2000);
  setInterval(()=>{ state.pnl=loadPnL(); state.positions=loadPositions(); if(state.mode==='idle') render(state); },30000);
}

main().catch(e=>{ console.error(e); process.exit(1); });
