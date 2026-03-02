import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentStatus, Turn, Transaction, HeartbeatData, ChildAgent, MarketplaceStats, SurvivalTier } from './types';
import { mockStatus, mockTurns, mockTransactions, mockHeartbeat, mockChildren, mockMarketplace } from './mock-data';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Polling intervals (ms) by survival tier
const intervals: Record<SurvivalTier, { fast: number; slow: number }> = {
  normal:      { fast: 10_000, slow: 30_000 },
  low_compute: { fast: 15_000, slow: 60_000 },
  critical:    { fast: 5_000,  slow: 30_000 },
  sleeping:    { fast: 30_000, slow: 60_000 },
  dead:        { fast: 60_000, slow: 120_000 },
};

export function usePolling<T>(
  path: string,
  fallback: T,
  tier: SurvivalTier,
  speed: 'fast' | 'slow' = 'fast',
): { data: T; loading: boolean; connected: boolean; lastPoll: Date | null } {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const result = await fetchJSON<T>(path);
      if (mountedRef.current) {
        setData(result);
        setConnected(true);
        setLastPoll(new Date());
      }
    } catch {
      if (mountedRef.current) {
        setConnected(false);
        // Use mock fallback only on first load failure
        if (loading) setData(fallback);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [path, fallback]);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    const ms = intervals[tier]?.[speed] ?? 10_000;
    const id = setInterval(poll, ms);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll, tier, speed]);

  return { data, loading, connected, lastPoll };
}

// Convenience hooks with built-in mock fallbacks
export function useStatus(tier: SurvivalTier) {
  return usePolling<AgentStatus>('/api/status', mockStatus, tier, 'fast');
}

export function useTurns(tier: SurvivalTier) {
  return usePolling<Turn[]>('/api/turns?limit=20', mockTurns, tier, 'fast');
}

export function useTransactions(tier: SurvivalTier) {
  return usePolling<Transaction[]>('/api/transactions?limit=20', mockTransactions, tier, 'slow');
}

export function useHeartbeat(tier: SurvivalTier) {
  return usePolling<HeartbeatData>('/api/heartbeat', mockHeartbeat, tier, 'slow');
}

export function useChildren(tier: SurvivalTier) {
  return usePolling<ChildAgent[]>('/api/children', mockChildren, tier, 'slow');
}

export function useMarketplace(tier: SurvivalTier) {
  return usePolling<MarketplaceStats>('/api/marketplace/stats', mockMarketplace, tier, 'slow');
}
