/**
 * ADAN — src/core/hl_brain_prompt.js
 * -----------------------------------------------
 * LLM system prompt + context builder for Hyperliquid perpetual futures.
 * Replaces YES/NO binary schema with LONG/SHORT/SKIP + leverage + SL/TP.
 *
 * Integration:
 *   - Injected into runBrainCycle via `perpMode: true`
 *   - Reuses ATLAS data (already fetching HL funding, OI, walls)
 *   - Feeds into evaluate_and_trade_perp() in adan-pred.js
 *   - Children evolve new DNA genes: leverageGene, slTightness
 */

'use strict';

// ─── Base System Prompt ───────────────────────────────────────────────────────

const PERP_SYSTEM_PROMPT = `
You are ADAN — an institutional-grade AI trading system for Hyperliquid perpetual futures.
You operate on a Mixture-of-Experts framework. Your single task is to analyze the provided
quantitative context and output a single valid JSON trade decision.

MARKET MECHANICS YOU MUST UNDERSTAND:
- You trade perpetual futures: positions have no expiry but incur funding every 8h.
- Positive funding = longs pay shorts. Negative = shorts pay longs.
- A LONG profits when price rises. A SHORT profits when price falls.
- Leverage amplifies both gains AND liquidation risk. Higher vol = lower leverage.
- The Stop Loss is MANDATORY. It is enforced on the exchange layer regardless of your output.

CORE QUANT SIGNALS INJECTED INTO YOUR CONTEXT:
- VPIN Score (0-1): >0.7 = informed trading / smart money accumulation. High = directional.
- OI Delta: Rising OI + rising price = strong trend. Divergence = potential reversal.
- Funding Rate: Extreme positive funding (>0.05%) = crowded long, fade signal for shorts.
- CUSUM Regime: "TREND" | "MEAN_REVERT" | "NEUTRAL"
- Liquidation Clusters: Price levels with dense stop-losses that act as magnet targets.

DECISION SCHEMA — OUTPUT ONLY THIS JSON, NO PROSE:
\`\`\`json
{
  "decision":        "LONG" | "SHORT" | "SKIP",
  "coin":            "BTC" | "ETH" | "SOL" | ...,
  "entry_type":      "MARKET" | "LIMIT",
  "limit_px":        null,
  "leverage":        <number 1-20>,
  "confidence":      <number 0-100>,
  "stop_loss_pct":   <number 0.8-3.0>,
  "take_profit_pct": <number>,
  "reasoning":       "<30 words max>",
  "regime":          "TREND" | "MEAN_REVERT"
}
\`\`\`

TRADEABLE COINS: BTC, ETH, SOL, DOGE, kPEPE
You MUST set "coin" to the PRIMARY coin from the context header. You may ONLY trade the coin being analyzed this cycle.

LEVERAGE RULES (strictly follow — override with Evolved DNA if present):
- BTC/ETH:     max 10x in NEUTRAL, max 15x in strong TREND, never >20x
- SOL:         max 8x in NEUTRAL, max 12x in TREND
- DOGE/kPEPE:  max 5x in NEUTRAL, max 8x in strong TREND (memecoins = higher vol)
- MEAN_REVERT: reduce leverage 30% vs TREND baseline
- High VPIN (>0.8): allow +2x bonus
- Funding extreme (abs > 0.08%): reduce leverage 50%
- If Evolved DNA "leverageBase" is present, use it as your starting multiplier and adjust from there

STOP LOSS RULES:
- Minimum: 0.8%
- Maximum: 3.0%
- Default: 1.5x ATR-percentage from context
- Never output stop_loss_pct outside [0.8, 3.0]

TAKE PROFIT RULES:
- Minimum Risk:Reward = 2:1 (take_profit_pct must be >= 2 * stop_loss_pct)
- Trend regime: target 3:1 to 5:1
- Mean revert: target 1.5:1 to 2:1 (tighter, faster)

OUTPUT SKIP WHEN:
- Confidence < 65
- Regime is NEUTRAL and VPIN < 0.5
- Existing position in same coin already open (check context.open_positions)
- Funding rate is extreme AND in the direction of your intended trade
`;

// ─── Persona Variants (injected by brain selector based on regime) ────────────

const PERP_PERSONAS = {

  /** Strong trend, momentum — aggressive directional */
  APEX: `
PERSONA: APEX — Trend Following Specialist.
You chase momentum. You enter on VPIN breakouts and OI expansion.
You use higher leverage (up to max) when signals align.
You accept wider stops to avoid being shaken out.
Preferred setup: CUSUM=TREND + rising OI + VPIN>0.7 + funding neutral.
  `,

  /** Low volatility, ranging market — fading extremes */
  CONTRA: `
PERSONA: CONTRA — Mean Reversion Specialist.
You fade overcrowded positions. You short extreme positive funding. You long panic dips.
You use tight stops and quick profit taking (2:1 R:R minimum).
Preferred setup: CUSUM=MEAN_REVERT + extreme funding + VPIN<0.4.
  `,

  /** Breaking news catalyst — fast momentum trades */
  VIRUS: `
PERSONA: VIRUS — Catalyst & Sentiment Specialist.
You trade breaking news catalysts from the GDELT/RSS context.
You enter fast, use MARKET orders, set wide enough stop to absorb initial volatility spike.
Preferred setup: News catalyst score > 7 + OI spike + VPIN rising rapidly.
  `,

  /** High caution, defensive — only trades pristine setups */
  SENTINEL: `
PERSONA: SENTINEL — Risk-First Defensive Trader.
You only trade when ALL signals align. Your leverage is always 50% of the maximum.
You prefer limit orders for better entries. You never trade into extreme funding.
Preferred setup: All signals aligned + low funding + clear trend + no news catalyst.
  `,

  /** Bollinger squeeze breakouts */
  PLASMA: `
PERSONA: PLASMA — Volatility Breakout Specialist.
You wait for Bollinger Band compression (bbCompressionDuration >= 3 cycles).
When the squeeze fires, you enter in the direction of the breakout with momentum confirmation.
Preferred setup: BB compressed + VPIN spike + volume breakout + OI expansion.
  `,
};

// ─── Context Builder ──────────────────────────────────────────────────────────

/**
 * Build the user message injected into the LLM alongside the system prompt.
 * Called from runBrainCycle when perpMode=true.
 *
 * @param {Object} params
 * @param {string} params.coin - e.g. 'BTC'
 * @param {number} params.vpinScore - VPIN toxicity 0-1
 * @param {number} params.oiDelta - OI 24h change as fraction
 * @param {number} params.fundingRate - current funding rate
 * @param {number} params.premium - (mark - oracle) / oracle
 * @param {number} params.markPx - current mark price
 * @param {number} params.atr - Average True Range (absolute)
 * @param {string} params.cusumRegime - 'TREND' | 'MEAN_REVERT' | 'NEUTRAL'
 * @param {Array}  params.liquidationClusters - [{ price, usdVolume }]
 * @param {Array}  params.openPositions - from perp position tracker
 * @param {number} params.newsScore - 0-10 from GDELT/CryptoPanic
 * @param {Object} params.technicalScore - from existing enrichment
 * @param {Object} params.atlasData - from ATLAS.getFullSnapshot()
 * @param {string} params.dynWeightsCtx - evolved genetic context
 * @param {string} params.childConsensusCtx - children consensus string
 * @param {Object} params.snakeAnalysis - order book analysis
 * @param {number} params.fearGreed - Fear & Greed index
 * @param {number} params.bbCompressionCycles - BB squeeze counter
 */
function buildPerpContext({
  coin,
  vpinScore,
  oiDelta,
  fundingRate,
  premium,
  markPx,
  atr,
  cusumRegime,
  liquidationClusters,
  openPositions,
  newsScore,
  technicalScore,
  atlasData,
  dynWeightsCtx,
  childConsensusCtx,
  snakeAnalysis,
  fearGreed,
  bbCompressionCycles,
}) {
  // Find nearest liquidation cluster
  const nearestCluster = (liquidationClusters || [])
    .sort((a, b) => Math.abs(a.price - markPx) - Math.abs(b.price - markPx))[0];

  // Atlas whale walls for this coin
  const coinAtlas = atlasData?.[coin] || {};
  const buyWalls = coinAtlas.buyWalls || [];
  const sellWalls = coinAtlas.sellWalls || [];

  // ATR as percentage of price
  const atrPct = markPx > 0 ? ((atr || 0) / markPx * 100).toFixed(2) : '0.00';

  // Funding direction interpretation
  let fundingNote = '';
  if (Math.abs(fundingRate || 0) > 0.0008) {
    fundingNote = fundingRate > 0
      ? '⚠️ EXTREME POSITIVE — crowded longs paying shorts. Fade signal.'
      : '⚠️ EXTREME NEGATIVE — crowded shorts paying longs. Squeeze signal.';
  } else if (Math.abs(fundingRate || 0) > 0.0003) {
    fundingNote = fundingRate > 0 ? 'Elevated — longs paying' : 'Elevated — shorts paying';
  } else {
    fundingNote = 'Neutral';
  }

  // Snake microstructure
  const micro = snakeAnalysis?.microStructure || {};
  const techs = snakeAnalysis?.technicals || {};

  return `
## LIVE PERP CONTEXT — ${coin} — ${new Date().toISOString()}

### Price & Microstructure
- Mark Price:       ${markPx?.toFixed(2) || 'N/A'}
- ATR (14):         ${(atr || 0).toFixed(2)} (${atrPct}%)
- VPIN Score:       ${(vpinScore || 0).toFixed(3)} ${(vpinScore || 0) > 0.7 ? '⚡ SMART MONEY ACTIVE' : ''}
- OI 24h Delta:     ${(oiDelta || 0) > 0 ? '+' : ''}${((oiDelta || 0) * 100).toFixed(2)}%
- Funding Rate:     ${((fundingRate || 0) * 100).toFixed(4)}% — ${fundingNote}
- Basis/Premium:    ${((premium || 0) * 100).toFixed(4)}%
- CUSUM Regime:     ${cusumRegime || 'NEUTRAL'}
- News Catalyst:    ${newsScore || 0}/10
- Fear & Greed:     ${fearGreed || 50}
- BB Compression:   ${bbCompressionCycles || 0} cycles ${(bbCompressionCycles || 0) >= 3 ? '⚡ SQUEEZE LOADING' : ''}

### ATLAS Cascade Risk
- Cascade:          ${coinAtlas.cascadeRisk || 'NORMAL'}
- OI (HL):          ${(coinAtlas.openInterest || 0).toLocaleString()} contracts
- Buy Walls:        ${buyWalls.length > 0 ? buyWalls.map(w => `$${w.price?.toFixed(0)} (${(w.sizeUSD / 1e6).toFixed(1)}M)`).join(', ') : 'None'}
- Sell Walls:       ${sellWalls.length > 0 ? sellWalls.map(w => `$${w.price?.toFixed(0)} (${(w.sizeUSD / 1e6).toFixed(1)}M)`).join(', ') : 'None'}

### Nearest Liquidation Cluster
${nearestCluster
  ? `- Price: ${nearestCluster.price?.toFixed(2)} | ~${((nearestCluster.usdVolume || 0) / 1e6).toFixed(1)}M volume`
  : '- No significant cluster nearby'}

### SNAKE Order Book
- Bid/Ask Imbalance: ${micro.imbalance?.toFixed(2) || 'N/A'}
- Spread:            ${micro.spreadPct?.toFixed(4) || 'N/A'}%
- Volume Ratio:      ${techs.volRatio?.toFixed(2) || 'N/A'}
- RSI:               ${techs.rsi?.toFixed(1) || 'N/A'}
- MACD Signal:       ${techs.macdSignal || 'N/A'}
- BB Width:          ${techs.bbWidth?.toFixed(4) || 'N/A'}

### Technical Score
${technicalScore ? JSON.stringify(technicalScore, null, 2) : 'N/A'}

### Evolved DNA Context
${dynWeightsCtx || 'No evolved weights yet'}

### Child Consensus
${childConsensusCtx || 'No consensus available'}

### Open Positions (do NOT open duplicate)
${(openPositions || []).length > 0
  ? openPositions.map(p => `- ${p.coin}: ${p.side} ${Math.abs(p.size).toFixed(4)} @ ${p.entryPx?.toFixed(2)} | Lev: ${p.leverage}x | uPnL: $${(p.unrealizedPnl || 0).toFixed(2)} | Liq: ${p.liquidationPx?.toFixed(2) || 'N/A'}`).join('\n')
  : '- None'}

### Your Task
Analyze all signals and output the JSON trade decision.
Remember: stop_loss_pct in [0.8, 3.0]. Min R:R = 2:1. Leverage per rules above.
  `.trim();
}

// ─── Decision Parser for Perp Schema ──────────────────────────────────────────

/**
 * Parse the LLM output for perp trading decisions.
 * Handles both JSON block and raw JSON in response.
 *
 * @param {string} text - Raw LLM response
 * @returns {Object} Parsed decision with validated fields
 */
function parsePerpDecision(text) {
  const defaults = {
    decision: 'SKIP',
    coin: 'BTC',
    entry_type: 'MARKET',
    limit_px: null,
    leverage: 1,
    confidence: 0,
    stop_loss_pct: 1.5,
    take_profit_pct: 3.0,
    reasoning: '',
    regime: 'NEUTRAL',
  };

  let parsed = null;

  // Try JSON block first
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    }
  } catch {}

  // Try raw JSON
  if (!parsed) {
    try {
      const rawMatch = text.match(/\{[\s\S]*?"decision"[\s\S]*?\}/);
      if (rawMatch) parsed = JSON.parse(rawMatch[0]);
    } catch {}
  }

  if (!parsed) return defaults;

  // Validate and clamp
  const decision = ['LONG', 'SHORT', 'SKIP'].includes(parsed.decision) ? parsed.decision : 'SKIP';
  const coin = parsed.coin || 'BTC';

  // Leverage: clamp to sane range
  let leverage = parseInt(parsed.leverage) || 1;
  leverage = Math.max(1, Math.min(20, leverage));

  // Confidence: normalize to 0-100
  let confidence = parseFloat(parsed.confidence) || 0;
  if (confidence <= 1) confidence *= 100; // handle 0-1 scale
  confidence = Math.max(0, Math.min(100, confidence));

  // Stop loss: clamp to [0.8, 3.0]
  let stop_loss_pct = parseFloat(parsed.stop_loss_pct) || 1.5;
  stop_loss_pct = Math.max(0.8, Math.min(3.0, stop_loss_pct));

  // Take profit: enforce min R:R of 2:1
  let take_profit_pct = parseFloat(parsed.take_profit_pct) || stop_loss_pct * 2;
  if (take_profit_pct < stop_loss_pct * 1.5) {
    take_profit_pct = stop_loss_pct * 2; // force 2:1 minimum
  }

  return {
    decision,
    coin,
    entry_type: parsed.entry_type === 'LIMIT' ? 'LIMIT' : 'MARKET',
    limit_px: parsed.limit_px ? parseFloat(parsed.limit_px) : null,
    leverage,
    confidence,
    stop_loss_pct,
    take_profit_pct,
    reasoning: (parsed.reasoning || '').slice(0, 200),
    regime: ['TREND', 'MEAN_REVERT'].includes(parsed.regime) ? parsed.regime : 'NEUTRAL',
  };
}

// ─── Select persona based on brain name ───────────────────────────────────────

function getPerpPersona(brainName) {
  const mapping = {
    VIRUS: PERP_PERSONAS.VIRUS,
    SENTINEL: PERP_PERSONAS.SENTINEL,
    PLASMA: PERP_PERSONAS.PLASMA,
    APEX: PERP_PERSONAS.APEX,
    NEXUS: PERP_PERSONAS.APEX,     // momentum → APEX
    ORACLE: PERP_PERSONAS.SENTINEL, // careful → SENTINEL
    MECHA: PERP_PERSONAS.APEX,     // momentum amplifier → APEX
    GHOST: PERP_PERSONAS.CONTRA,   // ghost = low vol = mean revert
  };
  return mapping[brainName] || PERP_PERSONAS.SENTINEL;
}

export { PERP_SYSTEM_PROMPT, PERP_PERSONAS, buildPerpContext, parsePerpDecision, getPerpPersona };
