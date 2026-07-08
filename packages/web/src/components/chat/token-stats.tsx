'use client';

import type { LanguageModelUsage } from 'rem-agent-core';
import { formatUsage, computeCacheStats, computeWindowRatio } from 'rem-agent-core';

interface TokenStatsBadgeProps {
  usage: LanguageModelUsage;
  maxTokens: number;
}

export function TokenStatsBadge({ usage, maxTokens }: TokenStatsBadgeProps) {
  const ratio = computeWindowRatio(usage, maxTokens);
  const cache = computeCacheStats(usage);

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>{formatUsage(usage)}</span>
      <span className="rounded-full bg-secondary px-2 py-0.5">
        cache {cache.cacheRead.toLocaleString()}/{cache.cacheWrite.toLocaleString()}
      </span>
      <span className="rounded-full bg-secondary px-2 py-0.5">
        {(ratio * 100).toFixed(1)}% of context
      </span>
    </div>
  );
}
