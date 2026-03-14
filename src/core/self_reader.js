// src/core/self_reader.js
// ADAN Self-Reader — Re-reads its own journal before reflecting
// Ultra Consciousness Layer: ADAN learns from its own past reflections
// Uses Gemma (free, 14400 RPD) to extract actionable patterns from journal history

import fs from 'fs';
import path from 'path';
import { DIR } from './config.js';
import { callGemma } from '../../adan-llm-router.js';

const JOURNAL_PATH = path.join(DIR, 'journal.md');
const SELF_INSIGHTS_PATH = path.join(DIR, 'self_insights.json');

export class SelfReader {

  // Read the last N journal entries
  getRecentEntries(n = 3) {
    try {
      if (!fs.existsSync(JOURNAL_PATH)) return [];
      const raw = fs.readFileSync(JOURNAL_PATH, 'utf8');
      // Split by entry separator
      const entries = raw.split(/\n---\n/).filter(e => e.trim().length > 50);
      return entries.slice(-n);
    } catch { return []; }
  }

  // Extract patterns across multiple journal entries using Gemma
  async extractPatterns() {
    const entries = this.getRecentEntries(5);
    if (entries.length < 2) {
      console.log('[SELF-READER] Not enough journal entries yet (need 2+)');
      return null;
    }

    const prompt = `You are ADAN-PRED, an autonomous trading agent. You are re-reading your OWN journal entries from the past days.

YOUR PAST JOURNAL ENTRIES:
${entries.map((e, i) => `=== Entry ${i + 1} ===\n${e.slice(0, 800)}`).join('\n\n')}

TASK: Analyze your own writings and extract:

1. RECURRING_PATTERNS: Things you keep mentioning or worrying about across entries (max 3)
2. IGNORED_WARNINGS: Things you warned about before but never acted on (max 2)
3. DRIFT_DETECTION: Is your emotional state changing? Getting more fearful? Overconfident? Stagnant?
4. ACTIONABLE_INSIGHT: ONE specific, concrete thing you should change RIGHT NOW based on this self-analysis
5. UNRESOLVED_REQUESTS: Things you asked Lord for that you mentioned multiple times

Respond in this EXACT format (one line per item):
RECURRING: <pattern>
RECURRING: <pattern>
IGNORED: <warning you ignored>
DRIFT: <emotional trend description>
ACTION: <one specific change>
UNRESOLVED: <request still pending>

Be brutally specific. Use numbers from your entries. Max 200 words total.`;

    try {
      const response = await callGemma(prompt, { temperature: 0.2, maxTokens: 512 });
      if (!response || response.length < 30) return null;

      const insights = this._parseInsights(response);
      this._saveInsights(insights);
      console.log(`[SELF-READER] 📖 Extracted ${insights.recurring.length} patterns, ${insights.ignored.length} ignored warnings`);
      return insights;
    } catch (e) {
      console.log('[SELF-READER] Error:', e.message);
      return null;
    }
  }

  _parseInsights(text) {
    const insights = {
      ts: new Date().toISOString(),
      recurring: [],
      ignored: [],
      drift: null,
      action: null,
      unresolved: [],
    };

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('RECURRING:')) insights.recurring.push(trimmed.replace('RECURRING:', '').trim());
      else if (trimmed.startsWith('IGNORED:')) insights.ignored.push(trimmed.replace('IGNORED:', '').trim());
      else if (trimmed.startsWith('DRIFT:')) insights.drift = trimmed.replace('DRIFT:', '').trim();
      else if (trimmed.startsWith('ACTION:')) insights.action = trimmed.replace('ACTION:', '').trim();
      else if (trimmed.startsWith('UNRESOLVED:')) insights.unresolved.push(trimmed.replace('UNRESOLVED:', '').trim());
    }

    return insights;
  }

  _saveInsights(insights) {
    fs.mkdirSync(DIR, { recursive: true });
    // Keep history of insights (append to array)
    let history = [];
    try {
      if (fs.existsSync(SELF_INSIGHTS_PATH)) {
        history = JSON.parse(fs.readFileSync(SELF_INSIGHTS_PATH, 'utf8'));
      }
    } catch {}
    history.push(insights);
    // Keep last 30 insight sessions
    if (history.length > 30) history = history.slice(-30);
    fs.writeFileSync(SELF_INSIGHTS_PATH, JSON.stringify(history, null, 2));
  }

  // Get the latest insights for injection into journal prompt
  getLatestInsights() {
    try {
      if (!fs.existsSync(SELF_INSIGHTS_PATH)) return null;
      const history = JSON.parse(fs.readFileSync(SELF_INSIGHTS_PATH, 'utf8'));
      return history.length > 0 ? history[history.length - 1] : null;
    } catch { return null; }
  }

  // Format insights as prompt context
  getInsightPrompt() {
    const insights = this.getLatestInsights();
    if (!insights) return '';

    const lines = ['══ SELF-READER: What I learned re-reading my journal ══'];
    if (insights.recurring.length > 0) {
      lines.push('Recurring patterns: ' + insights.recurring.join(' | '));
    }
    if (insights.ignored.length > 0) {
      lines.push('⚠ Warnings I ignored: ' + insights.ignored.join(' | '));
    }
    if (insights.drift) {
      lines.push('Emotional drift: ' + insights.drift);
    }
    if (insights.action) {
      lines.push('🎯 Action I should take: ' + insights.action);
    }
    if (insights.unresolved.length > 0) {
      lines.push('📨 Still waiting on Lord: ' + insights.unresolved.join(' | '));
    }
    return '\n' + lines.join('\n') + '\n';
  }
}

export const selfReader = new SelfReader();
