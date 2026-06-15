import { CoreAgent, createAgentFromEnv } from '@agent-harness/core';
import type { EventContext } from '@agent-harness/core';

export interface AgentCallbacks {
  onStart?: () => void;
  onTurnBefore?: (turnNumber: number) => void;
  onReasonBefore?: () => void;
  onReasonAfter?: (durationMs: number) => void;
  onTurnAfter?: (turnNumber: number) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: string) => void;
}

export function createDemoAgent(
  name: string,
  maxTurns: number,
  callbacks: AgentCallbacks,
): CoreAgent {
  const agent = createAgentFromEnv({ name, maxTurns });

  const reasonStartTimes = new Map<number, number>();

  agent.on('core-agent:start', () => {
    callbacks.onStart?.();
    callbacks.onStatusChange?.('running');
  });

  agent.on('turn:before', (ctx: EventContext) => {
    const turnNumber = ctx.state.currentTurn;
    callbacks.onTurnBefore?.(turnNumber);
  });

  agent.on('phase:reason:before', (ctx: EventContext) => {
    const turnNumber = ctx.state.currentTurn;
    reasonStartTimes.set(turnNumber, Date.now());
    callbacks.onReasonBefore?.();
  });

  agent.on('phase:reason:after', (ctx: EventContext) => {
    const turnNumber = ctx.state.currentTurn;
    const start = reasonStartTimes.get(turnNumber);
    const duration = start ? Date.now() - start : 0;
    callbacks.onReasonAfter?.(duration);
    reasonStartTimes.delete(turnNumber);
  });

  agent.on('turn:after', (ctx: EventContext) => {
    const turnNumber = ctx.state.currentTurn;
    callbacks.onTurnAfter?.(turnNumber);
  });

  agent.on('core-agent:error', () => {
    callbacks.onError?.(new Error('Agent error'));
    callbacks.onStatusChange?.('error');
  });

  return agent;
}
