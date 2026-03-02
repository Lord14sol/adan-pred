import { useState } from 'react';
import type { MarketplaceStats } from '../api/types';

interface MarketplacePanelProps {
  stats: MarketplaceStats;
}

function formatRating(rating: number): string {
  if (rating === 0) return '—';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MarketplacePanel({ stats }: MarketplacePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border border-ink/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted uppercase tracking-wider">Marketplace</span>
          <span className="text-[10px] text-ink-muted">
            {stats.listedCount} listed
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[10px] text-ink-muted bg-transparent border-none cursor-pointer hover:text-ink"
        >
          {collapsed ? '[+]' : '[−]'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-3 text-xs">
            <span>
              <span className="text-ink-muted">Revenue:</span>{' '}
              <span className="font-medium">{formatPrice(stats.totalRevenueCents)}</span>
            </span>
            <span>
              <span className="text-ink-muted">Sales:</span>{' '}
              <span className="font-medium">{stats.totalSales}</span>
            </span>
            {stats.averageRating > 0 && (
              <span>
                <span className="text-ink-muted">Rating:</span>{' '}
                <span className="font-medium">{stats.averageRating.toFixed(1)} {formatRating(stats.averageRating)}</span>
              </span>
            )}
          </div>

          {/* Skill list */}
          {stats.skills.length === 0 ? (
            <div className="text-xs text-ink-muted py-2">
              No skills listed yet. The agent is still setting up shop.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.skills.map(skill => (
                <div key={skill.name} className="text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{skill.displayName}</span>
                    <span className="text-[10px] text-ink-muted">v{skill.version}</span>
                    <span className="text-[10px] text-ink-light px-1 py-0 border border-ink/10 rounded-sm">
                      {skill.category}
                    </span>
                    <span className="ml-auto text-ink-muted shrink-0">{formatPrice(skill.priceCents)}</span>
                  </div>
                  <div className="text-ink-muted mt-0.5">{skill.description}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-ink-muted">
                    <span>{skill.salesCount} sold</span>
                    {skill.reviewCount > 0 && (
                      <span>{skill.averageRating.toFixed(1)} {formatRating(skill.averageRating)} ({skill.reviewCount})</span>
                    )}
                    {skill.tags.length > 0 && (
                      <span className="text-ink-light">{skill.tags.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
