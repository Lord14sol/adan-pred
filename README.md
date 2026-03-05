# ADAN-PRED — Autonomous Decision Agent Node (v3.0)

> *"No es un bot. Es una entidad con algo que perder."*

ADAN is a **Darwinian Autonomous Hedge Fund** operating on Polymarket. It runs continuously, scanning global narratives, order book micro-structures, and institutional positioning to find the highest EV (Expected Value) bets. 

It is designed to systematically extract yield by targeting a consistent **52%+ Win Rate** with highly calibrated Kelly Criterion bet sizing and a dynamic **8-Brain Transition System**.

**Current Stack:** Node.js, Google AI Studio (Gemma-3-27B & Gemini-2.5-Flash), D3.js (UI).

---

## 🧠 Architecture: The Golden Round Table

ADAN evaluates markets using a 4-pillar data pipeline, fed into one of 8 specialized AI Personas (Brains). The monolithic prompt has been replaced by the `BrainTransitionManager` which dynamically swaps ADAN's active persona every 5-minute cycle based on granular market conditions.

### The 4 Data Pillars

*   🍎 **APPLE (Context Scanner):** Synthesizes CryptoPanic news feeds and Fear & Greed indices. Detects black swans BEFORE technical analysis runs.
*   🐍 **SNAKE (Execution Scanner):** Processes Binance data. Extracts raw order book imbalances, volume acceleration, and VWAP deviations within 0.5% of the mid price.
*   👁️ **ATLAS (Hyperliquid Oracle):** Fetches real-time liquidation levels, open interest, and whale limit order walls (>$500k) from L2 perpetuals.
*   👑 **EVA (Risk Guard):** The final firewall. Can unilaterally VETO any bet if capital is low, volatility is chaotic, or recent Brier Scores are poor. Evaluates the need for a secondary dual-AI check.

### The 8 Brain Switch System

| Brain | Avatar | Triggers When | Key Strategy |
|-------|--------|---------------|--------------|
| **VIRUS** | ⚗️ | Extreme Fear (F&G ≤ 22) or Severe News | Black swan predator. Biased to NO. Exploits panic overreactions. |
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

### 1. Child Agents (The Forge)
Lower-level scout nodes (e.g. `HERMES` for BTC-5min, `ATHENA` for ETH-15min) scan specific assets. If their signals align, ADAN gets a **+3% Consensus Edge** bonus. These children track their own PnL and Win Rate individually.

### 2. Tournament of Death & Gen3 Crossover
At 20 trades, the bottom 50% of child nodes in The Forge are killed based on their **Brier Score** calibration strictly. 
When two Gen2 children survive the Tournament of Death and reach 100 EXP, they cross over their DNA (Patience, Aggressiveness, Bias multipliers) using a 70/30 weighted merge. The Gen3 elite child inherits the "Trauma Rules" from both parents' `SOUL.md`.

### 3. Off-Hours Dream Mode
Once every 24 hours, during off-market hours, ADAN triggers `dreamMode`. 
The AI reviews its last 5 losing trades, reflects on its mistakes (e.g., chasing a breakout on low volume), and extracts new **DREAM_RULES**. These rules bypass standard training and are injected directly into `soul_rules.json` to alter behavior the next morning.

---

## ⚙️ AI Routing & Quota Management

ADAN has been fully migrated from Anthropic/Ollama to **Google AI Studio**. The system utilizes a hybrid model approach to handle massive API demands for free.

*   **Brain (Gemma-3-27B):** Acts as the primary workhorse, evaluating markets 24/7. Speed > 14,000 requests per day limit.
*   **Sniper (Gemini-2.5-Flash):** Deployed selectively for heavy logic evaluation, Live Mode trading, and deep Dream Mode reflection. Speed > 20 requests per day limit.

The `quota_manager.js` subsystem securely tracks RPD (Requests Per Day) and automatically triggers **Saver Mode** (falling back to Gemma entirely) if Gemini is close to exhaustion.

Additionally, `soul_manager.js` acts as a context limiter. Instead of passing ADAN's entire 500KB "Soul", it uses a mathematical similarity search to extract only the top 6 most relevant historical rules based on the active asset and timeframe.

---

## 📈 Advanced Quantitative Framework (v3.0 Addition)

In the latest v3.0 evolution, ADAN has been upgraded with a strict, math-first logic layer to penalize LLM hallucinations and enforce strict risk management before ANY trade is executed.

### Core Quant Features:
1. **Regime Classifier:** Detects 60-minute rolling volatility and trend strength (Efficiency Ratio) to classify the market as `TRENDING`, `VOLATILE`, or `MEAN_REVERTING`. 
2. **Fractional Kelly Gate:** Applies a Bayesian uncertainty penalty to bet sizing. If the LLM confidence is low (<70%), it slashes the Kelly stake to `1/8`. If confidence is supreme (>=90%), it permits a progressive `1/2` Kelly allocation.
3. **EV (Expected Value) Gate:** Replaced the legacy order entry with `Agent_evaluate_and_trade`. If the mathematically calculated Expected Value of a trade is $\le 0$ after factoring in edges and probabilities, the trade is **HARD REJECTED**, regardless of LLM conviction.
4. **Regime-Weighted Consensus:** The Child Learning nodes no longer vote democratically. Their votes are dynamically weighted by their historical accuracy *in the specific current market regime* (e.g., a child that excels in VOLATILE markets gets 2x voting power during chop).
5. **Diversity Penalty (Shannon Entropy):** During the Genetic Crossover phase of child agents, the system measures the Shannon Entropy ($H$) of the gene pool. If $H < 0.5$ (danger of monoculture), it forces a 3x mutation rate to ensure the swarm does not suffer from groupthink.

---

## 📡 The Dashboard

While the terminal node runs, ADAN serves a real-time HTTP dashboard locally at:
👉 `http://localhost:3141`

*   **Interactive Force DAG (D3.js):** Replaces static SVGs. Watch nodes (ADAN, APPLE, SNAKE, EVA, and the genetically forged children) physically interact on-screen.
*   **Dynamic Avatars:** ADAN's layout physically morphs CSS styling based on the Active Brain (CYBER = neon green, MECHA = red, GHOST = stealth dimming).
*   **Clickable Nodes:** Click any entity in the D3 network to open a detailed modal with real-time WR, PnL, lifetime edge, and DNA mutation stats.
*   **Brain Log:** Real-time stream of ADAN's internal thought process, including justifications for Brain Swaps, Vetoes from EVA, and Quota metrics.

---

## 🚀 Setup & Installation

**Prerequisites:** Node.js v18+, Google AI Studio Account.

1. Clone the repository:
```bash
git clone https://github.com/Lord14sol/adan-pred.git
cd adan-pred
npm install
```

2. Create a `.env` file in the root directory and add your Google AI Studio key:
```bash
GEMINI_API_KEY=AIzaSy...
ADAN_MODE=TRAINING   # TRAINING (Paper) or LIVE
```

3. Start ADAN:
```bash
node adan-pred.js
```
*Leave the terminal open and visit the dashboard at `http://localhost:3141`.*

### Backtest & Simulation Tools
Run the following scripts to validate strategies and test ADAN's quantitative models on historical data:
```bash
node backtest.js             # Replays ADAN's 294 raw trades through current Mother Code filters
node backtest-historical.js  # Downloads full Polymarket action history and simulates strategies
```
