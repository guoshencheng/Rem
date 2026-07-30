'use client';

import type { Usage } from 'rem-agent-core';
import { formatUsage, formatCost, computeCacheRatio } from '../../../../core/dist/agent/token-usage/token-usage.js';
import { computeWindowRatio } from 'rem-agent-core/llm/context-window';

interface TokenStatsBadgeProps {
  usage: Usage;
  maxTokens: number;
}

export function TokenStatsBadge({ usage, maxTokens }: TokenStatsBadgeProps) {
  const ratio = computeWindowRatio(usage, maxTokens);
  const cacheRatio = computeCacheRatio(usage);

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>{formatUsage(usage)}</span>
      <span className="rounded-full bg-secondary px-2 py-0.5">
        cache {(cacheRatio * 100).toFixed(1)}%
      </span>
      <span className="rounded-full bg-secondary px-2 py-0.5">
        {(ratio * 100).toFixed(1)}% of context
      </span>
      {usage.cost.total > 0 && (
        <span className="rounded-full bg-secondary px-2 py-0.5">
          {formatCost(usage.cost)}
        </span>
      )}
    </div>
  );
}
