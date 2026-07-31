import type { Usage } from '@earendil-works/pi-ai';
import type { ToolContext } from '../sdk/tool-provider.js';

export type DelegationStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface DelegationRequest {
  task: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface DelegationContext {
  parentSessionId: string;
  parentToolCallId: string;
  workspace: string;
  workspaceRoot: string;
  depth: number;
  signal?: AbortSignal;
}

export interface DelegationResult {
  childSessionId: string;
  content: string;
  status: Exclude<DelegationStatus, 'running'>;
  usage?: Usage;
}

export type RunDelegation = (
  request: DelegationRequest,
  toolContext: ToolContext,
) => Promise<DelegationResult>;
