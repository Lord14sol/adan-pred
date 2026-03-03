import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  DIR, MAX_POSITIONS, MIN_EDGE, PAPER_BET_SIZE, SYMBOLS, TREE_RULES,
  G, Y, R, B, C, M, W, D, X, BOLD,
  cls, loadStrategy, loadPnL, savePnL, loadPositions, loadCalibration,
  expProgress, levelTitle, getSkills
} from '../core/config.js';
import { signalLabel } from '../api/binance.js';

// ── Panel — fixed 72 cols, always fits terminal ───────────────────────────
const PW = 72;
const sep = (col, ch = '═') => col + '╠' + ch.repeat(PW) + '╣' + X;
const SEP = (col) => col + '╟' + '─'.repeat(PW) + '╢' + X;
const TOP = col => col + '╔' + '═'.repeat(PW) + '╗' + X;
const BOT = col => col + '╚' + '═'.repeat(PW) + '╝' + X;
function row(txt, col = M) {
  const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, PW - clean.length - 2);
  return col + '║ ' + X + txt + ' '.repeat(pad) + col + ' ║' + X;
}
const TW = 72, DIV = '─'.repeat(TW + 2);
function trow(txt, col, bdr) {
  const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
  return bdr + '│' + X + col + txt + ' '.repeat(Math.max(0, TW - clean.length)) + X + bdr + '│' + X;
}

// ── Mini sparkline from candles ─────────────────────────────────────────────
function sparkline(closes) {
  if (!closes || closes.length < 2) return D + 'no data' + X;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const last = closes[closes.length - 1], prev = closes[closes.length - 2];
  const trend = last > prev ? G : last < prev ? R : D;
  return closes.slice(-12).map(c => trend + bars[Math.round((c - min) / range * 7)] + X).join('');
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
  console.log(row(B + BOLD + '  🌳 DYNASTY TREE' + X + D + '  Gen ' + (pnl.generation || 1) + '  │  ADAN + ' + children.length + ' children' + X));
  console.log(SEP(B));

  // ADAN root node
  const rootFund = ('$' + (pnl.fund || 0).toFixed(0)).padStart(8);
  const rootNet = (pnl.net >= 0 ? '+' : '') + '$' + (pnl.net || 0).toFixed(0);
  const netCol = (pnl.net || 0) >= 0 ? G : R;
  console.log(row(
    '  ' + M + BOLD + '◈ ADAN' + X + D + ' [ROOT · GEN1]' + X +
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
      try { if (fs.existsSync(childPnlPath)) childPnl = JSON.parse(fs.readFileSync(childPnlPath, 'utf8')); } catch { }

      const childExp = childPnl?.exp || 0;
      const childExpNeeded = TREE_RULES.childExpToSpawn;
      const gcList = (childPnl?.children) || [];
      const canHaveGC = xp.level >= 4;
      const gcReady = canHaveGC && childExp >= childExpNeeded && gcList.length < TREE_RULES.maxChildrenGen2;
      const expBar = childExp >= childExpNeeded ? G + '●' + X : Y + Math.min(childExp, childExpNeeded) + '/' + childExpNeeded + 'xp' + X;

      const nameStr = C + BOLD + (child.name || child.spec).padEnd(10) + X;
      const specStr = D + child.spec.padEnd(11) + X;
      const sigStr = sigBadge(sig);
      const scoreStr = intel ? (intel.intelScore >= 65 ? G : intel.intelScore >= 45 ? Y : R) + BOLD + '[' + intel.intelScore + ']' + X : D + '[--]' + X;
      const ageStr = intel ? D + ' ' + Math.round((Date.now() - new Date(intel.ts).getTime()) / 60000) + 'm' + X : '';
      const gcStr = gcReady ? ' ' + Y + BOLD + '🌱SPAWN' + X : gcList.length > 0 ? ' ' + B + '(' + gcList.length + 'gc)' + X : '';

      console.log(row(
        '  ' + B + '  ' + connector + ' ' + X +
        nameStr + ' ' + specStr +
        ' ' + sigStr + ' ' + scoreStr + ageStr +
        '  exp:' + expBar + gcStr
      ));

      // Grandchildren (if any)
      gcList.forEach((gc, gi) => {
        const gcLast = gi === grandChildren.length - 1;
        const gcConn = gcLast ? '    └──' : '    ├──';
        const gcIntel = readChildIntel(gc.spec);
        const gcSig = gcIntel ? gcIntel.signal : null;
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
    const ups = signals.filter(s => s.dir === 'UP').length;
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
let _nextScanAt = null;   // epoch ms of next scheduled scan
let _resultAt = null;   // epoch ms when last 'result' was set
const RESULT_SHOW_MS = 22000; // show "DECISION MADE" for 22s then go idle

// ── Terminal braille spinner (thinking mode) ──────────────────────────────────
let _thinkSpinTimer = null;
const _SPIN_F = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _spinIdx = 0;
function _startThinkSpin() {
  if (_thinkSpinTimer) return;
  _thinkSpinTimer = setInterval(() => {
    try { process.stdout.write('\r  ' + _SPIN_F[_spinIdx++ % _SPIN_F.length] + ' Claude Sonnet 4.6 analyzing market edge...              '); } catch { }
  }, 120);
}
function _stopThinkSpin() {
  if (!_thinkSpinTimer) return;
  clearInterval(_thinkSpinTimer);
  _thinkSpinTimer = null;
  try { process.stdout.write('\r                                                                   \r'); } catch { }
}

function startDashboard() {
  const PORT = 3141;
  const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADAN · Web4 Node</title>
<script>window.ADAN_MODE = '${process.env.ADAN_MODE || 'TRAINING'}';</script>
<script src="https://d3js.org/d3.v7.min.js"></script>
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

/* ── Interactive D3 DAG ───────────────────────────────────────── */
.dynasty-wrap {
  position: relative;
  background: var(--bg3);
  border: 2px solid var(--border);
  display: flex;
  flex-direction: column;
}
.dynasty-wrap.fullscreen {
  position: fixed;
  inset: 16px;
  z-index: 1000;
  box-shadow: 12px 12px 0px rgba(0,0,0,0.8);
}
.dynasty-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border);
  background: var(--bg4);
}
.btn-dag {
  background: var(--bg);
  border: 2px solid var(--border);
  font-family: var(--pixel);
  font-size: 8px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--text);
  box-shadow: 2px 2px 0px var(--border);
  transition: all 0.1s;
}
.btn-dag:active {
  box-shadow: 0px 0px 0px var(--border);
  transform: translate(2px, 2px);
}
.btn-dag.active {
  background: var(--purple);
  color: #fff;
}

#dynasty-panel {
  width: 100%;
  height: 480px;
  flex: 1;
  position: relative;
  overflow: hidden;
  box-shadow: inset 4px 4px 0px rgba(0,0,0,0.05);
  cursor: grab;
}
#dynasty-panel:active { cursor: grabbing; }

/* Pulse animation for nodes ready for Gen3 Crossover */
@keyframes fuseGlow {
  0% { filter: drop-shadow(0 0 2px var(--yellow)); }
  50% { filter: drop-shadow(0 0 10px var(--yellow)); }
  100% { filter: drop-shadow(0 0 2px var(--yellow)); }
}
.d3-node.ready-fuse rect {
  stroke: var(--yellow) !important;
  stroke-width: 2px;
  animation: fuseGlow 2s infinite;
}

.lasso-tooltip {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--purple);
  color: #fff;
  padding: 8px 16px;
  font-family: var(--pixel);
  font-size: 10px;
  border: 2px solid #000;
  box-shadow: 4px 4px 0px #000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 100;
  white-space: pre-wrap;
  text-align: center;
  line-height: 1.4;
}
.lasso-tooltip.visible { opacity: 1; }

.d3-node rect {
  stroke: var(--border);
  stroke-width: 2px;
  transition: all 0.2s ease;
  box-shadow: 2px 2px 0px rgba(0,0,0,1);
}

.d3-node.dimmed { opacity: 0.15; pointer-events: none; }
.d3-link.dimmed { opacity: 0.15; }

@keyframes nodePulse {
  0% { filter: drop-shadow(0 0 2px var(--pulse-color)) }
  50% { filter: drop-shadow(0 0 12px var(--pulse-color)) }
  100% { filter: drop-shadow(0 0 2px var(--pulse-color)) }
}
.d3-node.pulsing rect {
  animation: nodePulse 1s ease infinite;
}

.d3-node:hover rect {
  filter: brightness(1.1);
  stroke-width: 3px;
  cursor: pointer;
}

.d3-node text {
  font-family: var(--pixel);
  pointer-events: none;
}

.d3-link {
  stroke: var(--dim);
  stroke-width: 2px;
  stroke-dasharray: 4 2;
  animation: linkFlow 20s linear infinite;
}

@keyframes linkFlow {
  to { stroke-dashoffset: -100; }
}

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
@keyframes avBetting{0%{filter:drop-shadow(0 0 4px #ef444488)}50%{filter:drop-shadow(0 0 14px #ef4444) drop-shadow(0 0 6px #22c55e)}100%{filter:drop-shadow(0 0 4px #22c55e88)}}
@keyframes avLosing{0%,100%{transform:translateY(2px);filter:brightness(0.6) drop-shadow(0 0 2px #8a1a1a44)}50%{transform:translateY(4px);filter:brightness(0.5) drop-shadow(0 0 1px #8a1a1a22)}}
@keyframes avDreaming{0%,100%{filter:drop-shadow(0 0 6px #8b5cf688) hue-rotate(0deg)}33%{filter:drop-shadow(0 0 12px #a78bfa) hue-rotate(20deg)}66%{filter:drop-shadow(0 0 8px #c084fc) hue-rotate(-20deg)}}
@keyframes avCrown{0%{opacity:1;transform:translateY(0) scale(1)}50%{opacity:0.8;transform:translateY(-2px) scale(1.1)}100%{opacity:0;transform:translateY(-8px) scale(0.5)}}
@keyframes avZfloat{0%{opacity:1;transform:translate(0,0) scale(0.8)}100%{opacity:0;transform:translate(12px,-20px) scale(1.2)}}
@keyframes avAgresivo{0%,100%{transform:translateY(0)}25%{transform:translateY(-6px)}50%{transform:translateY(-2px)}75%{transform:translateY(-5px)}}
@keyframes avBlink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(0.1)}}
@keyframes avBlinkSlow{0%,85%,100%{transform:scaleY(1)}90%{transform:scaleY(0.1)}}
.av-sprite{animation:avFloat 3s ease-in-out infinite,avIdle 4s ease-in-out infinite}
.av-sprite.thinking{animation:avFloat 1.2s ease-in-out infinite,avThink .8s ease-in-out infinite}
.av-sprite.winning{animation:avFloat 2s ease-in-out infinite,avWin .5s ease-in-out 3}
.av-sprite.betting{animation:avFloat 1.5s ease-in-out infinite,avBetting 0.6s ease-in-out infinite}
.av-sprite.losing{animation:avLosing 2.5s ease-in-out infinite}
.av-sprite.dreaming{animation:avFloat 5s ease-in-out infinite,avDreaming 4s ease-in-out infinite}
.av-sprite.p-analitico{animation:avFloat 4s ease-in-out infinite,avIdle 6s ease-in-out infinite}
.av-sprite.p-analitico #avatar-eyes{animation:avBlinkSlow 6s ease-in-out infinite}
.av-sprite.p-agresivo{animation:avAgresivo 1.5s ease-in-out infinite,avIdle 2s ease-in-out infinite}
.av-sprite.p-agresivo #avatar-eyes{filter:brightness(1.5)}
.av-sprite.p-cauteloso{animation:avFloat 5s ease-in-out infinite}
.av-sprite.p-cauteloso #avatar-eyes{animation:avBlink 4s ease-in-out infinite}
.av-crown{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:20px;animation:avCrown 2s ease-out forwards;pointer-events:none}
.av-zzz{position:absolute;top:10px;right:-10px;font-size:11px;color:var(--purple);animation:avZfloat 2s ease-out infinite;pointer-events:none}
.avatar-name{font-size:9px;font-family:var(--pixel);color:var(--purple);margin-top:4px}
.avatar-title{font-size:9px;color:var(--grey);margin-top:3px;font-family:var(--pixel);line-height:1.6}
.avatar-status{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:9px;padding:3px 8px;background:var(--bg4);border:2px solid var(--border);font-family:var(--pixel)}
/* ── Command Center ───────────────────────────────────────────── */
.cmd-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cmd-sub{font-size:8px;font-family:var(--pixel);text-transform:uppercase;color:var(--grey);margin-bottom:8px;display:flex;align-items:center;gap:6px;border-bottom:2px dashed var(--border2);padding-bottom:4px}
.cmd-sub::before{content:'■';color:var(--purple);font-size:7px}
.cmd-sub.thinking::before{color:var(--cyan);animation:pulse .4s infinite}
@media(max-width:900px){.cmd-grid{grid-template-columns:1fr}}
/* ── Command Center topbar ────────────────────────────────────── */
.cmd-topbar{display:flex;align-items:center;gap:8px;padding:8px 10px 4px;border-bottom:2px solid var(--border2)}
.cmd-live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;flex-shrink:0}
.cmd-live-dot.thinking{background:var(--cyan);animation:pulse .4s infinite}
.cmd-live-dot.idle{background:var(--grey)}
.cmd-live-txt{font-family:var(--pixel);font-size:7px;color:var(--text2);letter-spacing:1px}
.cmd-scan-eta{font-family:var(--mono);font-size:11px;color:var(--dim);margin-left:auto}
.cmd-scan-bar-wrap{height:3px;background:var(--bg2);width:100%}
.cmd-scan-bar{height:3px;background:var(--cyan);transition:width .5s linear;width:0%}
/* ── Neural Flow Visualization ────────────────────────────────── */
.nf-wrap{overflow-x:auto;padding:4px 0}
/* ── Dynasty Panel ────────────────────────────────────────────── */
.dynasty-panel{padding:10px;border-top:2px dashed var(--border2)}
.dyn-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dyn-title{font-family:var(--pixel);font-size:7px;color:var(--text);letter-spacing:.5px}
.dyn-badge{font-family:var(--pixel);font-size:6px;padding:2px 6px;border:1.5px solid;display:inline-block}
.dyn-badge-ready{border-color:var(--green);color:var(--green)}
.dyn-badge-soon{border-color:var(--yellow);color:var(--yellow)}
.dyn-badge-wait{border-color:var(--grey);color:var(--grey)}
.dyn-badge-active{border-color:var(--cyan);color:var(--cyan)}
/* Requirements to spawn */
.dyn-req-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px}
.dyn-req{padding:8px;border:2px solid var(--border2);background:var(--bg2)}
.dyn-req.done{border-color:var(--green)}
.dyn-req-label{font-family:var(--pixel);font-size:6px;color:var(--dim);margin-bottom:4px;letter-spacing:.5px}
.dyn-req-val{font-family:var(--mono);font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px}
.dyn-req.done .dyn-req-val{color:var(--green)}
.dyn-req-track{height:6px;background:var(--bg);border:1.5px solid var(--border2)}
.dyn-req-fill{height:100%;background:var(--cyan);transition:width .6s}
.dyn-req.done .dyn-req-fill{background:var(--green)}
.dyn-note{font-family:var(--font);font-size:13px;color:var(--dim);line-height:1.4;padding:6px;border-left:3px solid var(--border2)}
/* Children cards */
.dyn-children-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.dyn-child-card{padding:8px;border:2px solid var(--border2);background:var(--bg2);position:relative}
.dyn-child-card.bull{border-color:var(--green)}
.dyn-child-card.bear{border-color:var(--red)}
.dyn-child-name{font-family:var(--pixel);font-size:7px;color:var(--purple);margin-bottom:5px;letter-spacing:.5px}
.dyn-child-stats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px}
.dyn-stat{font-family:var(--mono);font-size:11px;color:var(--dim)}
.dyn-sig{font-family:var(--pixel);font-size:6px;padding:1px 4px;border:1.5px solid;margin-left:auto}
.dyn-sig.bull{border-color:var(--green);color:var(--green)}
.dyn-sig.bear{border-color:var(--red);color:var(--red)}
.dyn-sig.idle{border-color:var(--grey);color:var(--grey)}
.dyn-exp-track{height:5px;background:var(--bg);border:1.5px solid var(--border2);margin-bottom:3px}
.dyn-exp-fill{height:100%;background:var(--purple)}
.dyn-child-meta{font-family:var(--mono);font-size:10px;color:var(--dim)}
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
@keyframes nfHeartbeat{0%,100%{opacity:.4}10%{opacity:1}20%{opacity:.6}30%{opacity:1}40%{opacity:.4}}
.nf-heartbeat{animation:nfHeartbeat 2.4s ease-in-out infinite}
/* ── Brain Live Block ─────────────────────────────────────────── */
.brain-live-block{padding:12px;border:2px solid var(--border);background:var(--bg4);margin-bottom:12px;box-shadow:var(--shadow-sm);position:relative;overflow:hidden}
.brain-live-block::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cyan)}
.brain-live-block.bet::before{background:var(--green)}
.brain-live-block.skip::before{background:var(--yellow)}
.brain-live-block.thinking::before{background:var(--cyan);animation:pulse .4s infinite}
.brain-live-block.thinking{border-color:var(--cyan)}
.brain-live-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-family:var(--mono)}
.brain-live-dot{width:8px;height:8px;background:var(--cyan);display:inline-block;flex-shrink:0;animation:pulse .4s infinite}
.brain-live-body{font-size:11px;font-family:var(--mono);color:var(--text2);line-height:1.75;white-space:pre-wrap;max-height:140px;overflow-y:auto;border-left:2px solid var(--border2);padding-left:8px}
.brain-full-text{font-size:10px;font-family:var(--mono);color:var(--dim);line-height:1.6;white-space:pre-wrap;max-height:300px;overflow-y:auto;padding:8px;background:var(--bg3);margin-top:6px;border:1px solid var(--border2)}
.brain-section-title{font-family:var(--pixel);font-size:7px;color:var(--grey);letter-spacing:1px;margin:10px 0 6px;padding-bottom:4px;border-bottom:1px dashed var(--border2)}
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
  <div class="tick"><span class="tick-sym">BNB</span><span class="tick-p">--</span></div>
  <div class="tick" style="margin-left:auto;color:var(--grey)" id="fg-tick">F&G: --</div>
</div>

<div class="main">
  <div class="sidebar">

    <!-- Avatar -->
    <div class="card avatar-card">
      <!-- Avatar style selector -->
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:4px">
        <button onclick="changeAvatar(-1)" style="background:none;border:1px solid var(--border);color:var(--text);font-family:var(--pixel);font-size:9px;padding:2px 6px;cursor:pointer">◀</button>
        <span id="av-style-name" style="font-family:var(--pixel);font-size:8px;color:var(--grey);min-width:60px;text-align:center">DEFAULT</span>
        <button onclick="changeAvatar(1)" style="background:none;border:1px solid var(--border);color:var(--text);font-family:var(--pixel);font-size:9px;padding:2px 6px;cursor:pointer">▶</button>
      </div>
      <div class="avatar-wrap" style="position:relative;cursor:pointer" onclick="showAdanDetail()">
        <div id="av-sprite-wrap"><svg id="av-sprite" class="av-sprite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 94" width="84" height="141" shape-rendering="crispEdges">
          <!-- Populated by JavaScript -->
        </svg></div>
        <div class="avatar-platform"></div>
      </div>
    </div>

    <!-- Level & Fund -->
    <div class="card">
      <div class="level-box">
        <div class="level-title">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-family:var(--pixel);font-size:9px;color:var(--grey)">Web4 Node</div>
            <div class="level-num" id="lvl-num">LVL --</div>
            <div class="level-name" id="lvl-name">--</div>
          </div>
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
      <div class="stat-row"><span class="stat-lbl">Brier Score</span><span class="stat-val" id="s-brier">--</span></div>
      <div class="stat-row"><span class="stat-lbl">Total Trades</span><span class="stat-val" id="s-trades">--</span></div>
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
      <div class="card-title">LIVE</div>
      <div class="price-grid" id="price-grid"></div>
    </div>

    <!-- Command Center: Neural Pipeline + Dynasty -->
    <div class="card" id="cmd-card">
      <div class="cmd-topbar">
        <span class="card-title" id="nf-sub-title" style="margin:0;border:none;padding:0">◈ NEURAL PIPELINE</span>
        <span class="cmd-live-dot" id="cmd-live-dot"></span>
        <span class="cmd-live-txt" id="cmd-live-txt">INITIALIZING</span>
        <span class="cmd-scan-eta" id="cmd-scan-eta"></span>
      </div>
      <div class="cmd-scan-bar-wrap"><div class="cmd-scan-bar" id="cmd-scan-bar"></div></div>
      <div class="nf-wrap" id="nf-wrap"></div>
      <div class="dynasty-wrap" id="dynasty-wrap">
        <div class="dynasty-tools">
          <span class="card-title" style="margin:0;border:none;padding:0">🧬 THE FORGE (DYNASTY DAG)</span>
          <div style="display:flex; gap: 8px;">
            <button class="btn-dag" onclick="toggleDagFullscreen()" id="btn-fs">⛶ FULLSCREEN</button>
            <button class="btn-dag" onclick="toggleGoldenPath()" id="btn-gp">⭐ GOLDEN PATH</button>
          </div>
        </div>
        <div class="dynasty-panel" id="dynasty-panel"></div>
        <div id="lasso-tooltip" class="lasso-tooltip"></div>
        <div id="fuse-modal" class="fuse-modal">
           <h3 id="fuse-title">FUSE NODES?</h3>
           <p id="fuse-desc">A new Gen3 descendant will be born combining both AI rulesets.</p>
           <div class="fuse-actions">
              <button class="fuse-btn yes" id="fuse-yes">FUSE (GEN3)</button>
              <button class="fuse-btn no" id="fuse-no">CANCEL</button>
           </div>
        </div>
      </div>
    </div>

    <!-- Child Detail Modal -->
    <style>
      @keyframes childPulse { 0%,100%{box-shadow:0 0 12px rgba(90,26,138,0.3),3px 3px 0 #1a1a1a} 50%{box-shadow:0 0 24px rgba(90,26,138,0.6),3px 3px 0 #1a1a1a} }
      @keyframes heartbeat { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
      @keyframes scanLine { 0%{top:-2px} 100%{top:100%} }
      @keyframes fadeSlideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      @keyframes barFill { from{width:0} to{width:var(--target-w)} }
      @keyframes glowText { 0%,100%{text-shadow:0 0 4px rgba(26,74,138,0.5)} 50%{text-shadow:0 0 12px rgba(26,74,138,0.9)} }
      .child-modal-wrap{display:none;position:fixed;inset:0;z-index:999;background:rgba(10,10,8,0.85);backdrop-filter:blur(6px);overflow-y:auto}
      .child-panel{max-width:520px;margin:30px auto;background:var(--bg3);border:3px solid var(--border);font-family:var(--mono);font-size:12px;position:relative;animation:childPulse 3s ease infinite,fadeSlideIn .3s ease-out}
      .child-panel::before{content:'';position:absolute;top:-2px;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--purple),var(--cyan),var(--purple),transparent);animation:scanLine 3s linear infinite;pointer-events:none;z-index:2}
      .child-header{background:var(--border);color:var(--bg3);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden}
      .child-header::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0,transparent 3px,rgba(255,255,255,0.03) 3px,rgba(255,255,255,0.03) 4px);pointer-events:none}
      .child-name{font-family:var(--pixel);font-size:14px;letter-spacing:3px;color:#f0ece2}
      .child-gen{font-family:var(--pixel);font-size:9px;color:var(--cyan);background:rgba(26,74,138,0.2);padding:2px 8px;border:1px solid var(--cyan)}
      .child-close{cursor:pointer;color:var(--grey);font-family:var(--pixel);font-size:12px;padding:4px 8px;border:2px solid var(--border2);background:var(--bg);transition:all .15s}
      .child-close:hover{background:var(--red);color:#fff;border-color:var(--red)}
      .child-body{padding:16px 18px}
      .child-section{margin-bottom:14px;animation:fadeSlideIn .4s ease-out both}
      .child-section:nth-child(2){animation-delay:.05s}
      .child-section:nth-child(3){animation-delay:.1s}
      .child-section:nth-child(4){animation-delay:.15s}
      .child-section:nth-child(5){animation-delay:.2s}
      .child-section:nth-child(6){animation-delay:.25s}
      .child-section:nth-child(7){animation-delay:.3s}
      .child-sec-title{font-family:var(--pixel);font-size:8px;color:var(--purple);letter-spacing:2px;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid var(--border);display:flex;align-items:center;gap:6px}
      .child-sec-title::before{content:'▶';font-size:6px}
      .child-grid{display:grid;gap:4px 12px;font-size:12px}
      .child-grid .lbl{color:var(--grey);font-size:10px;font-family:var(--pixel)}
      .child-grid .val{color:var(--text);font-family:var(--mono)}
      .dna-chip{display:inline-block;padding:2px 8px;font-size:10px;font-family:var(--pixel);border:2px solid;margin:2px}
      .child-bar-track{height:14px;background:var(--bg);border:2px solid var(--border);overflow:hidden;position:relative}
      .child-bar-fill{height:100%;transition:width .6s steps(16)}
      .child-bar-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--pixel);font-size:7px;color:var(--text);mix-blend-mode:difference;z-index:1}
      .score-dot{display:inline-block;width:8px;height:8px;border:1px solid var(--border);margin:1px;transition:all .15s}
      .score-dot:hover{transform:scale(1.8);z-index:5;position:relative}
      .gc-card{padding:8px;border:2px solid var(--border);background:var(--bg4);box-shadow:var(--shadow-sm);position:relative;overflow:hidden}
      .gc-card::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%}
      .gc-card.elite::before{background:var(--purple)}
      .gc-card:not(.elite)::before{background:var(--cyan)}
      .alive-dot{width:6px;height:6px;border-radius:0;display:inline-block;animation:heartbeat 1.5s ease infinite}
      .signal-badge{padding:3px 10px;font-family:var(--pixel);font-size:8px;border:2px solid;letter-spacing:1px;display:inline-block}
    </style>
    <div id="child-modal" class="child-modal-wrap" onclick="if(event.target===this)this.style.display='none'">
      <div class="child-panel">
        <div id="child-modal-content"></div>
      </div>
    </div>

    <!-- ADAN World Conway Grid -->
    <div class="card" id="adan-world-card">
      <div class="card-title">ADAN WORLD · Cellular Automaton</div>
      <canvas id="adan-world-cvs" width="600" height="200" style="width:100%;height:auto;background:var(--bg4);border:2px solid var(--border);box-shadow:inset 2px 2px 0 var(--border2);image-rendering:pixelated;"></canvas>
    </div>

    <!-- Brain Log: Decisions + Reasoning -->
      <div class="card-title">🧠 BRAIN LOG · Decisions &amp; Learning</div>
      <div id="decisions-wrap"></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">

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
// ── Avatar Customization V2 (Distinct SVGs) ──────────────────────────────
const baseLegs = '<rect x="8" y="74" width="16" height="12" fill="#0d0d18"/><rect x="32" y="74" width="16" height="12" fill="#0d0d18"/><rect x="10" y="74" width="2" height="12" fill="#111128"/><rect x="34" y="74" width="2" height="12" fill="#111128"/><rect x="6" y="86" width="20" height="8" fill="#060610"/><rect x="30" y="86" width="20" height="8" fill="#060610"/><rect x="6" y="86" width="20" height="2" fill="#161628"/><rect x="30" y="86" width="20" height="2" fill="#161628"/><rect x="22" y="90" width="4" height="4" fill="#0d0d20"/><rect x="46" y="90" width="4" height="4" fill="#0d0d20"/>';
const baseHead = '<rect x="4" y="12" width="4" height="24" fill="#1a0e05"/><rect x="48" y="12" width="4" height="24" fill="#1a0e05"/><rect id="avatar-skin" x="8" y="12" width="40" height="24" fill="#e0b98a"/><rect x="26" y="24" width="4" height="2" fill="#c8996a"/><rect x="18" y="30" width="4" height="2" fill="#b07840"/><rect x="22" y="32" width="12" height="2" fill="#b07840"/><rect x="34" y="30" width="4" height="2" fill="#b07840"/><rect x="12" y="36" width="28" height="4" fill="#94a3b8"/><rect x="20" y="36" width="12" height="4" fill="#cbd5e1"/>';

const AVATAR_PALETTES = [
  { 
    name: 'DEFAULT', 
    svg: \`
      <!-- Hair/Crown: Core Processor --><g fill="#3b82f6"><rect x="16" y="0" width="24" height="4" style="fill:inherit"/><rect x="12" y="4" width="32" height="4" style="fill:inherit"/><rect x="8" y="8" width="40" height="4" fill="#1e3a8a"/></g>
      \${baseHead}
      <!-- Eyes: Serious --><rect x="12" y="20" width="32" height="4" fill="#0f172a"/><g fill="#60a5fa"><rect x="14" y="20" width="8" height="4" style="fill:inherit"/><rect x="34" y="20" width="8" height="4" style="fill:inherit"/></g><rect x="16" y="21" width="2" height="2" fill="#eff6ff"/><rect x="36" y="21" width="2" height="2" fill="#eff6ff"/>
      <!-- Suit: Standard Core --><g fill="#1e293b"><rect x="0" y="40" width="56" height="4" style="fill:inherit"/><rect x="0" y="40" width="8" height="4" fill="#3b82f6"/><rect x="48" y="40" width="8" height="4" fill="#3b82f6"/><rect x="4" y="44" width="48" height="30" style="fill:inherit"/><rect x="4" y="44" width="4" height="30" fill="#2563eb"/><rect x="48" y="44" width="4" height="30" fill="#2563eb"/><rect x="16" y="46" width="24" height="12" fill="#0f172a"/><rect x="18" y="48" width="4" height="4" fill="#60a5fa"/><rect x="24" y="48" width="8" height="4" fill="#60a5fa"/><rect x="34" y="48" width="4" height="4" fill="#60a5fa"/><rect x="18" y="52" width="20" height="2" fill="#334155"/></g>
      <!-- Belt --><rect x="8" y="70" width="40" height="4" fill="#0f172a"/><rect x="24" y="70" width="8" height="4" fill="#3b82f6"/><rect x="22" y="71" width="12" height="2" fill="#bfdbfe"/>
      \${baseLegs}
    \`
  },
  { 
    name: 'CYBER', 
    svg: \`
      <!-- Hair: Spiky --><g fill="#00ff88"><rect x="16" y="0" width="4" height="12" style="fill:inherit"/><rect x="28" y="2" width="4" height="10" style="fill:inherit"/><rect x="40" y="0" width="4" height="12" style="fill:inherit"/><rect x="8" y="8" width="40" height="4" fill="#001a0d"/></g>
      \${baseHead}
      <!-- Eyes: Visor --><rect x="8" y="18" width="40" height="8" fill="#001a0d"/><rect x="12" y="20" width="32" height="4" fill="#00ff88"/><rect x="14" y="20" width="8" height="2" fill="#ccffcc"/>
      <!-- Suit: Cyber --><g fill="#001a0d"><rect x="0" y="40" width="56" height="34" style="fill:inherit"/><rect x="0" y="40" width="12" height="8" fill="#00cc66"/><rect x="44" y="40" width="12" height="8" fill="#00cc66"/><rect x="12" y="50" width="32" height="16" fill="#00331a"/><rect x="20" y="54" width="16" height="8" fill="#00ff88"/><rect x="20" y="56" width="16" height="2" fill="#ccffcc"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'KNIGHT', 
    svg: \`
      <!-- Helmet --><rect x="4" y="4" width="48" height="32" fill="#d4d4d8"/><rect x="24" y="0" width="8" height="4" fill="#fbbf24"/><rect x="20" y="2" width="16" height="2" fill="#fbbf24"/><rect x="8" y="16" width="40" height="8" fill="#000"/><rect x="24" y="16" width="8" height="16" fill="#000"/><rect x="26" y="16" width="4" height="12" fill="#fbbf24"/>
      <!-- Suit: Gold Armor --><g fill="#52525b"><rect x="0" y="36" width="56" height="38" style="fill:inherit"/><rect x="0" y="36" width="16" height="12" fill="#fbbf24"/><rect x="40" y="36" width="16" height="12" fill="#fbbf24"/><rect x="16" y="44" width="24" height="24" fill="#fbbf24"/><rect x="24" y="48" width="8" height="16" fill="#fde68a"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'GHOST', 
    svg: \`
      <!-- Hood --><rect x="4" y="4" width="48" height="12" fill="#0f172a"/><rect x="0" y="16" width="56" height="24" fill="#0f172a"/>
      <!-- Face in Shadow --><rect x="12" y="16" width="32" height="20" fill="#000"/>
      <!-- Eyes: Glowing dots --><rect x="16" y="24" width="4" height="4" fill="#e2e8f0"/><rect x="36" y="24" width="4" height="4" fill="#e2e8f0"/><rect x="17" y="25" width="2" height="2" fill="#fff"/><rect x="37" y="25" width="2" height="2" fill="#fff"/>
      <!-- Suit: Stealth cloak --><g fill="#0f172a"><rect x="0" y="40" width="56" height="34" style="fill:inherit"/><rect x="8" y="40" width="4" height="34" fill="#1e293b"/><rect x="44" y="40" width="4" height="34" fill="#1e293b"/><rect x="24" y="52" width="8" height="8" fill="#334155"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'PLASMA', 
    svg: \`
      <!-- Hair: Energy flames --><g fill="#ec4899"><rect x="12" y="-4" width="4" height="16" style="fill:inherit"/><rect x="24" y="-8" width="8" height="20" style="fill:inherit"/><rect x="40" y="-4" width="4" height="16" style="fill:inherit"/><rect x="8" y="8" width="40" height="4" fill="#4c1d95"/></g>
      \${baseHead}
      <!-- Eyes: Plasma --><rect x="12" y="20" width="8" height="8" fill="#4c1d95"/><rect x="36" y="20" width="8" height="8" fill="#4c1d95"/><rect x="14" y="22" width="4" height="4" fill="#ec4899"/><rect x="38" y="22" width="4" height="4" fill="#ec4899"/>
      <!-- Suit: Void --><g fill="#2e1065"><rect x="0" y="40" width="56" height="34" style="fill:inherit"/><rect x="20" y="48" width="16" height="16" fill="#a855f7"/><rect x="24" y="52" width="8" height="8" fill="#ec4899"/><rect x="26" y="54" width="4" height="4" fill="#fbcfe8"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'MECHA', 
    svg: \`
      <!-- Mecha Head --><rect x="8" y="8" width="40" height="28" fill="#dc2626"/><rect x="26" y="4" width="4" height="4" fill="#ef4444"/><rect x="12" y="16" width="32" height="12" fill="#000"/><rect x="16" y="18" width="24" height="4" fill="#facc15"/><rect x="24" y="28" width="8" height="8" fill="#991b1b"/>
      <!-- Mecha Body --><g fill="#991b1b"><rect x="0" y="36" width="56" height="38" style="fill:inherit"/><rect x="0" y="36" width="20" height="16" fill="#dc2626"/><rect x="36" y="36" width="20" height="16" fill="#dc2626"/><rect x="16" y="44" width="24" height="16" fill="#7f1d1d"/><rect x="24" y="48" width="8" height="8" fill="#3b82f6"/><rect x="26" y="50" width="4" height="4" fill="#93c5fd"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'VIRUS', 
    svg: \`
      <!-- Glitch Hair --><g fill="#22c55e"><rect x="8" y="0" width="12" height="4" style="fill:inherit"/><rect x="36" y="4" width="16" height="4" style="fill:inherit"/><rect x="16" y="8" width="8" height="4" fill="#14532d"/><rect x="40" y="8" width="8" height="4" fill="#14532d"/></g>
      \${baseHead}
      <!-- Eyes: Glitchy/Asymmetric --><rect x="12" y="18" width="12" height="8" fill="#022c22"/><rect x="32" y="22" width="12" height="4" fill="#022c22"/><rect x="14" y="20" width="4" height="4" fill="#22c55e"/><rect x="34" y="22" width="8" height="2" fill="#22c55e"/><rect x="20" y="28" width="8" height="2" fill="#22c55e"/>
      <!-- Suit: Corrupted --><g fill="#022c22"><rect x="0" y="40" width="56" height="34" style="fill:inherit"/><rect x="4" y="40" width="8" height="12" fill="#22c55e"/><rect x="44" y="48" width="12" height="4" fill="#22c55e"/><rect x="12" y="52" width="20" height="8" fill="#14532d"/><rect x="28" y="56" width="16" height="4" fill="#22c55e"/><rect x="16" y="64" width="8" height="4" fill="#22c55e"/></g>
      \${baseLegs}
    \`
  },
  { 
    name: 'SENTINEL', 
    svg: \`
      <!-- Heavy Helm --><rect x="0" y="0" width="56" height="36" fill="#334155"/><rect x="4" y="4" width="48" height="4" fill="#475569"/><rect x="24" y="-4" width="8" height="8" fill="#f97316"/>
      <!-- Eye Slit --><rect x="4" y="16" width="48" height="8" fill="#000"/><rect x="12" y="18" width="32" height="4" fill="#f97316"/><rect x="24" y="18" width="8" height="4" fill="#fff"/>
      <!-- Suit: Heavy Armor --><g fill="#1e293b"><rect x="-4" y="36" width="64" height="16" style="fill:inherit"/><rect x="-4" y="40" width="12" height="12" fill="#475569"/><rect x="48" y="40" width="12" height="12" fill="#475569"/><rect x="8" y="50" width="40" height="24" style="fill:inherit"/><rect x="20" y="50" width="16" height="24" fill="#475569"/><rect x="24" y="56" width="8" height="8" fill="#f97316"/></g>
      \${baseLegs}
    \`
  }
];
let _avIdx = parseInt(localStorage.getItem('adan_av_idx') || '0');

function applyAvatar(idx) {
  const p = AVATAR_PALETTES[idx % AVATAR_PALETTES.length];
  const svg = document.getElementById('av-sprite');
  if (svg) svg.innerHTML = p.svg;
  const lbl = document.getElementById('av-style-name');
  if (lbl) lbl.textContent = p.name;
}

function changeAvatar(dir) {
  _avIdx = ((_avIdx + dir) % AVATAR_PALETTES.length + AVATAR_PALETTES.length) % AVATAR_PALETTES.length;
  localStorage.setItem('adan_av_idx', _avIdx);
  applyAvatar(_avIdx);
}

// Apply on load
document.addEventListener('DOMContentLoaded', () => applyAvatar(_avIdx));

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

// ── ADAN Pixel Brain Detail Modal ──────────────────────────────────────────
function showAdanDetail() {
  const d = window._lastNFData;
  if (!d) return;
  const modal = document.getElementById('child-modal');
  const content = document.getElementById('child-modal-content');
  if (!modal||!content) return;

  const xp = d.xp||{lvl:1,val:0,pct:0};
  const pnl = d.pnl||{net:0,trades:0,wins:0,losses:0};
  const children = d.children||[];
  const livingChildren = children.filter(c => c.status !== 'dead').length;
  const deadChildren = children.length - livingChildren;
  
  // Calculate lifetime in days
  const firstTrade = (d.positions?.closed||[])[0];
  const bornTime = firstTrade ? new Date(firstTrade.openedAt).getTime() : Date.now();
  const lifetimeDays = Math.max(1, Math.floor((Date.now() - bornTime) / 86400000));
  
  const brierScore = d.calibration?.brierScore || 0;
  const brierBg = brierScore < 0.1 ? 'var(--green)' : brierScore < 0.2 ? 'var(--cyan)' : brierScore < 0.3 ? 'var(--yellow)' : 'var(--red)';

  content.innerHTML = \`
    <div class="child-header" style="border-bottom:2px solid var(--purple)">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:24px; animation: pulse 2s infinite">🧠</div>
        <div>
          <div style="font-family:var(--pixel);font-size:14px;color:var(--text);animation:glowText 3s infinite">ADAN CORE</div>
          <div style="font-size:10px;color:var(--purple)">Sovereign Commercial Brain · Gen 1</div>
        </div>
      </div>
      <div class="child-close" onclick="document.getElementById('child-modal').style.display='none'">X</div>
    </div>
    
    <div class="child-body">
      <!-- LIFETIME VITALS -->
      <div class="child-section">
        <div class="child-sec-title">LIFETIME VITALS</div>
        <div class="child-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div><span class="lbl">LIFESPAN</span><div class="val" style="color:var(--cyan)">\${lifetimeDays} Days</div></div>
          <div><span class="lbl">TOTAL TRADES</span><div class="val">\${pnl.trades}</div></div>
          <div><span class="lbl">NET PROFIT</span><div class="val" style="color:\${pnl.net>=0?'var(--green)':'var(--red)'}">\$\${pnl.net.toFixed(2)}</div></div>
        </div>
      </div>

      <!-- EVOLUTION & GENETICS -->
      <div class="child-section">
        <div class="child-sec-title" style="color:var(--purple)">EVOLUTION & GENETICS</div>
        <div class="child-grid" style="grid-template-columns:1fr 1fr">
          <div><span class="lbl">GENERATION</span><div class="val" style="color:var(--purple)">Gen \${pnl.generation || 1}</div></div>
          <div><span class="lbl">FACTION PARENT</span><div class="val" style="color:var(--cyan)">\${(ch.faction || 'Adan Direct').toUpperCase()}</div></div>
          <div><span class="lbl">ROLE</span><div class="val" style="color:var(--green);font-size:9px">Context & Signal Scanning</div></div>
          <div><span class="lbl">EATING HISTORY</span><div class="val" style="color:var(--yellow);font-size:9px">\${dna.crossoverFrom && dna.crossoverFrom.length > 0 ? 'Absorbed DNA from: ' + dna.crossoverFrom.join(', ') : 'No absorptions yet.'}</div></div>
        </div>
      </div>

      <!-- INTEL STREAMS -->
      <div class="child-section">
        <div class="child-sec-title" style="color:var(--cyan)">NEURAL PIPELINE ORIGINS</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          
          <div style="padding:8px;background:var(--bg4);border-left:3px solid var(--yellow)">
            <div style="font-family:var(--pixel);font-size:10px;color:var(--yellow);margin-bottom:2px">BINANCE HUB</div>
            <div style="font-size:10px;color:var(--text2)">Global Spot & Perp Volume. Processed by APPLE (Trend) & SNAKE (Execution).</div>
          </div>
          
          <div style="padding:8px;background:var(--bg4);border-left:3px solid var(--purple)">
            <div style="font-family:var(--pixel);font-size:10px;color:var(--purple);margin-bottom:2px">HYPERLIQUID ORACLE</div>
            <div style="font-size:10px;color:var(--text2)">Institutional positioning & L2 order book. Processed by ATLAS (Whale Tracking).</div>
          </div>

          <div style="padding:8px;background:var(--bg4);border-left:3px solid var(--green)">
            <div style="font-family:var(--pixel);font-size:10px;color:var(--green);margin-bottom:2px">JUPITER DEX</div>
            <div style="font-size:10px;color:var(--text2)">On-chain liquidity & token swaps. Validated by EVA (Risk Guard).</div>
          </div>

        </div>
      </div>

      <!-- BRIER SCORE (CALIBRATION) -->
      <div class="child-section">
        <div class="child-sec-title">PREDICTION CALIBRATION</div>
         <div class="child-grid" style="grid-template-columns:1fr 1fr">
          <div><span class="lbl">BRIER SCORE</span><div class="val" style="color:\${brierBg}">\${brierScore.toFixed(4)}</div></div>
          <div><span class="lbl">CALIBRATION</span><div class="val">\${brierScore < 0.1 ? 'Excellent' : brierScore < 0.2 ? 'Good' : brierScore < 0.3 ? 'Fair' : 'Poor'}</div></div>
        </div>
        <div style="font-size:9px;color:var(--grey);margin-top:4px">Lower Brier Score means ADAN's confidence perfectly matches reality.</div>
      </div>

    </div>
  \`;
  modal.style.display='block';
}

// ── Parent Detail Modal ─────────────────────────────────────────────────────
function showParentDetail(type) {
  const d = window._lastNFData;
  if (!d) return;
  const modal = document.getElementById('child-modal');
  const content = document.getElementById('child-modal-content');
  if (!modal||!content) return;

  const names = { apple:'APPLE (Horizon)', snake:'SNAKE (Execution)', eva:'EVA (Guard)', atlas:'ATLAS (Oracle)' };
  const icons = { apple:'🍎', snake:'🐍', eva:'👑', atlas:'👁️‍🗨️' };
  const colors = { apple:'var(--yellow)', snake:'var(--green)', eva:'var(--red)', atlas:'var(--purple)' };
  const desc = {
    apple: 'Primary context scanner. Analyzes Fear & Greed, global trends, and narrative filters to define the current objective.',
    snake: 'Aggressive execution layer. Scans for volatility ratios, VWAP deviation, and high-volume opportunities.',
    eva: 'Risk oversight. Validates all signals against safety parameters, ensuring survival over aggressive profit.',
    atlas: 'Hyperliquid Institutional Oracle. Tracks smart money positioning, funding rates, and L2 order book imbalances.'
  };

  // Calculate parent-specific stats based on children lineage
  const children = d.children || [];
  const pIntel = children.find(c => c.spec === type)?.intel || {};
  const lineageChildren = children.filter(c => c.faction?.toLowerCase() === type || c.name?.toLowerCase().includes(type));
  const activeLineage = lineageChildren.filter(c => c.status !== 'dead');
  
  let totalLineageWR = 0;
  let hasTrades = 0;
  lineageChildren.forEach(c => {
    const cpnl = c.childPnl || {trades:0, wins:0};
    if (cpnl.trades > 0) {
      totalLineageWR += (cpnl.wins / cpnl.trades * 100);
      hasTrades++;
    }
  });
  const avgWR = hasTrades > 0 ? (totalLineageWR / hasTrades).toFixed(1) : 0;

  content.innerHTML = \`
    <div class="child-header" style="border-bottom:2px solid \${colors[type]}">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:24px">\${icons[type]}</div>
        <div>
          <div class="child-name">\${names[type] || type.toUpperCase()}</div>
          <div style="font-size:10px;color:var(--grey)">Golden Round Table Foundation</div>
        </div>
      </div>
      <div class="child-close" onclick="document.getElementById('child-modal').style.display='none'">X</div>
    </div>
    
    <div class="child-body">
      
      <div class="child-section">
        <div class="child-sec-title">FOUNDATION LOGIC</div>
        <div style="font-size:12px;line-height:1.5;color:var(--text2);background:var(--bg);padding:10px;border-left:4px solid \${colors[type]}">
          \${desc[type] || 'Core structural node in the Neural Pipeline.'}
        </div>
      </div>

      <div class="child-section">
        <div class="child-sec-title">DYNAMIC SCANNING / LIVE EDGE</div>
        <div class="child-grid" style="grid-template-columns:1fr 1fr">
          <div><span class="lbl">ACTIVE CHILDREN</span><div class="val" style="color:var(--cyan)">\${activeLineage.length} Nodes</div></div>
          <div><span class="lbl">PRUNED (DEAD)</span><div class="val" style="color:var(--red)">\${lineageChildren.length - activeLineage.length} Nodes</div></div>
          <div><span class="lbl">LINEAGE WIN RATE</span><div class="val" style="color:\${avgWR>=50?'var(--green)':'var(--red)'}">\${avgWR}%</div></div>
          <div><span class="lbl">REAL-TIME EDGE</span><div class="val" style="color:var(--green)">+ \${((pIntel?.signal?.conf || 0)/10).toFixed(2)}%</div></div>
        </div>
      </div>
      
    </div>
  \`;
  modal.style.display='block';
}

// ── Child Detail Modal ─────────────────────────────────────────────────────
function showChildDetail(childIdx) {
  const d = window._lastNFData;
  if (!d) return;
  const ch = (d.children||[])[childIdx];
  if (!ch) return;
  const modal = document.getElementById('child-modal');
  const content = document.getElementById('child-modal-content');
  if (!modal||!content) return;

  const dna = ch.dna||{};
  const intel = ch.intel||{};
  const sig = intel.signal||{};
  const scoreHist = intel.scoreHistory||[];
  const exp = Math.min(100, ch.childExp||0);
  const gcs = ch.grandChildren||[];
  const styleMap = { volume_vwap:'VOL/VWAP', bollinger_vol:'BB/VOL', rsi_reversal:'RSI/REV' };
  const cogStyle = styleMap[dna.cognitiveStyle]||dna.cognitiveStyle||'UNKNOWN';

  const cpnl = ch.childPnl||{};
  const cTrades = cpnl.trades||0;
  const cWins = cpnl.wins||0;
  const cLosses = cpnl.losses||0;
  const cWR = cTrades>0 ? Math.round(cWins/cTrades*100) : 0;
  const cNet = cpnl.net||0;

  // Age calculation
  const ageDays = ch.born ? Math.floor((Date.now()-new Date(ch.born).getTime())/86400000) : 0;
  const ageHrs  = ch.born ? Math.floor((Date.now()-new Date(ch.born).getTime())/3600000) : 0;
  const ageStr  = ageDays > 0 ? ageDays+'d' : ageHrs+'h';

  // Signal age
  const sigAge = intel.ts ? Math.round((Date.now()-new Date(intel.ts).getTime())/1000) : null;
  const sigFresh = sigAge !== null && sigAge < 600;

  // Status colors
  const statusColor = ch.status==='observing'?'var(--yellow)':ch.status==='dead'?'var(--red)':'var(--green)';

  // Score heatmap blocks
  const scoreBlocks = scoreHist.length ? scoreHist.map((s,i)=>{
    const bg = s>=70?'var(--green)':s>=55?'var(--cyan)':s>=40?'var(--yellow)':'var(--red)';
    return '<div class="score-dot" style="background:'+bg+'" title="Cycle '+(i+1)+': '+s+'/100"></div>';
  }).join('') : '<span style="color:var(--grey);font-size:10px">Awaiting first cycle...</span>';

  // Sparkline SVG for score history
  const scoreSpark = (()=>{
    if(scoreHist.length<2) return '';
    const W=200,H=32,n=scoreHist.length;
    const mn=Math.min(...scoreHist),mx=Math.max(...scoreHist),rg=mx-mn||1;
    const pts=scoreHist.map((v,i)=>\`\${(i/(n-1))*W},\${H-(v-mn)/rg*H}\`).join(' ');
    const last=scoreHist[n-1],prev=scoreHist[n-2];
    const c=last>prev?'var(--green)':last<prev?'var(--red)':'var(--grey)';
    // area fill
    const area=pts+\` \${W},\${H} 0,\${H}\`;
    return \`<svg width="\${W}" height="\${H}" style="display:block;margin-top:4px">
      <polygon points="\${area}" fill="\${c}" fill-opacity="0.1"/>
      <polyline points="\${pts}" fill="none" stroke="\${c}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="\${W}" cy="\${H-(scoreHist[n-1]-mn)/rg*H}" r="3" fill="\${c}"/>
    </svg>\`;
  })();

  // Build DNA bar visualization
  function dnaBar(label, value, max, color) {
    const pct = Math.min(100, (value/max)*100);
    return \`<div style="margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span class="lbl">\${label}</span><span style="font-family:var(--mono);font-size:11px;color:\${color}">\${typeof value==='number'?value.toFixed(3):value}</span>
      </div>
      <div class="child-bar-track"><div class="child-bar-fill" style="width:\${pct}%;background:repeating-linear-gradient(90deg,\${color} 0,\${color} 4px,transparent 4px,transparent 6px)"></div></div>
    </div>\`;
  }

  // Grandchildren HTML
  const gcHTML = gcs.length ? gcs.map(gc => {
    const gcExp = Math.min(100, gc.childExp||gc.exp||0);
    const isElite = gc.dna?.isElite || gc.isElite;
    const gcName = (gc.name||gc.spec||'GC').toUpperCase();
    const crossFrom = gc.dna?.crossoverFrom;
    return \`<div class="gc-card \${isElite?'elite':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-family:var(--pixel);font-size:8px;color:\${isElite?'var(--purple)':'var(--cyan)'};\${isElite?'animation:glowText 2s infinite':''}">\${gcName}</span>
        <span style="font-family:var(--pixel);font-size:7px;color:var(--grey)">G\${gc.generation||3}</span>
      </div>
      \${isElite?'<div style="font-size:9px;color:var(--purple);margin-bottom:3px">ELITE CANDIDATE</div>':''}
      \${crossFrom?'<div style="font-size:9px;color:var(--grey)">Cross: '+crossFrom.join(' x ')+'</div>':''}
      <div style="font-size:10px;margin-top:3px">
        <span style="color:var(--grey)">Status:</span> \${gc.status||'?'}
        <span style="margin-left:8px;color:var(--grey)">Cap:</span> \$\${(gc.capital||0).toFixed(2)}
      </div>
      <div style="margin-top:4px">
        <div class="child-bar-track" style="height:8px">
          <div class="child-bar-fill" style="width:\${gcExp}%;background:repeating-linear-gradient(90deg,\${isElite?'var(--purple)':'var(--cyan)'} 0,\${isElite?'var(--purple)':'var(--cyan)'} 3px,transparent 3px,transparent 5px)"></div>
          <div class="child-bar-label" style="font-size:6px">\${gcExp}/100 EXP</div>
        </div>
      </div>
    </div>\`;
  }).join('') : '';

  content.innerHTML = \`
    <div class="child-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="alive-dot" style="background:\${statusColor}"></div>
        <div>
          <div class="child-name">\${(ch.name||'CHILD').toUpperCase()}</div>
          <div style="font-size:10px;color:var(--grey);font-family:var(--mono);margin-top:2px">\${(ch.faction||'ADAN').toUpperCase()} · \${ch.spec||'?'} · \${cogStyle} · \${ageStr} old</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="child-gen">GEN \${ch.generation||2}</span>
        <div class="child-close" onclick="document.getElementById('child-modal').style.display='none'">X</div>
      </div>
    </div>

    <div class="child-body">

      <!-- VITALS -->
      <div class="child-section">
        <div class="child-sec-title">VITALS</div>
        <div class="child-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
          <div><span class="lbl">STATUS</span><div class="val" style="color:\${statusColor}">\${(ch.status||'?').toUpperCase()}</div></div>
          <div><span class="lbl">CAPITAL</span><div class="val" style="color:var(--cyan)">\$\${(ch.capital||0).toFixed(2)}</div></div>
          <div><span class="lbl">EXP</span><div class="val">\${exp}/100</div></div>
          <div><span class="lbl">BORN</span><div class="val">\${ch.born?new Date(ch.born).toLocaleDateString():'---'}</div></div>
          \${ch.status==='dead' ? \`<div><span class="lbl">DIED</span><div class="val" style="color:var(--red)">\${ch.deathTime?new Date(ch.deathTime).toLocaleDateString():'---'}</div></div>\` : ''}
        </div>
        \${ch.status==='dead' ? \`<div style="margin-top:6px;font-size:10px;color:var(--red)">Cause: \${ch.deathReason||'Capital Exhausted'}</div>\` : ''}
      </div>

      <!-- EXPERIENCE BAR -->
      <div class="child-section">
        <div class="child-sec-title">EXPERIENCE</div>
        <div class="child-bar-track" style="height:18px">
          <div class="child-bar-fill" style="width:\${exp}%;background:repeating-linear-gradient(90deg,var(--purple) 0,var(--purple) 6px,#8b3acd 6px,#8b3acd 8px)"></div>
          <div class="child-bar-label">\${exp}/100 \${exp>=100?'READY TO SPAWN':'· needs '+(100-exp)+' more'}</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px;font-family:var(--pixel);color:var(--grey)">
          <span>0</span>
          <span>\${exp>=100?'CAN BREED':'OBSERVING'}</span>
          <span>100</span>
        </div>
      </div>

      <!-- DNA GENOME -->
      <div class="child-section">
        <div class="child-sec-title">DNA GENOME</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">
          <span class="dna-chip" style="border-color:var(--purple);color:var(--purple)">\${cogStyle}</span>
          <span class="dna-chip" style="border-color:var(--cyan);color:var(--cyan)">MUT #\${dna.mutation??0}</span>
          \${dna.crossoverFrom?\`<span class="dna-chip" style="border-color:var(--green);color:var(--green)">CROSSOVER</span>\`:''}
          \${dna.isElite?\`<span class="dna-chip" style="border-color:var(--red);color:var(--red);animation:glowText 2s infinite">ELITE</span>\`:''}
        </div>
        \${dnaBar('STAKE', dna.stakePct||0.1, 0.2, 'var(--cyan)')}
        \${dnaBar('PATIENCE', dna.patience||1, 2, 'var(--purple)')}
        \${dnaBar('MIN EDGE', dna.minEdge||0.05, 0.15, 'var(--green)')}
        \${dnaBar('VOL WEIGHT', dna.volWeight||1, 2, 'var(--yellow)')}
        \${dnaBar('VWAP WEIGHT', dna.vwapWeight||1, 2, 'var(--cyan)')}
        \${dnaBar('BORED BB', dna.boredBBMin||0.005, 0.015, 'var(--grey)')}
      </div>

      <!-- LIVE INTEL -->
      <div class="child-section">
        <div class="child-sec-title">LIVE INTEL \${sigFresh?'<span class="alive-dot" style="background:var(--green);margin-left:4px"></span>':''}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          \${sig.dir?\`<span class="signal-badge" style="border-color:\${sig.dir==='UP'?'var(--green)':'var(--red)'};color:\${sig.dir==='UP'?'var(--green)':'var(--red)'};background:\${sig.dir==='UP'?'rgba(26,90,26,0.1)':'rgba(138,26,26,0.1)'}">\${sig.dir} \${sig.conf||0}%</span>\`:'<span style="color:var(--grey);font-size:10px">No signal</span>'}
          \${intel.price?\`<span style="font-family:var(--mono);font-size:13px;color:var(--text)">\$\${Number(intel.price).toLocaleString()}</span>\`:''}
          \${sigAge!==null?\`<span style="font-size:10px;color:\${sigFresh?'var(--green)':'var(--grey)'}">\${sigAge}s ago</span>\`:''}
        </div>
        \${sig.reason?\`<div style="font-size:11px;color:var(--text2);padding:6px 8px;background:var(--bg);border-left:3px solid var(--cyan);margin-bottom:6px">\${sig.reason}</div>\`:''}
        <div class="child-grid" style="grid-template-columns:1fr 1fr">
          <div><span class="lbl">INTEL SCORE</span><div class="val" style="color:\${(intel.intelScore||0)>=65?'var(--green)':(intel.intelScore||0)>=40?'var(--yellow)':'var(--red)'}">\${intel.intelScore||0}/100</div></div>
          <div><span class="lbl">MARKETS SCANNED</span><div class="val">\${intel.markets||0}</div></div>
        </div>
        \${intel.bestMarket?\`<div style="margin-top:8px;padding:8px;background:var(--bg4);border:2px solid var(--border)">
          <div style="font-family:var(--pixel);font-size:8px;color:var(--cyan);margin-bottom:4px">BEST MARKET FOUND</div>
          <div style="font-size:12px;font-weight:bold;color:var(--text);margin-bottom:3px">\${intel.bestMarket.title||''}</div>
          <div class="child-grid" style="grid-template-columns:1fr 1fr 1fr;font-size:10px">
            <div><span class="lbl">SIDE</span><div style="color:\${intel.bestMarket.suggestedSide==='YES'?'var(--green)':'var(--red)'}; font-weight:bold">\${intel.bestMarket.suggestedSide||'?'}</div></div>
            <div><span class="lbl">EDGE</span><div style="color:var(--cyan)">\${((intel.bestMarket.impliedEdge||0)*100).toFixed(1)}%</div></div>
            <div><span class="lbl">CLOSES IN</span><div>\${intel.bestMarket.closesIn||'?'}min</div></div>
          </div>
        </div>\`:''}
      </div>

      <!-- SCORE HISTORY (heatmap) -->
      <div class="child-section">
        <div class="child-sec-title">SCORE HISTORY (\${scoreHist.length} cycles)</div>
        <div style="display:flex;flex-wrap:wrap;gap:1px;margin-bottom:4px">\${scoreBlocks}</div>
        \${scoreSpark}
        \${scoreHist.length >= 2 ?\`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--grey);font-family:var(--pixel);margin-top:4px">
          <span>LOW \${Math.min(...scoreHist)}</span>
          <span>AVG \${Math.round(scoreHist.reduce((a, b) => a + b, 0) / scoreHist.length)}</span>
          <span>HIGH \${Math.max(...scoreHist)}</span>
        </div>\`:''}
      </div>

      <!-- TRADE PERFORMANCE -->
      <div class="child-section">
        <div class="child-sec-title">TRADE PERFORMANCE</div>
        \${cTrades > 0 ?\`
        <div class="child-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:8px">
          <div><span class="lbl">TRADES</span><div class="val">\${cTrades}</div></div>
          <div><span class="lbl">WINS</span><div class="val" style="color:var(--green)">\${cWins}</div></div>
          <div><span class="lbl">LOSSES</span><div class="val" style="color:var(--red)">\${cLosses}</div></div>
          <div><span class="lbl">WIN RATE</span><div class="val" style="color:\${cWR>=55?'var(--green)':cWR>=40?'var(--yellow)':'var(--red)'}">\${cWR}%</div></div>
        </div>
        <div class="child-bar-track" style="height:12px;margin-bottom:6px">
          <div class="child-bar-fill" style="width:\${cWR}%;background:var(--green)"></div>
          <div style="position:absolute;top:0;right:0;height:100%;width:\${100-cWR}%;background:var(--red);opacity:0.4"></div>
          <div class="child-bar-label">\${cWR}% WR</div>
        </div>
        <div class="child-grid" style="grid-template-columns:1fr 1fr">
          <div><span class="lbl">NET P&L</span><div class="val" style="color:\${cNet>=0?'var(--green)':'var(--red)'}">\${cNet >= 0 ? '+' : ''}\$\${cNet.toFixed(2)}</div></div>
          <div><span class="lbl">FUND</span><div class="val" style="color:var(--cyan)">\$\${(cpnl.fund || 0).toFixed(2)}</div></div>
        </div>
        \`:\`
        <div style="text-align:center;padding:12px;color:var(--grey);font-size:11px">
          <div style="font-size:20px;margin-bottom:6px">...</div>
          <div style="font-family:var(--pixel);font-size:8px">NO TRADES YET</div>
          <div style="margin-top:4px">Observing and building intel for ADAN</div>
        </div>
        \`}
      </div>

      <!-- GRANDCHILDREN -->
      \${gcs.length || exp >= 100 ?\`<div class="child-section">
        <div class="child-sec-title">OFFSPRING (\${gcs.length} grandchildren)</div>
        \${gcs.length ?\`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">\${gcHTML}</div>\`:\`
        <div style="text-align:center;padding:10px;border:2px dashed var(--border2)">
          <div style="font-family:var(--pixel);font-size:8px;color:var(--purple);margin-bottom:4px">\${exp >= 100 ? 'READY TO BREED' : 'AWAITING 100 EXP'}</div>
          <div style="font-size:10px;color:var(--grey)">\${exp >= 100 ? 'Will spawn on next ADAN LVL 4+ cycle' : 'Needs ' + (100 - exp) + ' more EXP to unlock breeding'}</div>
        </div>
        \`}
      </div>\`:''}

    </div>
  \`;
  modal.style.display='block';
}

async function refresh() {
  try {
    const r = await fetch('/api/state');
    const d = await r.json();
    
    // Fetch brain data
    let brainData = null;
    try {
      const br = await fetch('/api/brains');
      brainData = await br.json();
    } catch(e) {}

    window._lastNFData = d; // for fast neural-flow spinner
    const pnl = d.pnl, xp = d.xp;
    const pct = pnl.trades > 0 ? Math.round(pnl.wins / pnl.trades * 100) : 0;
    const st = d.state;

    // Status dot
    const isThinking = st?.mode === 'thinking';
    document.getElementById('sdot').className = 'status-dot' + (isThinking ? ' thinking' : '');
    const sm = st?.survivalMode;
    const statusTxt = isThinking ? 'Thinking...' : sm === 'critical' ? '🚨 CRITICAL' : sm === 'survival' ? '⚠ SURVIVAL MODE' : sm === 'cautious' ? 'CAUTIOUS' : 'Ready';
    const stEl = document.getElementById('status-txt');
    stEl.textContent = statusTxt;
    stEl.style.color = sm === 'critical' || sm === 'survival' ? 'var(--red)' : sm === 'cautious' ? 'var(--yellow)' : '';
    document.getElementById('scan-info').textContent = st?.lastScan ? 'Last scan: ' + st.lastScan + ' · Next: ~' + st.nextScanIn + 'min' : '';

    // Topbar
    document.getElementById('top-fund').textContent = '\$' + (pnl.fund || 0).toFixed(2);
    const netEl = document.getElementById('top-net');
    netEl.textContent = (pnl.net >= 0 ? '+' : '') + '\$' + (pnl.net || 0).toFixed(2);
    netEl.style.color = pnl.net >= 0 ? 'var(--green)' : 'var(--red)';
    const wrEl = document.getElementById('top-wr');
    wrEl.textContent = pct + '%';
    wrEl.style.color = pct >= 55 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
    document.getElementById('top-trades').textContent = pnl.wins + 'W/' + pnl.losses + 'L';

    // Ticker
    const prices = st?.prices || {};
    const tickItems = [['BTC', 'BTCUSDT'], ['ETH', 'ETHUSDT'], ['SOL', 'SOLUSDT'], ['BNB', 'BNBUSDT']];
    document.getElementById('ticker').innerHTML = tickItems.map(([sym, key]) => {
      const p = prices[key];
      if (!p) return \`<div class="tick"><span class="tick-sym">\${sym}</span><span class="tick-p" style="color:var(--grey)">--</span></div>\`;
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
    document.getElementById('fund-arc').style.stroke=fundPct>=0.9?'var(--green)':fundPct>=0.7?'var(--cyan)':fundPct>=0.4?'var(--yellow)':'var(--red)';
    document.getElementById('ring-fund').textContent='\$'+(pnl.fund/1000).toFixed(2)+'k';
    document.getElementById('ring-fund').style.color=fundPct>=0.9?'var(--green)':fundPct>=0.7?'var(--cyan)':fundPct>=0.4?'var(--yellow)':'var(--red)';

    // Stats
    document.getElementById('s-net').innerHTML=\`<span style="color:\${pnl.net>=0?'var(--green)':'var(--red)'}">\${pnl.net>=0?'+':''}\$\${(pnl.net||0).toFixed(2)}</span>\`;
    document.getElementById('s-wr').innerHTML=\`<span style="color:\${pct>=55?'var(--green)':pct>=40?'var(--yellow)':'var(--red)'}">\${pct}%</span> <span style="color:var(--grey);font-size:10px">(\${pnl.wins}W/\${pnl.losses}L)</span>\`;
    const bs = pnl.brierScore;
    document.getElementById('s-brier').innerHTML = bs != null ? \`<span style="color:\${bs < 0.15 ? 'var(--green)' : bs < 0.25 ? 'var(--yellow)' : 'var(--red)'}">\${bs.toFixed(3)}</span>\` : \`<span style="color:var(--grey)">--</span>\`;
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
    const priceSyms=[['BTC','BTCUSDT'],['ETH','ETHUSDT'],['SOL','SOLUSDT'],['BNB','BNBUSDT']];
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
      <span style="color:var(--purple);font-weight:700;font-size:14px">◈ ADAN</span>
      <span class="badge2 b-lvl">LVL \${xp.level}</span>
      <span class="badge2 \${wrClass}">\${pct}% WR</span>
      <span style="color:var(--grey);font-size:10px">Gen\${pnl.generation||1} · ROOT</span>
    </div>\`;
    if(children.length===0){
      const sc={minLvl:2,minTrades:10,minWR:0};
      const needs=[];
      if(xp.level<sc.minLvl)needs.push('LVL '+sc.minLvl);
      if(pnl.trades<sc.minTrades)needs.push((sc.minTrades-pnl.trades)+' trades');
      if(pnl.treasury<=0)needs.push('treasury > 0');
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
    const tw=document.getElementById('tree-wrap'); if(tw) tw.innerHTML=treeHtml;

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
    updateAvatar(d, brainData);

    // ADAN World Conway
    updateAdanWorld(d.children || [], d.config || {});

    // Neural flow + dynasty panel
    updateNeuralFlow(d);
    updateDynastyPanel(d);
    updateDecisionsLog(d);
    updateHourHeatmap(d);

  }catch(e){
    console.error('[refresh crash]',e);
    const errEl = document.getElementById('decisions-wrap');
    if(errEl) errEl.innerHTML='<div style="color:var(--red);font-size:11px;padding:8px 0">[JS error] '+e.message+' — check console</div>';
  }
}

// ── Avatar update ─────────────────────────────────────────────────────────────
function updateAvatar(d, brainData) {
  const sprite = document.getElementById('av-sprite');
  const dot    = document.getElementById('av-dot');
  const stxt   = document.getElementById('av-status-txt');
  const title  = document.getElementById('av-title');
  if (!sprite || !dot || !stxt || !title) return;

  // Render Golden Round Table Active Brain SVG
  const activeBrain = brainData?.activeBrain || 'DEFAULT';
  let pal = AVATAR_PALETTES.find(p => p.name === activeBrain);
  if (!pal) pal = AVATAR_PALETTES.find(p => p.name === 'DEFAULT');
  const svgWrap = document.getElementById('avatar-svg');
  if (svgWrap && pal) {
    // Check if we need to swap the inner SVG completely
    if (!svgWrap.dataset.currentBrain || svgWrap.dataset.currentBrain !== activeBrain) {
       svgWrap.innerHTML = pal.svg;
       svgWrap.dataset.currentBrain = activeBrain;
    }
  }

  // Fallback to legacy colors if Golden Table fails
  if (!brainData && d.config && d.config.avatar) {
    const r = d.config.avatar;
    const h = document.getElementById('avatar-hair'); if (h && r.hairColor) h.style.fill = r.hairColor;
    const s = document.getElementById('avatar-suit'); if (s && r.suitColor) s.style.fill = r.suitColor;
    const e = document.getElementById('avatar-eyes'); if (e && r.eyeColor) e.style.fill = r.eyeColor;
    const k = document.getElementById('avatar-skin'); if (k && r.skinColor) k.style.fill = r.skinColor;
  }

  const mode = d.state?.mode;
  const xp   = d.xp;
  const pnl  = d.pnl;
  const pct  = pnl.trades>0 ? Math.round(pnl.wins/pnl.trades*100) : 0;
  const openCount = (d.positions?.open||[]).length;
  const personality = d.config?.avatar?.personality || 'analitico';
  const lastTrade = (d.positions?.closed||[]).slice(-1)[0];
  const lastWasWin = lastTrade?.result === 'WIN';
  const lastWasLoss = lastTrade?.result === 'LOSS';
  const lastTradeRecent = lastTrade?.resolvedAt && (Date.now() - new Date(lastTrade.resolvedAt).getTime()) < 30000;
  const isDreaming = !mode && openCount === 0 && !d.state?.prices?.['BTCUSDT'];

  // Determine avatar visual state
  let avState = '';
  if (mode === 'thinking') avState = 'thinking';
  else if (openCount > 0 && mode === 'result') avState = 'betting';
  else if (lastWasWin && lastTradeRecent) avState = 'winning';
  else if (lastWasLoss && lastTradeRecent) avState = 'losing';
  else if (isDreaming) avState = 'dreaming';
  else if (pct >= 55 && pnl.trades >= 5) avState = 'winning';

  // Personality base class (only when idle-ish)
  const pClass = (!avState || avState === 'winning') ? ' p-' + personality : '';
  sprite.className = 'av-sprite' + (avState ? ' ' + avState : '') + pClass;

  // Dynamic eye color based on betting state
  const eyesEl = document.getElementById('avatar-eyes');
  if (eyesEl) {
    if (avState === 'betting') {
      const lastBetSide = (d.positions?.open||[]).slice(-1)[0]?.side;
      eyesEl.style.fill = lastBetSide === 'YES' ? '#22c55e' : '#ef4444';
    } else if (avState === 'losing') {
      eyesEl.style.fill = '#666';
    } else if (d.config?.avatar?.eyeColor) {
      eyesEl.style.fill = d.config.avatar.eyeColor;
    }
  }

  // Crown on winning (temporary)
  const wrap = document.getElementById('av-sprite-wrap');
  if (wrap) {
    const existingCrown = wrap.querySelector('.av-crown');
    const existingZzz = wrap.querySelector('.av-zzz');
    if (avState === 'winning' && lastWasWin && lastTradeRecent && !existingCrown) {
      const crown = document.createElement('div');
      crown.className = 'av-crown';
      crown.textContent = '👑';
      wrap.style.position = 'relative';
      wrap.appendChild(crown);
      setTimeout(() => crown.remove(), 2000);
    }
    if (avState === 'dreaming' && !existingZzz) {
      const zzz = document.createElement('div');
      zzz.className = 'av-zzz';
      zzz.textContent = 'Z';
      wrap.style.position = 'relative';
      wrap.appendChild(zzz);
      setTimeout(() => zzz.remove(), 2000);
    } else if (avState !== 'dreaming' && existingZzz) {
      existingZzz.remove();
    }
  }

  // Status dot + text
  if (dot && stxt) {
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
  }

  // Title evolves with level
  if (title) {
    const titles = {1:'Web4 Node · Gen 1',3:'Scout Trader · Gen 1',5:'Intelligence Node',10:'Market Oracle',20:'Apex Predictor',40:'Sovereign Agent'};
    let tkey = 1;
    for (const k of Object.keys(titles).map(Number).sort((a,b)=>a-b)) { if ((xp?.level||1)>=k) tkey=k; }
    
    // Inject Active Brain prefix if present
    const prefix = brainData ? '['+ activeBrain +'] ' : '';
    title.textContent = prefix + (titles[tkey]||'Web4 Node') + ' · LVL '+(xp?.level||1);
  }
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
  const closed  = (d.positions?.closed||[]).slice(-6).reverse();
  const open    = d.positions?.open||[];
  const all     = [...open.map(p=>({...p,_open:true})), ...closed];
  const thought = d.state?.thought || '';
  const mode    = d.state?.mode;
  const isThinking = mode === 'thinking';
  const hasThought = thought.length > 10;

  let html = '';

  // ── LIVE THOUGHT BLOCK ────────────────────────────────────────────────────
  if (isThinking) {
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    const frame  = frames[Math.floor(Date.now()/150) % frames.length];
    html += \`<div class="brain-live-block thinking">
      <div class="brain-live-header">
        <span class="brain-live-dot"></span>
        <span style="color:var(--cyan);font-weight:700;font-size:11px;font-family:var(--mono)">\${frame} ANALYZING — \${(window.ADAN_MODE || 'TRAINING') === 'TRAINING' ? 'Local Qwen3.5 0.8b' : 'Claude Sonnet 4.6'}</span>
        <span style="color:var(--grey);font-size:9px;margin-left:auto;font-family:var(--mono)">thinking...</span>
      </div>
      <div class="brain-live-body">Procesando mercados + datos Binance + señales hijos...</div>
    </div>\`;
  } else if (hasThought) {
    const isBet  = thought.includes('BET') || thought.includes('MARKET_ID');
    const isSkip = thought.includes('SKIP') || thought.includes('AUTO-SKIP') || thought.includes('Session offline');
    const isAuto = thought.includes('AUTO-SKIP');
    const blockCls = isBet ? 'bet' : isSkip ? 'skip' : 'result';
    const dotColor = isBet ? 'var(--green)' : isAuto ? 'var(--yellow)' : isSkip ? 'var(--grey)' : 'var(--cyan)';
    const label    = isBet ? '◉ BET PLACED' : isAuto ? '⏸ AUTO-SKIP' : isSkip ? '⏸ SKIP / MONITORING' : '● ANALYSIS COMPLETE';
    // Extract key lines (skip headers, code fences, separators)
    const lines = thought.split('\\n')
      .filter(l => l.trim() && !l.startsWith('#') && l.slice(0,3)!=='---' && l.slice(0,3)!=='~~~')
      .slice(0,5);
    html += \`<div class="brain-live-block \${blockCls}">
      <div class="brain-live-header">
        <span style="color:\${dotColor};font-weight:700;font-size:11px;font-family:var(--mono)">\${label}</span>
        <span style="color:var(--grey);font-size:9px;margin-left:auto;font-family:var(--mono)">\${d.state?.lastScan||''}</span>
      </div>
      <div class="brain-live-body">\${lines.join('\\n').slice(0,500)}</div>
      \${thought.length > 200 ? \`<details style="margin-top:8px"><summary style="color:var(--grey);font-size:9px;font-family:var(--pixel);cursor:pointer;user-select:none">▸ FULL REASONING</summary><div class="brain-full-text">\${thought.slice(0,3000)}</div></details>\` : ''}
    </div>\`;
  }

  // ── PAST DECISIONS ────────────────────────────────────────────────────────
  if (all.length === 0) {
    if (!hasThought && !isThinking) {
      html += '<div style="color:var(--grey);font-size:12px;padding:8px 0">No decisions yet — ADAN is observing markets...</div>';
    }
  } else {
    html += '<div class="brain-section-title">TRADE HISTORY · LAST DECISIONS</div>';
    html += all.slice(0,7).map((p,idx) => {
      const w  = p.result==='WIN';
      const isO= p._open;
      const badgeCls = isO ? 'b-lvl' : (w ? 'b-wr-good' : 'b-wr-bad');
      const badgeTxt = isO ? 'OPEN' : (w?'WIN':'LOSS');
      const edge = ((p.edge||0)*100).toFixed(1);
      const side = p.side==='YES' ? '<span style="color:var(--green)">YES ▲</span>' : '<span style="color:var(--red)">NO ▼</span>';
      const pnlTxt = isO ? '' : \`<span style="color:\${w?'var(--green)':'var(--red)'};font-weight:700">\${w?'+':''}\$\${p.pnl}</span>\`;
      const entryThought = p.entryThought || '';
      const reasonLines  = entryThought.split('\\n').filter(l=>l.trim()&&!l.startsWith('#')).slice(0,3).join('\\n');
      const fullReason   = entryThought.replace(/^#.*$/mg,'').trim();
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

  wrap.innerHTML = html;
}

// ── Neural Pipeline Visualization — RADIAL with ADAN center + 3 Parents orbiting ──
function updateNeuralFlow(d) {
    const wrap = document.getElementById('nf-wrap');
    if (!wrap) return;
    const isThinking = d.state?.mode === 'thinking';
    const isDone = d.state?.mode === 'result';

    const prices = d.state?.prices || {};
    const btc = prices['BTCUSDT'];

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const frame = frames[Math.floor(Date.now() / 150) % frames.length];
    const fmt = (v, dp = 2) => v != null ? v.toFixed(dp) : '--';
    const chgTxt = (p) => p ? (p.chg >= 0 ? '+' : '') + fmt(p.chg, 1) + '%' : '--';

    const C_CARD = '#ddd9cc';
    const C_CARD3 = '#e8e4d8';
    const C_BRD2 = '#3a3a2a';
    const C_TXT = '#1a1a1a';
    const C_DIM = '#888878';
    const C_SHD = '#1a1a1a';
    const C_CYA = '#1a4a8a';
    const C_GRN = '#1a5a1a';
    const C_PUR = '#5a1a8a';
    const C_YEL = '#7a5a10';
    const C_RED = '#8a1a1a';

    const lnColor = isThinking ? C_CYA : isDone ? C_GRN : C_BRD2;

    const SVG_W = 1000, SVG_H = 450;
    const CX = SVG_W / 2, CY = SVG_H / 2;
    const ORBIT_R = 150;
    const ADAN_R = 40;
    const PARENT_R = 30;

    const children = d.children || [];
    const appleIntel = children.find(c => c.spec === 'apple');
    const snakeIntel = children.find(c => c.spec === 'snake');
    const evaIntel = children.find(c => c.spec === 'eva');
    const atlasIntel = children.find(c => c.spec === 'atlas');

    const parentDefs = [
        { id: 'apple', name: 'APPLE', icon: '🍎', color: C_YEL, angle: -45, intel: appleIntel, l1: appleIntel?.report?.opportunity || 'scanning...', l2: appleIntel ? 'F&G:' + (appleIntel.report?.fgValue ?? '--') : 'waiting' },
        { id: 'snake', name: 'SNAKE', icon: '🐍', color: C_GRN, angle: 45, intel: snakeIntel, l1: snakeIntel?.report?.viability || 'scanning...', l2: snakeIntel ? 'Vol:' + (snakeIntel.report?.avgVolRatio ?? '--') + 'x' : 'waiting' },
        { id: 'eva', name: 'EVA', icon: '👑', color: C_RED, angle: 135, intel: evaIntel, l1: evaIntel?.report?.approved ? 'APPROVED' : (evaIntel ? 'DENIED' : 'scanning...'), l2: evaIntel ? 'Risk:' + (evaIntel.report?.riskLevel || '--') : 'waiting' },
        { id: 'atlas', name: 'ATLAS', icon: '👁️‍🗨️', color: C_PUR, angle: -135, intel: atlasIntel, l1: atlasIntel?.report?.smartMoney || 'scanning...', l2: atlasIntel ? 'Funding:' + (atlasIntel.report?.fundingRate || '--') : 'waiting' }
    ];

    let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${SVG_W} \${SVG_H}" style="width:100%;height:\${SVG_H}px">
  <defs>
    <marker id="arh-rad" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="\${lnColor}"/>
    </marker>
    <radialGradient id="adan-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="\${C_PUR}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="\${C_PUR}" stop-opacity="0"/>
    </radialGradient>
  </defs>\`;

    svg += \`<circle cx="\${CX}" cy="\${CY}" r="\${ORBIT_R}" fill="none" stroke="\${C_BRD2}" stroke-width="1" stroke-dasharray="4 4" opacity="0.3"/>\`;

    parentDefs.forEach((p, i) => {
        const rad = p.angle * Math.PI / 180;
        const px = CX + ORBIT_R * Math.cos(rad);
        const py = CY + ORBIT_R * Math.sin(rad);
        const distC = Math.sqrt(Math.pow(CX - px, 2) + Math.pow(CY - py, 2));
        const x1 = px + (CX - px) / distC * PARENT_R;
        const y1 = py + (CY - py) / distC * PARENT_R;
        const x2 = CX - (CX - px) / distC * ADAN_R;
        const y2 = CY - (CY - py) / distC * ADAN_R;
        const lineOpacity = Math.max(0.3, Math.min(1, (p.intel?.signal?.conf || 30) / 100));
        const ptDur = isThinking ? '0.5s' : '1.5s';

        svg += \`<path d="M\${x1.toFixed(1)},\${y1.toFixed(1)} L\${x2.toFixed(1)},\${y2.toFixed(1)}" stroke="\${p.color}" stroke-width="1.5" stroke-dasharray="4 3" fill="none" opacity="\${lineOpacity}" marker-end="url(#arh-rad)"/>\`;
        for (let pt = 0; pt < 5; pt++) {
            svg += \`<circle r="2" fill="\${p.color}" opacity="\${lineOpacity * (1 - pt / 10)}">
        <animateMotion path="M\${x1.toFixed(1)},\${y1.toFixed(1)} L\${x2.toFixed(1)},\${y2.toFixed(1)}" dur="\${ptDur}" begin="\${pt * 0.3}s" repeatCount="indefinite"/>
      </circle>\`;
        }
    });

    svg += \`<circle cx="\${CX}" cy="\${CY}" r="\${ADAN_R + 15}" fill="url(#adan-glow)"/>\`;
    if (isThinking) {
        svg += \`<circle cx="\${CX}" cy="\${CY}" r="\${ADAN_R + 8}" fill="none" stroke="\${C_CYA}" stroke-width="1.5" opacity=".3" class="nf-pulse"/>\`;
    }

    const adanBorder = isThinking ? C_CYA : isDone ? C_GRN : C_PUR;
    svg += \`<rect x="\${CX - ADAN_R}" y="\${CY - ADAN_R}" width="\${ADAN_R * 2}" height="\${ADAN_R * 2}" fill="\${C_CARD}" stroke="\${adanBorder}" stroke-width="2.5" onclick="showAdanDetail()" style="cursor:pointer"/>
  <text x="\${CX}" y="\${CY - 12}" text-anchor="middle" font-size="7" font-weight="700" fill="\${C_PUR}" font-family="JetBrains Mono,monospace" letter-spacing="1.5">ADAN</text>
  <text x="\${CX}" y="\${CY + 4}" text-anchor="middle" font-size="18" fill="\${isThinking ? C_CYA : C_PUR}" font-family="JetBrains Mono,monospace" font-weight="700">\${isThinking ? frame : (isDone ? '◉' : '◈')}</text>
  <text x="\${CX}" y="\${CY + 18}" text-anchor="middle" font-size="8" fill="\${C_DIM}" font-family="JetBrains Mono,monospace">\${isThinking ? 'analyzing' : (isDone ? (d.state?.thought?.includes('BET') ? 'BET' : 'SKIP') : 'idle')}</text>\`;

    const tSecGlobal = Date.now() / 1000;
    parentDefs.forEach((p) => {
        const rad = p.angle * Math.PI / 180;
        const px = CX + ORBIT_R * Math.cos(rad);
        const py = CY + ORBIT_R * Math.sin(rad);

        svg += \`<g onclick="showParentDetail('\${p.id}')" style="cursor:pointer">
      <rect x="\${px - PARENT_R}" y="\${py - PARENT_R}" width="\${PARENT_R * 2}" height="\${PARENT_R * 2}" fill="\${C_CARD}" stroke="\${p.color}" stroke-width="2"/>
      <text x="\${px}" y="\${py - 10}" text-anchor="middle" font-size="6.5" font-weight="700" fill="\${p.color}" font-family="JetBrains Mono,monospace">\${p.name}</text>
      <text x="\${px}" y="\${py + 2}" text-anchor="middle" font-size="12">\${p.icon}</text>
    </g>\`;

        const pChildren = children.filter(c => c.status !== 'dead' && (c.faction?.toLowerCase() === p.id || (c.name && c.name.toLowerCase().startsWith(p.id.charAt(0)))));
        const childOrbitR = PARENT_R + 35;
        if (pChildren.length > 0) {
            svg += \`<circle cx="\${px}" cy="\${py}" r="\${childOrbitR}" fill="none" stroke="\${p.color}" stroke-width="0.5" stroke-dasharray="2 4" opacity="0.3"/>\`;
        }

        pChildren.forEach((child, ci) => {
            const globalIdx = children.indexOf(child);
            const startAngle = (tSecGlobal % 16) / 16 * 360 + (ci / pChildren.length) * 360;
            svg += \`<g transform="translate(\${px}, \${py})">
        <g>
          <animateTransform attributeName="transform" type="rotate" from="\${startAngle} 0 0" to="\${startAngle + 360} 0 0" dur="16s" repeatCount="indefinite" />
          <g transform="translate(\${childOrbitR}, 0)">
            <g>
              <animateTransform attributeName="transform" type="rotate" from="\${-startAngle} 0 0" to="\${-(startAngle + 360)} 0 0" dur="16s" repeatCount="indefinite" />
              <g onclick="showChildDetail(\${globalIdx})" style="cursor:pointer;">
                <circle cx="0" cy="0" r="8" fill="\${C_CARD3}" stroke="\${C_CYA}" stroke-width="1.5" />
                <text x="0" y="2" text-anchor="middle" font-size="5" fill="\${C_TXT}" font-family="JetBrains Mono,monospace">\${(child.name || child.spec).slice(0, 3).toUpperCase()}</text>
              </g>
            </g>
          </g>
        </g>
      </g>\`;
        });
    });

    svg += '</svg>';
    wrap.innerHTML = svg;

    const dot = document.getElementById('cmd-live-dot');
    const txt = document.getElementById('cmd-live-txt');
    const aiEngine = (window.ADAN_MODE || 'TRAINING') === 'TRAINING' ? 'Local Qwen3.5' : 'Sonnet 4.6';
    if (dot) dot.className = 'cmd-live-dot' + (isThinking ? ' thinking' : (btc ? '' : ' idle'));
    if (txt) {
        txt.textContent = isThinking ? \`THINKING — \${aiEngine} analyzing\` : isDone ? 'DECISION MADE' : (btc ? 'MONITORING · live prices' : 'INITIALIZING');
        txt.style.color = isThinking ? 'var(--cyan)' : isDone ? 'var(--green)' : 'var(--text2)';
    }
}
// ── Dynasty Network — D3.js Force DAG ─────────────────────────────────────────
let d3Sim = null;
let d3Svg = null;
let d3G = null;
let dynNodes = [];
let dynLinks = [];
let d3Zoom = null;

function toggleDagFullscreen() {
  const wrap = document.getElementById('dynasty-wrap');
  const btn = document.getElementById('btn-fs');
  if (wrap.classList.contains('fullscreen')) {
    wrap.classList.remove('fullscreen');
    btn.textContent = '⛶ FULLSCREEN';
  } else {
    wrap.classList.add('fullscreen');
    btn.textContent = '✖ MINIMIZE';
  }
}

let isGoldenPath = false;
function toggleGoldenPath() {
  isGoldenPath = !isGoldenPath;
  const btn = document.getElementById('btn-gp');
  if (isGoldenPath) {
    btn.classList.add('active');
    d3G.selectAll('.d3-node').classed('dimmed', d => d.isDead || (d.group === 2 && d.wr < 50));
    d3G.selectAll('.d3-link').classed('dimmed', d => !d.isGreen);
  } else {
    btn.classList.remove('active');
    d3G.selectAll('.d3-node').classed('dimmed', false);
    d3G.selectAll('.d3-link').classed('dimmed', false);
  }
}

function updateDynastyPanel(d) {
  const el = document.getElementById('dynasty-panel');
  if (!el) return;

  const config = d.config || {};
  const children = d.children || [];
  
  // Transform ADAN data to D3 nodes/links layout
  const newNodes = [];
  const newLinks = [];
  
  // 1. Core Node
  newNodes.push({ id: 'ADAN', group: 0, label: '👑 ADAN', sub: 'Root Gen1', color: 'var(--purple)', edgeVolume: 5, fx: 0, fy: 0, 
    pulseColor: (d.state?.mode && d.state.mode !== 'idle') ? 'var(--cyan)' : null 
  });

  // 2. Pillars
  const parents = config.mesaRedonda?.parents || [];
  if (!parents.find(p => p.id === 'atlas')) parents.push({ id: 'atlas', name: 'Atlas', role: 'Oracle' });
  
  const pColors = { apple: 'var(--yellow)', snake: 'var(--green)', eva: 'var(--red)', atlas: 'var(--purple)' };
  const pIcons = { apple: '🍎 APPLE', snake: '🐍 SNAKE', eva: '👑 EVA', atlas: '👁️ ATLAS' };

  parents.forEach((p, i) => {
    // Pulse rule: Apple pulses if scanning news. Snake pulses if scanning orderbook.
    const isScanning = d.state?.thought?.toLowerCase().includes(p.id);
    newNodes.push({
      id: p.id, group: 1, label: pIcons[p.id], sub: p.role, color: pColors[p.id] || 'var(--grey)', edgeVolume: 3, pulseColor: isScanning ? pColors[p.id] : null
    });
    newLinks.push({ source: p.id, target: 'ADAN', value: 3, isGreen: false, edgeVolume: 3 });
  });

  // 3. Children (Alive + Dead Branches)
  children.forEach((c, idx) => {
    const isDead = c.status === 'dead';
    const cid = c.spec + (isDead ? '_dead_' + idx : '');
    const trades = c.childPnl?.trades || 1;
    const wr = Math.round((c.childPnl?.wins || 0) / Math.max(1, trades) * 100);
    const xp = c.exp || 0;
    
    // Eugenics Condition: > 55% WR, > 10 trades, ALIVE
    const isReadyFuse = !isDead && wr >= 55 && (c.childPnl?.trades || 0) >= 10;
    
    // Check mutations
    let mutationIcon = '';
    if (c.dna) {
       if (c.dna.stake_multiplier > 1.2) mutationIcon += '⚔️';
       if (c.dna.confirmation_delay > 2) mutationIcon += '🛡️';
    }

    newNodes.push({
      id: cid,
      group: 2,
      rawChild: c,
      label: (isDead ? '💀 ' : '🧬 ') + (c.name || c.spec).toUpperCase().slice(0, 8) + mutationIcon,
      sub: isDead ? 'DEAD' : ('WR: ' + wr + '%'),
      color: isDead ? 'var(--red)' : 'var(--cyan)',
      childIdx: idx,
      isDead: isDead,
      isReadyFuse: isReadyFuse,
      wr: wr,
      edgeVolume: Math.min(6, 1 + (xp / 20))
    });
    
    // Link to specific parent or ADAN
    const pStr = (c.faction || c.spec).toLowerCase();
    const parent = parents.find(p => pStr.startsWith(p.id.charAt(0)));
    const parentId = parent ? parent.id : 'ADAN';
    
    // Green line if WR >= 50% and alive
    const isGreen = !isDead && wr >= 50;
    newLinks.push({ source: cid, target: parentId, value: 1, isGreen: isGreen, edgeVolume: Math.min(5, 1 + (xp / 25)) });
  });

  // Preserve existing D3 node positions where possible so it doesn't jump
  dynNodes.forEach(oldN => {
    const newN = newNodes.find(n => n.id === oldN.id);
    if (newN && !newN.fx) { // Don't overwrite fixed x/y
      newN.x = oldN.x;
      newN.y = oldN.y;
      newN.vx = oldN.vx;
      newN.vy = oldN.vy;
    }
  });

  dynNodes = newNodes;
  dynLinks = newLinks;

  if (!d3Svg) {
    el.innerHTML = '';
    d3Svg = d3.select('#dynasty-panel').append('svg')
      .attr('width', '100%')
      .attr('height', '100%');
      
    d3G = d3Svg.append('g').attr('class', 'dag-container');

    d3Zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        d3G.attr('transform', event.transform);
      });

    d3Svg.call(d3Zoom);
    d3Svg.on('dblclick.zoom', null); // disable default double-click zoom

    // Lasso Brush
    const brush = d3.brush()
      .extent([[-1000, -1000], [1000, 1000]])
      .on('start brush', (event) => {
        if (!event.selection) return;
        const [[x0, y0], [x1, y1]] = event.selection;
        d3G.selectAll('.d3-node rect').style('stroke', d => {
          const isSelected = d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1;
          return isSelected ? '#fff' : d.color;
        });
      })
      .on('end', (event) => {
         const tooltip = document.getElementById('lasso-tooltip');
         if (!event.selection) {
           d3G.selectAll('.d3-node rect').style('stroke', d => d.color);
           tooltip.classList.remove('visible');
           return;
         }
         
         const [[x0, y0], [x1, y1]] = event.selection;
         const selectedPaths = dynNodes.filter(d => d.group === 2 && d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1);
         
         if (selectedPaths.length > 0) {
           const avgWR = selectedPaths.reduce((sum, d) => sum + (d.wr || 0), 0) / selectedPaths.length;
           const alive = selectedPaths.filter(d => !d.isDead).length;
           let tStr = '🧬 SELECTED FORGE COMBINE: ' + selectedPaths.length + ' NODES\\n';
           tStr += '⭐ AVG WIN RATE: ' + avgWR.toFixed(1) + '% | 🩸 ALIVE: ' + alive;
           tooltip.innerHTML = tStr;
           tooltip.classList.add('visible');
         } else {
           tooltip.classList.remove('visible');
         }
      });
      
    d3G.append("g")
      .attr("class", "brush")
      .call(brush);

    // Start centered
    d3Svg.call(d3Zoom.transform, d3.zoomIdentity.translate(el.clientWidth / 2, el.clientHeight / 2));
      
    d3Sim = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(d => d.target.id === 'ADAN' ? 120 : 80))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide().radius(40));
  }

  // Update Links
  const link = d3G.selectAll('.d3-link')
    .data(dynLinks, d => d.source.id + '-' + d.target.id);
    
  link.exit().remove();
  
  const linkEnter = link.enter().append('line')
    .attr('class', 'd3-link');
    
  const linkMerge = linkEnter.merge(link);
  
  linkMerge
    .style('stroke', d => d.isGreen ? 'var(--green)' : 'var(--dim)')
    .style('stroke-width', d => d.edgeVolume);

  // Update Nodes
  const node = d3G.selectAll('.d3-node')
    .data(dynNodes, d => d.id);
    
  node.exit().remove();

  const nodeEnter = d3G.selectAll('.d3-node').data(dynNodes, d => d.id).enter()
    .append('g')
    .attr('class', 'd3-node')
    .call(d3.drag()
        .on('start', (event, d) => { if (!event.active) d3Sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { 
            if (!event.active) d3Sim.alphaTarget(0); 
            if(d.id !== 'ADAN') { d.fx = null; d.fy = null; }
            
            // Crossover Collision Detection
            if (d.group === 2 && d.isReadyFuse) {
               // Find if dropped on another ready-fuse node
               const droppedOn = dynNodes.find(n => n.id !== d.id && n.group === 2 && n.isReadyFuse && Math.abs(n.x - d.x) < 30 && Math.abs(n.y - d.y) < 30);
               if (droppedOn) {
                  promptCrossover(d, droppedOn);
               }
            }
        })
    )
    .on('click', (event, d) => {
        if (event.defaultPrevented) return;
        if (d.group === 0) showAdanDetail();
        else if (d.group === 1) showParentDetail(d.id);
        else if (d.group === 2) showChildDetail(d.childIdx);
    })
    .on('dblclick', (event, d) => {
        event.stopPropagation();
        d3Svg.transition().duration(750).call(
          d3Zoom.transform,
          d3.zoomIdentity.translate(el.clientWidth / 2, el.clientHeight / 2).scale(1.5).translate(-d.x, -d.y)
        );
    });

  // Box (Neo-brutalist style)
  nodeEnter.append('rect')
    .attr('width', 100).attr('height', 36)
    .attr('x', -50).attr('y', -18)
    .attr('fill', 'var(--bg2)')
    .style('stroke', d => d.color);

  // Labels
  nodeEnter.append('text')
    .attr('class', 'label-main')
    .attr('dy', '-2px')
    .attr('text-anchor', 'middle')
    .style('font-size', '10px')
    .style('fill', d => d.color)
    .text(d => d.label);
    
  nodeEnter.append('text')
    .attr('class', 'label-sub')
    .attr('dy', '10px')
    .attr('text-anchor', 'middle')
    .style('font-size', '8px')
    .style('fill', 'var(--text2)')
    .style('font-family', 'var(--mono)')
    .text(d => d.sub);

  const nodeMerge = nodeEnter.merge(node);
  
  // Re-apply classes, pulse colors and state
  nodeMerge.classed('pulsing', d => !!d.pulseColor);
  nodeMerge.classed('ready-fuse', d => d.isReadyFuse);
  nodeMerge.style('--pulse-color', d => d.pulseColor || 'transparent');
  if (isGoldenPath) {
    nodeMerge.classed('dimmed', d => d.isDead || (d.group === 2 && d.wr < 50));
    linkMerge.classed('dimmed', d => !d.isGreen);
  } else {
    nodeMerge.classed('dimmed', false);
    linkMerge.classed('dimmed', false);
  }
  
  // Update texts logic in case it changes
  nodeMerge.select('.label-main').text(d => d.label);
  nodeMerge.select('.label-sub').text(d => d.sub);
  nodeMerge.select('rect').style('stroke', d => d.color);

  // Simulation tick event
  d3Sim.nodes(dynNodes).on('tick', () => {
    linkMerge
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
      
    nodeMerge.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });
  
  d3Sim.force('link').links(dynLinks);
  d3Sim.alpha(0.3).restart();
}


refresh();
setInterval(refresh, 4000);
// Fast-refresh: solo actualiza countdown + spinner via DOM — NO reconstruye el SVG
const _spinFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
setInterval(() => {
  const d = window._lastNFData;
  if (!d) return;
  const mode = d.state?.mode;
  const nextAt = d.state?.nextScanAt;
  const isIdle = !mode || mode === null;

  // Countdown en topbar (no toca el SVG)
  const eta = document.getElementById('cmd-scan-eta');
  const bar = document.getElementById('cmd-scan-bar');
  if (nextAt && isIdle && eta) {
    const rem = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    const mm = Math.floor(rem / 60), ss = String(rem % 60).padStart(2, '0');
    if (eta) eta.textContent = mm + ':' + ss + ' to scan';
    if (bar) { bar.style.width = Math.min(100, Math.round((300 - rem) / 300 * 100)) + '%'; bar.style.background = 'var(--cyan)'; }
  }

  // Braille spinner: solo actualiza el textContent del nodo CLAUDE en el SVG existente
  if (mode === 'thinking') {
    const frame = _spinFrames[Math.floor(Date.now() / 150) % _spinFrames.length];
    const el = document.getElementById('nf-claude-icon');
    if (el) el.textContent = frame;
    const el2 = document.getElementById('nf-dec-icon');
    if (el2) el2.textContent = frame;
  }
}, 150);

// ── ADAN World Conway Grid ──────────────────────────────────────────────────
let cw_grid = [];
let cw_cols = 80;
let cw_rows = 25;
let cw_agents = []; // Array of {id, x, y, state}

function drawCell(ctx, x, y, state, glowRadius) {
  const cellSize = 8;
  const px = x * cellSize, py = y * cellSize;
  // State: 0=dead, 1=alive(profitable child), 2=parent-adan, 3=parent-apple, 4=parent-snake, 5=parent-eva, 6=dead-child
  const colors = {
    0: '#ddd9cc',   // dead — bg2
    1: '#1a5a1a',   // alive child — green
    2: '#8b5cf6',   // ADAN — bright purple
    3: '#eab308',   // APPLE — yellow
    4: '#22c55e',   // SNAKE — green
    5: '#ef4444',   // EVA — red
    6: '#4a4a3a'    // dead child — dark grey
  };
  ctx.fillStyle = colors[state] || colors[0];
  ctx.fillRect(px, py, cellSize - 1, cellSize - 1);

  // Glow effect for parent cells
  if (state >= 2 && state <= 5 && glowRadius) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = colors[state];
    const gr = glowRadius * cellSize;
    ctx.beginPath();
    ctx.arc(px + cellSize / 2, py + cellSize / 2, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // ADAN is 2x size
  if (state === 2) {
    ctx.fillStyle = colors[2];
    ctx.fillRect(px - cellSize / 2, py - cellSize / 2, cellSize * 2 - 1, cellSize * 2 - 1);
  }
}

function placeAgentOnGrid(agentId) {
  if (cw_agents.has(agentId)) {
    return cw_agents.get(agentId);
  }

  // Find a random empty spot
  for (let i = 0; i < 100; i++) { // Try 100 times to find an empty spot
    const x = Math.floor(Math.random() * cw_cols);
    const y = Math.floor(Math.random() * cw_rows);
    let isOccupied = false;
    for (const agent of cw_agents.values()) {
      if (agent.x === x && agent.y === y) {
        isOccupied = true;
        break;
      }
    }
    if (!isOccupied) {
      const newPos = { x, y, state: 1 };
      cw_agents.set(agentId, newPos);
      return newPos;
    }
  }
  // If no spot found, place it at a default random location
  const finalPos = { x: Math.floor(Math.random() * cw_cols), y: Math.floor(Math.random() * cw_rows), state: 1 };
  cw_agents.set(agentId, finalPos);
  return finalPos;
}

// First definition placeholder removed — see unified updateAdanWorld below


function initAdanWorld() {
  cw_grid = new Array(cw_rows).fill(0).map(() => new Array(cw_cols).fill(0));
  // Random noise initially
  for (let y = 0; y < cw_rows; y++) {
    for (let x = 0; x < cw_cols; x++) {
      cw_grid[y][x] = Math.random() > 0.85 ? 1 : 0;
    }
  }
}

// Unified ADAN World — colorful Conway grid with parent/child distinction
function updateAdanWorld(children, config) {
  if (!cw_grid || !cw_grid.length) initAdanWorld();

  const parents = config?.mesaRedonda?.parents || [];
  const parentIds = { adan: 2, apple: 3, snake: 4, eva: 5 };

  // Map agents to fixed coordinates
  const allAgents = [];

  // ADAN at center
  allAgents.push({ id: 'adan', x: Math.floor(cw_cols / 2), y: Math.floor(cw_rows / 2), state: 2 });

  // Parents at strategic positions
  const parentPositions = [
    { id: 'apple', x: Math.floor(cw_cols / 2), y: 3 },           // top center
    { id: 'snake', x: Math.floor(cw_cols * 0.75), y: Math.floor(cw_rows * 0.75) }, // bottom right
    { id: 'eva', x: Math.floor(cw_cols * 0.25), y: Math.floor(cw_rows * 0.75) }    // bottom left
  ];
  parentPositions.forEach(p => {
    allAgents.push({ ...p, state: parentIds[p.id] || 2 });
  });

  // Children
  const spawnedChildren = children.filter(c => !parents.some(p => p.id === c.spec));
  spawnedChildren.forEach((ch, i) => {
    const space = Math.max(2, Math.floor((cw_cols - 10) / (spawnedChildren.length || 1)));
    const x = 5 + space * i;
    const y = Math.floor(cw_rows / 2) + ((i % 3) - 1) * 2;
    const isAlive = (ch.childPnl?.net || 0) > 0;
    allAgents.push({ id: ch.spec, x, y, state: isAlive ? 1 : 6, name: ch.spec });
  });

  cw_agents = allAgents;
}

function stepAdanWorld() {
  if (!cw_grid || !cw_grid.length) return;
  const next = new Array(cw_rows).fill(0).map(() => new Array(cw_cols).fill(0));

  // Build parent proximity map — cells near parents survive easier
  const parentCells = new Set();
  (cw_agents || []).forEach(a => {
    if (a.state >= 2 && a.state <= 5) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          let ny = a.y + dy, nx = a.x + dx;
          if (ny < 0) ny += cw_rows; if (ny >= cw_rows) ny -= cw_rows;
          if (nx < 0) nx += cw_cols; if (nx >= cw_cols) nx -= cw_cols;
          parentCells.add(ny * cw_cols + nx);
        }
      }
    }
  });

  for (let y = 0; y < cw_rows; y++) {
    for (let x = 0; x < cw_cols; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let ny = y + dy, nx = x + dx;
          if (ny < 0) ny = cw_rows - 1; else if (ny >= cw_rows) ny = 0;
          if (nx < 0) nx = cw_cols - 1; else if (nx >= cw_cols) nx = 0;
          if (cw_grid[ny][nx] > 0) neighbors++;
        }
      }
      const alive = cw_grid[y][x] > 0;
      const nearParent = parentCells.has(y * cw_cols + x);

      // Modified Conway rules — parent proximity gives survival bonus
      if (alive && (neighbors === 2 || neighbors === 3)) next[y][x] = 1;
      else if (!alive && neighbors === 3) next[y][x] = 1;
      else if (nearParent && alive && neighbors >= 1) next[y][x] = 1; // parent aura keeps cells alive
      else if (nearParent && !alive && neighbors >= 2) next[y][x] = 1; // easier birth near parents
      else next[y][x] = 0;
    }
  }

  // Enforce agent cells with their proper states
  (cw_agents || []).forEach(a => {
    if (a.y >= 0 && a.y < cw_rows && a.x >= 0 && a.x < cw_cols) {
      next[a.y][a.x] = a.state || (a.alive ? 1 : 0);
    }
  });

  cw_grid = next;
  drawAdanWorld();
}

function drawAdanWorld() {
  const cvs = document.getElementById('adan-world-cvs');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const w = cvs.width, h = cvs.height;
  const cellW = w / cw_cols, cellH = h / cw_rows;

  ctx.clearRect(0, 0, w, h);

  // State colors
  const stateColors = {
    0: null,          // dead — transparent
    1: '#1a5a1a',     // alive child — green
    2: '#8b5cf6',     // ADAN — bright purple
    3: '#eab308',     // APPLE — yellow
    4: '#22c55e',     // SNAKE — green bright
    5: '#ef4444',     // EVA — red
    6: '#4a4a3a'      // dead child — dark grey
  };

  // Draw grid cells
  for (let y = 0; y < cw_rows; y++) {
    for (let x = 0; x < cw_cols; x++) {
      const state = cw_grid[y]?.[x] || 0;
      if (state === 0) continue;
      ctx.fillStyle = stateColors[state] || '#1a4a8a';
      const px = Math.floor(x * cellW), py = Math.floor(y * cellH);
      ctx.fillRect(px, py, Math.ceil(cellW) - 1, Math.ceil(cellH) - 1);
    }
  }

  // Draw agents with glow/highlights
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  const labels = { adan: 'A', apple: '🍎', snake: '🐍', eva: '👑' };

  (cw_agents || []).forEach(a => {
    const color = stateColors[a.state] || '#1a4a8a';
    const px = Math.floor(a.x * cellW), py = Math.floor(a.y * cellH);
    const isParent = a.state >= 2 && a.state <= 5;
    const size = isParent ? 2 : 1;

    // Glow for parents
    if (isParent) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px + cellW / 2, py + cellH / 2, cellW * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Cell (parents are larger)
    ctx.fillStyle = color;
    ctx.fillRect(px - (size - 1) * Math.ceil(cellW) / 2, py - (size - 1) * Math.ceil(cellH) / 2,
      Math.ceil(cellW) * size - 1, Math.ceil(cellH) * size - 1);

    // Border highlight
    ctx.strokeStyle = color;
    ctx.lineWidth = isParent ? 1.5 : 0.5;
    ctx.strokeRect(px - 2, py - 2, Math.ceil(cellW) * size + 3, Math.ceil(cellH) * size + 3);

    // Label above parents
    if (isParent && a.id) {
      ctx.fillStyle = color;
      ctx.fillText((labels[a.id] || a.id[0].toUpperCase()), px + cellW / 2, py - 4);
    }
  });
}

setInterval(stepAdanWorld, 200);

</script>
</body>
</html>`;

  const srv = http.createServer((req, res) => {
    if (req.url === '/api/brains') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(brainManager.getDashboardPayload()));
      return;
    }

    if (req.url === '/api/web4') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      import('./adan-web4-identity.js').then(module => {
        module.getWeb4DashboardPayload(module.initAdanKeypair ? null : null).then(payload => {
          res.end(JSON.stringify(payload));
        }).catch(err => res.end(JSON.stringify({ error: err.message })));
      }).catch(err => {
        console.error("Web4 module missing, ignoring:", err.message);
        res.end(JSON.stringify({ registered: false, error: 'Module missing run `npm install 8004-solana`' }));
      });
      return;
    }

    if (req.url === '/api/crossover' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const { childIdA, childIdB } = JSON.parse(body);
          const pnl = loadPnL();
          const children = pnl.children || [];

          const idxA = children.findIndex(c => c.spec === childIdA || c.id === childIdA);
          const idxB = children.findIndex(c => c.spec === childIdB || c.id === childIdB);
          if (idxA === -1 || idxB === -1) throw new Error("Parent nodes not found");

          const childA = children[idxA];
          const childB = children[idxB];

          let dnaA = childA.dna || { minEdge: 0.05, maxRiskIdx: 4, stakePct: 0.15, patience: 1.0, volWeight: 1.0, vwapWeight: 1.0 };
          let dnaB = childB.dna || { minEdge: 0.05, maxRiskIdx: 4, stakePct: 0.15, patience: 1.0, volWeight: 1.0, vwapWeight: 1.0 };

          // Fused DNA
          const fusedDna = {
            minEdge: parseFloat(((dnaA.minEdge + dnaB.minEdge) / 2).toFixed(3)),
            maxRiskIdx: Math.round((dnaA.maxRiskIdx + dnaB.maxRiskIdx) / 2),
            stakePct: parseFloat(((dnaA.stakePct + dnaB.stakePct) / 2).toFixed(3)),
            patience: parseFloat(((dnaA.patience + dnaB.patience) / 2).toFixed(2)),
            volWeight: parseFloat(((dnaA.volWeight + dnaB.volWeight) / 2).toFixed(2)),
            vwapWeight: parseFloat(((dnaA.vwapWeight + dnaB.vwapWeight) / 2).toFixed(2))
          };

          // Execute the weakest parent (Brier-score approximate)
          const wrA = (childA.childPnl?.wins || 0) / Math.max(1, childA.childPnl?.trades || 1);
          const wrB = (childB.childPnl?.wins || 0) / Math.max(1, childB.childPnl?.trades || 1);
          if (wrA >= wrB) childB.status = 'dead'; else childA.status = 'dead';

          // Spawn Gen3
          const genId = 'GEN3-' + Date.now().toString().slice(-6);
          const gen3 = {
            name: genId,
            spec: genId,
            faction: childA.faction,
            status: 'observing',
            generation: 3,
            dna: fusedDna,
            fusedFrom: [childIdA, childIdB],
            fusedAt: new Date().toISOString()
          };

          children.push(gen3);
          pnl.children = children;
          savePnL(pnl);

          appendToSoul(`\n### GEN3 CROSSOVER — ${new Date().toISOString()}:\nNodes [${childIdA}] and [${childIdB}] fused to create ${genId}.\nFused DNA: ${JSON.stringify(fusedDna)}\nWeakest parent executed.\n`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, gen3 }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

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
            if (age <= 10) intel = { signal: d.signal, intelScore: d.intelScore, ts: d.ts, price: d.price, bestMarket: d.bestMarket, scoreHistory: d.scoreHistory };
          }
        } catch { }
        // grandchildren + child EXP
        let grandChildren = [], childExp = 0, childSignals = 0;
        try {
          const childDir = path.join(DIR, 'children', child.id || child.spec);
          const gcPnlPath = path.join(childDir, 'pnl.json');
          if (fs.existsSync(gcPnlPath)) {
            const cp = JSON.parse(fs.readFileSync(gcPnlPath, 'utf8'));
            childExp = cp.exp || 0;
            childSignals = cp.signals || 0;
            grandChildren = (cp.children || []).map(gc => {
              let gcIntel = null;
              try {
                const gslug = gc.spec.replace(/[^a-z0-9]/gi, '-').toLowerCase();
                const gfp = path.join(INTEL_DIR, gslug + '.json');
                if (fs.existsSync(gfp)) {
                  const gd = JSON.parse(fs.readFileSync(gfp, 'utf8'));
                  if ((Date.now() - new Date(gd.ts).getTime()) / 60000 <= 10) gcIntel = { signal: gd.signal, ts: gd.ts, focus: gd.focus };
                }
              } catch { }
              return { ...gc, intel: gcIntel };
            });
          }
        } catch { }
        // Read child DNA + PnL
        let dna = child.dna || null;
        let childPnl = {};
        try {
          const specSlug = (child.spec || '').replace(/[^a-zA-Z0-9-]/g, '-');
          const childDir = path.join(DIR, 'children', specSlug);
          const cpPath = path.join(childDir, 'pnl.json');
          if (fs.existsSync(cpPath)) {
            const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
            childPnl = { trades: cp.trades || 0, wins: cp.wins || 0, losses: cp.losses || 0, net: cp.net || 0, fund: cp.fund || 0 };
            if (!dna && cp.dna) dna = cp.dna;  // read DNA from child's pnl.json
          }
        } catch { }
        return { ...child, intel, grandChildren, childExp, childSignals, dna, childPnl };
      });

      // Auto-reset result → idle after RESULT_SHOW_MS so the flow goes back to monitoring
      if (_dashboardState?.mode === 'result' && _resultAt && (Date.now() - _resultAt) > RESULT_SHOW_MS) {
        _dashboardState = { ..._dashboardState, mode: null };
      }
      // Enrich state with live nextScanAt for client-side countdown
      const enrichedState = _dashboardState
        ? { ..._dashboardState, nextScanAt: _nextScanAt || null }
        : null;

      // Include Golden Round Table parent intel in children array
      const config = loadConfig();
      const parentIntelEntries = [];
      if (config?.mesaRedonda?.parents) {
        for (const parent of config.mesaRedonda.parents) {
          try {
            const fp = path.join(INTEL_DIR, parent.id + '.json');
            if (fs.existsSync(fp)) {
              const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
              const age = (Date.now() - new Date(d.ts).getTime()) / 1000;
              if (age <= 1800) { // 30 min limit for API serving
                parentIntelEntries.push({
                  spec: parent.id,
                  name: parent.name,
                  role: parent.role,
                  intel: { signal: d.signal, intelScore: d.intelScore, ts: d.ts },
                  report: d.report || null,
                  signal: d.signal,
                  isParent: true
                });
              }
            }
          } catch { }
        }
      }

      res.end(JSON.stringify({
        ts: new Date().toISOString(),
        pnl, calib, positions: pos,
        xp: { ...xp, title: levelTitle(xp.level) },
        children: [...parentIntelEntries, ...childrenWithIntel],
        state: enrichedState,
        config
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    }
  });

  srv.listen(PORT, '127.0.0.1', () => {
    // silently started
  });
  srv.on('error', () => { }); // ignore port conflicts
  return srv;
}

// ── Render ───────────────────────────────────────────────────────────────────
function render(s) {
  _dashboardState = s; // expose to web dashboard
  if (s.mode === 'result') {
    _resultAt = Date.now();
    _nextScanAt = Date.now() + (s.nextScanIn || 5) * 60 * 1000;
  }
  if (s.mode !== 'thinking') _stopThinkSpin();
  cls();
  const pnl = s.pnl;
  const pct = pnl.trades > 0 ? Math.round(pnl.wins / pnl.trades * 100) : 0;
  const winColor = pct >= 55 ? G : pct >= 40 ? Y : R;
  const xp = expProgress(pnl.exp || 0);
  const lvlColor = xp.level >= 60 ? M : xp.level >= 40 ? M : xp.level >= 20 ? C : xp.level >= 10 ? Y : G;
  const fund = pnl.fund ?? 100;
  const openPos = s.positions?.open || [];
  const slots = Math.max(0, MAX_POSITIONS - openPos.length);
  const net = pnl.net || 0;
  const treasury = pnl.treasury || 0;
  const calib = loadCalibration();
  const prices = s.prices || {};

  // ── HEADER ──
  console.log('\n' + M + BOLD + '  ╔══════════════════════════════════════════════════════════════════╗');
  console.log(M + BOLD + '  ║  ▄▄  ██▄  ▄▄  ██▄    ██▄  ██▄  ██▄  ██▄                       ║');
  console.log(M + BOLD + '  ║  ███ ███ ███  ███▀▄  ███  ███  ███  ███                        ║');
  console.log(M + BOLD + '  ║  ███▀███ ███  ██▀▀█  ███  ███  ███  ███                        ║');
  console.log(M + BOLD + '  ║  A D A N - P R E D  v2   ·   Web4 Autonomaton   ·   2026       ║');
  console.log(M + BOLD + '  ║  Polymarket  ·  Binance  ·  Claude Sonnet 4.6  ·  by Lord      ║');
  console.log(M + BOLD + '  ║  ' + C + BOLD + 'Dashboard: http://localhost:3141' + M + BOLD + '  ·  auto-refresh 5s            ║');
  console.log(M + BOLD + '  ╚══════════════════════════════════════════════════════════════════╝' + X + '\n');

  const timeStr = new Date().toLocaleTimeString();
  const scanStatus = s.mode === 'thinking' ? Y + BOLD + '⬤ THINKING' + X
    : s.mode === 'result' ? G + BOLD + '⬤ READY' + X : C + '⬤ ' + s.status + X;
  const nextStr = s.lastScan ? D + '  scan: ' + s.lastScan + '  next: ~' + s.nextScanIn + 'min  $' + (s.apiCost || 0).toFixed(4) + X : '';

  console.log(TOP(M));
  console.log(row('  ' + BOLD + M + 'ADAN' + X + '  ' + D + timeStr + X + '  ' + scanStatus + nextStr));
  console.log(sep(M));

  // ── MARKET SENTIMENT ──
  const fg = prices._meta?.fearGreed;
  const fundRates = prices._meta?.fundingRates || {};
  if (fg) {
    const fgCol = fg.value >= 60 ? G : fg.value >= 40 ? Y : R;
    const fgBar = fgCol + '█'.repeat(Math.round(fg.value / 10)) + '░'.repeat(10 - Math.round(fg.value / 10)) + X;
    const fgDir = fg.direction > 0 ? ' ' + G + '↑' + X : fg.direction < 0 ? ' ' + R + '↓' + X : '';
    console.log(row('  SENTIMENT  ' + fgBar + '  ' + fgCol + BOLD + fg.value + '/100  ' + fg.label.toUpperCase() + X + fgDir));
  }
  console.log(sep(M));

  // ── PRICE TICKER — clean fixed columns ──
  console.log(row(D + '  ASSET    PRICE          CHG      TREND(1m/5m)    SIGNAL       SCORE' + X));
  console.log(SEP(M));

  for (const sym of SYMBOLS) {
    const d = prices[sym];
    const name = sym.replace('USDT', '');
    if (!d) { console.log(row(D + '  ' + name.padEnd(5) + '  no data' + X)); continue; }

    const chgCol = d.chg >= 0 ? G : R;
    const score = d.intelScore ?? 50;
    const sCol = score >= 65 ? G : score >= 45 ? Y : R;
    const spark = sparkline(d.closes || []);
    const t1Col = d.trend1m >= 0 ? G : R;
    const t5Col = d.trend5m >= 0 ? G : R;
    const sig = signalLabel(score);

    // Row 1 — price line (use plain strings for padding, then colorize)
    const priceStr = ('$' + d.price.toLocaleString()).padEnd(14);
    const chgStr = ((d.chg >= 0 ? '+' : '') + d.chg.toFixed(2) + '%').padEnd(8);
    const t1Str = (d.trend1m >= 0 ? '+' : '') + d.trend1m.toFixed(2) + '%';
    const t5Str = (d.trend5m >= 0 ? '+' : '') + d.trend5m.toFixed(2) + '%';
    console.log(row(
      '  ' + W + BOLD + name.padEnd(5) + X
      + C + BOLD + priceStr + X
      + chgCol + BOLD + chgStr + X
      + D + '1m:' + X + t1Col + t1Str + X
      + D + ' 5m:' + X + t5Col + t5Str + '  ' + X
      + sig + '  ' + sCol + BOLD + '[' + score + ']' + X
    ));
    // Row 2 — indicators line
    const rsiCol = d.rsi > 70 ? G : d.rsi < 30 ? R : Y;
    const mCol = d.macd?.hist > 0 ? G : R;
    const bbCol = d.bb?.pct > 75 ? G : d.bb?.pct < 25 ? R : Y;
    const vCol = d.vol?.trend === 'rising' ? G : d.vol?.trend === 'falling' ? R : D;
    const funding = d.funding || fundRates[sym];
    const fCol = funding?.signal === 'bearish' ? R : funding?.signal === 'bullish' ? G : D;
    console.log(row(
      D + '       RSI ' + X + rsiCol + BOLD + d.rsi.toFixed(0).padEnd(4) + X
      + D + 'MACD ' + X + mCol + BOLD + (d.macd?.hist > 0 ? '▲' : ' ▼') + '  ' + X
      + D + 'BB% ' + X + bbCol + (d.bb?.pct || 0).toFixed(0).padStart(3) + '%  ' + X
      + D + 'VOL ' + X + vCol + (d.vol?.trend || '--').padEnd(8) + X
      + (funding ? D + 'FUND ' + X + fCol + (funding.rate || 0).toFixed(3) + '%  ' + X : '')
      + D + 'VOLAT ' + X + (d.volatility > 0.12 ? R : d.volatility > 0.06 ? Y : G) + d.volatility.toFixed(3) + '%' + X
      + '  ' + spark
    ));
    console.log(SEP(M));
  }
  console.log(sep(M));

  // ── LEVEL + PORTFOLIO ──
  const skills = getSkills(xp.level);
  const unlocked = skills.filter(s => s.unlocked).map(s => s.icon + s.name).join(' ');
  const nextSkill = skills.find(s => !s.unlocked);
  const roiCol = fund >= 100 ? G : fund >= 80 ? Y : R;
  const sc = TREE_RULES.spawnConditions;
  const childCount = (pnl.children || []).length;
  const maxChildren = xp.level >= 4 ? TREE_RULES.maxChildrenGen1 : 1;
  const canSpawn = xp.level >= sc.minLvl
    && pnl.trades >= sc.minTrades
    && (pnl.wins / Math.max(pnl.trades, 1)) >= sc.minWinRate
    && childCount < maxChildren
    && treasury > 0;
  const strat = loadStrategy();

  console.log(row('  ' + lvlColor + BOLD + 'LVL ' + xp.level + '  ' + levelTitle(xp.level) + X
    + '  ' + D + xp.bar + ' ' + xp.pct + '%' + X
    + (nextSkill ? D + '  → ' + nextSkill.icon + nextSkill.name + ' @LVL' + nextSkill.lvl + X : '')));
  console.log(row('  ' + D + 'Skills: ' + X + M + unlocked + X
    + ((pnl.streak || 0) >= 3 ? '  ' + Y + BOLD + '🔥 STREAK ' + (pnl.streak || 0) + 'W' + X : '')));
  console.log(SEP(M));
  console.log(row(
    '  FUND  ' + roiCol + BOLD + '$' + fund.toFixed(2) + X + D + '/$' + PAPER_BET_SIZE * 100 + '  ' + X +
    '  NET  ' + (net >= 0 ? G : R) + BOLD + (net >= 0 ? '+' : '') + net.toFixed(2) + X +
    '  TRADES  ' + W + pnl.trades + X +
    '  W/L  ' + G + pnl.wins + X + D + '/' + X + R + pnl.losses + X +
    '  WR  ' + winColor + BOLD + pct + '%' + X + D + '  (goal 55%)' + X
  ));
  const kellyOn = xp.level >= 4;
  console.log(row(
    '  SLOTS  ' + (slots > 0 ? G : R) + BOLD + slots + '/' + MAX_POSITIONS + X + D + ' free  ' + X +
    '  MIN EDGE  ' + Y + BOLD + (strat.minEdge * 100).toFixed(0) + '%' + X +
    '  BET  ' + D + (kellyOn ? '📐KELLY' : '$' + PAPER_BET_SIZE + ' flat') + X +
    (treasury > 0 ? '  ' + M + '💰 $' + treasury.toFixed(2) + (canSpawn ? ' 👶SPAWN!' : '') + X : '')
  ));
  console.log(sep(M));
  // ── DYNASTY TREE ──
  renderTreePanel(pnl, prices);

  // ── CALIBRATION ──
  const calibLine = Object.entries(calib).map(([asset, d]) => {
    const acc = d.p >= 3 ? Math.round(d.c / d.p * 100) : null;
    const col = acc === null ? D : acc >= 60 ? G : acc >= 50 ? Y : R;
    return W + asset.toUpperCase() + X + D + ':' + X + (acc === null ? D + '--' : col + BOLD + acc + '%') + X + D + '(' + d.p + ')' + X;
  }).join('   ');
  console.log(row('  CALIBRATION  ' + calibLine));
  console.log(sep(M));

  // ── OPEN POSITIONS ──
  if (openPos.length > 0) {
    console.log(row(Y + BOLD + '  OPEN BETS (' + openPos.length + ')' + X + D + '  — monitoring for resolution' + X));
    console.log(row(D + '  MARKET                              SIDE  MY_P  MKT_P  EDGE   STAKE  CLOSES' + X));
    openPos.forEach(p => {
      const title = (p.marketTitle || '???').slice(0, 30).padEnd(30);
      const side = (p.side || 'YES').padEnd(5);
      const myP = ((p.myProb || 0) * 100).toFixed(0).padStart(4) + '%';
      const mktP = ((p.marketPrice || 0) * 100).toFixed(0).padStart(5) + '%';
      const edge = (((p.myProb || 0) - (p.marketPrice || 0)) * 100).toFixed(1).padStart(5) + '%';
      const eCol = parseFloat(edge) >= MIN_EDGE * 100 ? G : Y;
      const stake = ('$' + p.stake).padStart(5);
      const closes = p.closesAt ? new Date(p.closesAt).toLocaleTimeString() : '   n/a';
      console.log(row('  ' + W + title + X + side + Y + myP + X + mktP + eCol + BOLD + edge + X + stake + '  ' + D + closes + X));
    });
    console.log(sep(M));
  } else {
    console.log(row(D + '  No open bets — ADAN will enter on next scan' + X));
    console.log(sep(M));
  }

  // ── HISTORY ──
  const allClosed = s.positions?.closed || [];
  const shown = allClosed.slice(-4).reverse();
  if (shown.length > 0 || pnl.trades > 0) {
    const bsPart = pnl.brierScore != null ? D + ' | ' + X + Y + 'Brier: ' + pnl.brierScore.toFixed(3) + X : '';
    console.log(row(B + BOLD + '  HISTORY' + X + D + '  ' + pnl.trades + ' trades  (' + G + pnl.wins + 'W' + X + '/' + R + pnl.losses + 'L' + X + ')' + bsPart + X));
    shown.forEach(c => {
      const isWin = c.result === 'WIN';
      const rCol = isWin ? G : R;
      const sym = (c.marketTitle || '???').slice(0, 32).padEnd(32);
      const edge = c.edge != null ? (c.edge >= 0 ? '+' : '') + ((c.edge || 0) * 100).toFixed(1) + '%' : '?';
      const pnlStr = rCol + (isWin ? '+' : '') + c.pnl + X;
      const dt = (c.entryTime || '').slice(11, 16);
      console.log(row('  ' + rCol + BOLD + (isWin ? '✓ WIN' : '✗ LOSS') + X + ' ' + W + sym + X + D + ' edge:' + X + Y + edge + X + ' P&L: ' + pnlStr + D + ' ' + dt + X));
    });
    console.log(sep(M));
  }

  // ── LIVE MARKETS — separados por 5M / 15M / 1H ──
  const allMkts = s.markets || [];
  const mkts5 = allMkts.filter(m => m.windowMin === 5);
  const mkts15 = allMkts.filter(m => m.windowMin === 15);
  const mkts1h = allMkts.filter(m => m.windowMin === 60 || m.windowMin === 240);
  const sessionOn = allMkts.length > 0;

  function mktRow(m) {
    const asst = (m.asset || '???').toUpperCase().slice(0, 3).padEnd(4);
    const price = ((m.yesPrice || 0) * 100).toFixed(0).padStart(4) + '%';
    const edge = m.edge != null ? ((m.edge >= 0 ? '+' : '') + (m.edge * 100).toFixed(1) + '%').padStart(6) : '    --';
    const eCol = Math.abs(m.edge || 0) >= MIN_EDGE ? G : D;
    const liq = ('$' + (m.liquidity || 0).toFixed(0)).padStart(7);
    const endMs = m.closesAt ? new Date(m.closesAt).getTime() : 0;
    const hoursL = endMs ? (endMs - Date.now()) / 3600000 : null;
    const closes = hoursL != null ? (hoursL < 1 ? R + BOLD + (hoursL * 60).toFixed(0) + 'min' + X : hoursL < 4 ? Y + BOLD + hoursL.toFixed(1) + 'h' + X : D + hoursL.toFixed(0) + 'h' + X) : D + '--' + X;
    return '  ' + W + asst + X + C + price + X + eCol + edge + X + D + liq + ' ' + X + closes;
  }

  if (sessionOn) {
    console.log(row(G + BOLD + '  ▸ 5MIN' + X + D + '  BTC · ETH · SOL  (closes in minutes)' + X));
    if (mkts5.length > 0) {
      console.log(row(D + '  ASSET  UP%   EDGE     LIQ       CLOSES' + X));
      mkts5.slice(0, 3).forEach(m => console.log(row(mktRow(m))));
    } else { console.log(row(D + '  — no 5M active right now —' + X)); }
    console.log(SEP(M));

    console.log(row(Y + BOLD + '  ▸ 15MIN' + X + D + '  BTC · ETH · SOL  (closes in 15 min windows)' + X));
    if (mkts15.length > 0) {
      mkts15.slice(0, 3).forEach(m => console.log(row(mktRow(m))));
    } else { console.log(row(D + '  — no 15M active right now —' + X)); }
    console.log(SEP(M));

    console.log(row(C + BOLD + '  ▸ 1H / 4H' + X + D + '  BTC · ETH · SOL  (hourly/4h windows)' + X));
    if (mkts1h.length > 0) {
      mkts1h.slice(0, 3).forEach(m => console.log(row(mktRow(m))));
    } else { console.log(row(D + '  — no 1H active right now —' + X)); }
  } else {
    console.log(row(D + '  Session offline. 5M/15M/1H markets open ~3PM-10PM ET daily.' + X));
    console.log(row(D + '  Checking resolutions every 5min. New markets scan every 20min.' + X));
  }
  console.log(BOT(M));

  // ── THOUGHT PANEL ──
  if (s.mode === 'thinking') {
    const sp = _SPIN_F[Math.floor(Date.now() / 150) % _SPIN_F.length];
    console.log('\n' + Y + '┌' + DIV + '┐' + X);
    console.log(trow('  ' + sp + ' ADAN THINKING  —  Binance loaded · Sonnet 4.6 analyzing...', BOLD + Y, Y));
    console.log(trow('  Flow: Candles ' + sp + ' Trend ' + sp + ' Polymarket odds ' + sp + ' Edge calc ' + sp + ' BET or SKIP', D, Y));
    console.log(Y + '└' + DIV + '┘' + X + '\n');
    _startThinkSpin();
  } else if (s.mode === 'result' && s.thought) {
    console.log('\n' + M + '┌' + DIV + '┐' + X);
    console.log(trow('  ◉ ADAN DECISION', BOLD + M, M));
    console.log(M + '├' + DIV + '┤' + X);
    s.thought.split('\n').filter(Boolean).forEach(l => {
      (l.match(new RegExp('.{1,' + (TW - 2) + '}', 'g')) || [l]).forEach(chunk => {
        console.log(M + '│' + X + W + '  ' + chunk + ' '.repeat(Math.max(0, TW - chunk.length - 2)) + X + M + ' │' + X);
      });
    });
    console.log(M + '└' + DIV + '┘' + X + '\n');
  }
}

export {
  TOP, BOT, row, sep, trow, sparkline, renderTreePanel, startDashboard, render,
  _startThinkSpin, _stopThinkSpin, _dashboardState
};