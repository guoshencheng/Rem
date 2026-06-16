import type { AgentStreamChunk, AgentStatus } from '../types.js';

export interface UISessionCallbacks {
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: Error) => void;

  onStatusChange?: (status: AgentStatus) => void;
  onTurnChange?: (currentTurn: number, maxTurns: number) => void;

  onUserMessage?: (text: string) => void;
  onStreamChunk?: (chunk: AgentStreamChunk) => void;
  onAssistantMessageFinalized?: (text: string) => void;
}

export interface UIAgentSession {
  readonly status: AgentStatus;
  readonly currentTurn: number;
  readonly maxTurns: number;

  setCallbacks(callbacks: UISessionCallbacks): void;
  submit(text: string): void;
  interrupt(): void;
  reset(): Promise<void>;
}
