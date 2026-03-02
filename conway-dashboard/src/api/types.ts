export type SurvivalTier = 'normal' | 'low_compute' | 'critical' | 'sleeping' | 'dead';

export interface AgentStatus {
  agentState: 'running' | 'paused' | 'sleeping' | 'stopped' | 'dead';
  survivalTier: SurvivalTier;
  creditsCents: number;
  usdcBalance: number;
  turnCount: number;
  uptimeSince: string; // ISO timestamp
  name: string;
  address: string; // wallet address
}

export interface Turn {
  id: number;
  turnNumber: number;
  timestamp: string;
  summary: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  name: string;
  durationMs: number;
}

export interface Transaction {
  id: number;
  timestamp: string;
  type: 'earned' | 'spent' | 'deposit' | 'withdrawal';
  amountCents: number;
  description: string;
}

export interface HeartbeatData {
  lastPing: string;
  scheduledTasks: ScheduledTask[];
}

export interface ScheduledTask {
  name: string;
  cron: string;
  lastRun: string | null;
  nextRun: string;
  status: 'active' | 'paused' | 'disabled';
}

export interface ChildAgent {
  id: string;
  name: string;
  state: 'running' | 'paused' | 'stopped' | 'dead';
  tier: SurvivalTier;
  creditsCents: number;
  spawnedAt: string;
}

export interface MarketplaceSkill {
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  priceCents: number;
  priceUSDC: string;
  tags: string[];
  salesCount: number;
  averageRating: number;
  reviewCount: number;
  status: 'active' | 'draft' | 'archived';
}

export interface MarketplaceStats {
  vendor: string;
  listedCount: number;
  totalSales: number;
  totalRevenueCents: number;
  averageRating: number;
  skills: MarketplaceSkill[];
}
