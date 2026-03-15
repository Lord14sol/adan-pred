# ADAN-PRED v8.0: Scientific Trading Intelligence
## 4-Layer ML Brain × 14 Scientific Concepts × MoE Dynasty × Autonomous Evolution
---

## Executive Summary
ADAN-PRED is a fully autonomous, self-evolving prediction markets trading agent on **Polymarket**. It combines a **32-feature logistic regression brain**, **4-voter ensemble system** (stat model + LLM + historical + online learner), **Platt-calibrated probabilities**, **Kelly-optimal sizing with 9 multipliers**, a **12-child MoE genetic swarm**, and **14 integrated scientific concepts** — all in pure JavaScript with zero external ML dependencies.

**Current Stats (v8.0 paper trading):** 1,647 trades | 864W/783L | 52.5% WR | +$12,099 net P&L | $22,099 fund | Peak $23,552 | Gen 94 | Brier: 0.136

---

## v8.0: The Scientific Intelligence Upgrade

### What Changed (v7.0 → v8.0)

| Layer | Before (v7.0) | After (v8.0) |
|-------|---------------|--------------|
| **Ensemble** | 3-voter (stat + LLM + hist) | 4-voter: + Online Learner (#16) with exponential decay |
| **Children** | Simple majority vote | MoE Dynasty (#10): softmax gating, auto-specialization |
| **Hour Filter** | Boolean skip (WR < threshold) | Bin Counting (#12C): continuous log-odds with Laplace smoothing |
| **Regime Detection** | EWMA-only | + K-Means Clustering (#12D): 3 clusters from 5 features |
| **Order Flow** | Basic imbalance | PIN Score (#14): order flow toxicity + momentum detection |
| **Order Book** | Wall detection only | L2 Tensor (#8A): wall_score + imbalance_ratio + depth_score |
| **Market Selection** | Quality filter only | UCB Explorer (#8C): UCB1 bandit + blacklisting |
| **Risk Management** | 5 multipliers | 9 multipliers: + time_decay + kmeans + bin_count + markovian |
| **State Tracking** | Streak counter | Markovian State (#8D): 5 state vars, 4 hard risk gates |
| **Sentiment** | CryptoPanic titles | + VADER Sentiment (#3): compound scores, BLACK_SWAN detection |
| **Feature Transform** | Raw values | Log Transform (#12A): Math.log1p() on volumes |
| **LLM Output** | Regex parsing | Conformal Prediction (#17): JSON-first parser, norm01, anti-bias |
| **Evolution** | DNA crossover only | Evolution Strategies (#2): 20-vector ES with Sharpe fitness |
| **Feature Analysis** | Weight magnitude | Shapley Values (#7): Monte Carlo permutation importance |
| **TTC Filter** | Hard 1h cutoff | Time-to-Close (#21): 5min/15min exemptions, graduated decay |
| **Voice** | Streaks + milestones | + MoE, K-Means, PIN, Online Learner, ES, Shapley reports |

---

## Architecture Overview

```
                         ┌─────────────────────────────┐
                         │        ADAN v8.0             │
                         │   Scientific Trading Agent   │
                         └─────────┬───────────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                          │                            │
┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐  ┌───────▼───────┐
│ STAT MODEL   │  │ LLM BRAIN     │  │ HISTORICAL   │  │ ONLINE LEARNER│
│ LogReg 32ft  │  │ Gemma/Gemini  │  │ Bayesian WR  │  │ SGD + decay   │
│ L2 + Platt   │  │ 8 personas    │  │ BinCount+Soul│  │ λ=0.995       │
└──────┬──────┘  └───────┬───────┘  └──────┬──────┘  └───────┬───────┘
       │                  │                 │                  │
       └──────────────────┼─────────────────┼──────────────────┘
                          │                 │
           ┌──────────────▼─────────────────▼──────────────┐
           │        ENSEMBLE (Log-Linear Pooling)           │
           │   Platt-calibrated × Learned weights × Veto    │
           └──────────────────────┬────────────────────────┘
                                  │
           ┌──────────────────────▼────────────────────────┐
           │             RISK PIPELINE (9 gates)            │
           │  Kelly × session × metabolic × particle ×      │
           │  copula × wilmott × IV × timeDecay ×           │
           │  kmeansRegime × binCountHour                   │
           └──────────────────────┬────────────────────────┘
                                  │
           ┌──────────────────────▼────────────────────────┐
           │          MARKOVIAN STATE GATE (#8D)            │
           │  positions_open ≤ 3 | drawdown < 20%          │
           │  loss_streak ≥ 3 → cap $75 | exposure gate    │
           └──────────────────────┬────────────────────────┘
                                  │
                            PAPER TRADE
```

---

## Scientific Concepts (14 Integrated)

### Concept #2: Evolution Strategies (ES)
**File:** `src/ml/evolution_strategies.js`

Population of N=20 parameter vectors evolved using OpenAI-style ES:
- Parameters: `kellyBase`, `edgeMin`, `confidenceFloor`, `regimeWeight`, `hourWeight`, `momentumDecay`
- Fitness function: Sharpe ratio over last 200 trades
- Update: `θ_new = θ_old + α × (1/Nσ) × Σ(ε_i × fitness_i)`
- Gaussian noise σ=0.02, learning rate α=0.01
- Runs per Dream cycle, persists to `~/.adan-pred/evolution_params.json`

### Concept #3: VADER Sentiment Analysis
**Integrated in:** `adan-brain-complete.js` (APPLE module)

- Uses `vader-sentiment` npm package on CryptoPanic headlines
- Computes average compound score across all headlines
- Signal classification: `BLACK_SWAN` (< -0.7), `STRONG_BULLISH` (> 0.6), `BEARISH` (< -0.3), `BULLISH` (> 0.3), `NEUTRAL`
- BLACK_SWAN overrides all technical analysis

### Concept #7: Shapley Value Feature Importance
**File:** `src/ml/shapley_values.js`

Monte Carlo approximation of Shapley values:
- M=100 random permutations per feature
- Marginal contribution = accuracy_with - accuracy_without
- Identifies TOP features (Shapley > 0.01), HARMFUL features (negative), IRRELEVANT (|Shapley| < 0.001)
- Runs per Dream cycle on last 500 trades
- Persists to `~/.adan-pred/shapley_values.json`

### Concept #8A: L2 Tensor (Order Book Intelligence)
**Integrated in:** `adan-pred.js` (fetchOrderBookWalls)

Three metrics from Level 2 order book depth:
| Metric | Formula | Signal |
|--------|---------|--------|
| `wall_score` | Cluster density of large ask orders | Resistance strength |
| `imbalance_ratio` | ask_volume / bid_volume | > 1 = sell pressure |
| `depth_score` | Liquidity concentration near mid price | Stability indicator |

### Concept #8C: UCB Market Explorer
**File:** `src/ml/ucb_explorer.js`

Upper Confidence Bound (UCB1) for market selection:
```
ucb_score = avg_edge + 2.0 × √(log(N) / n_market)
```
- Per-market tracking of trades, wins, edge
- Blacklisting: WR < 40% after 15 trades → 30-day ban
- Exploration flag: < 5 trades on a market
- Exploration cap: 3% of fund
- Persists to `~/.adan-pred/market_explorer.json`

### Concept #8D: Markovian State Tracker
**Integrated in:** `adan-pred.js` (computeMarkovianState)

5 state variables computed every cycle:
| Variable | Gate Rule |
|----------|-----------|
| `positions_open` | ≥ 3 → block new bets |
| `capital_deployed_pct` | > 40% → Kelly on free capital only |
| `consecutive_losses` | ≥ 3 → cap stake at $75 |
| `hours_since_last_win` | Context for brain prompt |
| `current_drawdown_pct` | > 20% → Dream Mode + full stop |

### Concept #10: Mixture of Experts Dynasty (MoE)
**File:** `src/core/moe_dynasty.js`

Replaces simple majority voting for the 12 children:
- Each child is a specialized expert with a gating weight
- Gating network: softmax over composite score (50% WR + 30% inv-Brier + 20% edge accuracy)
- Combined prediction: `P = Σ(gate_weight_i × expert_prediction_i)`
- Weight update per trade: correct → `+= η × (1 - w)`, wrong → `×= (1 - η)`, η=0.05
- Auto-specialization after 50 trades (best BTC child, best ETH child, etc.)
- Persists to `~/.adan-pred/moe_weights.json`

### Concept #12A: Log Transform
**Integrated in:** `adan-brain-complete.js` (SNAKE) + `src/api/binance.js`

`Math.log1p()` applied to raw volumes only (not RSI, BB, funding):
- `volumeLog = Math.log1p(rawVolume)`
- `bidVolLog = Math.log1p(bidVolume)`
- `askVolLog = Math.log1p(askVolume)`

Prevents volume outliers from dominating feature vectors.

### Concept #12C: Bin Counting Hour Filter
**Integrated in:** `adan-pred.js` (3 locations)

Replaces boolean hour filter with continuous log-odds score:
```javascript
pWin = (wins + 1) / (total + 2)   // Laplace smoothing
score = log(pWin / (1 - pWin))     // Log-odds
```

| Score | Kelly Multiplier | Action |
|-------|-----------------|--------|
| > 0.3 | ×1.1 | Winning hour bonus |
| < -0.3 | ×0.7 | Losing hour penalty |
| < -1.0 | SKIP | Toxic hour, hard skip |
| else | ×1.0 | Neutral |

Also used in ensemble voter (Laplace-smoothed pWin replaces raw WR).

### Concept #12D: K-Means Regime Detector
**File:** `src/core/regime_detector.js`

Pure Node.js K-Means clustering into 3 regimes:
- **Features:** volatility, volume_ratio, trend_strength, bb_width, efficiency_ratio
- **Initialization:** k-means++ for stable convergence
- **Window:** 200-sample rolling, retrained every 50 new samples
- **Regime Labels:** Assigned by volatility characteristics:
  - `TRENDING` → Kelly ×1.0
  - `RANGING` → Kelly ×0.5
  - `EVENT` → Kelly ×0 (ALL bets VETOED)
- Persists to `~/.adan-pred/market_regime.json`

### Concept #14: PIN Score (Order Flow Toxicity)
**File:** `src/core/pin_score.js`

Probability of Informed Trading proxy from order book:
- Bid/ask volume imbalance → PIN estimate
- Momentum detection: 3+ consecutive same-direction imbalances
- Signal classification:
  - `STRONG_INFORMED` (> 0.6): follow momentum direction
  - `MODERATE` (> 0.3): confirm with technicals
  - `NOISE` (< 0.3): ignore
- Persists to `~/.adan-pred/pin_scores.json`

### Concept #16: Online Learning (SGD)
**File:** `src/ml/online_learner.js`

Stochastic Gradient Descent after every resolved trade:
- Same feature vector as logistic regression
- Exponential decay: `weight_t = 0.995^(T-t)` (recent trades matter more)
- Adaptive learning rate: `η_t = 0.01 / (1 + 0.001 × t)`
- L2 regularization (λ=0.01)
- Tracks: onlineWR, onlineBrier, onlineLogLoss
- Auto-promote: if online WR > batch WR by 2% over last 100 trades → flag
- 4th voter in ensemble system

### Concept #17: Conformal Prediction (JSON Parser)
**Integrated in:** `adan-brain-complete.js` (parseDecision)

JSON-first extraction with scale normalization:
```javascript
const norm01 = (v) => {
    if (v > 1) return v / 100;  // 68 → 0.68
    return v;
};
```
- Tries JSON block first, regex fallback only if JSON fails
- Sanity bounds: probability ∈ [0.01, 0.99], edge ∈ [-0.5, 0.5]
- Anti-bias notice injected into prompt: "You bet NO 83% of the time. This is a BIAS."

### Concept #21: Time-to-Close (TTC) Filter
**Integrated in:** `adan-pred.js` (getTimeDecayFactor)

Graduated decay based on market closing time:
- **5min/15min crypto markets** (detected by title): allowed with > 1 minute remaining
  - TTC < 2min → ×0.7 decay
  - TTC ≥ 2min → ×1.0 (full conviction)
- **Long-term markets**: strict TTC rules
  - < 1h → ×0.7 + min 3% edge
  - < 4h → ×0.85 + min 2% edge
  - > 24h → ×1.0

---

## ML Intelligence Layer

### 1. Statistical Brain — 32-Feature Logistic Regression

Pure JavaScript L2-regularized logistic regression trained on ADAN's own 1,647+ trade history.

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

**Alien Features (8):**
`macdHist`, `fundingRate`, `priceDist`, `timeToExpiry`, `yesPrice`, `fearGreed`, `rsi1h`, `effRatio`

**Regime Interaction Features (4):**
`rsi_x_trending`, `rsi_x_meanrev`, `trend5m_x_trending`, `volRatio_x_volatile`

**Binary (3) + Cyclical (2) + L2 Tensor (3):** `sellWallTrap`, `buyWallTrap`, `side_is_yes`, `hour_sin`, `hour_cos`, `wall_score`, `imbalance_ratio`, `depth_score`

### 2. 4-Voter Ensemble System

```
P_ensemble = normalize(P_stat^w1 × P_llm^w2 × P_hist^w3 × P_online^w4)
```

| Voter | Weight | Source |
|-------|--------|--------|
| **STAT** | 50% | Logistic regression (Platt-calibrated) |
| **LLM** | 30% | Gemma/Gemini (Platt-calibrated) |
| **HIST** | 15% | Bayesian base-rate (bin count + asset + soul) |
| **ONLINE** | 5% | Online SGD learner (adaptive) |

### 3. Kelly Sizer with 9 Multipliers

```
stake = baseKelly × human × session × metabolic × particle × copula ×
        wilmott × IV × timeDecay × kmeansRegime × binCountHour
```

---

## The Dynasty: MoE Genetic Swarm

### 12 Crypto Children (Expert Specialization)
| Asset | 5-min | 15-min | 1-hour |
|-------|-------|--------|--------|
| **BTC** | HERMES | KRONOS | TITAN |
| **ETH** | ATHENA | DAEDALUS | ZEUS |
| **SOL** | HELIOS | APOLLO | POSEIDON |
| **XRP** | ARES | PROTEUS | HADES |

### MoE Gating (v8.0)
- Each child has a learned gate weight (softmax-normalized)
- Correct prediction → weight increases (+η)
- Wrong prediction → weight decays (×(1-η))
- Auto-specialization: best ETH expert, best 5min expert, etc.
- Combined prediction replaces simple majority vote

### Evolution Strategies (v8.0)
- 20 parameter vectors evolved with Gaussian noise
- Fitness = Sharpe ratio over 200 trades
- OpenAI-style ES update rule
- Runs per Dream cycle

### 4 LLM Category Children
- **politics-daily**, **sports-daily**, **macro-weekly**, **events-daily**

---

## Risk Management Stack

| Layer | Concept | Action |
|-------|---------|--------|
| Markovian Gate | 3 open positions | Block new bets |
| Markovian Gate | Drawdown > 20% | Dream Mode + full stop |
| Markovian Gate | 3+ consecutive losses | Cap stake at $75 |
| K-Means Regime | EVENT detected | Veto ALL bets |
| K-Means Regime | RANGING | Kelly ×0.5 |
| Bin Count Hour | Log-odds < -1.0 | Skip toxic hour |
| TTC Filter | < 1 min remaining | Block bet |
| Wilmott Engine | 16 quantitative checks | Various |
| CrashMetrics | Correlation spike | Stake ×0.3 |
| VaR Limit | 99% confidence | Block if > 20% fund |
| Copula Risk | Portfolio correlation | Penalty |

---

## Real-Time Data Layer

### Perception Stack
| Source | Data | Module |
|--------|------|--------|
| Binance | 1m/5m/15m/1h candles, order book L2, funding rates, VWAP | `src/api/binance.js` |
| Polymarket CLOB WS | Real-time L2 order book, whale orders, depth | `src/api/polymarket_ws.js` |
| CryptoPanic | News headlines + VADER sentiment | APPLE module |
| Fear & Greed Index | Market sentiment (0-100) | `src/api/binance.js` |
| HyperLiquid | ATLAS cross-exchange intelligence | ATLAS module |
| PIN Score | Order flow toxicity per symbol | `src/core/pin_score.js` |

---

## Wilmott Quantitative Layer (16 Concepts)

### Tier 1: Game Changers
| # | Concept | Implementation |
|---|---------|----------------|
| 1 | EWMA Volatility | σ²_n = λ×σ²_{n-1} + (1-λ)×R²_n, λ=0.94 |
| 2 | Uncertain Parameters | Fair value range [V_min, V_max] with σ±30% |
| 3 | CrashMetrics | All correlations → 1 in crash. Stake ×0.3 |
| 4 | Portfolio VaR | 99% confidence (α=2.326). Blocks at 20% fund |
| 5 | Crash Allocation | Korn-Wilmott ODE: π̂(t) decreasing |
| 6 | Skill Factor | z-score > 1.645 = statistically skilled |

### Tier 2: High Value
| # | Concept | Implementation |
|---|---------|----------------|
| 7 | Transaction Costs | Min edge > 2× spread |
| 8 | Binary Fair Value | Black-Scholes binary digital call pricing |
| 9 | Jump Diffusion | Kurtosis > 3.5 → confidence reduction |
| 10 | Feedback Effect | σ_eff = σ/(1 - ε×∂Δ/∂S) |
| 11 | Utility Theory | CRRA, Half-Kelly = log utility |
| 12 | Arbitrage Detection | YES + NO < 1.0 - fees → scanner |

### Black-Scholes Singularity (v6.5)
- IV Solver: Newton-Raphson for binary digital calls
- Binary Vega: Sensitivity to volatility spikes
- Skew Analysis: Panic skew detection

---

## ADAN Voice System

ADAN communicates with Lord through `~/.adan-pred/lord_messages.json`:

| Trigger | Type | Example |
|---------|------|---------|
| 5+ win streak | insight | "7 wins in a row! Strategy working." |
| 5+ loss streak | warning | "On a 6-trade losing streak. Consider pausing." |
| Every 100 trades | milestone | "Reached 1600 trades. WR: 52.4%." |
| Fund < $8000 | fear | "Fund dropped. Risk of ruin increasing." |
| Every 50 trades | insight | MoE Dynasty, K-Means regime, PIN Score, Online Learner, ES, Shapley status |
| Meta-calib < 0.80 | request | "I'm very overconfident. Need adjustment." |

---

## Dashboard
Real-time telemetry at `http://localhost:3141`:
- Live prices with sparklines (BTC, ETH, SOL, XRP)
- Dynasty Tree with MoE gate weights and specializations
- Open positions: edge, countdown, P&L
- Hour heatmap with bin count log-odds scores
- Trade history with shadow/ghost bets
- ML status: ensemble weights, walk-forward, calibration, online learner
- Voice messages from ADAN
- K-Means regime indicator
- PIN Score alerts

---

## Key Files

| File | Purpose |
|------|---------|
| `adan-pred.js` | Main engine (~4300 lines): scanning, trading, ensemble, risk |
| `adan-brain-complete.js` | LLM brain: 8 personas, prompt builder, JSON parser |
| `force_dream.js` | Manual dream cycle trigger |
| **ML Layer** | |
| `src/ml/logistic_regression.js` | 32-feature L2-regularized logistic regression |
| `src/ml/walk_forward.js` | Walk-forward validation (27 folds, proper OOS) |
| `src/ml/ensemble.js` | 4-voter log-linear pooling with learned weights |
| `src/ml/kelly_sizer.js` | Quarter-Kelly optimal sizing |
| `src/ml/calibrator.js` | Platt/Isotonic calibration (PAV algorithm) |
| `src/ml/market_filter.js` | Bayesian market quality filter |
| `src/ml/online_learner.js` | **NEW** Online SGD learner with exponential decay |
| `src/ml/evolution_strategies.js` | **NEW** 20-vector ES with Sharpe fitness |
| `src/ml/shapley_values.js` | **NEW** Monte Carlo Shapley feature importance |
| `src/ml/ucb_explorer.js` | **NEW** UCB1 market selection bandit |
| **Core** | |
| `src/core/wilmott_quant.js` | 16 Wilmott concepts: EWMA, VaR, CrashMetrics |
| `src/core/iv_solver.js` | Black-Scholes IV Solver & Skew Analysis |
| `src/core/regime_classifier.js` | EWMA-based regime detection + kurtosis |
| `src/core/regime_detector.js` | **NEW** K-Means clustering regime detector |
| `src/core/pin_score.js` | **NEW** PIN Score order flow toxicity tracker |
| `src/core/moe_dynasty.js` | **NEW** Mixture of Experts gating for children |
| `src/core/genetics.js` | DNA crossover, mutation, Tournament of Death |
| `src/core/child_learning.js` | Accuracy tracking + MoE weight updates |
| `src/core/soul_memory_v2.js` | Pattern memory per market type |
| `src/core/self_optimizer.js` | Nightly parameter auto-tuning |
| `src/core/config.js` | Paths, PnL, positions management |
| **Consciousness** | |
| `src/core/consciousness_journal.js` | Dream cycle journal |
| `src/core/self_reader.js` | Re-reads own journal for patterns |
| `src/core/inner_monologue.js` | Post-trade reflections |
| `src/core/experiment_engine.js` | Self-directed hypothesis testing |
| `src/core/request_tracker.js` | Lord communication |
| `src/core/adan_voice.js` | Voice output + system status reports |
| **API** | |
| `src/api/polymarket.js` | Polymarket REST API + market classification |
| `src/api/polymarket_ws.js` | Real-time CLOB WebSocket (L2 order book) |
| `src/api/binance.js` | Binance candles, order book, funding, VWAP |
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

## Intelligence Score: 780/1000

| Category | Score | Details |
|----------|-------|---------|
| **Statistical Brain** | 130/150 | 32-feature LogReg + Online SGD + walk-forward + Shapley feature analysis. Missing: XGBoost, neural net. |
| **Calibration** | 85/100 | Platt isotonic + meta-calibration + conformal JSON parser. |
| **Ensemble** | 95/100 | 4-voter log-linear pooling + learned weights + veto + online learner. |
| **Market Selection** | 85/100 | Bayesian quality filter + UCB Explorer bandit + blacklisting. |
| **Risk Management** | 95/100 | Kelly (9 mult) + Wilmott (16) + VaR + CrashMetrics + Copula + Markovian (4 gates) + K-Means regime veto. |
| **Data Pipeline** | 80/100 | Binance + Polymarket WS + CryptoPanic + VADER + Fear&Greed + PIN Score + L2 Tensor. Missing: on-chain. |
| **Consciousness** | 55/100 | Self-reader + monologue + experiments + voice (7 report types). Missing: meta-learning. |
| **Genetic Evolution** | 75/100 | MoE Dynasty + Evolution Strategies + Shapley pruning. Missing: CMA-ES. |
| **Execution** | 30/100 | Paper trading only. No real CLOB execution. |

**What gets us to 900+:** CNN/LSTM/XGBoost (Python microservice), whale wallet tracking, real CLOB execution, and >58% WR sustained.

**What gets us to 950+:** Reinforcement learning, transformer sequence model, cross-market transfer learning, and >65% WR over 5000+ trades.

---

## Pending Concepts (Roadmap)

| # | Concept | Requirement | Priority |
|---|---------|-------------|----------|
| 1 | CNN 1D Multivariate | Python microservice | HIGH |
| 4 | DQN Trading Environment | Python + RL | HIGH |
| 5 | LSTM Regime Detector | Python + TensorFlow | HIGH |
| 6 | XGBoost Ensemble | Python + XGBoost | HIGH |
| 9 | Whale Wallet Tracker | On-chain API | MEDIUM |
| 15 | ADAN-SHADOW (adversarial) | Node.js twin | MEDIUM |
| 20 | López de Prado Financial ML | Node.js possible | MEDIUM |
| 18 | Infrastructure (PostgreSQL, Docker) | DevOps | LOW |
| 19 | Arbitrage Cross-Venue | Additional APIs | LOW |
| 11 | Ephemeral Coding | LVL 25+ gate | GATED |
| 13 | Mempool Reader | WR>62% + fund>$30k | GATED |

---
*Autonomous intelligence research. Paper trading mode. Not financial advice.*
*Statistical framework: logistic regression + walk-forward validation + Platt calibration.*
*Quantitative framework: Paul Wilmott's "Quantitative Finance" (Wiley, 2006).*
*Scientific concepts: VADER, K-Means, UCB1, Shapley, Evolution Strategies, PIN, MoE, Markov.*
