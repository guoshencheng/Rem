'use client';

import type { LanguageModelUsage } from 'rem-agent-core';
import { formatUsage, computeCacheRatio } from 'rem-agent-core/token-usage';
import { computeWindowRatio } from 'rem-agent-core/llm/context-window';

interface TokenStatsBadgeProps {
  usage: LanguageModelUsage;
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
    </div>
  );
}
