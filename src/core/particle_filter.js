// src/core/particle_filter.js
// Bootstrap Particle Filter — true probability vs noisy market price
// 200 particles (reduced from 500 for CPU efficiency, still statistically valid)
// Part of Mother Code v2.0 — Quant Intelligence Layer

export class ParticleFilter {
    constructor({ nParticles = 200, processNoise = 0.08, obsNoise = 0.15 } = {}) {
        this.N = nParticles;
        this.procNoise = processNoise;
        this.obsNoise = obsNoise;
        this.markets = new Map();
    }

    _randn() {
        const u = Math.random(), v = Math.random();
        return Math.sqrt(-2 * Math.log(u + 1e-10)) * Math.cos(2 * Math.PI * v);
    }

    _logit(p) { return Math.log(Math.max(0.001, Math.min(0.999, p)) / (1 - Math.max(0.001, Math.min(0.999, p)))); }
    _sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

    _initMarket(marketId, yesPrice) {
        const logitPrice = this._logit(yesPrice);
        const particles = Array.from({ length: this.N }, () => logitPrice + this._randn() * 0.3);
        this.markets.set(marketId, {
            particles,
            weights: new Array(this.N).fill(1 / this.N),
            estimates: [],
            lastUpdate: Date.now()
        });
    }

    _systematicResample(particles, weights) {
        const N = particles.length;
        const cumW = [];
        let cum = 0;
        for (const w of weights) { cum += w; cumW.push(cum); }
        const newP = [];
        const start = Math.random() / N;
        let j = 0;
        for (let i = 0; i < N; i++) {
            const u = start + i / N;
            while (j < N - 1 && cumW[j] < u) j++;
            newP.push(particles[j] + this._randn() * 0.02);
        }
        return newP;
    }

    update(marketId, yesPrice, additionalSignals = {}) {
        if (!this.markets.has(marketId)) this._initMarket(marketId, yesPrice);
        const filter = this.markets.get(marketId);
        const logitObs = this._logit(yesPrice);

        // Propagate
        filter.particles = filter.particles.map(p => p + this._randn() * this.procNoise);

        // Reweight by likelihood
        filter.weights = filter.particles.map(p => {
            const diff = logitObs - p;
            return Math.exp(-0.5 * (diff / this.obsNoise) ** 2);
        });

        if (additionalSignals.signalLogitUpdate) {
            const boost = additionalSignals.signalLogitUpdate;
            filter.weights = filter.weights.map((w, i) => {
                const diff2 = filter.particles[i] - boost;
                return w * (0.7 + 0.3 * Math.exp(-0.5 * (diff2 / 0.5) ** 2));
            });
        }

        const total = filter.weights.reduce((a, b) => a + b, 0);
        filter.weights = total > 0 ? filter.weights.map(w => w / total) : new Array(this.N).fill(1 / this.N);

        // Resample
        filter.particles = this._systematicResample(filter.particles, filter.weights);
        filter.weights = new Array(this.N).fill(1 / this.N);

        // Estimate
        const meanLogit = filter.particles.reduce((s, p) => s + p, 0) / this.N;
        const varLogit = filter.particles.reduce((s, p) => s + (p - meanLogit) ** 2, 0) / this.N;
        const trueProb = this._sigmoid(meanLogit);
        const sigma = Math.sqrt(varLogit);

        const estimate = {
            trueProbability: parseFloat(trueProb.toFixed(4)),
            marketPrice: parseFloat(yesPrice.toFixed(4)),
            uncertainty: parseFloat(sigma.toFixed(4)),
            confidenceInterval: {
                low: parseFloat(this._sigmoid(meanLogit - 1.96 * sigma).toFixed(4)),
                high: parseFloat(this._sigmoid(meanLogit + 1.96 * sigma).toFixed(4))
            },
            mispricing: parseFloat((trueProb - yesPrice).toFixed(4)),
            t: Date.now()
        };

        filter.estimates.push(estimate);
        if (filter.estimates.length > 50) filter.estimates.shift();
        filter.lastUpdate = Date.now();

        const trend = this._detectTrend(filter.estimates.slice(-5));
        const icon = Math.abs(estimate.mispricing) > 0.05 ? '⚡' : '◎';
        console.log('[PARTICLE]', icon,
            'True P(YES):', (estimate.trueProbability * 100).toFixed(1) + '%',
            '| Market:', (estimate.marketPrice * 100).toFixed(1) + '%',
            '| Misprice:', (estimate.mispricing >= 0 ? '+' : '') + (estimate.mispricing * 100).toFixed(1) + '%',
            '| σ:', sigma.toFixed(3), '| Trend:', trend);

        return { ...estimate, trend };
    }

    _detectTrend(estimates) {
        if (estimates.length < 3) return 'INSUFFICIENT_DATA';
        const probs = estimates.map(e => e.trueProbability);
        let up = 0, down = 0;
        for (let i = 1; i < probs.length; i++) {
            if (probs[i] > probs[i - 1] + 0.01) up++;
            else if (probs[i] < probs[i - 1] - 0.01) down++;
        }
        if (up >= probs.length - 2) return 'TRENDING_UP';
        if (down >= probs.length - 2) return 'TRENDING_DOWN';
        return 'STABLE';
    }

    getEstimate(marketId) {
        const f = this.markets.get(marketId);
        return f?.estimates?.length > 0 ? f.estimates[f.estimates.length - 1] : null;
    }

    cleanup() {
        const now = Date.now();
        for (const [id, f] of this.markets.entries()) {
            if (now - f.lastUpdate > 7200000) this.markets.delete(id);
        }
    }
}

export const particleFilter = new ParticleFilter();
