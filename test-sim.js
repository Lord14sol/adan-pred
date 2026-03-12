
import IVSolverEngine from './src/core/iv_solver.js';
import { soulManager } from './src/core/soul_manager.js';

const ivSolver = new IVSolverEngine();

const data = {
    asset: 'BTC',
    yesPrice: 0.52,
    noPrice: 0.46,
    hoursToClose: 24,
    ewmaVol: 0.22,
    childSignal: { dir: 'UP', conf: 71 }
};

console.log('--- ADAN v6.5 GATES SIMULATION ---');
console.log(`Input: YES=${data.yesPrice}, NO=${data.noPrice}, EWMA=${data.ewmaVol}, Time=${data.hoursToClose}h`);

// Gate 3.5 Logic
const ivAnalysis = ivSolver.analyzePolymarketBook(data.yesPrice, data.noPrice, data.hoursToClose);
const ivSpread = ivSolver.calculateIVSpread(ivAnalysis.iv, data.ewmaVol);
const ivSignal = ivSolver.generateVolSignal(0, ivSpread, ivAnalysis.iv);

console.log('--- GATE 3.5: IV ANALYSIS ---');
console.log(`- Implied Vol (IV): ${(ivAnalysis.iv * 100).toFixed(2)}%`);
console.log(`- Realized Vol (RV): ${(data.ewmaVol * 100).toFixed(2)}%`);
console.log(`- IV Spread: ${(ivSpread * 100).toFixed(2)}%`);
console.log(`- Vol Signal: ${ivSignal.signal} (Strength: ${ivSignal.strength})`);

let ivStakeMult = 1.0;
if (ivSignal.signal === 'SELL_VOL' && ivSignal.strength > 0.7) {
    console.log('[FACCION] SNAKE: Boost +2 Authority (Stake x1.2)');
    ivStakeMult = 1.2;
} else if (ivSignal.signal === 'BUY_VOL' && ivSignal.strength > 0.7) {
    console.log('[FACCION] EVA: Protective Mode (Stake x0.8)');
    ivStakeMult = 0.8;
}

if (ivSpread < -0.10) {
    console.log('[FACCION] EVA: Expanding VaR Threshold');
}

const ivSoulRule = soulManager.checkIVRegimeRule(ivSpread);
if (ivSoulRule.active) {
    console.log(`[SOUL RULE] ${ivSoulRule.reason}`);
    ivStakeMult *= ivSoulRule.multiplier;
}

console.log(`FINAL IV STAKE MULTIPLIER: ${ivStakeMult}`);
console.log('---------------------------------');
process.exit(0);
