import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { RuntimeUnitOfWork } from '../../sdk/runtime-storage.js';
import type { StartRunDeps, StartRunInput } from './types.js';
import { hashCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { generateId as defaultGenerateId } from '../../shared/generate-id.js';
import { normalizeAgentDefinition } from './normalize-agent-definition.js';
import { hashStartRunRequest } from './start-run-hash.js';
import { validateStartRunInput } from './validate-start-run-input.js';
import { validateRunContexts } from './validate-run-contexts.js';
import { buildExecutionPlan } from './execution-plan.js';
import { validateJsonSchema } from './json-schema-validation.js';
import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import { prepareRunRecords } from './prepare-run-records.js';

export type { StartRunDeps, StartRunInput } from './types.js';

export class StartRunUsecase {
  private readonly now: () => Date;
  private readonly generateId: () => string;
  constructor(private readonly deps: StartRunDeps) {
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? defaultGenerateId;
  }

  async execute(request: RuntimeRequestContext, input: StartRunInput): Promise<AgentRun> {
    const normalized = validateStartRunInput(request, input);
    const runRequest = normalized.request;
    const runInput = normalized.input;
    const tenantId = runRequest.tenantId;
    const principalId = runRequest.principal.principalId;
    const requestHash = hashStartRunRequest(runRequest, runInput);
    const existing = await this.readIdempotentRun(tenantId, runInput.idempotencyKey, requestHash);
    if (existing) return existing;

    const receivedDefinition = await this.deps.agentDefinitions.get(runInput.agentId, runInput.agentRevision);
    if (!receivedDefinition) {
      const code = runInput.agentRevision === undefined ? 'AGENT_NOT_FOUND' : 'AGENT_REVISION_NOT_FOUND';
      throw new RuntimeError(code, `Agent definition not found: ${runInput.agentId}`);
    }
    const definition = normalizeAgentDefinition(receivedDefinition, runInput.agentId, runInput.agentRevision);
    if (!definition.acceptedTriggers.includes(runInput.trigger.type)) {
      throw new RuntimeError('TRIGGER_NOT_SUPPORTED', `Trigger is not supported: ${runInput.trigger.type}`);
    }
    const resolvedInput = validateTaskInput(definition, runInput);
    const resolvedDefinitions = await this.resolveExecutionDefinitions(definition, runInput.trigger.type);
    const executionPlan = buildExecutionPlan(resolvedDefinitions.root, resolvedDefinitions.members);
    if (executionPlan.executionType === 'team' && executionPlan.participants.length > executionPlan.limits.maxAgentRuns) {
      throw new RuntimeError('RUN_CONFLICT', 'Execution agent-run budget is exhausted', false, {
        reason: 'maxAgentRuns', max: executionPlan.limits.maxAgentRuns, actual: executionPlan.participants.length,
      });
    }

    const storedSession = runInput.sessionId === undefined
      ? null
      : await this.readSession(runInput.sessionId, tenantId);
    const base = storedSession?.contexts ?? { bindings: [] };
    const finalContexts = validateRunContexts(definition, base, runInput.contexts);
    const resolved = await this.deps.contextResolver.resolve(finalContexts, runRequest);
    const occurredAt = new Date(this.now().getTime());
    const prepared = prepareRunRecords({
      tenantId, principalId, runInput: resolvedInput, agentRevision: definition.revision,
      contexts: finalContexts, snapshot: resolved.snapshot, at: occurredAt, executionPlan,
      generateId: this.generateId,
    });

    return this.deps.storage.transaction((uow) => {
      const raced = readIdempotentRun(uow, tenantId, runInput.idempotencyKey, requestHash);
      if (raced) return raced;
      if (storedSession) assertSessionUnchanged(uow, storedSession);
      if (prepared.session) uow.sessions.insert(prepared.session);
      uow.runs.insert(prepared.run);
      for (const node of prepared.nodes) uow.executionNodes.insert(node);
      for (const entry of prepared.executionEntries) uow.executionEntries.append(entry);
      for (const delivery of prepared.deliveries) uow.deliveries.insert(delivery);
      uow.executionBudgets.insert(prepared.budget);
      uow.events.append({
        eventId: prepared.eventId, sequence: 1, schemaVersion: 1,
        tenantId: prepared.run.tenantId, sessionId: prepared.run.sessionId, runId: prepared.run.runId,
        type: 'run.created',
        data: { agentId: prepared.run.agentId, agentRevision: prepared.run.agentRevision, triggerType: prepared.run.trigger.type },
        occurredAt: cloneDate(occurredAt),
      });
      uow.workItems.insert(prepared.workItem);
      if (runInput.idempotencyKey !== undefined) {
        uow.idempotency.insert({
          tenantId, operation: 'start-run', idempotencyKey: runInput.idempotencyKey,
          requestHash, resourceId: prepared.run.runId, createdAt: cloneDate(occurredAt),
        });
      }
      return structuredClone(prepared.run);
    });
  }

  private async readIdempotentRun(tenantId: string, key: string | undefined, hash: string): Promise<AgentRun | null> {
    if (key === undefined) return null;
    return this.deps.storage.transaction((uow) => readIdempotentRun(uow, tenantId, key, hash));
  }

  private async readSession(sessionId: string, tenantId: string): Promise<AgentSession> {
    const session = await this.deps.storage.getSession(sessionId);
    if (!session || session.tenantId !== tenantId) throw new RuntimeError('SESSION_NOT_FOUND', 'Session not found');
    return session;
  }

  private async resolveExecutionDefinitions(root: AgentDefinition, triggerType: 'message' | 'task'): Promise<{ root: AgentDefinition; members: AgentDefinition[] }> {
    if (root.execution.type === 'single-agent') return { root, members: [] };
    const members: AgentDefinition[] = [];
    for (const reference of root.execution.members) {
      const received = await this.deps.agentDefinitions.get(reference.agentId, reference.revision);
      if (!received) {
        throw new RuntimeError(reference.revision === undefined ? 'AGENT_NOT_FOUND' : 'AGENT_REVISION_NOT_FOUND',
          `Team member definition not found: ${reference.agentId}`);
      }
      const member = normalizeAgentDefinition(received, reference.agentId, reference.revision);
      if (member.execution.type !== 'single-agent') {
        throw new RuntimeError('INTERNAL_ERROR', 'Nested team definitions are not supported');
      }
      if (!member.acceptedTriggers.includes(triggerType)) {
        throw new RuntimeError('TRIGGER_NOT_SUPPORTED', `Team member does not support trigger: ${triggerType}`);
      }
      members.push(member);
    }
    return { root, members };
  }

}

function validateTaskInput(definition: AgentDefinition, input: StartRunInput): StartRunInput {
  if (input.trigger.type !== 'task' || definition.inputSchema === undefined) return input;
  const taskInput = validateJsonSchema(definition.inputSchema, input.trigger.input, 'trigger.input');
  return { ...input, trigger: { type: 'task', input: taskInput } };
}

function readIdempotentRun(
  uow: RuntimeUnitOfWork,
  tenantId: string,
  key: string | undefined,
  hash: string,
): AgentRun | null {
  if (key === undefined) return null;
  const record = uow.idempotency.get(tenantId, 'start-run', key);
  if (!record) return null;
  if (record.requestHash !== hash) throw new RuntimeError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request');
  const run = uow.runs.get(record.resourceId);
  if (!run) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Idempotency record references a missing run', true);
  return structuredClone(run);
}

function assertSessionUnchanged(uow: RuntimeUnitOfWork, expected: AgentSession): void {
  const current = uow.sessions.get(expected.sessionId);
  if (!current || current.tenantId !== expected.tenantId) throw new RuntimeError('SESSION_NOT_FOUND', 'Session not found');
  if ((current.version ?? 0) !== (expected.version ?? 0)
    || current.updatedAt.getTime() !== expected.updatedAt.getTime()
    || hashCanonicalJson(current.contexts) !== hashCanonicalJson(expected.contexts)) {
    throw new RuntimeError('RUN_CONFLICT', 'Session contexts changed while starting the run');
  }
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
