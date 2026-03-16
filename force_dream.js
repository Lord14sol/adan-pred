#!/usr/bin/env node
// Force Dream Cycle — runs walk-forward retrain, calibrator, market filter bootstrap
// Usage: node force_dream.js

import { walkForward } from './src/ml/walk_forward.js';
import { calibrator } from './src/ml/calibrator.js';
import { marketFilter } from './src/ml/market_filter.js';
import { statModel, LogisticRegression } from './src/ml/logistic_regression.js';
import { shapleyAnalyzer } from './src/ml/shapley_values.js';
import { metaLabeler } from './src/ml/meta_labeler.js';
import { purgedWF } from './src/ml/purged_walkforward.js';
import { tripleBarrier } from './src/ml/triple_barrier.js';
import { evolutionStrategies } from './src/ml/evolution_strategies.js';
import { loadPositions } from './src/core/config.js';

console.log('═'.repeat(60));
console.log('  FORCED DREAM CYCLE — v8.3 Complete Intelligence');
console.log('═'.repeat(60));

// 1. Walk-forward retrain with 32 features
console.log('\n[1/5] WALK-FORWARD RETRAIN...');
try {
  const wfResult = walkForward.run();
  if (wfResult) {
    console.log(`  OOS WR: ${wfResult.overallOOSWR}% over ${wfResult.folds} folds`);
    console.log(`  Log-loss: ${wfResult.overallLogLoss}`);
    console.log(`  Model ready: ${wfResult.modelReady}`);
    console.log(`  Best fold: ${wfResult.bestFold.wr}% WR (train=${wfResult.bestFold.trainSize})`);
    console.log(`  Worst fold: ${wfResult.worstFold.wr}% WR (train=${wfResult.worstFold.trainSize})`);
    console.log(`  Top features:`);
    wfResult.featureImportance.slice(0, 10).forEach(f => {
      console.log(`    ${f.name}: ${f.weight > 0 ? '+' : ''}${f.weight.toFixed(4)}`);
    });
  } else {
    console.log('  No result (not enough trades with features?)');
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 2. Check calibrator status
console.log('\n[2/5] CALIBRATOR STATUS...');
try {
  const calStatus = calibrator.getStatus();
  console.log(`  Built: ${calStatus.built} | Breakpoints: ${calStatus.breakpoints}`);
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 3. Market filter bootstrap
console.log('\n[3/5] MARKET FILTER BOOTSTRAP...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  console.log(`  Bootstrapping from ${closed.length} closed trades...`);
  marketFilter.bootstrap(closed);
  const mfStatus = marketFilter.getStatus();
  console.log(`  Asset stats:`);
  for (const [k, v] of Object.entries(mfStatus.assetStats || {})) {
    console.log(`    ${k}: ${(v.wins/v.total*100).toFixed(1)}% WR (${v.total} trades)`);
  }
  console.log(`  Window stats:`);
  for (const [k, v] of Object.entries(mfStatus.windowStats || {})) {
    console.log(`    ${k}min: ${(v.wins/v.total*100).toFixed(1)}% WR (${v.total} trades)`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 4. Shapley Value Feature Importance (Concept #7)
console.log('\n[4/5] SHAPLEY VALUE ANALYSIS...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  if (statModel.trained) {
    const shapResult = shapleyAnalyzer.analyze(closed, statModel);
    if (shapResult) {
      const status = shapleyAnalyzer.getStatus();
      console.log(`  Helpful features (${status.helpful}): ${status.topFeatures.join(', ')}`);
      if (status.harmful > 0) {
        console.log(`  HARMFUL features (${status.harmful}): ${status.harmfulFeatures.join(', ')}`);
      }
      console.log(`  Irrelevant features: ${status.irrelevant}`);
      console.log(`  Compute time: ${status.computeTimeMs}ms`);
    } else {
      console.log('  Not enough trades for Shapley analysis');
    }
  } else {
    console.log('  Skipping — model not trained yet');
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 5. Final model status
console.log('\n[5/5] STAT MODEL STATUS...');
try {
  const status = statModel.getStatus();
  console.log(`  Trained: ${status.trained}`);
  console.log(`  Train samples: ${status.trainSamples}`);
  console.log(`  Train WR: ${status.trainWR}%`);
  console.log(`  OOS WR: ${status.oosWR}%`);
  console.log(`  Online updates: ${status.onlineUpdates}`);
  console.log(`  Top features: ${status.topFeatures.join(', ')}`);
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 6. SEED META-LABELER with historical trades
console.log('\n[6/8] SEEDING META-LABELER...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  let seeded = 0;
  for (const t of closed) {
    if (!t.entryVec || t.won === null || t.won === undefined) continue;
    // Reconstruct meta-features from what we have
    const metaFeatures = {
      primary_confidence: (t.confidence || 50) / 100,
      ensemble_agreement: 0.1,
      primary_probability: t.myProb || 0.5,
      edge_magnitude: Math.abs(t.edge || 0),
      volatility: t.entryVec[10] || 0, // volatility from feature vec
      volume_ratio: t.entryVec[5] || 1, // volRatio
      hour_bin_score: 0,
      streak: 0,
      time_to_close: Math.log(5 + 1),
      dynasty_consensus: 0.5,
      taker_ratio: 0,
      oi_delta: 0,
    };
    metaLabeler.update(metaFeatures, t.won);
    seeded++;
  }
  console.log(`  Seeded ${seeded} samples into Meta-Labeler`);
  if (metaLabeler.isReady()) {
    console.log(`  META-LABELER IS NOW ACTIVE!`);
    const status = metaLabeler.getStatus();
    console.log(`  Train acc: ${status.trainAcc} | Vetoes: ${status.vetoes} | Veto precision: ${status.vetoPrecision}`);
  } else {
    console.log(`  Samples: ${metaLabeler.getStatus().samples} — needs 200 to activate`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 7. SEED PURGED WALK-FORWARD CV with historical trades
console.log('\n[7/8] SEEDING PURGED WALK-FORWARD CV...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  let seeded = 0;
  for (const t of closed) {
    if (!t.entryVec || t.won === null || t.won === undefined) continue;
    purgedWF.addSample(t.entryVec, t.won, t.entryTime ? new Date(t.entryTime).getTime() : Date.now());
    seeded++;
  }
  console.log(`  Seeded ${seeded} samples into Purged WF`);
  const wfStatus = purgedWF.getStatus();
  console.log(`  Samples: ${wfStatus.samples} | Validations: ${wfStatus.validationRuns}`);
  if (wfStatus.lastValidation) {
    console.log(`  Test Acc: ${wfStatus.lastValidation.testAcc} | Overfit: ${wfStatus.lastValidation.overfit} | Reliable: ${wfStatus.lastValidation.reliable}`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 8. SEED TRIPLE BARRIER with historical trades
console.log('\n[8/8] SEEDING TRIPLE BARRIER...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  let labeled = 0;
  for (const t of closed) {
    if (t.won === null || t.won === undefined) continue;
    const entryP = t.sniperPrice || t.marketPrice || 0.5;
    const exitP = t.won ? entryP * 1.01 : entryP * 0.99;
    const vol = t.entryVec?.[10] || 1;
    tripleBarrier.labelTrade(entryP, exitP, t.side, 5, vol);
    labeled++;
  }
  // Manually trigger stats recording for the labels
  console.log(`  Labeled ${labeled} historical trades`);
  console.log(`  Stats: ${JSON.stringify(tripleBarrier.getStats())}`);
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 9. EVOLUTION STRATEGIES — evolve Kelly/edge/confidence params
console.log('\n[9/9] EVOLUTION STRATEGIES...');
try {
  const posData = loadPositions();
  const closed = posData.closed || [];
  const esInput = closed.slice(-200).map(t => ({
    pnl: t.pnl || 0,
    edge: t.edge || 0,
    confidence: t.confidence || 50,
    stake: t.stake || 100,
  }));
  if (esInput.length >= 50) {
    const result = evolutionStrategies.evolve(esInput);
    if (result) {
      const best = evolutionStrategies.getBestParams();
      console.log(`  Generation: ${result.generation} | Fitness: ${result.fitness?.toFixed(4)}`);
      console.log(`  Best params: kellyBase=${best.kellyBase.toFixed(3)} edgeMin=${(best.edgeMin*100).toFixed(1)}% confFloor=${best.confidenceFloor}`);
    }
  } else {
    console.log(`  Not enough trades (${esInput.length}/50)`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

console.log('\n' + '═'.repeat(60));
console.log('  DREAM COMPLETE — ALL MODULES SEEDED');
console.log('═'.repeat(60));
