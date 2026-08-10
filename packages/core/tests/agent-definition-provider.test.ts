import type { AgentDefinition, ContextTypeConstraint, RunTriggerType } from '../src/domain/agent-definition/types.js';
import { describe, expect, it } from 'vitest';
import { RuntimeError, RUNTIME_ERROR_CODES } from '../src/application/runtime/runtime-error.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/index.js';

const runtimeErrorCodes = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'AGENT_NOT_FOUND',
  'AGENT_REVISION_NOT_FOUND',
  'TRIGGER_NOT_SUPPORTED',
  'SESSION_NOT_FOUND',
  'RUN_NOT_FOUND',
  'RUN_CONFLICT',
  'RUN_ALREADY_TERMINAL',
  'CONTEXT_TYPE_NOT_FOUND',
  'CONTEXT_INVALID',
  'CONTEXT_CONFLICT',
  'CONTEXT_UNAUTHORIZED',
  'PLUGIN_DEPENDENCY_MISSING',
  'TOOL_NOT_FOUND',
  'TOOL_DENIED',
  'TOOL_EXECUTION_FAILED',
  'TOOL_RESULT_UNKNOWN',
  'MODEL_UNAVAILABLE',
  'MODEL_EXECUTION_FAILED',
  'STORAGE_CONFLICT',
  'STORAGE_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'EXECUTION_TIMEOUT',
  'EXECUTION_CANCELLED',
  'INTERNAL_ERROR',
] as const;

const definitions: AgentDefinition[] = [
  {
    agentId: 'support',
    revision: '2',
    name: 'Support',
    instructions: 'Help',
    modelId: 'default',
    toolNames: [],
    acceptedTriggers: ['message'],
    requiredContexts: [{ type: 'customer', min: 1 }],
    optionalContexts: [{ type: 'order', max: 2 }],
    overridableContexts: ['locale'],
    execution: { type: 'single-agent' },
  },
  {
    agentId: 'support',
    revision: '10',
    name: 'Support',
    instructions: 'Help better',
    modelId: 'default',
    toolNames: [],
    acceptedTriggers: ['message'],
    execution: { type: 'single-agent' },
  },
];

type MutableDefinition = {
  toolNames: string[];
  acceptedTriggers: RunTriggerType[];
  requiredContexts?: ContextTypeConstraint[];
  optionalContexts?: ContextTypeConstraint[];
  overridableContexts?: string[];
  execution: { type: string };
};

function mutateDefinition(definition: AgentDefinition, marker: string): void {
  const mutable = definition as unknown as MutableDefinition;
  mutable.toolNames.push(`${marker}-tool`);
  mutable.acceptedTriggers.push('task');
  mutable.requiredContexts?.[0] && (mutable.requiredContexts[0].type = `${marker}-required`);
  mutable.optionalContexts?.[0] && (mutable.optionalContexts[0].type = `${marker}-optional`);
  mutable.overridableContexts?.push(`${marker}-context`);
  mutable.execution.type = `${marker}-execution`;
}

function expectOriginalDefinition(definition: AgentDefinition | null): void {
  expect(definition).toMatchObject({
    name: 'Support',
    toolNames: [],
    acceptedTriggers: ['message'],
    requiredContexts: [{ type: 'customer', min: 1 }],
    optionalContexts: [{ type: 'order', max: 2 }],
    overridableContexts: ['locale'],
    execution: { type: 'single-agent' },
  });
}

describe('StaticAgentDefinitionProvider', () => {
  it('returns the highest numeric revision when revision is omitted', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await expect(provider.get('support')).resolves.toMatchObject({ revision: '10' });
  });

  it('returns the requested fixed revision', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await expect(provider.get('support', '2')).resolves.toMatchObject({ revision: '2' });
  });

  it('treats an empty revision as an explicit revision and current definition', async () => {
    const provider = new StaticAgentDefinitionProvider([{ ...definitions[0]!, revision: '' }]);

    await expect(provider.get('support')).resolves.toMatchObject({ revision: '' });
    await expect(provider.get('support', '')).resolves.toMatchObject({ revision: '' });
  });

  it('uses original UTF-16 ordering to break numeric revision ties', async () => {
    const revisionTwo = { ...definitions[0]!, revision: '2' };
    const revisionZeroTwo = { ...definitions[0]!, revision: '02' };
    const firstProvider = new StaticAgentDefinitionProvider([revisionTwo, revisionZeroTwo]);
    const secondProvider = new StaticAgentDefinitionProvider([revisionZeroTwo, revisionTwo]);

    const firstCurrent = await firstProvider.get('support');
    const secondCurrent = await secondProvider.get('support');
    expect(firstCurrent?.revision).toBe('2');
    expect(firstCurrent?.revision).toBe(secondCurrent?.revision);
  });

  it('uses original UTF-16 ordering for canonically equivalent Unicode revisions', async () => {
    const composedRevision = { ...definitions[0]!, revision: 'é2' };
    const decomposedRevision = { ...definitions[0]!, revision: 'e\u03012' };
    const firstProvider = new StaticAgentDefinitionProvider([composedRevision, decomposedRevision]);
    const secondProvider = new StaticAgentDefinitionProvider([decomposedRevision, composedRevision]);

    const firstCurrent = await firstProvider.get('support');
    const secondCurrent = await secondProvider.get('support');
    expect(firstCurrent?.revision).toBe('é2');
    expect(firstCurrent?.revision).toBe(secondCurrent?.revision);
  });

  it('returns null for unknown agents and revisions', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await expect(provider.get('sales')).resolves.toBeNull();
    await expect(provider.get('support', '3')).resolves.toBeNull();
  });

  it('rejects duplicate agent id and revision pairs', () => {
    expect(() => new StaticAgentDefinitionProvider([...definitions, definitions[0]!])).toThrow(
      'Duplicate agent definition',
    );
  });

  it('isolates stored definitions and all returned values from caller mutation', async () => {
    const input = structuredClone(definitions);
    const provider = new StaticAgentDefinitionProvider(input);
    input[0]!.name = 'Mutated input';
    mutateDefinition(input[0]!, 'input');
    expectOriginalDefinition(await provider.get('support', '2'));

    const listed = await provider.list();
    const fetched = await provider.get('support', '2');
    expect(listed[0]).not.toBe(fetched);
    expect(listed[0]!.toolNames).not.toBe(fetched!.toolNames);
    expect(listed[0]!.acceptedTriggers).not.toBe(fetched!.acceptedTriggers);
    expect(listed[0]!.requiredContexts).not.toBe(fetched!.requiredContexts);
    expect(listed[0]!.requiredContexts?.[0]).not.toBe(fetched!.requiredContexts?.[0]);
    expect(listed[0]!.optionalContexts).not.toBe(fetched!.optionalContexts);
    expect(listed[0]!.optionalContexts?.[0]).not.toBe(fetched!.optionalContexts?.[0]);
    expect(listed[0]!.overridableContexts).not.toBe(fetched!.overridableContexts);
    expect(listed[0]!.execution).not.toBe(fetched!.execution);

    mutateDefinition(listed[0]!, 'list');
    mutateDefinition(fetched!, 'get');

    const listedAgain = await provider.list();
    const fetchedAgain = await provider.get('support', '2');
    expectOriginalDefinition(listedAgain[0]!);
    expectOriginalDefinition(fetchedAgain);
  });

  it('keeps list order and supports repeated initialization', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await provider.init();
    await provider.init();

    await expect(provider.list()).resolves.toMatchObject([{ revision: '2' }, { revision: '10' }]);
  });
});

describe('RuntimeError', () => {
  it('matches the planned error code set', () => {
    expect(RUNTIME_ERROR_CODES).toEqual(runtimeErrorCodes);
    expect(runtimeErrorCodes).toHaveLength(27);
    expect(runtimeErrorCodes).toContain('AGENT_NOT_FOUND');
    expect(runtimeErrorCodes).toContain('STORAGE_UNAVAILABLE');
    expect(runtimeErrorCodes).toContain('INTERNAL_ERROR');
  });

  it('preserves stable error metadata and cause', () => {
    const cause = new Error('database unavailable');
    const details = { operation: 'write' };
    const error = new RuntimeError('STORAGE_UNAVAILABLE', 'Storage unavailable', true, details, { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RuntimeError');
    expect(error.code).toBe('STORAGE_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(error.details).toBe(details);
    expect(error.cause).toBe(cause);
  });
});
