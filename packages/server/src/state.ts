import type { AgentStreamResult } from 'rem-agent-core';

export const activeRuns = new Map<string, AbortController>();
export const activeStreams = new Map<string, AgentStreamResult>();
