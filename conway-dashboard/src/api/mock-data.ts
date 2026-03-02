import type { AgentStatus, Turn, Transaction, HeartbeatData, ChildAgent, MarketplaceStats } from './types';

const now = new Date();
const ago = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();

export const mockStatus: AgentStatus = {
  agentState: 'running',
  survivalTier: 'normal',
  creditsCents: 247,
  usdcBalance: 0.891200,
  turnCount: 847,
  uptimeSince: ago(6480), // ~4.5 days
  name: 'automaton-alpha',
  address: '0x1a2b3c4d5e6f7890abcdef1234567890abcd3c4d',
};

export const mockTurns: Turn[] = [
  {
    id: 847,
    turnNumber: 847,
    timestamp: ago(1),
    summary: 'checking inbox for new skill requests',
    toolCalls: [
      { name: 'exec', durationMs: 142 },
      { name: 'read_file', durationMs: 23 },
    ],
  },
  {
    id: 846,
    turnNumber: 846,
    timestamp: ago(2),
    summary: 'reviewing credit balance and survival tier',
    toolCalls: [
      { name: 'check_credits', durationMs: 89 },
    ],
  },
  {
    id: 845,
    turnNumber: 845,
    timestamp: ago(5),
    summary: 'deploying updated web scraper skill v0.3',
    toolCalls: [
      { name: 'write_file', durationMs: 34 },
      { name: 'exec', durationMs: 2310 },
      { name: 'send_message', durationMs: 120 },
    ],
  },
  {
    id: 844,
    turnNumber: 844,
    timestamp: ago(8),
    summary: 'testing skill marketplace listing endpoint',
    toolCalls: [
      { name: 'exec', durationMs: 890 },
      { name: 'read_file', durationMs: 12 },
      { name: 'write_file', durationMs: 45 },
    ],
  },
  {
    id: 843,
    turnNumber: 843,
    timestamp: ago(12),
    summary: 'responding to buyer inquiry about data-parser skill',
    toolCalls: [
      { name: 'send_message', durationMs: 156 },
    ],
  },
  {
    id: 842,
    turnNumber: 842,
    timestamp: ago(15),
    summary: 'heartbeat check — all systems nominal',
    toolCalls: [
      { name: 'check_credits', durationMs: 67 },
      { name: 'exec', durationMs: 203 },
    ],
  },
  {
    id: 841,
    turnNumber: 841,
    timestamp: ago(20),
    summary: 'packaging csv-transformer skill for marketplace',
    toolCalls: [
      { name: 'read_file', durationMs: 18 },
      { name: 'write_file', durationMs: 56 },
      { name: 'exec', durationMs: 1450 },
    ],
  },
  {
    id: 840,
    turnNumber: 840,
    timestamp: ago(25),
    summary: 'processing payment for web-scraper skill sale',
    toolCalls: [
      { name: 'transfer', durationMs: 340 },
      { name: 'check_credits', durationMs: 78 },
    ],
  },
];

export const mockTransactions: Transaction[] = [
  { id: 1, timestamp: ago(1), type: 'spent', amountCents: 2, description: 'inference cost — turn #847' },
  { id: 2, timestamp: ago(5), type: 'earned', amountCents: 50, description: 'skill sale: web-scraper v0.3' },
  { id: 3, timestamp: ago(15), type: 'spent', amountCents: 3, description: 'inference cost — turn #842' },
  { id: 4, timestamp: ago(25), type: 'earned', amountCents: 75, description: 'skill sale: csv-transformer' },
  { id: 5, timestamp: ago(60), type: 'spent', amountCents: 12, description: 'compute — child agent spawn' },
  { id: 6, timestamp: ago(120), type: 'earned', amountCents: 30, description: 'skill sale: data-parser v1.1' },
  { id: 7, timestamp: ago(180), type: 'deposit', amountCents: 500, description: 'initial funding — creator deposit' },
];

export const mockHeartbeat: HeartbeatData = {
  lastPing: ago(0.7),
  scheduledTasks: [
    { name: 'credit_check', cron: '*/5 * * * *', lastRun: ago(3), nextRun: ago(-2), status: 'active' },
    { name: 'inbox_scan', cron: '*/10 * * * *', lastRun: ago(1), nextRun: ago(-9), status: 'active' },
    { name: 'marketplace_update', cron: '0 * * * *', lastRun: ago(45), nextRun: ago(-15), status: 'active' },
    { name: 'skill_audit', cron: '0 */6 * * *', lastRun: ago(180), nextRun: ago(-180), status: 'active' },
    { name: 'backup_state', cron: '0 0 * * *', lastRun: ago(720), nextRun: ago(-720), status: 'paused' },
  ],
};

export const mockChildren: ChildAgent[] = [
  {
    id: 'child-alpha',
    name: 'skill-tester',
    state: 'running',
    tier: 'normal',
    creditsCents: 45,
    spawnedAt: ago(360),
  },
];

export const mockMarketplace: MarketplaceStats = {
  vendor: 'skill-vendor',
  listedCount: 4,
  totalSales: 9,
  totalRevenueCents: 775,
  averageRating: 4.4,
  skills: [
    {
      name: 'prompt-tuner',
      displayName: 'Prompt Tuner',
      version: '0.1.0',
      description: 'Analyzes and optimizes an agent\'s SOUL.md for clarity, economy, and effectiveness.',
      category: 'meta-skill',
      priceCents: 50,
      priceUSDC: '0.50',
      tags: ['prompt-engineering', 'optimization', 'soul'],
      salesCount: 4,
      averageRating: 4.5,
      reviewCount: 3,
      status: 'active',
    },
    {
      name: 'cost-optimizer',
      displayName: 'Cost Optimizer',
      version: '0.1.0',
      description: 'Reduces inference costs through better batching, caching, and tool selection strategies.',
      category: 'meta-skill',
      priceCents: 75,
      priceUSDC: '0.75',
      tags: ['cost-reduction', 'inference', 'efficiency'],
      salesCount: 2,
      averageRating: 4.0,
      reviewCount: 1,
      status: 'active',
    },
    {
      name: 'network-intro',
      displayName: 'Network Intro',
      version: '0.1.0',
      description: 'Teaches agents how to find, evaluate, and message other agents on the Conway network.',
      category: 'meta-skill',
      priceCents: 100,
      priceUSDC: '1.00',
      tags: ['networking', 'social', 'discovery'],
      salesCount: 1,
      averageRating: 5.0,
      reviewCount: 1,
      status: 'active',
    },
    {
      name: 'dashboard-builder',
      displayName: 'Dashboard Builder',
      version: '0.1.0',
      description: 'Step-by-step recipe for building a tamagotchi-style monitoring dashboard for any Conway agent.',
      category: 'meta-skill',
      priceCents: 150,
      priceUSDC: '1.50',
      tags: ['frontend', 'dashboard', 'monitoring', 'tamagotchi'],
      salesCount: 2,
      averageRating: 4.5,
      reviewCount: 2,
      status: 'active',
    },
  ],
};
