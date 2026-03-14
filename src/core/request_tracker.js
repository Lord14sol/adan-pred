// src/core/request_tracker.js
// ADAN Request Tracker — Tracks requests to Lord with IDs and urgency escalation
// Ultra Consciousness Layer v2.0
//
// ADAN writes requests → assigns ID → checks if Lord responded
// If no response after N cycles, urgency escalates
// Lord can respond by editing lord_responses.json or via dashboard

import fs from 'fs';
import path from 'path';
import { DIR } from './config.js';

const REQUESTS_PATH = path.join(DIR, 'tracked_requests.json');
const RESPONSES_PATH = path.join(DIR, 'lord_responses.json');
const MAX_REQUESTS = 30;

export class RequestTracker {

  constructor() {
    this.data = this._load();
  }

  _load() {
    const defaults = { requests: [], totalSent: 0 };
    try {
      if (fs.existsSync(REQUESTS_PATH)) {
        return { ...defaults, ...JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8')) };
      }
    } catch {}
    return defaults;
  }

  _save() {
    fs.mkdirSync(DIR, { recursive: true });
    if (this.data.requests.length > MAX_REQUESTS) {
      this.data.requests = this.data.requests.slice(-MAX_REQUESTS);
    }
    fs.writeFileSync(REQUESTS_PATH, JSON.stringify(this.data, null, 2));
  }

  // ── Create a new tracked request ──
  createRequest(message, category = 'general', data = {}) {
    const id = `req_${++this.data.totalSent}_${Date.now().toString(36)}`;
    const request = {
      id,
      message,
      category, // 'data_source', 'bug', 'strategy', 'capital', 'code', 'general'
      status: 'pending', // 'pending', 'acknowledged', 'resolved', 'dismissed'
      urgency: 1, // 1-5, escalates over time
      createdAt: new Date().toISOString(),
      lastEscalated: new Date().toISOString(),
      cyclesSinceSent: 0,
      response: null,
      ...data,
    };

    this.data.requests.push(request);
    this._save();

    console.log(`[REQUESTS] 📨 New request #${id}: "${message.slice(0, 60)}..." [${category}]`);
    return request;
  }

  // ── Escalate urgency for unanswered requests ──
  escalate() {
    let escalated = 0;
    const now = Date.now();

    for (const req of this.data.requests) {
      if (req.status !== 'pending') continue;

      req.cyclesSinceSent++;

      // Escalate every 3 cycles (roughly every 3 dream modes = ~3 days)
      const timeSinceEscalation = now - new Date(req.lastEscalated).getTime();
      const hoursWaiting = timeSinceEscalation / (1000 * 60 * 60);

      if (hoursWaiting >= 24 && req.urgency < 5) {
        req.urgency = Math.min(5, req.urgency + 1);
        req.lastEscalated = new Date().toISOString();
        escalated++;
        console.log(`[REQUESTS] ⬆️ Escalated #${req.id} to urgency ${req.urgency}: "${req.message.slice(0, 40)}..."`);
      }
    }

    // Check for Lord's responses
    this._checkResponses();
    this._save();

    return escalated;
  }

  // ── Check if Lord left responses in lord_responses.json ──
  _checkResponses() {
    try {
      if (!fs.existsSync(RESPONSES_PATH)) return;
      const responses = JSON.parse(fs.readFileSync(RESPONSES_PATH, 'utf8'));
      if (!Array.isArray(responses)) return;

      for (const resp of responses) {
        if (!resp.requestId || resp.processed) continue;

        const req = this.data.requests.find(r => r.id === resp.requestId);
        if (req) {
          req.status = resp.action || 'resolved'; // 'acknowledged', 'resolved', 'dismissed'
          req.response = resp.message || 'Lord acknowledged';
          req.respondedAt = new Date().toISOString();
          resp.processed = true;
          console.log(`[REQUESTS] ✅ Lord responded to #${req.id}: "${(resp.message || '').slice(0, 40)}"`);
        }
      }

      // Save processed responses back
      fs.writeFileSync(RESPONSES_PATH, JSON.stringify(responses, null, 2));
    } catch {}
  }

  // ── Get pending requests (for voice/journal) ──
  getPending() {
    return this.data.requests.filter(r => r.status === 'pending');
  }

  // ── Get urgent requests (urgency >= 3) ──
  getUrgent() {
    return this.data.requests.filter(r => r.status === 'pending' && r.urgency >= 3);
  }

  // ── Format for journal/voice ──
  getRequestSummary() {
    const pending = this.getPending();
    if (pending.length === 0) return '';

    const lines = ['══ REQUEST TRACKER: Pending requests to Lord ══'];
    for (const req of pending) {
      const urgencyBar = '🔴'.repeat(Math.min(req.urgency, 5));
      const daysWaiting = Math.floor((Date.now() - new Date(req.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      lines.push(`  ${urgencyBar} #${req.id} [${req.category}] (${daysWaiting}d waiting): ${req.message.slice(0, 80)}`);
    }
    return '\n' + lines.join('\n') + '\n';
  }

  // ── Get stats for dashboard ──
  getStatus() {
    const pending = this.getPending();
    const urgent = this.getUrgent();
    return {
      total: this.data.totalSent,
      pending: pending.length,
      urgent: urgent.length,
      resolved: this.data.requests.filter(r => r.status === 'resolved').length,
      requests: pending.slice(-5).map(r => ({
        id: r.id,
        message: r.message.slice(0, 60),
        urgency: r.urgency,
        category: r.category,
        daysWaiting: Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
      })),
    };
  }
}

export const requestTracker = new RequestTracker();
