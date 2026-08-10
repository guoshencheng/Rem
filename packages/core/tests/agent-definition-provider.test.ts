import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import { describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/index.js';

const definitions: AgentDefinition[] = [
  {
    agentId: 'support',
    revision: '1',
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
    revision: '2',
    name: 'Support',
    instructions: 'Help better',
    modelId: 'default',
    toolNames: [],
    acceptedTriggers: ['message'],
    execution: { type: 'single-agent' },
  },
];

describe('StaticAgentDefinitionProvider', () => {
  it('returns the highest numeric revision when revision is omitted', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await expect(provider.get('support')).resolves.toMatchObject({ revision: '2' });
  });

  it('returns the requested fixed revision', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await expect(provider.get('support', '1')).resolves.toMatchObject({ revision: '1' });
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
    input[0]!.toolNames.push('mutated-input-tool');
    input[0]!.requiredContexts?.[0] && (input[0]!.requiredContexts[0].type = 'mutated-context');

    const listed = await provider.list();
    listed[0]!.name = 'Mutated list';
    listed[0]!.toolNames.push('mutated-list-tool');
    listed[0]!.requiredContexts?.[0] && (listed[0]!.requiredContexts[0].type = 'mutated-list-context');
    listed[0]!.execution.type = 'single-agent';

    const fetched = await provider.get('support', '1');
    fetched!.name = 'Mutated get';
    fetched!.overridableContexts?.push('mutated-get-context');

    const listedAgain = await provider.list();
    const fetchedAgain = await provider.get('support', '1');
    expect(listedAgain[0]).toMatchObject({
      name: 'Support',
      toolNames: [],
      requiredContexts: [{ type: 'customer', min: 1 }],
      overridableContexts: ['locale'],
    });
    expect(fetchedAgain).toMatchObject({ name: 'Support', overridableContexts: ['locale'] });
  });

  it('keeps list order and supports repeated initialization', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);

    await provider.init();
    await provider.init();

    await expect(provider.list()).resolves.toMatchObject([{ revision: '1' }, { revision: '2' }]);
  });
});

describe('RuntimeError', () => {
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
