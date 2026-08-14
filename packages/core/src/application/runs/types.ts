import type { ContextPatch } from '../../domain/context/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { RunTrigger } from '../../domain/run/types.js';
import type { AgentDefinitionProvider } from '../../sdk/agent-definition-provider.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { ContextResolver } from '../contexts/context-resolver.js';
import type { AgentDefinition } from '../../domain/agent-definition/types.js';

export interface StartRunInput {
  agentId: string;
  agentRevision?: string;
  sessionId?: string;
  trigger: RunTrigger;
  contexts?: ContextPatch;
  idempotencyKey?: string;
}

export interface StartRunDeps {
  storage: RuntimeStorage;
  agentDefinitions: AgentDefinitionProvider;
  contextResolver: ContextResolver;
  now?: () => Date;
  generateId?: () => string;
}

export interface ResolvedRunDefinition {
  root: AgentDefinition;
  members: AgentDefinition[];
}

export interface NormalizedStartRunRequest {
  request: RuntimeRequestContext;
  input: StartRunInput;
}
