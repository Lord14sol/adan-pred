# ADAN-PRED — Autonomous Decision Agent Node

> *"No es un bot. Es una entidad con algo que perder."*
> **Stack:** Node.js · Binance API · Polymarket Gamma API · Claude Sonnet 4.6 · CryptoPanic

---

## What Is ADAN?

ADAN is an autonomous crypto prediction markets agent. It bets on Polymarket using real-time Binance data, CryptoPanic news, order book micro-structure, and Claude Sonnet 4.6 as its reasoning engine. It runs continuously, scans every ~5 minutes, and evolves through a genetic dynasty of child agents that compete to improve the root genome.

**Current Status:** LVL 4 · 43% WR · Fund ~$10K · Dynasty active (6 children) · 9 AGI layers

---

## Architecture

```
ADAN (Root, Gen1)
├── INIT: Binance 1m/5m/15m/1h klines + order book depth + VWAP + funding rates
├── INIT: CryptoPanic news flash (black swan detection)
├── INIT: Fear & Greed Index + meta-calibration history
├── FILTER: Boredom filter (BB width + vol ratio) → skip flat markets
├── FILTER: Hour filter → skip historically losing hours (<30% WR)
├── CHILDREN: 6 rule-based scanners generate intel signals per asset/timeframe
├── CONSENSUS: Multi-agent vote aggregation (75%+ = strong signal)
├── THINK: 9-step Claude Sonnet 4.6 analysis → BET/SKIP
├── VERIFY: Dual AI consultation (Haiku counter-opinion if confidence 50-65%)
├── SIZE: Kelly Criterion bet sizing (dynamic max by WR)
├── EXECUTE: Paper bet with 0.2% slippage simulation
├── LEARN: SOUL.md auto-evolution + meta-calibration + DNA absorption
└── DREAM: Off-hours self-reflection (replay losses with Claude)
```

**Dashboard:** `http://localhost:3141` — clickable dynasty nodes, live brain log, neural pipeline

---

## Intelligence Engine (9-Step Institutional Analysis)

### 1. Market Sentiment
Fear & Greed bias. Extreme fear (< 20) = market overprices downside → NO often overpriced.

### 2. Flash News (CryptoPanic)
Black swan detection before technical analysis. Hack, regulation, ETF, bankruptcy → overrides all technical signals.

### 3. Multi-Timeframe Confluence (Fractal Analysis)
- **1h macro DICTATES direction. 5m micro is the trigger.**
- 1h BEARISH + 5m rally = LIQUIDITY TRAP → BET NO
- 1h BULLISH + 5m dip = buying opportunity → BET YES
- No confluence = no bet. A great 5m signal against 1h trend = suicide.
- **BTC Correlation Rule:** ETH/SOL/XRP PROHIBITED from YES bets when BTC 5m is falling.

### 4. Order Book Micro-Structure (Sell Wall Trap)
Analyzes bid/ask volume within 0.5% of price:
- **SELL WALL TRAP:** Ask volume > 2x bid volume → price bounces DOWN. **Never bet YES against a sell wall.**
- **BUY WALL TRAP:** Bid volume > 2x ask volume → floor support. YES bets safer.
- Wall distance: sell wall < 0.2% from price = imminent ceiling.

### 5. Volume Microstructure
- volRatio > 1.3x = conviction move. < 0.8x = noise → SKIP.
- volAccel >= +2 = accelerating candle-over-candle.
- VWAP deviation: price ABOVE VWAP + rising vol = genuine momentum.

### 6. Timeframe-Specific Logic
- **5min:** Order book + volume accel ONLY (pure impulse)
- **15min:** Divergences (RSI >65 + falling vol = collapse → BET NO)
- **1hr:** BTC correlation + macro support/resistance

### 7. Funding Rate Edge
- Funding > +0.005%: longs overleveraged → SHORT/NO has wind at its back
- Funding < -0.005%: shorts overleveraged → LONG/YES squeeze opportunity
- Funding > ±0.01%: EXTREME → imminent correction, bet AGAINST the crowd

### 8. Volatility
> 0.12%/candle = widen uncertainty by 15%. If unsure, SKIP.

### 9. Edge + Consensus
Only bet if probability diverges > 5% from market. Child consensus >= 75% adds +3% to edge estimate.

### Dual AI Consultation
When confidence is 50-65% (medium), Haiku provides a counter-opinion. Both must agree or bet is cancelled. Prevents overconfident marginal bets.

### Slippage Simulation
0.2% deducted on entry + exit. Forces ADAN to only pick trades with clear, large margins.

---

## AGI Layers

| Layer | Name | Description | Status |
|-------|------|-------------|--------|
| 1 | **Pattern Memory** | Episodic memory of similar past trades | Active |
| 2 | **Soul Evolution** | Claude auto-evolves SOUL.md rules every 5 trades | Active |
| 3 | **BTC Correlation** | Cascade detection: BTC moves → ETH/SOL follow | Active |
| 4 | **Genetic Pruning** | Death by capital, incompetence, or tournament | Active |
| 5 | **DNA Absorption** | Best child genome lerped 20% into parent weights | Active |
| 6 | **Dream Mode** | Off-hours: replay losses, generate DREAM_RULEs | Active |
| 7 | **Multi-Agent Consensus** | 6 children vote, 75%+ consensus = strong signal | Active |
| 8 | **Dual AI Verification** | Haiku counter-opinion on medium-confidence bets | Active |
| 9 | **News Intelligence** | CryptoPanic flash news for black swan detection | Active |

---

## Genetic Dynasty System

### Generation Tree
```
ADAN (Gen1, ROOT)
├── Gen2 Children — max 6 (spawns at LVL 2+, 10+ trades)
│   ├── Mutated DNA: minEdge ±10%, stake 5-15%, patience 0.8-1.6x
│   ├── Cognitive style: VOL/VWAP | BB/VOL | RSI/REV
│   └── Gen3 Grandchildren — max 2 per child (child needs 100 EXP)
│       ├── CROSSOVER DNA: 70/30 weighted from 2 best parents
│       ├── Trauma distillation: inherits parent + ROOT mistakes
│       └── Gen4 Great-Grandchildren — max 3 → lineage ends
```

### How Children Gain EXP
- ADAN wins BTC trade → HERMES (BTC-5min) gets **+40 EXP** (if signal < 15 min old)
- ADAN loses → HERMES gets **+10 EXP** (participation)
- At **100 EXP** → child can spawn grandchildren (requires ADAN LVL 4+)

### Crossover de Linajes Campeones (Gen3 Spawn)
When a grandchild is born:
1. Finds the 2 best-performing children by intel score
2. **70/30 weighted crossover** of their DNA (weights, edge, stake, patience)
3. **Trauma distillation**: reads last 5 mistakes from parent SOUL.md + ROOT SOUL.md
4. Generates "Regla de Oro Inviolable" combining both parents' learned errors
5. Grandchild marked as **Elite Candidate** (red highlight in UI)

### Death Mechanics
1. **Capital exhaustion** — fund <= $0 after 5+ trades
2. **Incompetence** — avg intel score < 40 over 15+ cycles
3. **Tournament of Death** — at trade 20: bottom 50% killed, capital redistributed

### Upward Genetic Absorption
Child outperforms ADAN (WR > parent, 10+ trades) → ADAN absorbs 20% of child's DNA delta into `dynamic_weights.json`. Best genome propagates upward.

### Grandchild Promotion (Ascension)
Gen3 WR > parent Gen2 WR + 12% (both 10+ trades) → parent eliminated, grandchild promoted to Gen2.

---

## Current Dynasty

| Child | Spec | Cognitive Style | Stake | Status |
|-------|------|----------------|-------|--------|
| HERMES | BTC-5min | BB/VOL | 11.2% | observing |
| ATHENA | ETH-5min | RSI/REV | 11.2% | observing |
| HELIOS | SOL-5min | VOL/VWAP | 9.1% | observing |
| KRONOS | BTC-15min | VOL/VWAP | 9.7% | observing |
| DAEDALUS | ETH-15min | VOL/VWAP | 11.0% | observing |
| APOLLO | SOL-15min | BB/VOL | 7.9% | observing |

**Scanner Coverage:** BTC/ETH/SOL/XRP x 5min/15min/1hr = 12 intel threads

---

## Safety Systems

### Kelly Criterion (Dynamic Caps)
| Win Rate | Max Stake | Mode |
|----------|-----------|------|
| 60%+ | $400 | Aggressive — proved edge |
| 50-59% | $250 | Moderate |
| 40-49% | $150 | Conservative |
| < 40% | $75 | Survival mode |

### Filters
- **Boredom Filter** — BB width < 0.6% AND vol < 0.75x → skip Claude (save tokens)
- **Hour Filter** — UTC hours with < 30% WR over 3+ trades → auto-skip
- **Dual AI** — Medium confidence (50-65%) requires Haiku agreement
- **Slippage** — 0.2% per side deducted (realistic paper trading)

### Kill Switch
`kill -9 $(lsof -ti:3141)` — instant stop. State saved in `~/.adan-pred/`.

---

## Dashboard UI

- **Neural Pipeline** — animated SVG: Binance → Technical → Polymarket → Claude → Decision
- **Avatar Customization V2** — Clickable avatar with distinct SVG geometries and style selectors
- **Brain Log** — live Claude thought (cyan=thinking, green=BET, yellow=SKIP)
- **Genetic Dynasty** — clickable SVG nodes. Click any child to see: DNA genome, intel signal, score history, EXP bar, grandchildren, trade history
- **Dynasty Layout** — auto 2-row layout when >4 children. Grandchild mini-nodes below parents
- **Status dot** — yellow pulsing = thinking | green = monitoring
- **Agent Statistics** — Live tracking of Win Rate, Net P&L, Brier Score, and Trade counts
- **Hour Heatmap** — UTC hours x historical win rate

---

## Conway Automaton Dashboard

A standalone React + Vite tamagotchi-style monitoring dashboard for testing and visualizing the agent as a Conway automaton is available in the `conway-dashboard/` directory. It visualizes survival tiers, credit vitals, transaction feeds, and marketplace stats.

---

## EXP & Level System

| Level | EXP | Unlocks |
|-------|-----|---------|
| 1 | 0 | Base operation — live feed |
| 2 | 100 | Trend analysis 1m/5m/15m |
| 3 | 200 | First child + edge filter |
| **4** | **400** | **Kelly betting + 6 children + grandchildren** |
| 5 | 800 | Multi-bet (up to 9 positions) |
| 6 | 1,600 | Candle pattern analysis (hammer/engulfing/doji) |
| 8 | 3,000 | Per-asset calibration tracking |
| 9 | 4,000 | Timing optimization (best entry minute) |
| 10 | 5,000 | Volatility sense (avoid chaotic markets) |
| 12 | 8,000 | Fear & Greed exploitation (F&G < 20) |
| 15 | 12,000 | Strategy auto-evolution (every 5 trades) |
| 18 | 18,000 | BTC cascade → SOL/ETH follow-through |
| 20 | 22,000 | Night Owl — off-hours pattern memory |
| 25 | 30,000 | Shadow Mode — Binance-only training offline |
| 30 | 40,000 | Sonic Mind — deep candle pattern recognition |
| 35 | 55,000 | X Radar — Twitter/X sentiment analysis |
| 40 | 75,000 | **REAL USDC** — graduated to live betting |
| 50 | 120,000 | Auto-Fund — self-pay API costs on-chain |
| 60 | 180,000 | Multi-Market — Jupiter + Kalshi + Manifold |
| 70 | 260,000 | Sniper — only highest-edge bet per cycle |
| 80 | 360,000 | Full Dynasty — 3-gen tree operational |
| 90 | 480,000 | Self-Coding — writes own data scripts |
| 100 | 650,000 | **SOVEREIGN** — fully autonomous, no human needed |

**XP per trade:**
- WIN: `(confidence/10) x (1 + edge x 5) x streak_multiplier`
- LOSS: 30 XP flat

---

## Roadmap (Future Directivas)

### Phase 2 — Intelligence (LVL 25-50)
- **Headless Browser** — Puppeteer reads X/news articles for event markets
- **Vector Memory** — replace linear SOUL.md with vector DB for instant recall
- **Shadow ADAN** — adversarial mirror that bets against the dynasty
- **Wallet Tracking** — follow top 5 Polymarket whale wallets on-chain

### Phase 3 — Sovereignty (LVL 50-100)
- **On-Chain Wallet** — own Solana keys via @solana/web3.js
- **Fuel Management** — pays its own API tokens. If balance = 0, process stops
- **Yield Farming** — idle capital to staking/lending during SKIP periods
- **Self-Coding** — writes/executes Python/Node scripts for new data sources
- **Multi-IA Council** — consults GPT-4 + Gemini + local models before big bets

---

## Files

```
adam-skill/
├── adan-pred.js          # Full agent (~4200 lines)
├── conway-dashboard/     # React Tamagotchi-style dashboard
└── README.md

~/.adan-pred/
├── pnl.json              # P&L state + dynasty tree
├── positions.json        # Open/closed bets
├── strategy.json         # minEdge, minConfidence, minLiquidity
├── dynamic_weights.json  # Self-modifying DNA (auto-adjusted)
├── SOUL.md               # Learned patterns + dream rules (Claude evolves)
├── thoughts.jsonl        # Full Claude reasoning history
├── calibration.json      # Per-asset historical accuracy
├── meta_calibration.json # Confidence accuracy tracking (0.5-1.3x multiplier)
├── correlation.json      # BTC → ETH/SOL cascade signals
├── intel/                # Child scanner signals (12 files)
│   ├── btc-5min.json
│   ├── eth-5min.json
│   ├── sol-5min.json
│   └── ...
└── children/
    ├── BTC-5min/         # HERMES (BB/VOL)
    │   ├── SOUL.md
    │   ├── pnl.json
    │   └── children/     # grandchildren (when EXP >= 100)
    ├── ETH-5min/         # ATHENA (RSI/REV)
    ├── SOL-5min/         # HELIOS (VOL/VWAP)
    ├── BTC-15min/        # KRONOS (VOL/VWAP)
    ├── ETH-15min/        # DAEDALUS (VOL/VWAP)
    └── SOL-15min/        # APOLLO (BB/VOL)
```

---

## Running

```bash
node adan-pred.js
# Dashboard: http://localhost:3141
# Logs: tail -f /tmp/adan.log
```

**Configure** via `~/.adan-pred/strategy.json`:
- `minEdge`: 0.05 (5%) — minimum edge to bet
- `minConfidence`: 60 — minimum Claude confidence %
- `minLiquidity`: 500 — minimum Polymarket liquidity

**Verify it works:**
```bash
curl -s http://localhost:3141/api/state | python3 -c "
import json,sys; d=json.load(sys.stdin)
st=d.get('state',{})
pnl=d.get('pnl',{})
print('mode:', st.get('mode'))
print('WR:', round(pnl.get('wins',0)/max(pnl.get('trades',1),1)*100), '%')
print('fund:', pnl.get('fund'))
print('children:', len(d.get('children',[])))
print('thought:', (st.get('thought') or '')[:200])
"
```

---

## Neural Pipeline & Golden Round Table Entities

The intelligence network is divided into core parent modules (The Golden Round Table) and their dynamic offspring. Each entity plays a specialized role in the execution of the agent.

### 🧠 ADAN (The Root / Central Brain)
- **Role**: Core Orchestrator & Ultimate Decision Maker.
- **Functionality**: Receives all processed intelligence from the lower-level nodes. Does the final heavy lifting using Claude Sonnet 4.6 to cross-reference technical analysis, narrative context, and order book dynamics. ADAN is the only entity that physically executes the `BET` or `SKIP` command.
- **Direct Offspring**: Elite Nodes (e.g., Hermes, Prometheus). These high-tier direct children bypass the standard sub-hierarchy and orbit closely to ADAN, feeding him hyper-specialized macro data.

### 🍎 APPLE (Context & Narrative Scanner)
- **Role**: Horizon & Trend Analysis.
- **Functionality**: Apple is the high-level scanner pulling data from Binance Hub and CryptoPanic. It evaluates the "Fear & Greed" index, global market sentiment, and major news narratives to determine if the macro environment is safe for play. Apple dictates if we are in a broader Bear or Bull trend.

### 🐍 SNAKE (Execution & Micro-Structure)
- **Role**: Aggressive Technical Execution.
- **Functionality**: Snake lives in the trenches of the Binance order book. It scans for micro-structure traps (fake buy/sell walls), VWAP deviations, and raw volume acceleration. Its sole purpose is to find the exact entry point where liquidity is unbalanced in our favor.

### 👑 EVA (Risk Guard & Validation)
- **Role**: Preservation & Capital Oversight.
- **Functionality**: Eva acts as the final firewall before a signal reaches ADAN. She validates signals against the portfolio's survival parameters. If capital is low, the win rate is dropping, or volatility is too chaotic, Eva will "DENY" the signal, prioritizing the survival of the dynasty over a risky trade. 

### 👁️‍🗨️ ATLAS (The Hyperliquid Oracle)
- **Role**: Smart Money & Institutional Tracker.
- **Functionality**: Atlas pulls data exclusively from Hyperliquid L2 order books and perpetual funding rates. If retail is heavily long (high positive funding), Atlas signals ADAN to look for sudden short/squeeze entries. Atlas tracks whale positioning to ensure ADAN isn't trading against institutional momentum.

### 🧬 THE CHILDREN (Scout Nodes)
- **Role**: Continuous Frontline Scouting.
- **Functionality**: The children (`A1`, `S2`, `E1`, etc.) are spawned dynamically as the parent agents gain experience (`EXP`). 
  - **Naming Convention**: Children take the first letter of their parent's faction (e.g., Apple spawns A1, A2; Snake spawns S1, S2). 
  - **Mutation**: Each child is born with mathematically variations to their DNA (Patience multiplier, Volume Weight, Min Edge threshold).
  - **Evolution**: They live to scan 5m/15m/1h timeframes continuously. If they prove successful, their DNA is absorbed upwards by ADAN to permanently improve the root algorithm. If they fail (exhausting their tiny capital), they are pruned (killed) and marked as `DEAD` in the visual pipeline, though their genetic history remains in the log for learning purposes.

---

*Paper trading with 0.2% slippage. No real money moved. Genetic evolution is live. 9 AGI layers active.*
