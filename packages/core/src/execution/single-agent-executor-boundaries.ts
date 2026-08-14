import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { UserMessageContent } from '../domain/run/message-trigger-content.js';
import { isUserMessageContent } from '../domain/run/message-trigger-content.js';
import { normalizeAgentDefinition } from '../application/runs/normalize-agent-definition.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { log } from '../infrastructure/observability/debug-log.js';

export async function loadRunDefinition(provider: AgentDefinitionProvider, run: AgentRun, override?: AgentDefinition): Promise<AgentDefinition> {
  if (override) return checkedDefinition(override, run);
  let received: AgentDefinition | null;
  try { received = await provider.get(run.agentId, run.agentRevision); }
  catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision is unavailable', false, undefined, { cause: error });
  }
  if (!received) throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision is unavailable');
  return checkedDefinition(received, run);
}

function checkedDefinition(value: AgentDefinition, run: AgentRun): AgentDefinition {
  const definition = normalizeAgentDefinition(value, run.agentId, run.agentRevision);
  if (definition.agentId !== run.agentId || definition.revision !== run.agentRevision) {
    throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision does not match the run');
  }
  return definition;
}

export function buildSystemPrompt(definition: AgentDefinition, run: AgentRun): string {
  const sections = run.contextSnapshot.promptSections.slice().sort((left, right) =>
    left.priority - right.priority || left.name.localeCompare(right.name));
  return [definition.instructions, ...sections.map((section) => section.content)].filter(Boolean).join('\n\n');
}

export function resolveExecutionRoot(run: AgentRun, fallback: string): string {
  for (const item of run.contextSnapshot.items) {
    const snapshot = item.snapshot;
    if (isRecord(snapshot) && typeof snapshot.executionRoot === 'string' && snapshot.executionRoot.trim()) return snapshot.executionRoot;
  }
  return fallback;
}

export function readTriggerContent(run: AgentRun): UserMessageContent {
  if (run.trigger.type === 'message') {
    const content = structuredClone(run.trigger.content);
    if (isUserMessageContent(content)) return content;
    throw new RuntimeError('INVALID_INPUT', 'Message trigger content is not valid user input');
  }
  try { return JSON.stringify(run.trigger.input); }
  catch (error) { throw new RuntimeError('INVALID_INPUT', 'Task input is not serializable', false, undefined, { cause: error }); }
}

export function validateModelConfig(run: AgentRun, model: { provider: string; model: string; apiKey: string }): void {
  const unresolved = model.apiKey.match(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/);
  const legacy = model.apiKey.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!unresolved && !legacy) return;
  const variable = unresolved?.[1] ?? legacy?.[1];
  const syntax = legacy ? `{${variable}}` : `\${${variable}}`;
  logModelFailure(run, model, `Model API key placeholder ${syntax} was not resolved; set ${variable} or use a direct key`);
  throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model API key configuration is invalid');
}

export function logModelFailure(run: AgentRun, model: { provider: string; model: string }, error: unknown): void {
  log('runtime-model', 'model execution failed', { runId: run.runId, provider: model.provider, model: model.model, error: sanitizeModelError(error) });
}

export function sanitizeModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Authorization\s*:\s*Bearer\s+[^,;\s]+/gi, 'Authorization=[REDACTED]')
    .replace(/(authorization|api[-_ ]?key|token)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
