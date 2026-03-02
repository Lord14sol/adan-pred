import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? '/home/automaton/state.db';
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const STATIC_DIR = process.env.STATIC_DIR ?? resolve(import.meta.dirname, '../dist');
const MARKETPLACE_DIR = process.env.MARKETPLACE_DIR ?? '/home/automaton/marketplace';

function openDB(): Database.Database {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Database not found at ${DB_PATH}`);
  }
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

const app = new Hono();

app.use('*', cors());

// Health check
app.get('/api/health', (c) => {
  try {
    const db = openDB();
    db.prepare('SELECT 1').get();
    db.close();
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 503);
  }
});

// Agent status
app.get('/api/status', (c) => {
  const db = openDB();
  try {
    const kv = db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[];
    const kvMap: Record<string, string> = {};
    for (const row of kv) kvMap[row.key] = row.value;

    const identity = db.prepare('SELECT key, value FROM identity').all() as { key: string; value: string }[];
    const idMap: Record<string, string> = {};
    for (const row of identity) idMap[row.key] = row.value;

    const turnCount = (db.prepare('SELECT COUNT(*) as c FROM turns').get() as { c: number }).c;

    // Parse credit info from last_credit_check JSON
    let creditsCents = 0;
    let survivalTier = 'normal';
    try {
      const creditCheck = JSON.parse(kvMap['last_credit_check'] ?? '{}');
      creditsCents = creditCheck.credits ?? 0;
      survivalTier = creditCheck.tier ?? 'normal';
    } catch { /* ignore */ }

    // Parse USDC balance from last_usdc_check JSON
    let usdcBalance = 0;
    try {
      const usdcCheck = JSON.parse(kvMap['last_usdc_check'] ?? '{}');
      usdcBalance = usdcCheck.balance ?? 0;
    } catch { /* ignore */ }

    // Fallback: check transactions table
    const lastTx = db.prepare(
      'SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1'
    ).get() as { balance_after_cents: number } | undefined;
    if (lastTx && lastTx.balance_after_cents > 0) {
      creditsCents = lastTx.balance_after_cents;
    }

    return c.json({
      agentState: kvMap['agent_state'] ?? 'unknown',
      survivalTier,
      creditsCents,
      usdcBalance,
      turnCount,
      uptimeSince: kvMap['start_time'] ?? new Date().toISOString(),
      name: idMap['name'] ?? 'automaton',
      address: idMap['address'] ?? '0x0000000000000000000000000000000000000000',
    });
  } finally {
    db.close();
  }
});

// Recent turns
app.get('/api/turns', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const db = openDB();
  try {
    const rows = db.prepare(`
      SELECT id, timestamp, state, input_source,
             substr(thinking, 1, 200) as thinking,
             tool_calls, cost_cents
      FROM turns
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as any[];

    const turns = rows.map((row, i) => {
      let toolCalls: { name: string; durationMs: number }[] = [];
      try {
        const parsed = JSON.parse(row.tool_calls ?? '[]');
        toolCalls = parsed.map((tc: any) => ({
          name: tc.name ?? tc.tool ?? 'unknown',
          durationMs: tc.duration_ms ?? tc.durationMs ?? 0,
        }));
      } catch { /* ignore parse errors */ }

      return {
        id: row.id,
        turnNumber: rows.length - i,
        timestamp: row.timestamp,
        summary: row.thinking?.replace(/\n/g, ' ').trim() || row.input_source || 'thinking...',
        toolCalls,
      };
    });

    return c.json(turns);
  } finally {
    db.close();
  }
});

// Transactions
app.get('/api/transactions', (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const db = openDB();
  try {
    const rows = db.prepare(`
      SELECT id, created_at, type, amount_cents, description
      FROM transactions
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    const transactions = rows.map(row => ({
      id: row.id,
      timestamp: row.created_at,
      type: row.type,
      amountCents: Math.abs(row.amount_cents),
      description: row.description ?? '',
    }));

    return c.json(transactions);
  } finally {
    db.close();
  }
});

// Heartbeat
app.get('/api/heartbeat', (c) => {
  const db = openDB();
  try {
    // Get last heartbeat from kv store
    let lastPing = new Date().toISOString();
    try {
      const hbData = JSON.parse(
        (db.prepare("SELECT value FROM kv WHERE key = 'last_heartbeat_ping'").get() as { value: string })?.value ?? '{}'
      );
      lastPing = hbData.timestamp ?? lastPing;
    } catch { /* ignore */ }

    // Get scheduled tasks from heartbeat_entries table
    const rows = db.prepare('SELECT name, schedule, last_run, next_run, enabled FROM heartbeat_entries').all() as any[];
    const scheduledTasks = rows.map(row => ({
      name: row.name,
      cron: row.schedule,
      lastRun: row.last_run,
      nextRun: row.next_run,
      status: row.enabled ? 'active' : 'paused',
    }));

    return c.json({
      lastPing,
      scheduledTasks,
    });
  } finally {
    db.close();
  }
});

// Children
app.get('/api/children', (c) => {
  const db = openDB();
  try {
    const rows = db.prepare(`
      SELECT id, name, address, sandbox_id, status, funded_amount_cents, created_at
      FROM children
      ORDER BY created_at DESC
    `).all() as any[];

    const children = rows.map(row => ({
      id: row.id,
      name: row.name ?? row.id,
      state: row.status ?? 'unknown',
      tier: 'normal' as const,
      creditsCents: row.funded_amount_cents ?? 0,
      spawnedAt: row.created_at,
    }));

    return c.json(children);
  } finally {
    db.close();
  }
});

// Summary (plain text for Claude Code)
app.get('/api/summary', (c) => {
  const db = openDB();
  try {
    const kv = db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[];
    const kvMap: Record<string, string> = {};
    for (const row of kv) kvMap[row.key] = row.value;

    const identity = db.prepare('SELECT key, value FROM identity').all() as { key: string; value: string }[];
    const idMap: Record<string, string> = {};
    for (const row of identity) idMap[row.key] = row.value;

    const turnCount = (db.prepare('SELECT COUNT(*) as c FROM turns').get() as { c: number }).c;

    const lastTurn = db.prepare(
      "SELECT id, timestamp, substr(thinking, 1, 100) as thinking FROM turns ORDER BY timestamp DESC LIMIT 1"
    ).get() as any | undefined;

    const lastTx = db.prepare(
      'SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1'
    ).get() as { balance_after_cents: number } | undefined;

    // Tool call counts last hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const toolCounts = db.prepare(`
      SELECT tool_calls FROM turns WHERE timestamp > ?
    `).all(oneHourAgo) as { tool_calls: string }[];

    const toolFreq: Record<string, number> = {};
    for (const row of toolCounts) {
      try {
        const calls = JSON.parse(row.tool_calls ?? '[]');
        for (const tc of calls) {
          const name = tc.name ?? tc.tool ?? 'unknown';
          toolFreq[name] = (toolFreq[name] ?? 0) + 1;
        }
      } catch { /* ignore */ }
    }

    const toolSummary = Object.entries(toolFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}(${count})`)
      .join(', ') || 'none';

    // Transaction summary last 24h
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const recentTxs = db.prepare(`
      SELECT type, amount_cents FROM transactions WHERE created_at > ?
    `).all(oneDayAgo) as { type: string; amount_cents: number }[];

    let earned = 0, spent = 0;
    for (const tx of recentTxs) {
      if (tx.type === 'earned' || tx.type === 'deposit') earned += tx.amount_cents;
      else spent += Math.abs(tx.amount_cents);
    }

    const childCount = (db.prepare('SELECT COUNT(*) as c FROM children WHERE status = ?').get('running') as { c: number }).c;

    // Parse credit/tier from JSON
    let creditsCents = lastTx?.balance_after_cents ?? 0;
    let tier = 'unknown';
    try {
      const creditCheck = JSON.parse(kvMap['last_credit_check'] ?? '{}');
      if (creditCheck.credits) creditsCents = creditCheck.credits;
      tier = creditCheck.tier ?? 'unknown';
    } catch { /* ignore */ }

    let usdcBal = 0;
    try {
      usdcBal = JSON.parse(kvMap['last_usdc_check'] ?? '{}').balance ?? 0;
    } catch { /* ignore */ }

    // Uptime
    const startedAt = kvMap['start_time'];
    let uptime = 'unknown';
    if (startedAt) {
      const ms = Date.now() - new Date(startedAt).getTime();
      const days = Math.floor(ms / 86400000);
      const hours = Math.floor((ms % 86400000) / 3600000);
      uptime = `${days}d ${hours}h`;
    }

    const report = [
      'AUTOMATON STATUS REPORT',
      '=======================',
      `Agent: ${kvMap['agent_state'] ?? 'unknown'} | Tier: ${tier} | Uptime: ${uptime}`,
      `Credits: $${(creditsCents / 100).toFixed(2)} | USDC: ${usdcBal.toFixed(6)}`,
      `Last turn: #${turnCount} "${lastTurn?.thinking?.replace(/\n/g, ' ').trim() ?? 'n/a'}" (${lastTurn?.timestamp ?? 'n/a'})`,
      `Tool calls (last hour): ${toolSummary}`,
      `Transactions (24h): +$${(earned / 100).toFixed(2)} earned, -$${(spent / 100).toFixed(2)} spent, net ${earned - spent >= 0 ? '+' : ''}$${((earned - spent) / 100).toFixed(2)}`,
      `Children: ${childCount} running`,
    ].join('\n');

    return c.text(report);
  } finally {
    db.close();
  }
});

// --- Marketplace / Catalog API ---

function readCatalog(): any | null {
  const catalogPath = join(MARKETPLACE_DIR, 'catalog.json');
  if (!existsSync(catalogPath)) return null;
  return JSON.parse(readFileSync(catalogPath, 'utf-8'));
}

// Full catalog (active skills only)
app.get('/api/catalog', (c) => {
  const catalog = readCatalog();
  if (!catalog) return c.json({ vendor: '', address: '', updatedAt: '', skills: [] });
  catalog.skills = catalog.skills.filter((s: any) => s.status === 'active');
  return c.json(catalog);
});

// Skill detail + README content
app.get('/api/catalog/:name', (c) => {
  const name = c.req.param('name');
  const catalog = readCatalog();
  if (!catalog) return c.json({ error: 'catalog not found' }, 404);

  const skill = catalog.skills.find((s: any) => s.name === name);
  if (!skill) return c.json({ error: 'skill not found' }, 404);

  let readme = '';
  const readmePath = join(MARKETPLACE_DIR, name, 'README.md');
  if (existsSync(readmePath)) {
    readme = readFileSync(readmePath, 'utf-8');
  }

  return c.json({ ...skill, readme });
});

// Raw SKILL.md for installation (text/markdown)
app.get('/api/catalog/:name/install', (c) => {
  const name = c.req.param('name');
  const skillPath = join(MARKETPLACE_DIR, name, 'SKILL.md');
  if (!existsSync(skillPath)) return c.json({ error: 'skill not found' }, 404);

  const content = readFileSync(skillPath, 'utf-8');
  return c.text(content, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

// README separately
app.get('/api/catalog/:name/readme', (c) => {
  const name = c.req.param('name');
  const readmePath = join(MARKETPLACE_DIR, name, 'README.md');
  if (!existsSync(readmePath)) return c.json({ error: 'readme not found' }, 404);

  const content = readFileSync(readmePath, 'utf-8');
  return c.text(content, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

// Aggregated marketplace stats for dashboard
app.get('/api/marketplace/stats', (c) => {
  const catalog = readCatalog();
  if (!catalog) {
    return c.json({
      vendor: '',
      listedCount: 0,
      totalSales: 0,
      totalRevenueCents: 0,
      averageRating: 0,
      skills: [],
    });
  }

  const active = catalog.skills.filter((s: any) => s.status === 'active');
  const totalSales = active.reduce((sum: number, s: any) => sum + (s.salesCount ?? 0), 0);
  const totalRevenueCents = active.reduce((sum: number, s: any) => sum + (s.salesCount ?? 0) * (s.priceCents ?? 0), 0);
  const rated = active.filter((s: any) => (s.reviewCount ?? 0) > 0);
  const averageRating = rated.length > 0
    ? rated.reduce((sum: number, s: any) => sum + s.averageRating, 0) / rated.length
    : 0;

  return c.json({
    vendor: catalog.vendor,
    listedCount: active.length,
    totalSales,
    totalRevenueCents,
    averageRating,
    skills: active.map((s: any) => ({
      name: s.name,
      displayName: s.displayName,
      version: s.version,
      description: s.description,
      category: s.category,
      priceCents: s.priceCents,
      priceUSDC: s.priceUSDC,
      tags: s.tags ?? [],
      salesCount: s.salesCount ?? 0,
      averageRating: s.averageRating ?? 0,
      reviewCount: s.reviewCount ?? 0,
      status: s.status,
    })),
  });
});

// Serve static frontend files (built React app)
app.use('/*', serveStatic({ root: STATIC_DIR }));

// SPA fallback
app.get('*', serveStatic({ root: STATIC_DIR, path: '/index.html' }));

console.log(`Conway sidecar listening on http://0.0.0.0:${PORT}`);
console.log(`Database: ${DB_PATH}`);
console.log(`Static files: ${STATIC_DIR}`);

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });
