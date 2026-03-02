import { useState } from 'react';
import type { ChildAgent } from '../api/types';
import { tierLabels, tierColors } from '../pixel/palettes';

interface ChildrenListProps {
  children: ChildAgent[];
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ChildrenList({ children }: ChildrenListProps) {
  const [expanded, setExpanded] = useState(false);

  if (children.length === 0) return null;

  return (
    <div className="border border-ink/10 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full mb-3 cursor-pointer bg-transparent border-none p-0 font-[inherit] text-left"
      >
        <span className="text-xs text-ink-muted uppercase tracking-wider">Children</span>
        <span className="text-[10px] text-ink-muted">
          {expanded ? '[-]' : `[+] ${children.length}`}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1.5">
          {children.map(child => {
            const colors = tierColors[child.tier] ?? tierColors.dead;
            return (
              <div key={child.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: colors.text }}
                  />
                  <span className="text-ink-light">{child.name}</span>
                  <span
                    className="text-[9px] px-1 py-px rounded-sm"
                    style={{
                      backgroundColor: colors.bg,
                      color: colors.text,
                    }}
                  >
                    {tierLabels[child.tier]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-ink-muted">
                  <span>${(child.creditsCents / 100).toFixed(2)}</span>
                  <span>spawned {timeAgo(child.spawnedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
