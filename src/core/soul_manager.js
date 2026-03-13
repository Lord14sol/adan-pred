// Resuelve el PROBLEMA CRÍTICO: SOUL.md de 470KB no cabe en Gemma (15K TPM)
// Solo pasa las top-6 reglas más relevantes al prompt

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME, '.adan-pred');
const RULES_FILE = path.join(DIR, 'soul_rules.json');
const SOUL_FILE = path.join(DIR, 'SOUL.md');

export class SoulManager {
    constructor() {
        this.rules = this._load();
        this.deduplicateRules();
        this.ivCounter = 0; // [ADAN v6.5] Track consecutive IV spikes
    }

    deduplicateRules() {
        // Remove rules where text similarity > 80% (keep highest confidence)
        const seen = new Map();
        this.rules = this.rules.filter(r => {
            // Create a normalized key: remove specific numbers, keep pattern structure
            const key = r.text
                .replace(/[-\d.]+%/g, 'X%')  // normalize percentages
                .replace(/confirmed \dx/g, '')
                .trim().slice(0, 80);
            if (seen.has(key)) {
                // Keep whichever has higher confidence
                // The following lines were provided in the instruction but are syntactically incorrect
                // in this context and would cause a runtime error or unexpected behavior.
                // They seem to be part of a different function or a misplaced snippet.
                // To maintain syntactic correctness and avoid breaking the code,
                // I'm commenting them out as they cannot be integrated faithfully as-is.
                // confidence = Math.max(40, Math.min(98, confidence));
                // return parseFloat(confidence.toFixed(1)); {
                if (r.confidence > seen.get(key).confidence) {
                    seen.set(key, r);
                    return true;
                }
                return false;
            }
            seen.set(key, r);
            return true;
        });
        fs.writeFileSync(RULES_FILE, JSON.stringify(this.rules, null, 2));
        console.log(`[SOUL] After dedup: ${this.rules.length} unique rules`);
    }

    _load() {
        try { return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); }
        catch { return this._migrate(); }
    }

    _pruneOnMigration(rules) {
        const KEEP_KEYWORDS = ['NEVER', 'ALWAYS', 'DREAM_RULE', '→', 'BTC', 'ETH', 'funding', 'sell wall'];
        return rules
            .filter(r => KEEP_KEYWORDS.some(k => r.text.includes(k)))
            .slice(0, 200);
    }

    _migrate() {
        const rules = [];
        try {
            if (fs.existsSync(SOUL_FILE)) {
                const lines = fs.readFileSync(SOUL_FILE, 'utf8').split('\n');
                lines.forEach((line, i) => {
                    if (line.includes('→') || line.includes('NEVER') ||
                        line.includes('ALWAYS') || line.includes('DREAM_RULE')) {
                        rules.push({
                            id: `m_${i}`, text: line.trim().slice(0, 200),
                            confidence: 0.5, sample_size: 1,
                            asset: null, timeframe: null,
                            wins: 0, losses: 0,
                            created: new Date().toISOString()
                        });
                    }
                });
            }
        } catch { }
        if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
        const pruned = this._pruneOnMigration(rules);
        fs.writeFileSync(RULES_FILE, JSON.stringify(pruned, null, 2));
        return pruned;
    }

    // Lo que va al prompt de Gemma — máximo 6 reglas, ~400 tokens
    getRelevantRules({ asset, timeframe } = {}) {
        return this.rules
            .filter(r => r.confidence >= 0.3 && r.sample_size >= 2)
            .map(r => ({
                ...r, score:
                    (r.asset === asset ? 3 : 0) +
                    (r.timeframe === timeframe ? 2 : 0) +
                    r.confidence * 2 + Math.min(r.sample_size, 10) * 0.1
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map(r => `• [${r.confidence.toFixed(2)}|n=${r.sample_size}] ${r.text}`)
            .join('\n');
    }

    addRule(text, { won, asset, timeframe, tag = 'RULE' } = {}) {
        const existing = this.rules.find(r => r.text.slice(0, 50) === text.slice(0, 50));
        if (existing) {
            existing.sample_size++;
            if (won === true) existing.wins++;
            if (won === false) existing.losses++;
            const total = existing.wins + existing.losses;
            if (total > 0) existing.confidence = existing.wins / total;
        } else {
            this.rules.push({
                id: `r_${Date.now()}`, text: text.trim().slice(0, 300),
                confidence: 0.5, sample_size: 1,
                asset: asset ?? null, timeframe: timeframe ?? null,
                wins: won === true ? 1 : 0, losses: won === false ? 1 : 0,
                created: new Date().toISOString()
            });
        }
        // Prunar reglas malas (n>=10, conf<0.25)
        this.rules = this.rules.filter(r => !(r.sample_size >= 10 && r.confidence < 0.25));
        fs.writeFileSync(RULES_FILE, JSON.stringify(this.rules));
        const entry = `\n[${new Date().toISOString()}] ${tag}: ${text}`;
        fs.appendFileSync(SOUL_FILE, entry);

        // Log rotation for SOUL.md
        try {
            const stats = fs.statSync(SOUL_FILE);
            if (stats.size > 5 * 1024 * 1024) {
                const lines = fs.readFileSync(SOUL_FILE, 'utf8').split('\n');
                if (lines.length > 2000) {
                    fs.writeFileSync(SOUL_FILE, lines.slice(0, 50).join('\n') + '\n... [TRUNCATED] ...\n' + lines.slice(-1000).join('\n'));
                }
            }
        } catch (e) { }
    }

    // [ADAN v6.5] Automated IV Regime Rule
    checkIVRegimeRule(ivSpread) {
        if (ivSpread > 0.20) {
            this.ivCounter++;
            if (this.ivCounter >= 3) {
                return {
                    active: true,
                    multiplier: 0.5,
                    reason: "IV_REGIME_OVERPRICED: IV spread > 20% for 3+ cycles. Reducing stakes to 50%."
                };
            }
        } else {
            this.ivCounter = 0;
        }
        return { active: false, multiplier: 1.0 };
    }
}
export const soulManager = new SoulManager();
