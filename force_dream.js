#!/usr/bin/env node
// Force Dream Cycle — runs walk-forward retrain, calibrator, market filter bootstrap
// Usage: node force_dream.js

import { walkForward } from './src/ml/walk_forward.js';
import { calibrator } from './src/ml/calibrator.js';
import { marketFilter } from './src/ml/market_filter.js';
import { statModel } from './src/ml/logistic_regression.js';
import { shapleyAnalyzer } from './src/ml/shapley_values.js';
import { loadPositions } from './src/core/config.js';

console.log('═'.repeat(60));
console.log('  FORCED DREAM CYCLE — v7.0 Alien Intelligence');
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

console.log('\n' + '═'.repeat(60));
console.log('  DREAM COMPLETE');
console.log('═'.repeat(60));
