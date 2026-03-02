import type { AgentStatus } from '../api/types';
import { tierLabels, tierColors } from '../pixel/palettes';

interface VitalsBarProps {
  status: AgentStatus;
}

function formatUptime(since: string): string {
  const ms = Date.now() - new Date(since).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function VitalsBar({ status }: VitalsBarProps) {
  const tier = status.survivalTier;
  const colors = tierColors[tier] ?? tierColors.dead;
  const maxCredits = 10000; // $100 as reference max
  const pct = Math.min(100, (status.creditsCents / maxCredits) * 100);

  return (
    <div className="border border-ink/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-ink-muted uppercase tracking-wider">Vitals</span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-sm uppercase tracking-widest"
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
          }}
        >
          {tierLabels[tier] ?? 'UNKNOWN'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted w-16 shrink-0">Credits</span>
          <div className="flex-1 h-3 bg-cream-dark rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: colors.text,
              }}
            />
          </div>
          <span className="text-xs font-medium w-14 text-right">{formatCredits(status.creditsCents)}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted w-16 shrink-0">USDC</span>
          <span className="text-xs font-medium">{status.usdcBalance.toFixed(4)}</span>
        </div>

        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Turn #{status.turnCount}</span>
          <span>Uptime: {formatUptime(status.uptimeSince)}</span>
          <span>{status.agentState}</span>
        </div>
      </div>
    </div>
  );
}
