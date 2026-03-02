# ADAN-PRED — Autonomous Decision Agent Node

> *"No es un bot. Es una entidad con algo que perder."*
> **Stack:** Node.js · Binance API · Polymarket Gamma API · Hyperliquid L2 · Claude Sonnet 4.6 · CryptoPanic

---

## What Is ADAN?

ADAN is a **Darwinian Autonomous Hedge Fund** operating on Polymarket. It runs continuously, scanning global narratives, order book micro-structures, and institutional positioning to find the highest EV (Expected Value) bets. 

It is currently being engineered to join the **top 0.51% of Polymarket traders** by targeting a consistent **60%+ Win Rate** with highly calibrated Kelly Criterion bet sizing.

**Current Status:** LVL 5 · Dynasty active · 8-Brain Golden Round Table (v2.1)

---

## Architecture: The Golden Round Table (v2.1)

ADAN evaluates markets using a 4-pillar data pipeline, which is fed into one of 8 specialized AI Personas (Brains).

### 1. The 4 Data Pillars

*   🍎 **APPLE (Context Scanner):** Synthesizes CryptoPanic news feeds and Fear & Greed indices. Detects black swans BEFORE technical analysis runs.
*   🐍 **SNAKE (Execution Scanner):** Processes Binance data. Extracts raw order book imbalances, volume acceleration, and VWAP deviations within 0.5% of the mid price.
*   👁️ **ATLAS (Hyperliquid Oracle):** Fetches real-time liquidation levels, open interest, and whale limit order walls (>$500k) from L2 perpetuals.
*   👑 **EVA (Risk Guard):** The final firewall. Can unilaterally VETO any bet if capital is low, volatility is chaotic, or recent Brier Scores are poor. Evaluates the need for a secondary dual-AI check (using Haiku).

### 2. The 8 Brain Switch System

Instead of a monolithic prompt, `BrainTransitionManager` evaluates the 4 pillars and dynamically swaps ADAN's active persona every 5-minute cycle based on market conditions.

| Brain | Avatar | Triggers When | Key Strategy |
|-------|--------|---------------|--------------|
| **VIRUS** | 🌿 | Extreme Fear (F&G ≤ 22) or Severe News | Black swan predator. Biased to NO. Exploits panic overreactions. |
| **SENTINEL** | 🛡️ | Massive Order Book Imbalance (e.g. 2.5x sell walls) | Trap detector. Heavy reliance on SNAKE execution data. |
| **GHOST** | 👻 | Flat markets (BB < 0.4% AND Vol < 0.65x) | Capital protector. Extremely high confidence thresholds. Defaults to SKIP. |
| **MECHA** | 🤖 | High Volume (Vol ≥ 1.8x) AND extreme funding | Momentum crusher. Rides strong trends and squeezes. |
| **PLASMA** | 🔮 | BB compressed for 2+ consecutive cycles | Breakout anticipator. Uses ATLAS Open Interest to predict fakeouts. |
| **KNIGHT** | ⚔️ | London/NY institutional hours (13-17 UTC) | Trades strictly around the VWAP. Tracks institutional flow. |
| **CYBER** | 💚 | Extreme Greed (F&G ≥ 68) + BTC Bullish | Bull market specialist. Maximizes leverage on YES during euphoria. |
| **DEFAULT** | 🔵 | No extreme conditions detected | Standard 9-step balanced logical analyst. |

---

## AGI Layers & Safety Systems

| Layer | System | Description |
|-------|--------|-------------|
| 1 | **Kelly Capital Sizing** | Bets max $400 (Aggressive mode) scaling down to $75 based on dynamic Edge & WR. |
| 2 | **Tournament of Death** | At 20 trades, bottom 50% of child nodes are killed based on their **Brier Score** calibration. |
| 3 | **Dream Mode (Layer 6)** | During off-hours, ADAN replays losses via Claude to extract `DREAM_RULE`s into its `SOUL.md` vector memory. |
| 4 | **BTC Correlation Guards** | ETH/SOL/XRP are mathematically prohibited from YES bets when the BTC 5m trend is falling. |
| 5 | **Slippage Simulation** | Deducts 0.2% on entry/exit to force ADAN to only pick trades with clear, undeniable margins. |

---

## Genetic Dynasty System

ADAN is not a static script. It is the root of an evolutionary tree.

### 🧬 Child Agents
Lower-level scout nodes (e.g. `HERMES` for BTC-5min, `ATHENA` for ETH-15min) scan specific assets. If their signals align, ADAN gets a +3% Consensus Edge bonus.

### ⚔️ Gen3 Crossover (Champion Lineage)
When two Gen2 children survive the Tournament of Death and reach 100 EXP, they cross over their DNA (Patience, Aggressiveness, Bias multipliers) using a 70/30 weighted merge. The Gen3 elite child inherits the "Trauma Rules" (learned mistakes) from both parents' `SOUL.md`.

### ⬆️ Upward Genetic Absorption
If a child consistently outperforms the ADAN Root (WR > parent + 5% over 10 trades), ADAN absorbs 20% of the child's optimized DNA weights. The best genomes rise to the top.

---

## The Dashboard (Neo-Brutalist / Game of Life)

`http://localhost:3141`

- **Visual Pipeline:** Animated data flow from Binance/Hyperliquid → Sub-nodes → ADAN.
- **Dynamic Avatar:** ADAN's 128x128 pixel art explicitly morphs based on the Active Brain (CYBER, MECHA, VIRUS, etc.).
- **Clickable Nodes:** Click any entity in the Dynasty tree (The Forge) or the Neural Map to view real-time WR, PnL, lifetime edge, and DNA mutation stats.
- **Brain Log:** Real-time stream of ADAN's internal thought process, including justifications for Brain Swaps and Vetoes from EVA.

---

## MASTER PLAN v3.0 ROADMAP 🚀

ADAN is currently executing **Phase 1** of its roadmap toward a 60% WR. Next steps:

### Next Week
- 🔒 **Capital Lockup Manager:** Limit utilization to 60% so Kelly Criterion logic accurately accounts for tied-up funds.
- 📉 **Nightmare Slippage Engine:** Simulate 1%-2.5% severe slippage for low-liquidity Polymarket assets to over-train ADAN's resilience.
- 💤 **Dream Mode v2:** Enforce strict error categorization (Over/Under weighted signals) during post-mortem analysis.

### Month 2 (The Evolution Update)
- 🧬 **3-Chromosome Mutations:** Aggressiveness (`stake_multiplier`), Patience (`confirmation_delay`), and Bias (`weight_bias`).
- 🕸️ **D3.js Force DAG:** Upgrade the static SVG Dynasty Tree to an interactive, physics-based Directed Acyclic Graph.
- 🏆 **Brier Score Mutations:** Evolve agents strictly based on calibration precision, not just raw Win Rate.

### Phase 2 & 3 (Graduation / Mainnet LVL 40+)
- 🐋 **Whale Wallet Tracker:** Track the top 5 Polymarket Polygon wallets via RPC and echo their positioning.
- ⚖️ **Cross-Platform Arbitrage:** Detect risk-free 7%+ spreads between Polymarket and Kalshi.
- 💵 **Real USDC Injection:** Transition from Paper to Live Beta.

---

## Running ADAN

```bash
node adan-pred.js
# Dashboard available at http://localhost:3141
```

*Note: You must have an `ANTHROPIC_API_KEY` exported in your environment.*
