# ADAN-PRED — Autonomous Decision Agent Node

> *"No es un bot. Es una entidad con algo que perder."*

ADAN is a **Darwinian Autonomous Hedge Fund** operating on Polymarket. It runs continuously, scanning global narratives, order book micro-structures, and institutional positioning to find the highest EV (Expected Value) bets. 

It is currently being engineered to join the **top 0.51% of Polymarket traders** by targeting a consistent **60%+ Win Rate** with highly calibrated Kelly Criterion bet sizing.

**Current Status:** LVL 5 · Dynasty active · 8-Brain Golden Round Table (v2.1)

---

## 🧠 Architecture: The Golden Round Table (v2.1)

ADAN evaluates markets using a 4-pillar data pipeline, which is fed into one of 8 specialized AI Personas (Brains). The monolithic prompt has been replaced by the `BrainTransitionManager` which dynamically swaps ADAN's active persona every 5-minute cycle based on market conditions.

### The 4 Data Pillars

*   🍎 **APPLE (Context Scanner):** Synthesizes CryptoPanic news feeds and Fear & Greed indices. Detects black swans BEFORE technical analysis runs.
*   🐍 **SNAKE (Execution Scanner):** Processes Binance data. Extracts raw order book imbalances, volume acceleration, and VWAP deviations within 0.5% of the mid price.
*   👁️ **ATLAS (Hyperliquid Oracle):** Fetches real-time liquidation levels, open interest, and whale limit order walls (>$500k) from L2 perpetuals.
*   👑 **EVA (Risk Guard):** The final firewall. Can unilaterally VETO any bet if capital is low, volatility is chaotic, or recent Brier Scores are poor. Evaluates the need for a secondary dual-AI check (using Haiku).

### The 8 Brain Switch System

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

## 🧬 Genetic Dynasty & AGI Layers

ADAN is not a static script. It is the root of an evolutionary tree.

### Child Agents (The Forge)
Lower-level scout nodes (e.g. `HERMES` for BTC-5min, `ATHENA` for ETH-15min) scan specific assets. If their signals align, ADAN gets a **+3% Consensus Edge** bonus. These children track their own PnL and Win Rate individually.

### Tournament of Death & Brier Scores
At 20 trades, the bottom 50% of child nodes in The Forge are killed based on their **Brier Score** calibration strictly. 

### Gen3 Crossover (Champion Lineage)
When two Gen2 children survive the Tournament of Death and reach 100 EXP, they cross over their DNA (Patience, Aggressiveness, Bias multipliers) using a 70/30 weighted merge. The Gen3 elite child inherits the "Trauma Rules" (learned mistakes) from both parents' `SOUL.md`.

### Dream Mode & Upward Absorption
During off-hours, ADAN replays losses via Claude Haiku to extract `DREAM_RULE`s into its `SOUL.md` vector memory. If a child consistently outperforms the ADAN Root (WR > parent + 5% over 10 trades), ADAN absorbs 20% of the child's optimized DNA weights.

---

## ⚙️ Technical Stack & Installation

**Core:** Node.js, `fs`, `path`  
**AI LLM:** `@anthropic-ai/sdk` (Claude 3.5 Sonnet = Main Brain, Claude Haiku = Dream Mode)  
**APIs:** Polymarket Gamma, Binance, Hyperliquid L2, CryptoPanic  
**UI/UX:** HTML5, CSS Variables, D3.js (Force DAG)  

### 1. Prerequisites
- Node.js v18+
- An Anthropic API Key (`claude-3-5-sonnet-20241022`)

### 2. Setup
```bash
git clone https://github.com/Lord14sol/adan-pred.git
cd adan-pred
npm install
```

### 3. Configuration
Set your Anthropics API key in your environment variables:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

*(Optional)* You can modify `SOUL.md` to feed ADAN pre-learned hard rules, or edit `data.json` if you want to wipe its memory and restart the Dynasty.

### 4. Running the Node
Launch the main orchestrator:
```bash
node adan-pred.js
```
The node will run continuously in the terminal, evaluating markets every 5 minutes.

---

## 📡 The Dashboard (Neo-Brutalist D3.js)

While the terminal node runs, ADAN serves a real-time HTTP dashboard locally at:
👉 `http://localhost:3141`

*   **Interactive Force DAG (D3.js):** Replaces static SVGs. Watch nodes (ADAN, APPLE, SNAKE, EVA, and the genetically forged children) physically interact on-screen. Connections turn **green** when a child's Win Rate exceeds 50%, and dead branches show a `💀 DEAD` status.
*   **6 Advanced DAG Features (Added in v3.0):**
    1. **Golden Path Toggle:** Dims dead branches to highlight the >50% WR surviving lineages.
    2. **Real-time Pulse:** Active processing nodes (e.g., APPLE, SNAKE) glow dynamically when feeding data.
    3. **Dynamic Margins:** Link thickness scales automatically by the child's Experience Points (XP).
    4. **Mutations Icons:** Displays DNA traits (⚔️ for aggressiveness, 🛡️ for patience) directly on the node title.
    5. **Drag-Lasso:** Select multiple nodes at once with your mouse to highlight their lines.
    6. **Double-Click Auto-Center:** Zooms and pans automatically to perfectly center a node.
*   **Dynamic Avatar:** ADAN's 128x128 pixel art explicitly morphs CSS styling based on the Active Brain (CYBER = neon green, MECHA = red, GHOST = stealth dimming, etc.).
*   **Clickable Nodes:** Click any entity in the D3 network to open a detailed modal with real-time WR, PnL, lifetime edge, and DNA mutation stats.
*   **Brain Log:** Real-time stream of ADAN's internal thought process, including justifications for Brain Swaps, Vetoes from EVA, and HyperLiquid flows from ATLAS.

---

## 🛡️ Risk & Capital Engines (Master Plan v3.0 Phase 1 Complete)

ADAN natively limits its own exposure through two critical Risk Engines implemented in the pipeline:

1. **Capital Lockup Manager:** Enforces a rigid 60% maximum treasury utilization limit. If ADAN tries to deploy capital that breaks this ceiling, EVA unilaterally aborts the scan, forcing the system to preserve cash until open markets resolve.
2. **Nightmare Slippage Engine:** To simulate real-world Polymarket Order Book dynamics without burning actual cash, ADAN artificially deducts a 1.5% penalty per side (3% round-trip) from all theoretical PnL resolutions and Expected Value (EV) edge thresholds. This forces the AGI to only take highly asymmetric bets.

---

## 🚀 MASTER PLAN v3.0 ROADMAP 

ADAN is currently executing **Phase 2** of its roadmap toward a 60% WR. Next steps:

### Pending (Next Week)
- 💤 **Dream Mode v2:** Enforce strict error categorization (Over/Under weighted signals) during post-mortem analysis.

### Pending (Month 2 & 3: Graduation)
- 🧬 **3-Chromosome Mutations:** Aggressiveness (`stake_multiplier`), Patience (`confirmation_delay`), and Bias (`weight_bias`).
- 🏆 **Brier Score Mutations:** Evolve agents strictly based on calibration precision, not just raw Win Rate.
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
