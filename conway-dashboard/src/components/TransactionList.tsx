import { useState } from 'react';
import type { Transaction } from '../api/types';

interface TransactionListProps {
  transactions: Transaction[];
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function formatAmount(tx: Transaction): { text: string; color: string } {
  const dollars = (tx.amountCents / 100).toFixed(2);
  if (tx.type === 'earned' || tx.type === 'deposit') {
    return { text: `+$${dollars}`, color: 'text-green-accent' };
  }
  return { text: `-$${dollars}`, color: 'text-red-accent' };
}

export function TransactionList({ transactions }: TransactionListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? transactions : transactions.slice(0, 5);

  return (
    <div className="border border-ink/10 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full mb-3 cursor-pointer bg-transparent border-none p-0 font-[inherit] text-left"
      >
        <span className="text-xs text-ink-muted uppercase tracking-wider">Transactions</span>
        <span className="text-[10px] text-ink-muted">{expanded ? '[-]' : `[+] ${transactions.length}`}</span>
      </button>

      <div className="space-y-1.5">
        {visible.map(tx => {
          const { text, color } = formatAmount(tx);
          return (
            <div key={tx.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`font-medium w-14 ${color}`}>{text}</span>
                <span className="text-ink-muted">{tx.type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink-light truncate max-w-48">{tx.description}</span>
                <span className="text-[10px] text-ink-muted shrink-0">{formatTime(tx.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
