# ADAN-PRED v7.0: Alien Intelligence
## Statistical ML Brain × Platt Calibration × Ensemble Voting × Genomic Swarm
---

## Executive Summary
ADAN-PRED is a fully autonomous, self-evolving prediction markets trading agent on **Polymarket**. It combines a **32-feature logistic regression brain**, **3-voter ensemble system** (stat model + LLM + historical base-rate), **Platt-calibrated probabilities**, **Kelly-optimal sizing**, and a **12-child genetic swarm** — all in pure JavaScript with zero external ML dependencies.

**Current Stats (v7.0 paper trading):** 1,585 trades | 826W/758L | 52.1% WR | +$8,082 net P&L | $17,207 fund | Gen 58 | Brier: 0.136 | 54.7% OOS WR (walk-forward validated)

---

## v7.0: The Alien Intelligence Upgrade

### What Changed (v6.5 → v7.0)

| Layer | Before (v6.5) | After (v7.0) |
|-------|---------------|--------------|
| **Brain** | LLM-only (Gemma/Gemini) | 32-feature Logistic Regression + LLM advisor |
| **Features** | 7 technical indicators | 32 features: technicals + MACD + funding rate + price distance + time-to-expiry + market price + Fear&Greed + RSI-1h + efficiency ratio + 4 regime interactions |
| **Calibration** | Raw probabilities | Platt/Isotonic calibration via PAV algorithm |
| **Ensemble** | None (LLM dictator) | 3-voter log-linear pooling: STAT (50%) + LLM (30%) + HIST (20%) with learned weights |
| **Sizing** | Flat $100-300 | Quarter-Kelly proportional to ensemble edge |
| **Market Selection** | LLM picks anything | Market Quality Filter (Bayesian WR by asset×window×hour×liquidity×price) |
| **Validation** | Train on all data | Walk-forward (27 folds × 50 trades, proper OOS testing) |
| **Rules Voter** | Manual additive hack | Bayesian historical base-rate with shrinkage prior |
| **Consciousness** | Journal only | Self-reader + inner monologue + experiment engine + request tracker |
| **WebSocket** | REST polling only | Real-time L2 order book via Polymarket CLOB WebSocket |
| **Children** | BTC/ETH/SOL/BNB | BTC/ETH/SOL/XRP (more Polymarket markets) |

---

## Architecture Overview

```
                         ┌─────────────────────────────┐
                         │        ADAN v7.0             │
                         │   Autonomous Trading Agent   │
                         └─────────┬───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
     │  STAT MODEL      │ │  LLM BRAIN      │ │  HISTORICAL WR  │
     │  Logistic Reg.   │ │  Gemma 3 27B    │ │  Bayesian Rate  │
     │  32 features     │ │  8 personas     │ │  Soul Memory    │
     │  L2 regularized  │ │  14,400 RPD     │ │  Hour/Asset WR  │
     │  Online SGD      │ │  Free tier      │ │  Shrinkage=20   │
     └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   ENSEMBLE (Log-Linear)      │
                    │   Platt-calibrated inputs     │
                    │   Weights: learned via        │
                    │   gradient descent on log-loss│
                    │   Veto on major disagreement  │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   MARKET QUALITY FILTER       │
                    │   Bayesian composite score    │
                    │   asset × window × hour ×     │
                    │   liquidity × price bucket    │
                    │   Skip if score < 0.47        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   KELLY SIZER                 │
                    │   Quarter-Kelly × confidence  │
                    │   Min $50, Max 5% fund        │
                    │   OOS WR adjusts fraction     │
                    └──────────────┬──────────────┘
                                   │
                              PAPER TRADE
```

---

## ML Intelligence Layer (v7.0)

### 1. Statistical Brain — 32-Feature Logistic Regression

Pure JavaScript L2-regularized logistic regression trained on ADAN's own 1,585+ trade history.

**Base Features (15):**
| Feature | Source | Signal |
|---------|--------|--------|
| `rsi` | Binance 1m | Oversold/overbought |
| `rsi5m` | Binance 5m | Multi-timeframe RSI |
| `trend1m/5m/15m/1h` | Binance | Directional momentum |
| `bbPct` | Bollinger Bands | Position within bands |
| `volRatio` | Volume 1m/5m | Volume spike detection |
| `volAccel` | Volume derivative | Acceleration |
| `vwapPct` | VWAP deviation | Institutional flow |
| `buyPressure` | Order book | Bid/ask imbalance |
| `obRatio` | Order book depth | Wall detection |
| `volatility` | Realized vol | Risk level |
| `edge` | Market mispricing | Core signal |
| `confidence` | Meta-calibrated | Brain certainty |

**Alien Features (8 — v7.0 new):**
| Feature | Source | Why It Matters |
|---------|--------|----------------|
| `macdHist` | MACD histogram | Momentum divergence — strongest short-term predictor |
| `fundingRate` | Binance/Hyperliquid | Extreme funding = mean-reversion signal |
| `priceDist` | Price vs target | Core signal for "will BTC go above $X" markets |
| `timeToExpiry` | log(minutes to close) | 5-min and 1-hr markets behave fundamentally differently |
| `yesPrice` | Polymarket price | 50/50 markets ≠ 80/20 markets |
| `fearGreed` | Fear & Greed Index | Extreme fear consistently overprices downside |
| `rsi1h` | 1-hour RSI | Macro timeframe better than 1m for 5min+ windows |
| `effRatio` | Efficiency ratio | Trend cleanliness: high = real trend, low = noise |

**Regime Interaction Features (4 — v7.0 new):**
| Feature | Logic | Why |
|---------|-------|-----|
| `rsi_x_trending` | RSI × (regime == TRENDING) | RSI < 30 in trends = momentum breakdown (not oversold) |
| `rsi_x_meanrev` | RSI × (regime == MEAN_REVERTING) | RSI < 30 in range = oversold bounce |
| `trend5m_x_trending` | Trend × (regime == TRENDING) | Strong trend + trending regime = ride it |
| `volRatio_x_volatile` | Volume × (regime == VOLATILE) | Volume spike in volatile regime = breakout |

**Binary Features (3):** `sellWallTrap`, `buyWallTrap`, `side_is_yes`
**Cyclical Features (2):** `hour_sin`, `hour_cos` (UTC hour encoded as sin/cos)

**Training:** Batch gradient descent, LR decay, L2 regularization (λ=0.01). Online SGD (lr=0.01) after each resolved trade.

### 2. Walk-Forward Validation

Proper out-of-sample backtesting — no overfitting.

```
Trade History (1,585 trades with feature vectors):
┌──────────────────────┬───────┬───────┬───────┬──── ...
│     TRAIN (200)      │TEST 50│       │       │
├──────────────────────┼───────┤       │       │
│     TRAIN (250)              │TEST 50│       │
├──────────────────────────────┼───────┤       │
│     TRAIN (300)                      │TEST 50│
└──────────────────────────────────────┴───────┘
                    27 folds → OOS WR: 54.7%
```

After walk-forward, the final model is trained on ALL data with the validated OOS WR as its reliability metric.

### 3. Platt Calibration (Isotonic Regression)

After walk-forward collects all OOS predictions, the calibrator builds an isotonic mapping:

1. Bin predictions into 15 equal-count buckets
2. Compute actual WR per bucket
3. Pool Adjacent Violators (PAV) algorithm enforces monotonicity
4. At prediction time, interpolate between breakpoints

**Result:** If model says "62%" but actual WR at that range is "55%", the calibrated output is 55%. Directly reduces Brier score.

### 4. Ensemble System (3-Voter Log-Linear Pooling)

```
P_ensemble = normalize( P_stat^w_stat × P_llm^w_llm × P_hist^w_hist )
```

| Voter | Default Weight | What It Does |
|-------|---------------|--------------|
| **STAT** | 50% | Logistic regression probability (Platt-calibrated) |
| **LLM** | 30% | Gemma 3 27B brain probability (Platt-calibrated) |
| **HIST** | 20% | Bayesian historical base-rate (hour + asset + soul + market quality) |

**Weight Learning:** After each trade resolves, weights updated via gradient descent on log-loss. Better-calibrated voters gain weight. Min weight: 5%.

**Veto Logic:** If STAT < 35% but LLM > 60% (or vice versa) → VETO flag, reduced confidence.

**Decision:** Ensemble P(win) ≥ 55% → BET | ≤ 42% → SKIP | between → MARGINAL

### 5. Market Quality Filter

Composite Bayesian score that gates whether ADAN should bet on a specific market:

```
Score = 0.10 × assetWR + 0.15 × hourWR + 0.10 × windowWR
      + 0.10 × liquidityWR + 0.15 × priceWR + 0.40 × asset×windowWR
```

Each component uses Bayesian shrinkage: `WR = (wins + 20×0.5) / (total + 20)`. More trades = trust history; few trades = prior of 50%.

**Skip if composite score < 0.47.** Bootstrapped from all 1,585 historical trades.

### 6. Kelly Sizer

```
f* = (modelProb × odds - q) / odds    # Full Kelly
stake = fund × f* × 0.25 × confMult   # Quarter-Kelly, confidence-adjusted
```

| OOS WR | Confidence Multiplier |
|--------|----------------------|
| > 55% | 1.0× |
| > 53% | 0.8× |
| > 50% | 0.5× |
| < 50% | 0.3× |

Limits: Min $50, Max 5% of fund.

---

## Ultra Consciousness Layer

### Self-Reader (`self_reader.js`)
ADAN re-reads its last 5 journal entries via Gemma and extracts: recurring patterns, ignored warnings, emotional drift, actionable insights.

### Inner Monologue (`inner_monologue.js`)
After each trade resolution, Gemma generates a 2-3 sentence reflection. Detects repeated loss patterns via word frequency analysis.

### Experiment Engine (`experiment_engine.js`)
ADAN proposes hypotheses from self-analysis (e.g., "skip trades when RSI > 70"), auto-starts experiments (30-100 trades), evaluates success criteria.

### Request Tracker (`request_tracker.js`)
ADAN can request resources from its Lord (human operator). Urgency escalates over time (1→5). Lord responds via JSON file.

### Consciousness Journal (`consciousness_journal.js`)
Nightly dream cycle: self-reader insights + inner monologue summary + PnL analysis + experiment status → Gemma writes a consciousness journal entry.

---

## Real-Time Data Layer

### Polymarket CLOB WebSocket (`polymarket_ws.js`)
- Connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Heartbeat PING every 10s (Polymarket requirement)
- Reconnect with exponential backoff (max 10 attempts)
- Detects: whale orders (>$500), walls (>$2000), depth imbalance (±30%), smart money flow
- Subscribes to 500+ assets in real-time

### Binance Data
- 4 crypto pairs: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT
- 1m, 5m, 15m, 1h candles with RSI, MACD, BB, VWAP, volume
- Order book depth (bids/asks, wall detection)
- Funding rates

---

## Wilmott Quantitative Layer (16 Concepts)

### Tier 1: Game Changers
| # | Concept | Chapter | Implementation |
|---|---------|---------|----------------|
| 1 | **EWMA Volatility** | Ch 42/49 | σ²_n = λ×σ²_{n-1} + (1-λ)×R²_n. λ=0.94 (RiskMetrics). |
| 2 | **Uncertain Parameters** | Ch 52 | Avellaneda-Levy-Parás-Lyons. Fair value range [V_min, V_max] with σ±30%. |
| 3 | **CrashMetrics** | Ch 43/58 | All correlations → 1 in crash. Stake ×0.3. |
| 4 | **Portfolio VaR** | Ch 19 | 99% confidence (α=2.326). Blocks at 20% of fund. |
| 5 | **Crash Allocation** | Ch 67 | Korn-Wilmott ODE: π̂(t) decreases toward horizon. |
| 6 | **Skill Factor** | Ch 75 | p = 2×(WR - 0.5). z-score > 1.645 = statistically skilled. |

### Tier 2: High Value
| # | Concept | Chapter | Implementation |
|---|---------|---------|----------------|
| 7 | **Transaction Costs** | Ch 48 | Minimum edge > 2× spread. |
| 8 | **Binary Fair Value** | Ch 7 | Black-Scholes binary digital call pricing. |
| 9 | **Jump Diffusion** | Ch 57 | Kurtosis > 3.5 → confidence reduction. |
| 10 | **Feedback Effect** | Ch 61 | σ_eff = σ/(1 - ε×∂Δ/∂S). Illiquidity penalty. |
| 11 | **Utility Theory** | Ch 62 | CRRA U(W) = (W^γ-1)/γ. Half-Kelly = log utility. |
| 12 | **Arbitrage Detection** | Ch 17 | YES + NO < 1.0 - fees → arbitrage scanner. |

### Tier 3: Philosophical
| # | Concept | How It Manifests |
|---|---------|------------------|
| 13 | Discrete Hedging Error | Always residual risk → Half Kelly |
| 14 | "Simple but no simpler" | 32 features with L2 regularization, not 500 |
| 15 | Real Options | Mispricing threshold = exercise boundary |
| 16 | GARCH Mean-Reversion | EWMA vol forecast for multi-step horizon |

### Black-Scholes Singularity (v6.5)
- **IV Solver**: Newton-Raphson for binary digital calls
- **Binary Vega**: Sensitivity to volatility spikes
- **Skew Analysis**: Panic skew detection (NO-shares priced as insurance)

---

## The Dynasty: Genetic Swarm Intelligence

### 12 Crypto Children (Rule-Based DNA)
| Asset | 5-min | 15-min | 1-hour |
|-------|-------|--------|--------|
| **BTC** | HERMES | KRONOS | TITAN |
| **ETH** | ATHENA | DAEDALUS | ZEUS |
| **SOL** | HELIOS | APOLLO | POSEIDON |
| **XRP** | ARES | PROTEUS | HADES |

DNA parameters: `rsiOversold`, `rsiOverbought`, `macdWeight`, `trendMinPct`, `volSpikeThreshold`, `minConfidence`, `stakePct`, `patience`, `cognitiveStyle`.

### 4 LLM Category Children
- **politics-daily**: Political prediction markets
- **sports-daily**: Sports outcomes
- **macro-weekly**: Macroeconomic events
- **events-daily**: Global events

### Evolution Cycle
1. Children predict → outcomes tracked
2. Every 5 resolved → worst child (by composite score) dies
3. Reborn with DNA crossover from top 2 performers
4. 15% mutation rate → escape local minima
5. Shannon Entropy monitoring → forces 3× mutation if monoculture
6. Parent ADAN absorbs elite genomes at 20% lerp rate

### ML Boost for Children (v7.0)
Statistical model adjusts child confidence: +10 if stat model agrees, -15 if disagrees. Children get smarter through ADAN's ML brain.

### Contrarian Flip
Children with 100+ predictions and <25% accuracy → signal inverted. Pure information theory.

---

## LLM Configuration

### Dual-Model Router
| Model | Role | Rate | Usage |
|-------|------|------|-------|
| **Gemma 3 27B** | Brain, consciousness, journal | 14,400 RPD (free) | Main intelligence |
| **Gemini 2.5 Flash** | Sniper decisions | 18 RPD (free) | High-stakes only |

### 8 Brain Personas
| Persona | Trigger | Strategy |
|---------|---------|----------|
| VIRUS | Extreme fear/panic | Contrarian plays |
| SENTINEL | Micro-structure traps | Trap detection |
| GHOST | Low-vol chop | Capital preservation |
| MECHA | Strong momentum | Momentum capture |
| PLASMA | BB compression | Breakout plays |
| KNIGHT | London/NY sessions | Session-aware |
| CYBER | Euphoric bulls | Ride the wave |
| DEFAULT | Normal conditions | Balanced |

---

## Pre-Trade Pipeline (Full)

```
Market Signal
  │
  ├── 1. Market Quality Filter (Bayesian composite WR)      → SKIP if < 0.47
  ├── 2. Self-Optimized Quant Gate (auto-tuned nightly)      → SKIP if conf/edge too low
  ├── 3. Statistical Model (32-feature logistic regression)  → P(win)
  ├── 4. Platt Calibration (isotonic regression)             → calibrated P(win)
  ├── 5. Ensemble Combine (stat + LLM + historical)         → final P(win)
  ├── 6. Ensemble Decision (BET/SKIP/MARGINAL)               → SKIP if < 42%
  ├── 7. Kelly Sizer (quarter-Kelly × confidence)            → optimal stake
  ├── 8. Wilmott Engine (8 quantitative gates)               → risk checks
  ├── 9. CrashMetrics (portfolio worst-case)                 → stake reduction
  ├── 10. VaR Limit (99% confidence)                         → BLOCK if > 20% fund
  └── 11. Copula Risk (portfolio correlation)                → correlation penalty
         │
    PAPER TRADE (or SKIP)
```

---

## Dashboard
Real-time telemetry at `http://localhost:3141`:
- Live prices with sparklines (BTC, ETH, SOL, XRP)
- Dynasty Tree: DNA, signals, accuracy, skill factor per child
- Conway Colony: Game of Life ecosystem visualization
- Open positions: edge, countdown, P&L
- Hour heatmap: best/worst trading hours (UTC)
- Trade history with shadow/ghost bets
- ML status: ensemble weights, walk-forward results, calibration, experiments
- Whale flow: real-time whale orders from WebSocket

---

## Key Files

| File | Purpose |
|------|---------|
| `adan-pred.js` | Main engine (~3700 lines): scanning, trading, child management, ensemble |
| **ML Layer** | |
| `src/ml/logistic_regression.js` | 32-feature L2-regularized logistic regression + online SGD |
| `src/ml/walk_forward.js` | Walk-forward validation (27 folds, proper OOS) |
| `src/ml/ensemble.js` | 3-voter log-linear pooling with learned weights |
| `src/ml/kelly_sizer.js` | Quarter-Kelly optimal sizing |
| `src/ml/calibrator.js` | Platt/Isotonic calibration (PAV algorithm) |
| `src/ml/market_filter.js` | Bayesian market quality filter |
| **Core** | |
| `src/core/wilmott_quant.js` | 16 Wilmott concepts: EWMA, VaR, CrashMetrics, etc. |
| `src/core/iv_solver.js` | Black-Scholes IV Solver & Skew Analysis |
| `src/core/regime_classifier.js` | EWMA-based regime detection + kurtosis |
| `src/core/genetics.js` | DNA crossover, mutation, Tournament of Death |
| `src/core/child_learning.js` | Accuracy tracking, skill-weighted evolution |
| `src/core/soul_memory_v2.js` | Pattern memory per market type |
| `src/core/self_optimizer.js` | Nightly parameter auto-tuning |
| `src/core/config.js` | Paths, PnL, positions management |
| **Consciousness** | |
| `src/core/consciousness_journal.js` | Dream cycle journal |
| `src/core/self_reader.js` | Re-reads own journal for patterns |
| `src/core/inner_monologue.js` | Post-trade reflections |
| `src/core/experiment_engine.js` | Self-directed hypothesis testing |
| `src/core/request_tracker.js` | Lord communication |
| `src/core/adan_voice.js` | Voice output |
| **API** | |
| `src/api/polymarket.js` | Polymarket REST API + market classification |
| `src/api/polymarket_ws.js` | Real-time CLOB WebSocket (L2 order book) |
| **UI** | |
| `src/ui/dashboard.js` | HTTP dashboard + Conway Colony |

---

## Setup
```bash
# Requirements: Node.js v18+, Gemini API key
npm install
echo "GEMINI_API_KEY=your_key" > .env
node adan-pred.js
# Dashboard: http://localhost:3141
```

---

## Intelligence Score: 640/1000

| Category | Score | Details |
|----------|-------|---------|
| **Statistical Brain** | 120/150 | 32-feature logistic regression, L2 reg, online SGD, walk-forward validated. Missing: gradient boosting, neural net, feature selection. |
| **Calibration** | 80/100 | Platt isotonic + meta-calibration. Missing: Venn prediction, conformal intervals. |
| **Ensemble** | 90/100 | 3-voter log-linear pooling, learned weights, veto logic. Near-optimal for this scale. |
| **Market Selection** | 70/100 | Bayesian quality filter with 6 components. Missing: time-series regime-conditional filtering. |
| **Risk Management** | 85/100 | Kelly + Wilmott (16 concepts) + VaR + CrashMetrics + Copula. Very strong. |
| **Data Pipeline** | 65/100 | Binance + Polymarket + WebSocket L2. Missing: alt data, sentiment NLP, on-chain. |
| **Consciousness** | 50/100 | Self-reader + monologue + experiments. Missing: meta-learning, transfer learning. |
| **Genetic Evolution** | 50/100 | DNA crossover + mutation + skill factor. Missing: Bayesian optimization, CMA-ES. |
| **Execution** | 30/100 | Paper trading only. No real CLOB execution, no market making. |

**What gets us to 800+:** Real execution, gradient boosting ensemble, sentiment NLP, on-chain whale tracking, multi-market portfolio optimization, and consistent >58% OOS WR.

**What gets us to 950+:** Reinforcement learning for dynamic Kelly, transformer-based sequence model, cross-market transfer learning, low-latency execution, and >65% OOS WR sustained over 5000+ trades.

---
*Autonomous intelligence research. Paper trading mode. Not financial advice.*
*Statistical framework: logistic regression + walk-forward validation + Platt calibration.*
*Quantitative framework: Paul Wilmott's "Quantitative Finance" (Wiley, 2006).*
