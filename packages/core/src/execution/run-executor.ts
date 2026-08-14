import type { ArtifactDraft } from '../domain/artifact/types.js';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { Message } from '@earendil-works/pi-ai';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';

export interface RunExecutionResult {
  sessionEntries: Array<{ message: Message; metadata?: Record<string, unknown> }>;
  artifacts: ArtifactDraft[];
  /** Complete messages were checkpointed into the execution journal while running. */
  journaled?: boolean;
}

export interface RunExecutor {
  execute(input: {
    run: AgentRun;
    session: AgentSession;
    signal: AbortSignal;
    /** Immutable plan definition used by orchestration nodes; avoids provider drift after startRun. */
    definitionOverride?: AgentDefinition;
    /** 实时投影观察者；发布失败不得影响执行。 */
    emitSignal?: (signal: RunLiveSignalDraft) => void;
    observe?: RuntimeObservationSink;
  }): Promise<RunExecutionResult>;
}
