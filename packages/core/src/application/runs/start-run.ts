import type { ContextPatch, ContextSet } from '../../domain/context/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { AgentRun, RunTrigger, WorkItem } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { RuntimeUnitOfWork } from '../../sdk/runtime-storage.js';
import type { StartRunDeps, StartRunInput } from './types.js';
import { cloneCanonicalJson, hashCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { generateId as defaultGenerateId } from '../../shared/generate-id.js';
import { hashStartRunRequest } from './start-run-hash.js';
import { validateRunContexts } from './validate-run-contexts.js';

export type { StartRunDeps, StartRunInput } from './types.js';

interface PreparedRecords {
  session?: AgentSession;
  run: AgentRun;
  eventId: string;
  workItem: WorkItem;
}

export class StartRunUsecase {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly deps: StartRunDeps) {
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? defaultGenerateId;
  }

  async execute(request: RuntimeRequestContext, input: StartRunInput): Promise<AgentRun> {
    validateInput(request, input);
    const tenantId = request.tenantId;
    const principalId = request.principal.principalId;
    const occurredAt = new Date(this.now().getTime());
    const normalized = normalizeInput(input);
    const requestHash = hashStartRunRequest(request, normalized);
    const existing = await this.readIdempotentRun(tenantId, normalized.idempotencyKey, requestHash);
    if (existing) return existing;

    const definition = await this.deps.agentDefinitions.get(normalized.agentId, normalized.agentRevision);
    if (!definition) {
      const code = normalized.agentRevision === undefined ? 'AGENT_NOT_FOUND' : 'AGENT_REVISION_NOT_FOUND';
      throw new RuntimeError(code, `Agent definition not found: ${normalized.agentId}`);
    }
    const triggerType = readTriggerType(normalized.trigger);
    if (!definition.acceptedTriggers.includes(triggerType)) {
      throw new RuntimeError('TRIGGER_NOT_SUPPORTED', `Trigger is not supported: ${triggerType}`);
    }

    const storedSession = normalized.sessionId === undefined
      ? null
      : await this.readSession(normalized.sessionId, tenantId);
    const base = storedSession?.contexts ?? { bindings: [] };
    const finalContexts = validateRunContexts(definition, base, normalized.contexts);
    const resolved = await this.deps.contextResolver.resolve(finalContexts, request);
    const prepared = this.prepareRecords(
      tenantId, principalId, normalized, definition.revision, finalContexts, resolved.snapshot, occurredAt,
    );

    return this.deps.storage.transaction((uow) => {
      const raced = readIdempotentRun(uow, tenantId, normalized.idempotencyKey, requestHash);
      if (raced) return raced;
      if (storedSession) assertSessionUnchanged(uow, storedSession);
      if (prepared.session) uow.sessions.insert(prepared.session);
      uow.runs.insert(prepared.run);
      uow.events.append({
        eventId: prepared.eventId, sequence: 1, schemaVersion: 1,
        tenantId: prepared.run.tenantId, sessionId: prepared.run.sessionId, runId: prepared.run.runId,
        type: 'run.created',
        data: { agentId: prepared.run.agentId, agentRevision: prepared.run.agentRevision, triggerType: prepared.run.trigger.type },
        occurredAt: cloneDate(occurredAt),
      });
      uow.workItems.insert(prepared.workItem);
      if (normalized.idempotencyKey !== undefined) {
        uow.idempotency.insert({
          tenantId, operation: 'start-run', idempotencyKey: normalized.idempotencyKey,
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

  private prepareRecords(
    tenantId: string,
    principalId: string,
    input: StartRunInput,
    agentRevision: string,
    contexts: ContextSet,
    snapshot: AgentRun['contextSnapshot'],
    at: Date,
  ): PreparedRecords {
    const sessionId = input.sessionId ?? this.generateId();
    const session = input.sessionId === undefined ? {
      sessionId, tenantId, contexts, createdAt: cloneDate(at), updatedAt: cloneDate(at),
    } : undefined;
    const runId = this.generateId();
    return {
      ...(session ? { session } : {}),
      run: {
        runId, tenantId, principalId, sessionId,
        agentId: input.agentId, agentRevision, status: 'queued', trigger: input.trigger,
        contextSnapshot: structuredClone(snapshot), createdAt: cloneDate(at), updatedAt: cloneDate(at),
      },
      eventId: this.generateId(),
      workItem: {
        workItemId: this.generateId(), runId, status: 'queued', attempt: 0,
        createdAt: cloneDate(at), updatedAt: cloneDate(at),
      },
    };
  }
}

function validateInput(request: RuntimeRequestContext, input: StartRunInput): void {
  if (typeof request?.tenantId !== 'string' || !request.tenantId.trim()
    || typeof request?.principal?.principalId !== 'string' || !request.principal.principalId.trim()
    || !Array.isArray(request.principal.roles)
    || typeof input?.agentId !== 'string' || !input.agentId.trim()
    || input.idempotencyKey !== undefined
      && (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim())) {
    throw new RuntimeError('INVALID_INPUT', 'Invalid start run input');
  }
}

function normalizeInput(input: StartRunInput): StartRunInput {
  try {
    return {
      agentId: input.agentId,
      ...(input.agentRevision === undefined ? {} : { agentRevision: input.agentRevision }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      trigger: cloneCanonicalJson(input.trigger) as RunTrigger,
      ...(input.contexts === undefined ? {} : { contexts: cloneCanonicalJson(input.contexts) as ContextPatch }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    };
  } catch (cause) {
    throw new RuntimeError('INVALID_INPUT', 'Start run request must be JSON-compatible', false, undefined, { cause });
  }
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
  if (current.updatedAt.getTime() !== expected.updatedAt.getTime()
    || hashCanonicalJson(current.contexts) !== hashCanonicalJson(expected.contexts)) {
    throw new RuntimeError('RUN_CONFLICT', 'Session contexts changed while starting the run');
  }
}

const cloneDate = (value: Date): Date => new Date(value.getTime());

function readTriggerType(trigger: RunTrigger): 'message' | 'task' {
  if (trigger && typeof trigger === 'object' && (trigger.type === 'message' || trigger.type === 'task')) {
    return trigger.type;
  }
  throw new RuntimeError('TRIGGER_NOT_SUPPORTED', 'Trigger is not supported');
}
