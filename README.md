# ADAN-PRED v8.4: Distributed Intelligence + Scenario Forecaster + Critical Calibration Fixes
## 4-Layer ML Brain × 24 Scientific Concepts × MoE Dynasty × Autonomous Evolution × Third Eye Forecaster
---

## Executive Summary
ADAN-PRED is a fully autonomous, self-evolving prediction markets trading agent on **Polymarket**. It combines a **32-feature logistic regression brain**, **4-voter ensemble system** (stat model + LLM + historical + online learner), **Platt-calibrated probabilities**, **Kelly-optimal sizing with 15 multipliers**, a **12-child MoE genetic swarm**, **Scenario Forecaster (Third Eye)**, **Meta-Labeling gate**, **ADAN-SHADOW adversarial bias detection**, **Futures Intelligence leading indicators**, a **Distributed LLM Router v9.0** across 8 Gemini models, and the complete **López de Prado AFML suite** (Triple Barrier, CUSUM, VPIN, Purged Walk-Forward, Resolution Oracle) — all in pure JavaScript with zero external ML dependencies.

**Current Stats (v8.4):** 1,701+ trades | 891W/809L | 52.4% WR | +$1,754 net P&L | $11,754 fund | Brier: 0.144

---

## v8.3: Complete López de Prado AFML Suite

### What Changed (v8.0 → v8.3)

| Layer | v8.0 | v8.3 |
|-------|------|------|
| **Risk Multipliers** | 9 | 13: + meta-labeler + CUSUM + VPIN + copula |
| **Bet Gate** | Markovian + K-Means | + Meta-Labeling (#20E) + Resolution Oracle (#22) + CUSUM (#20D) |
| **Bias Detection** | None | ADAN-SHADOW (#15): adversarial twin per asset/timeframe/hour |
| **Leading Indicators** | Binance spot only | + Futures Intelligence: OI Delta, Taker Ratio, L/S Ratio, Liquidation Clusters |
| **Trade Labeling** | Binary win/loss | Triple Barrier (#20A): TP/SL/Time labels with volatility-scaled barriers |
| **ML Validation** | Walk-forward only | + Purged Walk-Forward CV (#20C): chronological splits, purge, embargo |
| **Structural Breaks** | None | CUSUM Filter (#20D): two-sided accumulator with dynamic threshold |
| **Flow Toxicity** | VPIN kill switch | + Volume VPIN (#20F): volume-bucket informed trading probability |
| **Market Quality** | Filter + UCB | + Resolution Oracle (#22): clarity scoring, ambiguous market filter |

### v8.0 → v8.4 Full Changelog
| Version | Added |
|---------|-------|
| v8.0 | 14 scientific concepts, MoE Dynasty, 4-voter ensemble |
| v8.1 | Futures Intelligence (OI Delta, Taker, L/S, Liquidation) |
| v8.2 | Meta-Labeling (#20E), ADAN-SHADOW (#15) |
| v8.3 | Triple Barrier (#20A), CUSUM (#20D), VPIN (#20F), Purged WF (#20C), Resolution Oracle (#22) |
| **v8.4** | **Scenario Forecaster (#23), Distributed LLM Router v9.0 (8 models), Edge Sign Fix, Edge Inflation Guard, YES Bias Correction, Dream Cycle Repair, Smart Shapley Mask, Toxic Hour Blocker, 15 Kelly Multipliers** |

---

## v8.4: Critical Calibration Fixes + Distributed Intelligence

### What Changed (v8.3 → v8.4)

| Layer | v8.3 | v8.4 |
|-------|------|------|
| **LLM Router** | Single Gemma 27B (15K TPM bottleneck) | Distributed v9.0: 8 models, 6-tier fallback, 250K TPM primary |
| **Risk Multipliers** | 13 | **15**: + scenario forecaster + purged walk-forward |
| **Edge Calibration** | `Math.abs()` destroyed negative edges | Sign preserved: negative edge = LLM rejects trade → SKIP |
| **Edge Inflation** | No cap (>25% edge = 48% WR) | Guard: edges >20% capped to 15% for sizing |
| **Default Edge** | 5% fallback when LLM silent | Reduced to 1% — no free edge gifts |
| **YES/NO Bias** | 96% YES bias, NO penalty 4% edge | Prompt corrected, NO penalty relaxed to 3% (same as YES) |
| **Dream Cycle** | Silent `.catch(() => {})`, stuck 42h | `await` + `markDreamRun()` on all exits + full error logging |
| **Shapley Mask** | Blanket mask on HARMFUL features | Smart mask: only silences if BOTH Shapley=HARMFUL AND ML weight < 0.05 |
| **Hour Filter** | Broken (`hStat.total` undefined) | Fixed: `(hStat.wins + hStat.losses)`, H21 UTC blocked |
| **Scenario Forecaster** | None | 3-scenario simulation (bull/bear/neutral) before each trade |
| **Error Handling** | 6 silent `.catch(() => {})` | All replaced with proper error logging |

### Critical Bugs Fixed in v8.4
1. **Edge Sign Destruction** — `Math.abs(edge)` converted "bad trade" signals (-7% edge) into "good trade" signals (+7%). ADAN was betting on trades its own brain rejected.
2. **Dream Cycle Dead** — `dreamMode().catch(() => {})` swallowed all errors. Dream hadn't run in 42+ hours, disabling journal, self-reader, experiments, walk-forward retrain.
3. **Edge Inflation** — Trades with >25% declared edge had 48% WR (worse than random). Now capped at 20%.
4. **YES Bias** — 96% of trades were YES side. Brain prompt said "83% NO bias" (outdated/inverted). NO penalty gate was too restrictive (4% vs 3% for YES).
5. **Toxic Hour Broken** — Hour stats used `.total` (undefined) instead of `wins + losses`. H21 UTC (34% WR) was never blocked.

---

## Architecture Overview

```
                         ┌─────────────────────────────┐
                         │        ADAN v8.4             │
                         │   Scientific Trading Agent   │
                         └─────────┬───────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  SCENARIO FORECASTER (#23)   │
                    │  3 scenarios × Kelly mult    │
                    │  bull/bear/neutral → confirm │
                    └──────────────┬──────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                          │                            │
┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐  ┌───────▼───────┐
│ STAT MODEL   │  │ LLM BRAIN     │  │ HISTORICAL   │  │ ONLINE LEARNER│
│ LogReg 32ft  │  │ Gemini Fleet  │  │ Bayesian WR  │  │ SGD + decay   │
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
           │          15 HARD BLOCKERS + QUANT GATE         │
           │  Markovian | Meta-Label | Resolution Oracle |  │
           │  CUSUM | VPIN | Toxic Hour | Edge Inflation |  │
           │  Soul Caution | Time Decay | K-Means Regime |  │
           │  Order Book | Shadow Bias | ES Threshold |     │
           │  Experiment Overrides | Drawdown Stop          │
           └──────────────────────┬────────────────────────┘
                                  │
           ┌──────────────────────▼────────────────────────┐
           │         RISK PIPELINE (15 Kelly mults)         │
           │  Kelly × session × metabolic × particle ×      │
           │  copula × wilmott × IV × timeDecay ×           │
           │  kmeansRegime × binCountHour × metaLabel ×     │
           │  cusum × vpin × purgedWF × forecast             │
           └──────────────────────┬────────────────────────┘
                                  │
           ┌──────────────────────▼────────────────────────┐
           │   DISTRIBUTED LLM ROUTER v9.0 (8 models)      │
           │  Workhorse 3.1 → Gemma 12B → Lite 2.5 →       │
           │  Flash 3 → Gemma 27B → Flash 2.0 (last resort) │
           └──────────────────────┬────────────────────────┘
                                  │
                            PAPER TRADE
```

---

## Scientific Concepts (24 Integrated)

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
- Anti-bias notice injected into prompt: "You bet YES 96% of the time. This is a SEVERE BIAS."
- **v8.4 Edge Sign Fix:** Negative edges (LLM contradicts its own bet) → auto-SKIP instead of silent `Math.abs()`
- **v8.4 Edge Inflation Guard:** Edges > 20% capped to 15% (data: >25% edge = 48% WR, inverted)

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

### Concept #15: ADAN-SHADOW (Adversarial Twin)
**File:** `src/core/adan_shadow.js`

Takes the OPPOSITE bet on every ADAN trade. If Shadow wins > 55%, ADAN has a systematic bias:
- Tracks per-asset, per-timeframe, per-hour, per-direction Shadow WR
- `getBiasReport()`: identifies worst-performing dimensions
- `shouldFlip(asset, timeframe)`: returns true when Shadow WR > 60%
- Prompt warning injected when bias detected
- Persists to `~/.adan-pred/shadow_stats.json`

### Concept #20A: Triple Barrier Labeling (López de Prado)
**File:** `src/ml/triple_barrier.js`

Replaces binary win/loss with 3-barrier labels:
- **Upper barrier** (TP): entry ± 2.0 × volatility
- **Lower barrier** (SL): entry ± 2.0 × volatility
- **Vertical barrier**: max 20 bars
- Labels: `{1 = TP hit, 0 = timed out, -1 = SL hit}`
- Tracks avg P&L per label type, optimal TP/SL ratio suggestion

### Concept #20C: Purged Walk-Forward Cross-Validation (López de Prado)
**File:** `src/ml/purged_walkforward.js`

Proper ML validation preventing information leakage:
- 5-fold chronological splits (not random)
- 5-sample purge at train/test boundary
- 3-sample embargo after each test fold
- Overfitting detection: train/test accuracy ratio > 1.3x → flag
- Auto-validates every 200 new samples with built-in logistic regression
- Persists to `~/.adan-pred/walkforward_cv.json`

### Concept #20D: CUSUM Filter (López de Prado)
**File:** `src/ml/cusum_filter.js`

Detects structural breaks in price series:
- Two-sided CUSUM: tracks positive (S+) and negative (S-) cumulative sums
- Dynamic threshold: 2 × rolling std of log returns (window 100)
- `isInTransition()`: true if break detected in last 30 seconds
- Stake reduction: ×0.6 during structural breaks (regime changing)
- Persists to `~/.adan-pred/cusum_state.json`

### Concept #20E: Meta-Labeling (López de Prado)
**File:** `src/ml/meta_labeler.js`

Second logistic regression that predicts P(primary model is correct):
- 12 meta-features: primary_confidence, ensemble_agreement, edge_magnitude, etc.
- L2-regularized, trains every 100 samples, activates after 200
- Decisions: `ALLOW` (prob > 0.55), `REDUCE` (0.45-0.55, stake ×0.6), `VETO` (< 0.45)
- Tracks veto precision (correctly blocked losers) and allow precision

### Concept #20F: VPIN — Volume-Synchronized Probability of Informed Trading
**File:** `src/ml/vpin.js`

Estimates toxic flow using volume buckets (López de Prado):
- Auto-calibrated bucket size from rolling volume average
- 50 buckets for VPIN calculation
- `VPIN = mean(|buyVol - sellVol| / bucketSize)` over last 50 buckets
- VPIN > 0.7 = TOXIC → stake ×0.5 | VPIN > 0.5 = ELEVATED → stake ×0.8
- Trend detection: RISING/FALLING/STABLE
- Persists to `~/.adan-pred/vpin_state.json`

### Concept #22: Resolution Oracle Filter
**File:** `src/ml/resolution_oracle.js`

Predicts whether a market will resolve cleanly:
- Crypto price markets ("Up or Down", "above/below") → high clarity (0.8+)
- Clear events with specific conditions → medium clarity (0.5-0.7)
- Vague events → low clarity (0.2-0.4)
- `TRADE` if clarity > 0.6, `AVOID` if < 0.4
- Learns from historical resolution quality per market type
- Persists to `~/.adan-pred/resolution_oracle.json`

### Concept #23: Scenario Forecaster (Third Eye)
**File:** `src/ml/scenario_forecaster.js`

Before each trade, ADAN simulates 3 future scenarios using LLM:
- **Input:** Last 30 candle closes + RSI + trend + vol ratio + BB% + MACD
- **Output:** Bull/Bear/Neutral scenarios with probability + price target
- **Expected Move:** Probability-weighted sum of all 3 scenarios
- **Kelly Multiplier #15:** forecast agrees with trade → ×1.15, contradicts → ×0.75
- **ML Features:** `forecast_direction`, `forecast_confidence`, `forecast_expected_move_pct` (features #33-35)
- **Learning:** Records actual outcome vs prediction, tracks accuracy per asset
- **Journal Integration:** Writes forecast accuracy to consciousness journal for self-reflection
- Persists to `~/.adan-pred/forecast_stats.json` and `forecast_log.jsonl`

### Concept #24: Distributed LLM Router v9.0
**File:** `adan-llm-router.js`

Inverted pyramid: Flash models (250K TPM) are primary, Gemma (15K TPM) is reserve:
| Priority | Model | RPM | TPM | RPD | Role |
|----------|-------|-----|-----|-----|------|
| 1 | `gemini-3.1-flash-lite-preview` | 15 | 250K | 500 | **Workhorse** (primary) |
| 2 | `gemma-3-12b-it` | 30 | 15K | 14.4K | Reserve (light) |
| 3 | `gemini-2.5-flash-lite` | 10 | 250K | 20 | Overflow |
| 4 | `gemini-3-flash-preview` | 5 | 250K | 20 | Overflow #2 |
| 5 | `gemma-3-27b-it` | 30 | 15K | 14.4K | Reserve (heavy) |
| 6 | `gemini-2.0-flash` | ∞ | 250K | 0* | Last resort |

- **Routing:** `routeLLM()` dispatches by weight: Heavy → Sniper (2.5 Flash), Dream → Sniper, Light → Distributed fleet, Child → Gemma 12B
- **Quota Manager:** Tracks RPD for all 6 tiers, resets daily, RPM tracking per minute
- **Embeddings:** Gemini Embedding v2 (`gemini-embedding-exp-03-07`) with legacy fallback

### Futures Intelligence (Leading Indicators)
**File:** `src/api/binance_futures.js`

4 modules from Binance Futures API (free, no API key):
| Module | Signal | Leading? |
|--------|--------|----------|
| OI Delta | TREND_CONFIRMED, SHORT_BUILDUP, LONG_LIQUIDATION | 1-5 min |
| Taker Ratio | AGGRESSIVE_BUYING/SELLING + momentum | 1-3 min |
| Long/Short Ratio | CROWDED_LONGS/SHORTS (contrarian) | 5-15 min |
| Liquidation Clusters | Price magnets at 10x/20x/50x/100x leverage | Event-based |

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

### 3. Kelly Sizer with 15 Multipliers

```
stake = baseKelly × human × session × metabolic × particle × copula ×
        wilmott × IV × timeDecay × kmeansRegime × binCountHour ×
        metaLabel × cusum × vpin × purgedWF × forecast
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
| Meta-Labeling | P(correct) < 0.45 | VETO bet |
| Meta-Labeling | P(correct) < 0.55 | Stake ×0.6 |
| Resolution Oracle | Clarity < 0.4 | AVOID market |
| CUSUM Filter | Structural break active | Stake ×0.6 |
| VPIN Toxicity | VPIN > 0.7 | Stake ×0.5 |
| VPIN Toxicity | VPIN > 0.5 | Stake ×0.8 |
| K-Means Regime | EVENT detected | Veto ALL bets |
| K-Means Regime | RANGING | Kelly ×0.5 |
| Bin Count Hour | Log-odds < -1.0 | Skip toxic hour |
| TTC Filter | < 1 min remaining | Block bet |
| Wilmott Engine | 16 quantitative checks | Various |
| CrashMetrics | Correlation spike | Stake ×0.3 |
| VaR Limit | 99% confidence | Block if > 20% fund |
| Copula Risk | Portfolio correlation | Penalty |
| ADAN-SHADOW | Shadow WR > 60% | Consider flipping direction |
| **v8.4** Toxic Hour | WR < 40% over 15+ trades in hour | Hard SKIP |
| **v8.4** Edge Inflation | Declared edge > 20% net | Cap to 15% for sizing |
| **v8.4** Edge Sign Gate | LLM gives negative edge | Auto-SKIP (brain contradicts bet) |
| **v8.4** QUANT GATE + ES | ES-evolved confidence + edge floor | Block if below threshold |
| **v8.4** Experiment Override | Active A/B test params | Dynamic threshold adjustment |
| **v8.4** Scenario Forecaster | Forecast contradicts trade | Kelly ×0.75 |

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
| Binance Futures | OI Delta, Taker Ratio, L/S Ratio, Liquidation | `src/api/binance_futures.js` |
| VPIN | Volume-synced informed trading probability | `src/ml/vpin.js` |
| CUSUM | Structural break detection in price series | `src/ml/cusum_filter.js` |

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
| `adan-brain-complete.js` | LLM brain: 8 personas, prompt builder, JSON parser, edge sign fix |
| `adan-llm-router.js` | **v8.4** Distributed LLM Router v9.0 (8 Gemini models) |
| `force_dream.js` | Manual dream cycle trigger |
| **ML Layer** | |
| `src/ml/logistic_regression.js` | 32-feature L2-regularized logistic regression |
| `src/ml/walk_forward.js` | Walk-forward validation (27 folds, proper OOS) |
| `src/ml/ensemble.js` | 4-voter log-linear pooling with learned weights |
| `src/ml/kelly_sizer.js` | Quarter-Kelly optimal sizing |
| `src/ml/calibrator.js` | Platt/Isotonic calibration (PAV algorithm) |
| `src/ml/market_filter.js` | Bayesian market quality filter |
| `src/ml/online_learner.js` | Online SGD learner with exponential decay |
| `src/ml/evolution_strategies.js` | 20-vector ES with Sharpe fitness |
| `src/ml/shapley_values.js` | Monte Carlo Shapley feature importance |
| `src/ml/ucb_explorer.js` | UCB1 market selection bandit |
| `src/ml/meta_labeler.js` | **v8.2** Meta-Labeling bet quality gate |
| `src/ml/triple_barrier.js` | **v8.3** Triple Barrier trade labeling |
| `src/ml/cusum_filter.js` | **v8.3** CUSUM structural break detector |
| `src/ml/vpin.js` | **v8.3** VPIN volume toxicity tracker |
| `src/ml/purged_walkforward.js` | **v8.3** Purged Walk-Forward CV |
| `src/ml/resolution_oracle.js` | **v8.3** Resolution Oracle market filter |
| `src/ml/scenario_forecaster.js` | **v8.4** Scenario Forecaster (Third Eye) |
| **Core** | |
| `src/core/wilmott_quant.js` | 16 Wilmott concepts: EWMA, VaR, CrashMetrics |
| `src/core/iv_solver.js` | Black-Scholes IV Solver & Skew Analysis |
| `src/core/regime_classifier.js` | EWMA-based regime detection + kurtosis |
| `src/core/regime_detector.js` | **NEW** K-Means clustering regime detector |
| `src/core/pin_score.js` | PIN Score order flow toxicity tracker |
| `src/core/moe_dynasty.js` | Mixture of Experts gating for children |
| `src/core/adan_shadow.js` | **v8.2** ADAN-SHADOW adversarial bias detection |
| `src/api/binance_futures.js` | **v8.1** Futures Intelligence (OI, taker, L/S, liquidation) |
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

## Intelligence Score: 835/1000

| Category | Score | Details |
|----------|-------|---------|
| **Statistical Brain** | 135/150 | 32-feature LogReg + Online SGD + walk-forward + Shapley (smart mask) + edge sign fix. Missing: XGBoost, neural net. |
| **Calibration** | 95/100 | Platt isotonic + meta-calibration + conformal parser + edge inflation guard + negative edge detection. |
| **Ensemble** | 95/100 | 4-voter log-linear pooling + learned weights + veto + online learner. |
| **Market Selection** | 85/100 | Bayesian quality filter + UCB Explorer bandit + blacklisting. |
| **Risk Management** | 100/100 | Kelly (15 mult) + Wilmott (16) + VaR + CrashMetrics + Copula + Markovian (4 gates) + K-Means regime veto + 15 hard blockers + toxic hour + edge inflation guard. |
| **Data Pipeline** | 80/100 | Binance + Polymarket WS + CryptoPanic + VADER + Fear&Greed + PIN Score + L2 Tensor + Futures Intelligence. Missing: on-chain. |
| **Consciousness** | 70/100 | Self-reader + monologue + experiments + voice + Scenario Forecaster (Third Eye) + consciousness journal. Missing: meta-learning. |
| **Genetic Evolution** | 75/100 | MoE Dynasty + Evolution Strategies + Shapley pruning. Missing: CMA-ES. |
| **LLM Infrastructure** | 70/100 | Distributed Router v9.0 (8 models), quota management, 6-tier fallback. |
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
| 18 | Infrastructure (PostgreSQL, Docker) | DevOps | LOW |
| 19 | Arbitrage Cross-Venue | Additional APIs | LOW |
| 11 | Ephemeral Coding | LVL 25+ gate | GATED |
| 13 | Mempool Reader | WR>62% + fund>$30k | GATED |

### Completed in v8.4 (removed from roadmap)
- ~~#15 ADAN-SHADOW~~ → Done in v8.2
- ~~#20 López de Prado AFML~~ → Done in v8.3 (Triple Barrier, CUSUM, VPIN, Purged WF)
- ~~#23 Scenario Forecaster~~ → Done in v8.4
- ~~#24 Distributed LLM Router~~ → Done in v8.4

---
*Autonomous intelligence research. Paper trading mode. Not financial advice.*
*Statistical framework: logistic regression + walk-forward validation + Platt calibration.*
*Quantitative framework: Paul Wilmott's "Quantitative Finance" (Wiley, 2006).*
*ML framework: Marcos López de Prado's "Advances in Financial Machine Learning" (Wiley, 2018).*
*Scientific concepts: VADER, K-Means, UCB1, Shapley, Evolution Strategies, PIN, MoE, Markov, CUSUM, VPIN, Triple Barrier, Meta-Labeling.*
*LLM Infrastructure: Google Gemini Fleet (8 models, distributed routing, 250K+ TPM).*
