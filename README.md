# ADAN-PRED: Autonomous Decision Agent Node (v3.0.0)
---

## Executive Summary
ADAN-PRED is a non-deterministic, Darwinian autonomous hedge fund architecture designed for real-time operation on prediction markets, specifically the Polymarket ecosystem. It utilizes a multi-layered intelligence pipeline to scan global narratives, order book micro-structures, and institutional positioning to identify and execute trades with a positive expected value (EV).

The system is engineered to systematically extract yield by targeting a statistical win rate exceeding the 52% threshold, utilizing calibrated Bayesian inference and a dynamic Eight-Brain Transition System.

## Architectural Framework: The Mother Code v2.0
ADAN-PRED evaluates market conditions through an integrated data pipeline, processed by specialized neural personas. The transition between these personas is managed by the `BrainTransitionManager`, which swaps the active persona every five-minute cycle based on specific market regime detections.

### Core Intelligence Layers
*   **APPLE (Contextual Synthesis):** Aggregates decentralized news feeds and market sentiment metadata. It provides the system with a macroeconomic and narrative-driven "priors" before any technical execution occurs.
*   **SNAKE (Micro-Structure Execution):** Processes high-frequency price data to extract order book imbalances, volume acceleration, and VWAP deviations.
*   **ATLAS (Liquidity Oracle):** Monitors real-time liquidation levels and institutional limit order placement across decentralized perpetual protocols to identify potential manipulation zones.
*   **EVA (Risk Mitigation Gate):** Serves as the final safety protocol. It has the unilateral authority to veto any execution if capital preservation thresholds are breached or if historical Brier Scores indicate performance degradation.

### The Specialized Persona Matrix
The system dynamically routes decision-making through specialized brains, each optimized for specific market environments:
*   **VIRUS (Systemic Panic):** Optimized for high-volatility, low-sentiment environments. Biased towards "NO" outcomes to exploit irrational market fear.
*   **SENTINEL (Market Integrity):** Focuses on detecting micro-structure traps and order book manipulation via SNAKE execution metrics.
*   **GHOST (Capital Preservation):** Active during low-volatility/low-volume regimes. Deploys extremely high confidence thresholds, defaulting to "SKIP" to prevent capital erosion during "chop."
*   **MECHA (Momentum Capture):** Activated during high-volume trend events. Designed to ride established momentum and squeeze trades.
*   **PLASMA (Compression Breakout):** Deployed during Bollinger Band compression phases to anticipate breakouts using ATLAS liquidity data.
*   **KNIGHT (Institutional Session):** Specifically active during London and New York market hours, focusing on VWAP-centric institutional flow.
*   **CYBER (Expansionary Greed):** Optimized for euphoric bull market environments, maximizing exposure during high-sentiment momentum.
*   **DEFAULT (Steady State):** Balanced logical analyst for standard market conditions.

## The Dynasty Effect: Genetic Swarm Intelligence
ADAN-PRED operates as the root of an evolutionary lineage, spawning specialized sub-agents to enhance the main node's decision matrix.

### The Forge (Child Evolution)
Sub-agents such as HERMES (BTC emphasis) and ATHENA (ETH emphasis) serve as specialized scouts. These agents track their own individual performance and genetic markers including patience, aggressiveness, and cognitive bias multipliers.

### Tournament of Death and Crossover
The system employs a rigorous pruning process. Every 20 trades, child agents in the bottom percentile of Brier Score calibration are terminated. Surviving high-performance agents are permitted to undergo genetic crossover, creating Gen-3 elite offspring that inherit trauma-based heuristic rules from their parents' SOUL.md logs.

### Recursive Shadow Learning (Polymerase Gates)
The Polymerase system simulates executions for trades that were blocked by risk gates. By tracking these "Ghost Trades," the system learns which gates were too restrictive (blocking winning trades) and which were effective (preventing losses), allowing for real-time adaptive threshold adjustment.

## Quantitative Infrastructure
Version 3.0 introduces a math-first logic layer to enforce strict risk parameters and penalize large-language model (LLM) hallucinations.
*   **Bayesian Uncertainty Penalty:** LLM confidence is weighted against historical regime accuracy. Low-confidence outputs trigger a capital allocation reduction to 1/8th of the standard Kelly stake.
*   **Shannon Entropy Regulation:** Measures the genetic diversity of the sub-agent swarm to prevent algorithmic groupthink or "monoculture" bias.
*   **Brier Score Calibration:** All internal probability estimations are strictly measured against actual market outcomes, ensuring institutional-grade forecasting accuracy.

---

## Deployment and Dashboard
The system operates as a Node.js process with a real-time HTTP telemetry interface.

**Access Internal Telemetry:** `http://localhost:3141`

*   **Interactive Force-Directed Graph:** Visualization of the active agents, brains, and their physical communication nodes.
*   **Dynamic Avatar Morphing:** The dashboard CSS evolves in real-time based on the active brain persona.
*   **Brain Log:** A real-time audit stream of the system's internal probabilistic justifications and gate-blocks.

### Technical Requirements
*   Node.js v18.0.0 or higher
*   Google AI Studio API Key (Gemini/Gemma integration)
*   Standard Unix-based environment (OSX/Linux)

### Installation Sequence
1. Clone the core repository.
2. Initialize dependencies using `npm install`.
3. Configure the `.env` file with your `GEMINI_API_KEY` and set `ADAN_MODE` to `TRAINING` for initial calibration.
4. Execute the system using `node adan-pred.js`.

---
*This repository and its contents are intended for autonomous intelligence research and quantitative experimentation. Perform due diligence before live market deployment.*
