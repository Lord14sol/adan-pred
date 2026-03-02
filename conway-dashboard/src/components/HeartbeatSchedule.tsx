import { useState } from 'react';
import type { HeartbeatData } from '../api/types';

interface HeartbeatScheduleProps {
  heartbeat: HeartbeatData;
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return 'upcoming';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function HeartbeatSchedule({ heartbeat }: HeartbeatScheduleProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-ink/10 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full mb-3 cursor-pointer bg-transparent border-none p-0 font-[inherit] text-left"
      >
        <span className="text-xs text-ink-muted uppercase tracking-wider">Heartbeat</span>
        <span className="text-[10px] text-ink-muted">
          {expanded ? '[-]' : '[+]'} Last ping: {timeAgo(heartbeat.lastPing)}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1">
          {heartbeat.scheduledTasks.map(task => (
            <div key={task.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      task.status === 'active' ? '#22c55e' :
                      task.status === 'paused' ? '#eab308' : '#6b7280',
                  }}
                />
                <span className="text-ink-light">{task.name}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-ink-muted">
                <span className="font-mono">{task.cron}</span>
                <span>{task.lastRun ? timeAgo(task.lastRun) : 'never'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
