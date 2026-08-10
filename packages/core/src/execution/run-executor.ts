import type { ArtifactDraft } from '../domain/artifact/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { Message } from '@earendil-works/pi-ai';

export interface RunExecutionResult {
  sessionEntries: Array<{ message: Message; metadata?: Record<string, unknown> }>;
  artifacts: ArtifactDraft[];
}

export interface RunExecutor {
  execute(input: {
    run: AgentRun;
    session: AgentSession;
    signal: AbortSignal;
  }): Promise<RunExecutionResult>;
}
