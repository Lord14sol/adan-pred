import { useState, useEffect } from 'react';
import { useStatus, useTurns, useTransactions, useHeartbeat, useChildren, useMarketplace } from './api/client';
import type { SurvivalTier } from './api/types';
import { PixelCharacter } from './pixel/PixelCharacter';
import { VitalsBar } from './components/VitalsBar';
import { MarketplacePanel } from './components/MarketplacePanel';
import { ActivityFeed } from './components/ActivityFeed';
import { TransactionList } from './components/TransactionList';
import { HeartbeatSchedule } from './components/HeartbeatSchedule';
import { ChildrenList } from './components/ChildrenList';
import { StatusFooter } from './components/StatusFooter';
import { tierLabels, tierColors } from './pixel/palettes';

const DEV_TIERS: SurvivalTier[] = ['normal', 'low_compute', 'critical', 'sleeping', 'dead'];

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function App() {
  const [devTierIndex, setDevTierIndex] = useState<number | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);

  const statusResult = useStatus('normal');
  const activeTier: SurvivalTier = devTierIndex !== null
    ? DEV_TIERS[devTierIndex]
    : statusResult.data.survivalTier;

  const turnsResult = useTurns(activeTier);
  const txResult = useTransactions(activeTier);
  const hbResult = useHeartbeat(activeTier);
  const childResult = useChildren(activeTier);
  const marketResult = useMarketplace(activeTier);

  const status = devTierIndex !== null
    ? {
        ...statusResult.data,
        survivalTier: DEV_TIERS[devTierIndex],
        agentState: DEV_TIERS[devTierIndex] === 'sleeping' ? 'sleeping' as const
          : DEV_TIERS[devTierIndex] === 'dead' ? 'dead' as const
          : statusResult.data.agentState,
      }
    : statusResult.data;

  // Auto-play: cycle through all tiers
  useEffect(() => {
    if (!autoPlay) return;
    setDevTierIndex(0);
    const id = setInterval(() => {
      setDevTierIndex(prev => {
        const next = (prev ?? 0) + 1;
        if (next >= DEV_TIERS.length) {
          setAutoPlay(false);
          return 0;
        }
        return next;
      });
    }, 2500);
    return () => clearInterval(id);
  }, [autoPlay]);

  // Keyboard shortcut: press 1-5 to cycle tiers in dev mode
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const n = parseInt(e.key);
      if (n >= 1 && n <= DEV_TIERS.length) {
        setAutoPlay(false);
        setDevTierIndex(n - 1);
      } else if (e.key === '0') {
        setAutoPlay(false);
        setDevTierIndex(null);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const colors = tierColors[activeTier] ?? tierColors.dead;

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-[720px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-6 mb-6 p-4 border border-ink/10">
          <div className="flex flex-col items-center gap-2 w-[100px] shrink-0">
            <PixelCharacter tier={activeTier} agentState={status.agentState} pixelSize={7} />
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-sm uppercase tracking-widest whitespace-nowrap"
              style={{
                backgroundColor: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
            >
              {tierLabels[activeTier]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold uppercase tracking-wider m-0">
              {status.name}
            </h1>
            <div className="text-[10px] text-ink-muted mt-1 font-mono">
              {truncateAddress(status.address)}
            </div>
            <div className="text-[10px] text-ink-muted mt-0.5">
              Status: {status.agentState}
            </div>
          </div>
        </div>

        {/* Dev tier switcher (only visible in mock mode) */}
        {!statusResult.connected && (
          <div className="sticky top-0 z-50 flex items-center gap-2 py-2 mb-2 text-[10px] text-ink-muted bg-cream">
            <span>Tier preview:</span>
            {DEV_TIERS.map((t, i) => (
              <button
                key={t}
                onClick={() => { setAutoPlay(false); setDevTierIndex(devTierIndex === i ? null : i); }}
                className={`px-1.5 py-0.5 border rounded-sm cursor-pointer text-[10px] font-mono bg-transparent ${
                  devTierIndex === i ? 'border-ink text-ink' : 'border-ink/20 text-ink-muted'
                }`}
              >
                {i + 1}:{t}
              </button>
            ))}
            <button
              onClick={() => setAutoPlay(!autoPlay)}
              className={`px-1.5 py-0.5 border rounded-sm cursor-pointer text-[10px] font-mono bg-transparent ${
                autoPlay ? 'border-ink text-ink' : 'border-ink/20 text-ink-muted'
              }`}
            >
              {autoPlay ? '⏸' : '▶'}
            </button>
          </div>
        )}

        {/* Dashboard sections */}
        <div className="space-y-0">
          <VitalsBar status={status} />
          <MarketplacePanel stats={marketResult.data} />
          <ActivityFeed turns={turnsResult.data} />
          <TransactionList transactions={txResult.data} />
          <HeartbeatSchedule heartbeat={hbResult.data} />
          <ChildrenList children={childResult.data} />
        </div>

        <StatusFooter
          connected={statusResult.connected}
          lastPoll={statusResult.lastPoll}
          sandboxId={import.meta.env.VITE_SANDBOX_ID}
        />
      </div>
    </div>
  );
}

export default App;
