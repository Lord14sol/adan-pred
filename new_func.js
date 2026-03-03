async function checkResolutions() {
  const pos = loadPositions();
  if (!pos.open.length) return;
  let changed = false;

  for (let i = pos.open.length - 1; i >= 0; i--) {
    const p = pos.open[i];
    if (p.resolved || !p.closesAt) continue;
    const endMs = new Date(p.closesAt).getTime();
    if (Date.now() < endMs) continue; // not yet closed

    // Fetch market result from Polymarket
    const data = await polyFetch('/markets/' + p.marketId);
    if (!data) continue;
    const closed = data.closed || data.archived || data.active === false;
    if (!closed) continue;

    // Determine winner
    let outcomePrices;
    try { outcomePrices = typeof data.outcomePrices === 'string' ? JSON.parse(data.outcomePrices) : data.outcomePrices; }
    catch { outcomePrices = [0.5, 0.5]; }
    // If YES resolved to 1.0 → YES won
    const yesWon = Array.isArray(outcomePrices) && parseFloat(outcomePrices[0]) >= 0.99;
    const won = (p.side === 'YES' && yesWon) || (p.side === 'NO' && !yesWon);

    // Slippage simulation: 1.5% deducted on entry + exit = realistic paper trading (Nightmare Engine)
    const SLIPPAGE = 0.015; // 1.5% per side for low-liquidity PM markets
    const slippageCost = parseFloat((p.stake * SLIPPAGE * 2).toFixed(2)); // entry + exit
    let pnlVal;
    if (won) {
      const mult = p.side === 'YES' ? 1 / Math.max(p.marketPrice, 0.01) : 1 / Math.max(1 - p.marketPrice, 0.01);
      pnlVal = parseFloat((p.stake * (mult - 1) - slippageCost).toFixed(2));
    } else {
      pnlVal = parseFloat((-p.stake - slippageCost).toFixed(2));
    }

    // BRIER SCORE CALCULATION (Calibration metric)
    const actual = yesWon ? 1 : 0;
    const pred = p.side === 'YES' ? (p.confidence / 100) : (1 - (p.confidence / 100));
    const brierScore = parseFloat(Math.pow(pred - actual, 2).toFixed(4));

    p.resolved = true; p.won = won; p.pnl = pnlVal; p.result = won ? 'WIN' : 'LOSS'; p.brierScore = brierScore;
    p.resolvedAt = new Date().toISOString();
    pos.closed.push({ ...p });
    pos.open.splice(i, 1);
    changed = true;
    resolveHypothesis(p.marketId, won);
    updateMetaCalib(p.confidence || 65, won);
    promoteInsightsToSoul();

    // ── Record Result for Brain Manager
    if (p.brainStake && p.brainStake > 0) {
      brainManager.recordResult({
        brainName: p.brain || 'DEFAULT',
        won,
        predictedP: pred,
        actualOutcome: actual,
        edge: p.edge,
      });
    }
    // Cortex Memory: store trade with its entry feature vector
    if (p.entryVec) {
      memorizeTradeContext(p, { orderBook: { buyPressure: p.entryVec.buyPressure, ratio: p.entryVec.obRatio, sellWallTrap: p.entryVec.sellWallTrap, buyWallTrap: p.entryVec.buyWallTrap }, rsi: p.entryVec.rsi, rsi5m: p.entryVec.rsi5m, trend1m: p.entryVec.trend1m, trend5m: p.entryVec.trend5m, trend15m: p.entryVec.trend15m, trend1h: p.entryVec.trend1h, bb: { pct: p.entryVec.bbPct }, vol: { ratio: p.entryVec.volRatio }, volAccel: p.entryVec.volAccel, vwap5m: { pct: p.entryVec.vwapPct }, volatility: p.entryVec.volatility }, won);
    }
    
    // We need awardChildExp if we have it or try
    if (typeof awardChildExp === 'function') awardChildExp(p.asset || 'btc', won);

    const pnl2 = loadPnL();
    pnl2.trades = (pnl2.trades || 0) + 1;
    if (won) {
      pnl2.wins = (pnl2.wins || 0) + 1; pnl2.streak = (pnl2.streak || 0) + 1;
      pnl2.fund = parseFloat(((pnl2.fund || 100) + p.stake + pnlVal).toFixed(2));
      pnl2.net = parseFloat(((pnl2.net || 0) + pnlVal).toFixed(2));
      pnl2.treasury = parseFloat(((pnl2.treasury || 0) + pnlVal * TREE_RULES.treasuryPct).toFixed(2));
      pnl2.brierTotal = (pnl2.brierTotal || 0) + brierScore;
      pnl2.brierCount = (pnl2.brierCount || 0) + 1;
      pnl2.brierScore = parseFloat((pnl2.brierTotal / pnl2.brierCount).toFixed(4));
      awardExp(calcWinExp(p.confidence, Math.abs(p.edge || 0), pnl2.streak));
      updateCalibration(p.asset, true);
      if (pnl2.trades % 5 === 0) {
        const rec = pos.closed.slice(-5);
        appendToSoul(`\n### PATTERNS — ${new Date().toISOString()} (${pnl2.trades} trades):\nWR: ${Math.round(pnl2.wins / pnl2.trades * 100)}%. Recent: ${rec.map(c => c.result + '[' + c.asset + ']').join(', ')}.\n`);
      }
    } else {
      pnl2.losses = (pnl2.losses || 0) + 1; pnl2.streak = 0;
      pnl2.net = parseFloat(((pnl2.net || 0) + pnlVal).toFixed(2));
      pnl2.brierTotal = (pnl2.brierTotal || 0) + brierScore;
      pnl2.brierCount = (pnl2.brierCount || 0) + 1;
      pnl2.brierScore = parseFloat((pnl2.brierTotal / pnl2.brierCount).toFixed(4));
      awardExp(30);
      updateCalibration(p.asset, false);
      appendToSoul(`\n### MISTAKE — ${new Date().toISOString()}:\nLOSS on "${p.marketTitle}" (${p.asset}). My: ${(p.myProb * 100).toFixed(0)}% vs market: ${(p.marketPrice * 100).toFixed(0)}%. Edge was ${(p.edge * 100).toFixed(1)}%. Brier Score: ${brierScore}\n`);
    }
    const h = new Date().getHours().toString();
    if (!pnl2.hourStats) pnl2.hourStats = {};
    if (!pnl2.hourStats[h]) pnl2.hourStats[h] = { wins: 0, losses: 0 };
    won ? pnl2.hourStats[h].wins++ : pnl2.hourStats[h].losses++;
    savePnL(pnl2);
    console.log('\n' + (won ? G : R) + BOLD + '  ► ' + (won ? 'WIN' : 'LOSS') + ' resolved: ' + p.marketTitle + ' → $' + (pnlVal >= 0 ? '+' : '') + pnlVal + X + '\n');
    await new Promise(r => setTimeout(r, 1000));
  }
  if (changed) {
    savePositions(pos);
    const pnlFinal = loadPnL();
    if (typeof _agiClient !== 'undefined' && _agiClient) {
       try { autoEvolveSoul(_agiClient, pnlFinal).catch(() => {}); } catch {}
    }
    absorbEliteGenome(pnlFinal);
    pruneDeadChildren(loadPnL());
    runTournamentOfDeath(loadPnL());
    promoteEliteGrandchild(loadPnL());
    const lastClosed = pos.closed[pos.closed.length - 1];
    if (lastClosed) evaluateParentPerformance(loadPnL(), lastClosed);
    checkUsurperPath(loadPnL());
  }
}
