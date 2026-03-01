# ADAN-PRED — Autonomous Decision Agent Node

> *"No es un bot. Es una entidad con algo que perder."*
> **Stack:** Node.js · Binance API · Polymarket Gamma API · Claude Sonnet 4.6

---

## What Is ADAN?

ADAN bets on Polymarket crypto prediction markets (BTC/ETH/SOL/XRP up-or-down) using real-time Binance data and Claude Sonnet 4.6 as its reasoning engine. It runs continuously, scans every ~5 minutes during active Polymarket sessions (~3PM–10PM ET), and places paper bets while learning from every outcome.

**Current Status:** LVL 4 · 20 trades · 40% WR · Fund $9,837 · Dynasty active (6 children)

---

## Architecture

```
ADAN (Root, Gen1)
├── Fetches Binance data: 1m/5m/15m/1h klines + order book walls + VWAP
├── Fetches Polymarket Gamma API: active crypto prediction markets
├── Sends 7-step analysis to Claude Sonnet 4.6 → BET/SKIP decision
├── Tracks PnL + auto-evolves SOUL.md patterns after each trade
└── Dynasty: spawns child scanners that compete to improve ADAN's DNA
```

**Dashboard:** `http://localhost:3141`

---

## Intelligence Engine (Institutional Grade)

### 7-Step Claude Analysis

1. **Sentiment** — F&G bias. Extreme fear (< 20) = market overprices downside.
2. **Multi-Timeframe Confluence (Fractal Analysis)** — 1h macro dictates direction, 5m micro is the trigger. No confluence = SKIP.
   - 1h BEARISH + 5m rally = liquidity trap → BET NO
   - 1h BULLISH + 5m dip = buying opportunity → BET YES
3. **Order Book Walls** — Sell wall 0.2% above price → price bounces DOWN. Buy wall below → support. Polymarket lags 10-30s = edge window.
4. **Volume Microstructure** — volRatio >1.3x = conviction. volAccel ≥+2 = accelerating. VWAP deviation = momentum quality.
5. **Timeframe-Specific Logic:**
   - **5min:** Order book + volume accel ONLY (pure impulse, ignore trend)
   - **15min:** Price/volume divergences (RSI >65 + falling vol = collapse → BET NO)
   - **1hr:** BTC correlation + macro support/resistance
6. **Volatility** — >0.12%/candle = widen uncertainty significantly
7. **Edge** — Only bet when YOUR prob vs market price diverges by >5%+

### BTC Correlation Rule (always active)
> ETH / SOL / XRP: **PROHIBITED** from YES bets when BTC 5m trend is falling.
> Crypto correlates tightly. A beautiful ETH chart with BTC bleeding is a trap.

### Boredom Filter
Auto-skips Claude call when ALL symbols have BB width <0.6% AND vol ratio <0.75x avg. Flat markets = no edge = no tokens wasted.

---

## Genetic Dynasty System

### Generation Tree
```
ADAN (Gen1, ROOT)
├── Gen2 Children — max 6 (spawns at LVL 2+, 10+ trades)
│   ├── Mutated DNA: minEdge ±10%, stake 5-15%, patience 0.8-1.6x
│   ├── Cognitive style: VOL/VWAP | BB/VOL | RSI/REV
│   └── Gen3 Grandchildren — max 2 per child (child needs 100 EXP)
│       └── Gen4 Great-Grandchildren — max 3 per grandchild → lineage dies
```

### How Children Gain EXP
Children earn EXP when their parent (ADAN) wins a trade on their specialized asset:
- ADAN wins BTC trade → HERMES (BTC-5min) gets **+40 EXP** if its signal was recent (< 15 min)
- ADAN loses → HERMES gets **+10 EXP** (participation reward)
- At **100 EXP** → child can spawn grandchildren (requires ADAN LVL 4+)

### Child Death Mechanics
1. **Capital exhaustion** — fund ≤ $0 after 5+ trades
2. **Incompetence** — avg intel score < 40 over 15+ cycles (consistently poor signals)
3. **Tournament of Death** — at ADAN's trade 20: bottom 50% killed, capital redistributed to winners

### DNA Mutation (Protocolo de Evolución Despiadada)
| Gene | Description | Range |
|------|-------------|-------|
| minEdge | Risk aversion | parent ± 10% |
| volWeight | Volume signal weight | 1.0 ± 8% |
| vwapWeight | VWAP signal weight | 1.0 ± 8% |
| **stakePct** | Stake as % of capital | **5% – 15%** |
| **patience** | Market patience factor | **0.8x – 1.6x** |
| **cognitiveStyle** | Analysis focus | **VOL/VWAP · BB/VOL · RSI/REV** |

### Upward Genetic Absorption
When a child outperforms ADAN (WR > parent, 10+ trades), ADAN absorbs 20% of child's DNA delta per cycle into `dynamic_weights.json`. The best genome propagates upward.

### Grandchild Promotion (Ascension)
Gen3 grandchild WR > parent Gen2 WR + 12% (both need 10+ trades) → parent eliminated, grandchild promoted to Gen2 direct child of ADAN.

### Crossover Inheritance (Gen3 spawn)
When spawning Gen3, the grandchild:
- Reads ADAN's SOUL.md (ROOT error patterns + learned rules)
- Reads parent's SOUL.md (Gen2 domain knowledge)
- Combines parent aggressiveness with ROOT's mistake memory

---

## Current Dynasty

| Child | Spec | Cognitive Style | DNA |
|-------|------|----------------|-----|
| HERMES | BTC-5min | observing | gen1 |
| ATHENA | ETH-5min | observing | gen1 |
| HELIOS | SOL-5min | observing | gen1 |
| KRONOS | BTC-15min | observing | gen1 |
| DAEDALUS | ETH-15min | observing | gen1 |
| APOLLO | SOL-15min | observing | gen1 |

**CHILD_SPECS (all active scanners):** BTC/ETH/SOL/XRP × 5min/15min/1hr = 12 intel threads

---

## Dashboard UI

- **Neural Pipeline** → animated SVG: Binance → Technical → Polymarket → Claude → Decision
- **Brain Log** → live Claude thought (cyan=thinking, green=BET, yellow=SKIP, details expandable)
- **Genetic Dynasty** → SVG network: each child node shows signal ▲/▼, DNA style, EXP bar, stake%
- **Transparent panel** → dot-grid overlay behind both SVGs
- **Status dot** → yellow pulsing = thinking | green = monitoring
- **Hour Heatmap** → UTC hours × historical win rate

---

## How To Know It's Working

```bash
# Live logs
tail -f /tmp/adan.log

# API state
curl http://localhost:3141/api/state | python3 -c "
import json,sys; d=json.load(sys.stdin)
st=d.get('state',{})
print('mode:', st.get('mode'))
print('thought:', (st.get('thought') or '')[:200])
"
```

**Console events to look for:**
- `◈ ANALYZING` / `✓ DECIDED` → Claude cycle
- `► WIN` / `► LOSS` → trade resolved
- `🌱 GRANDCHILD BORN` / `✗ CHILD DIED` → dynasty events
- `◈ GENOME ABSORBED` → DNA evolution
- `◈ PROMOTION` → grandchild ascension
- `◈ TOURNAMENT DONE` → death tournament (trade 20)

---

## EXP & Level System

| Level | EXP | Unlocks |
|-------|-----|---------|
| 1 | 0 | Base operation |
| 2 | 100 | Spawn first child |
| 3 | 200 | Active child scanners (BG intel) |
| **4** | **400** | **← ADAN is here. 6 children · Kelly betting · Grandchildren** |
| 5 | 800 | — |
| 6 | ~1,600 | Candle pattern analysis |
| 9 | ~4,000 | Timing optimization |
| 12 | ~8,000 | Fear/Greed exploitation |
| 18 | ~25,000 | BTC cascade betting |

**XP per trade:**
- WIN: `(confidence/10) × (1 + edge×5) × streak_multiplier`
- LOSS: 30 XP flat

---

## Files

```
adam-skill/
├── adan-pred.js          # Full agent (~3900 lines)
└── README.md

~/.adan-pred/
├── pnl.json              # P&L state + dynasty tree
├── positions.json        # Open/closed bets
├── strategy.json         # minEdge, minConfidence, minLiquidity
├── dynamic_weights.json  # Self-modifying DNA (Phase 2 autonomous)
├── SOUL.md               # Learned patterns (Claude auto-evolves)
├── thoughts.jsonl        # Full Claude reasoning history
├── calibration.json      # Per-asset historical accuracy
├── intel/                # Child scanner signals (12 files)
└── children/
    ├── BTC-5min/         # HERMES
    ├── ETH-5min/         # ATHENA
    ├── SOL-5min/         # HELIOS
    ├── BTC-15min/        # KRONOS
    ├── ETH-15min/        # DAEDALUS
    └── SOL-15min/        # APOLLO
```

---

## Running

```bash
node adan-pred.js
# Opens dashboard on http://localhost:3141
# Logs: tail -f /tmp/adan.log
```

**Configure** via `~/.adan-pred/strategy.json`:
- `minEdge`: 0.05 (5%) — minimum edge to bet
- `minConfidence`: 60 — minimum Claude confidence %
- `minLiquidity`: 500 — minimum Polymarket liquidity

---

*Paper trading only. No real money moved. Genetic evolution is live.*
