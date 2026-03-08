# ADAN-PRED v5.2: Autonomous Quantitative Agentic Firm
---

## Executive Summary
ADAN-PRED is a non-deterministic, Darwinian autonomous hedge fund architecture designed for real-time operation on prediction markets (Polymarket). It utilizes a multi-layered intelligence pipeline combining Binance technical analysis, genetic child swarm evolution, and LLM reasoning to identify and execute trades with positive expected value.

**Current Stats (paper trading):** 647 trades | 50.5% WR | +$1,276 net P&L | 12 children across 4 assets

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

### Accuracy-Based Stake Sizing
- 60% accuracy → $100 (base)
- 70% accuracy → $150
- 80% accuracy → $200
- Formula: `stake = Math.min(300, 100 + Math.round((acc - 60) * 5 / 25) * 25)`

### Contrarian Flip (v5.1)
Children with 100+ predictions and <25% accuracy consistently predict the WRONG direction. Instead of killing them, ADAN **inverts their signal** — a 0% accuracy child flipped becomes ~100% accuracy. Pure information theory.

### DNA Crossover (v5.0)
When a child dies, it's reborn with DNA crossed over from the **top 2 living children** by accuracy. For each DNA parameter: 50% chance from parent 1, 50% from parent 2, then 15% mutation applied.

## The Dynasty: Genetic Swarm Intelligence

### 12 Quant Children (Rule-Based)
Each child specializes in one asset + timeframe using evolved DNA thresholds:
- **BTC**: 5min, 15min, 1hr
- **ETH**: 5min, 15min, 1hr
- **SOL**: 5min, 15min, 1hr
- **BNB**: 5min, 15min, 1hr

DNA parameters evolve via natural selection: `rsiOversold`, `rsiOverbought`, `macdWeight`, `trendMinPct`, `volSpikeThreshold`, `minConfidence`, `patience`.

### 4 LLM Category Children
- **politics-daily**: Political prediction markets
- **sports-daily**: Sports outcomes
- **macro-weekly**: Macroeconomic events
- **events-daily**: Global events

### Evolution Cycle
1. Children predict → outcomes tracked by `child_learning.js`
2. Every N predictions → worst child replaced via crossover of top 2
3. DNA mutates 15% on rebirth → escapes local minima
4. Tournament of Death at trade 20 → bottom 50% culled

## Intelligence Layers

### Technical Analysis (Binance)
7 features fed to children (fixed in v5.2 — previously only RSI was active):
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

### Risk Gates
- **Kelly Criterion** stake sizing (brain trades)
- **Polymerase Gates**: RECOVERY_POTENTIAL active (57% accuracy, +$2,558 saved). CLOSE_WINDOW and EXIT_PATH disabled for training (were net negative).
- **Capital Lockup**: Max 90% treasury utilization
- **EV Gate**: Minimum -10% EV threshold (training mode)
- **LMSR**: Fair value estimation with logit components

## Quantitative Infrastructure
- **Brier Score Calibration**: 0.316 (tracks prediction accuracy)
- **Feature Importance**: Point-Biserial ranking of which indicators predict wins
- **Metacalibration**: Per-confidence-bucket accuracy tracking
- **Particle Filter**: Smooths market prices, tracks true underlying probability
- **Copula Risk**: Portfolio-level correlation analysis
- **Greeks Timing**: Delta/theta-inspired exit urgency

## Dashboard
Real-time telemetry at `http://localhost:3141`:
- Live prices with sparklines (BTC, ETH, SOL, BNB)
- Dynasty Tree with DNA, signals, accuracy per child
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
| `src/core/genetics.js` | DNA crossover, mutation, Tournament of Death |
| `src/core/child_learning.js` | Accuracy tracking, evolution engine |
| `src/core/polymerase.js` | Risk gates (shadow trade learning) |
| `src/core/config.js` | Paths, PnL, positions management |
| `src/api/polymarket.js` | Polymarket API integration |
| `src/ui/dashboard.js` | HTTP dashboard + Conway Colony |

---
*Autonomous intelligence research. Paper trading mode. Not financial advice.*
