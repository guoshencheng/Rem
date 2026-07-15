import type { LanguageModelUsage } from './types.js';
import type { Usage } from '@earendil-works/pi-ai';

export interface TokenUsageDetail extends LanguageModelUsage {
  runAt: Date;
  turns: LanguageModelUsage[];
}

export function emptyPiUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addCost(a: Usage['cost'], b: Usage['cost']): Usage['cost'] {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

export function addPiUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: addCost(a.cost, b.cost),
    reasoning: a.reasoning ?? b.reasoning,
  };
}

export function emptyUsage(): LanguageModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  };
}

function detailOrZero(detail: LanguageModelUsage['inputTokenDetails']) {
  return {
    noCacheTokens: detail?.noCacheTokens ?? 0,
    cacheReadTokens: detail?.cacheReadTokens ?? 0,
    cacheWriteTokens: detail?.cacheWriteTokens ?? 0,
  };
}

function outputDetailOrZero(detail: LanguageModelUsage['outputTokenDetails']) {
  return {
    textTokens: detail?.textTokens ?? 0,
    reasoningTokens: detail?.reasoningTokens ?? 0,
  };
}

export function addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  const aIn = detailOrZero(a.inputTokenDetails);
  const bIn = detailOrZero(b.inputTokenDetails);
  const aOut = outputDetailOrZero(a.outputTokenDetails);
  const bOut = outputDetailOrZero(b.outputTokenDetails);

  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    inputTokenDetails: {
      noCacheTokens: aIn.noCacheTokens + bIn.noCacheTokens,
      cacheReadTokens: aIn.cacheReadTokens + bIn.cacheReadTokens,
      cacheWriteTokens: aIn.cacheWriteTokens + bIn.cacheWriteTokens,
    },
    outputTokenDetails: {
      textTokens: aOut.textTokens + bOut.textTokens,
      reasoningTokens: aOut.reasoningTokens + bOut.reasoningTokens,
    },
  };
}

export function computeCacheStats(usage: LanguageModelUsage): {
  cacheRead: number;
  cacheWrite: number;
  noCache: number;
} {
  const details = detailOrZero(usage.inputTokenDetails);
  return {
    cacheRead: details.cacheReadTokens,
    cacheWrite: details.cacheWriteTokens,
    noCache: details.noCacheTokens,
  };
}

export function computeCacheRatio(usage: LanguageModelUsage): number {
  if (usage.totalTokens === 0) return 0;
  const details = detailOrZero(usage.inputTokenDetails);
  return (details.cacheReadTokens + details.cacheWriteTokens) / usage.totalTokens;
}

export function formatUsage(usage: LanguageModelUsage): string {
  return `${usage.totalTokens.toLocaleString()} tokens (${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out)`;
}
