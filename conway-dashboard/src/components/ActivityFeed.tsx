import type { Turn } from '../api/types';

interface ActivityFeedProps {
  turns: Turn[];
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ActivityFeed({ turns }: ActivityFeedProps) {
  return (
    <div className="border border-ink/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-ink-muted uppercase tracking-wider">Activity Feed</span>
        <span className="text-[10px] text-ink-muted">{turns.length} turns</span>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {turns.map(turn => (
          <div key={turn.id} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-ink-muted shrink-0">{formatTime(turn.timestamp)}</span>
              <span className="text-ink-light">Turn #{turn.turnNumber}</span>
              <span className="text-ink truncate">"{turn.summary}"</span>
            </div>
            {turn.toolCalls.length > 0 && (
              <div className="ml-12 mt-0.5 flex flex-wrap gap-1.5">
                {turn.toolCalls.map((tc, i) => (
                  <span key={i} className="text-[10px] text-ink-muted">
                    <span className="text-ink-light">{tc.name}</span>
                    <span className="ml-0.5">({tc.durationMs}ms)</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
