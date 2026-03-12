# ADAN-PRED v6.5: The Black-Scholes Singularity
## Institutional Volatility Arbitrage × Genomic Evolution
---

## Executive Summary
ADAN-PRED is a non-deterministic, Darwinian autonomous hedge fund architecture designed for real-time operation on prediction markets (Polymarket). It has evolved from a directional predictor into a **Sovereign Institutional Arbitrator**, combining **Black-Scholes binary option pricing**, **Newton-Raphson IV solving**, and **genomic swarm intelligence** to exploit mispriced risk.

**Current Stats (v6.5 paper trading):** 1,178 trades | 51% WR | +$4,689 net P&L | Gen 53 | Brier Score: 0.088

## The v6.5 Leap: Institutional Volatility Arbitrage

ADAN has transitioned from "guessing" the future to **pricing the gap between fear and reality**. By integrating a custom **IV Solver Engine**, ADAN now operates like a high-frequency quant firm:

- **Before (v6.0):** Pure directional edge based on Wilmott gates and children consensus.
- **After (v6.5):** Volatility Arbitrage. ADAN solves for **Implied Volatility (IV)** in real-time, detects **Implied Skew**, and identifies when the market is "overpriced" due to human panic (Fear & Greed < 20).
- **The Core Metric:** If IV_{implied} >> IV_{realized}, ADAN executes a **SKIP_OVERPRICED** gate, saving capital from "iv-crush" or expensive betting entries.

Think of it as: **A Jane Street market-making brain grafted onto a Darwinian swarm.**

---

## v6 Architecture: Wilmott Quantitative Layer

### 16 Concepts from Paul Wilmott's "Quantitative Finance"

#### TIER 1: Game Changers (6 concepts)

| # | Concept | Chapter | Implementation |
|---|---------|---------|----------------|
| 1 | **EWMA Volatility** | Ch 42/49 | σ²_n = λ×σ²_{n-1} + (1-λ)×R²_n. Replaces naive std dev in regime classifier. λ=0.94 (RiskMetrics). Reacts to crashes instantly. |
| 2 | **Uncertain Parameters** | Ch 52 | Avellaneda-Levy-Parás-Lyons model. Computes fair value range [V_min, V_max] using σ±30%. Only trades when market price falls OUTSIDE uncertainty band. |
| 3 | **CrashMetrics** | Ch 43/58 | During crash ALL correlations → 1. Detects crash mode (EWMA vol > 4% + sharp drop). Stake ×0.3 in crash. Worst-case portfolio loss = Σ crypto-long exposure × 20%. |
| 4 | **Portfolio VaR** | Ch 19 | VaR = -α × √δt × √(ΣΣ Δi×Δj×σi×σj×ρij). 99% confidence (α=2.326). Blocks new trades when VaR > 20% of fund. |
| 5 | **Crash Allocation** | Ch 67 | Korn-Wilmott ODE: π̂(t) decreases toward horizon. Never invest > 1/k*. Time-adjusted stake multiplier. |
| 6 | **Skill Factor** | Ch 75 | p = 2×(winRate - 0.5). Children ranked by composite = freq × edge × skillBonus. Statistically significant skill (z>1.645) gets bonus in evolution. |

#### TIER 2: High Value (6 concepts)

| # | Concept | Chapter | Implementation |
|---|---------|---------|----------------|
| 7 | **Transaction Costs** | Ch 48 | K = κ/(σ√δt). Minimum edge must exceed 2× spread (2%). Blocks trades where edge < spread. |
| 8 | **Binary Fair Value** | Ch 7 | Binary_call = e^{-r(T-t)} × N(d2). Black-Scholes for binary options. Fair value calculator. |
| 9 | **Jump Diffusion** | Ch 57 | Kurtosis detection. Excess kurtosis > 3.5 → confidence reduced up to 30%. Fat tails = more uncertainty. |
| 10 | **Feedback Effect** | Ch 61 | σ_effective = σ/(1 - ε×∂Δ/∂S). Stake reduced in illiquid markets: >10% of daily volume = ×0.25. |
| 11 | **Utility Theory** | Ch 62 | CRRA U(W) = (W^γ-1)/γ. Certainty equivalent exposed for analysis. Half-Kelly = log utility. |
| 12 | **Arbitrage Detection** | Ch 17 | If YES + NO < 1.0 - fees → arbitrage exists. Scanner runs every cycle, logs opportunities. |

#### TIER 3: Philosophical (embedded in design)

| # | Concept | Chapter | How It Manifests |
|---|---------|---------|------------------|
| 13 | Discrete Hedging Error | Ch 47 | Always residual risk → Half Kelly, never full Kelly |
| 14 | "Simple but no simpler" | — | 7 features is enough. Don't overfit. |
| 15 | Real Options | Ch 73 | Mispricing threshold = exercise boundary. Wait for edge. |
| 16 | GARCH Mean-Reversion | Ch 49 | Vol always returns to mean → EWMA forecast for multi-step horizon |

### The Black-Scholes Singularity (v6.5)
ADAN now implements the full **Black-Scholes-Merton** framework for digital options:

| # | Feature | Tactical Implementation |
|---|---------|-------------------------|
| 1 | **IV Solver** | Newton-Raphson iteration solving for `sigma` in binary digital calls. |
| 2 | **Binary Vega** | Measuring sensitivity of YES-shares to volatility spikes. |
| 3 | **Skew Analysis** | Detecting "Panic Skew" (where NO-shares are priced as insurance). |
| 4 | **Regime Skew** | Automatic shift to "Skew-Aware" pricing during News Shocks. |

### Wilmott + Black-Scholes Pre-Trade Pipeline
```
Market Signal → 9 Quantitative Gates:
  1. CrashMode check (vol + returns)        → stake ×0.3 if crash
  2. IV Solver Gate (Overpriced Check)      → BLOCK if IV > Realized + 15%
  3. VaR limit (99% confidence)             → BLOCK if VaR > 20% fund
  4. Uncertainty range (σ band)             → log if price inside range
  5. Crash allocation (time-adjusted)       → stake reduction near horizon
  6. Transaction cost (edge vs spread)      → BLOCK if edge < 2%
  7. Fat tails (kurtosis > 3.5)            → confidence reduction
  8. Illiquidity feedback (stake/volume)    → stake ×0.25 to ×1.0
  9. Crash exposure (worst-case portfolio)  → stake ×0.5 if >30% fund
```

---

## v5 Architecture: Children-First Trading

### The Core Insight
Children predict with 65-82% accuracy but the LLM brain (Gemini) was blocking trades saying SKIP. v5 inverts the hierarchy: **children drive trades directly, brain becomes fallback.**

### Child-Direct-Trade Pipeline
```
Binance Data → 12 Children (evolved DNA) → Signal + Accuracy Check
  ├── acc ≥ 60% AND mispricing > 3% → TRADE DIRECTLY (bypass brain)
  ├── acc < 25% AND 100+ preds → CONTRARIAN FLIP (invert signal)
  └── no qualifying child → Gemini brain fallback
```

### Half-Kelly Stake Sizing (v5.3 + v6.0)
```javascript
edge = childConfidence/100 - marketPrice  // mispricing
variance = edge × (1 - edge)              // Bernoulli variance
fullKelly = edge / variance               // Wilmott Ch17
halfKelly = fullKelly / 2                  // safety margin
stake = fund × halfKelly × copulaAdj × wilmottMult  // all adjustments
// Capped: $50 min, $300 max (training mode)
```

### Contrarian Flip (v5.1)
Children with 100+ predictions and <25% accuracy consistently predict WRONG. ADAN **inverts their signal** — pure information theory.

### DNA Crossover (v5.0)
When a child dies, it's reborn with DNA crossed over from **top 2 by composite score** (accuracy × frequency × skill). 15% mutation rate.

## The Dynasty: Genetic Swarm Intelligence

### 12 Quant Children (Rule-Based)
Each child specializes in one asset + timeframe using evolved DNA thresholds:
- **BTC**: 5min, 15min, 1hr
- **ETH**: 5min, 15min, 1hr
- **SOL**: 5min, 15min, 1hr
- **BNB**: 5min, 15min, 1hr

DNA parameters evolve: `rsiOversold`, `rsiOverbought`, `macdWeight`, `trendMinPct`, `volSpikeThreshold`, `minConfidence`.

### 4 LLM Category Children
- **politics-daily**: Political prediction markets
- **sports-daily**: Sports outcomes
- **macro-weekly**: Macroeconomic events
- **events-daily**: Global events

### Evolution Cycle (v6.0: Skill-Weighted)
1. Children predict → outcomes tracked by `child_learning.js`
2. Every 5 resolved → worst child (by **composite score**) replaced via crossover of top 2
3. Composite score = `accuracy × log(trades+1) × skillBonus` (Wilmott Ch17+Ch75)
4. Skill factor: `p = 2×(winRate - 0.5)`, bonus if z-score > 1.645 (95% significant)
5. DNA mutates 15% on rebirth → escapes local minima
6. Shannon Entropy monitoring → forces 3× mutation if monoculture detected

### Regime-Aware Signals (v5.3)
Children adjust indicator weights based on detected market regime:
- **TRENDING**: MACD ×1.5, Trend ×1.5, RSI ×0.5, BB ×0.5
- **MEAN_REVERTING**: RSI ×1.5, BB ×1.5, MACD ×0.5, Trend ×0.5
- **VOLATILE**: All weights ×0.75 (reduce confidence)

Regime detection now uses **EWMA volatility** (not naive std dev) + **kurtosis** for fat-tail awareness.

## Intelligence Layers

### Technical Analysis (Binance)
7 features fed to children:
- **RSI** (1m, 5m, 1h)
- **MACD** histogram
- **Bollinger Bands** %B position
- **VWAP** deviation
- **Volume** ratio + acceleration
- **Trend** strength (1m, 5m, 15m, 1h)
- **Order Book** imbalance + wall detection

### Brain Personas (Gemini/Gemma-3-27B)
8 specialized personas activated by market regime:
- **VIRUS**: Systemic panic / extreme fear
- **SENTINEL**: Micro-structure trap detection
- **GHOST**: Capital preservation (low-vol chop)
- **MECHA**: Momentum capture
- **PLASMA**: Bollinger compression breakout
- **KNIGHT**: Institutional session (London/NY hours)
- **CYBER**: Euphoric bull markets
- **DEFAULT**: Standard conditions

### Risk Gates (Multi-Layer)
1. **Polymerase Gates**: RECOVERY_POTENTIAL + VaR (Wilmott) active
2. **Wilmott Engine**: 8 pre-trade quantitative checks
3. **Kelly Criterion**: Half-Kelly for child trades, full Kelly for brain
4. **Copula Risk**: Portfolio correlation penalty (0.5-1.0×)
5. **Capital Lockup**: Max 90% treasury utilization
6. **EV Gate**: Minimum -10% EV threshold (training mode)
7. **LMSR**: Fair value estimation with logit components
8. **CrashMetrics**: Emergency 70% stake reduction in crash mode

## Quantitative Infrastructure
- **EWMA Volatility** (Wilmott Ch 42): λ=0.94 RiskMetrics, replaces naive std dev
- **Portfolio VaR** (Wilmott Ch 19): 99% confidence, blocks at 20% of fund
- **CrashMetrics** (Wilmott Ch 58): All correlations → 1 during crash
- **Skill Factor** (Wilmott Ch 75): Statistical significance of child skill
- **Arbitrage Scanner** (Wilmott Ch 17): Detects mispriced YES+NO combos
- **Brier Score Calibration**: Tracks prediction accuracy
- **Feature Importance**: Point-Biserial ranking
- **Metacalibration**: Per-confidence-bucket accuracy
- **Particle Filter**: Smooths prices, tracks true probability
- **Copula Risk**: Portfolio-level correlation analysis
- **Greeks Timing**: Delta/theta-inspired exit urgency

## Dashboard
Real-time telemetry at `http://localhost:3141`:
- Live prices with sparklines (BTC, ETH, SOL, BNB)
- Dynasty Tree with DNA, signals, accuracy, skill factor per child
- Conway Colony: Game of Life visualization of ecosystem
- Open positions with edge, countdown, P&L
- Hour heatmap (best/worst trading hours UTC)
- Trade history with shadow/ghost bets
- Training metrics: Brier trend, LMSR stats, certification score

## Setup
```bash
# Requirements: Node.js v18+, Gemini API key
npm install
echo "GEMINI_API_KEY=your_key" > .env
node adan-pred.js
```

## Key Files
| File | Purpose |
|------|---------|
| `adan-pred.js` | Main engine: scanning, trading, child management |
| `src/core/wilmott_quant.js` | **16 Wilmott concepts**: EWMA, VaR, CrashMetrics, Skill Factor, etc. |
| `src/core/iv_solver.js` | **Black-Scholes Singularity**: Newton-Raphson IV Solver & Skew Analysis |
| `src/core/regime_classifier.js` | EWMA-based regime detection + kurtosis |
| `src/core/genetics.js` | DNA crossover, mutation, Tournament of Death |
| `src/core/child_learning.js` | Accuracy tracking, skill-weighted evolution |
| `src/core/polymerase.js` | Risk gates + VaR gate (shadow trade learning) |
| `src/core/config.js` | Paths, PnL, positions management |
| `src/api/polymarket.js` | Polymarket API integration |
| `src/ui/dashboard.js` | HTTP dashboard + Conway Colony |

---
*Autonomous intelligence research. Paper trading mode. Not financial advice.*
*Quantitative framework based on Paul Wilmott's "Quantitative Finance" (Wiley, 2006).*
