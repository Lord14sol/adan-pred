interface StatusFooterProps {
  connected: boolean;
  lastPoll: Date | null;
  sandboxId?: string;
}

export function StatusFooter({ connected, lastPoll, sandboxId }: StatusFooterProps) {
  const pollAgo = lastPoll
    ? `${Math.floor((Date.now() - lastPoll.getTime()) / 1000)}s ago`
    : 'never';

  return (
    <div className="flex items-center justify-between text-[10px] text-ink-muted py-3 border-t border-ink/10">
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: connected ? '#22c55e' : '#ef4444' }}
        />
        <span>{connected ? 'Connected' : 'Mock mode'}</span>
      </div>
      <span>Last poll: {pollAgo}</span>
      {sandboxId && <span>Sandbox: {sandboxId}</span>}
    </div>
  );
}
