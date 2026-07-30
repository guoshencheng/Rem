import { describe, it, expect } from 'vitest';
import { applyToolPolicyPipeline, normalizeToolName } from '../src/security/tool-policy-pipeline.js';
import type { ToolDefinition } from '../src/sdk/tool-provider.js';

function makeTool(name: string, readOnly = false, dangerous = false): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object' } as unknown as ToolDefinition['parameters'],
    readOnly,
    dangerous,
  };
}

describe('tool-policy-pipeline', () => {
  it('normalizes tool names to lowercase', () => {
    expect(normalizeToolName('Read')).toBe('read');
  });

  it('keeps all tools when no policy is set', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: false, policy: {} });
    expect(result.map((t) => t.name)).toEqual(['read', 'write']);
  });

  it('filters by allow list', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: false, policy: { allow: ['read'] } });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('supports wildcard allow', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: false, policy: { allow: ['*'] } });
    expect(result.map((t) => t.name)).toEqual(['read', 'write']);
  });

  it('filters by deny list', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: false, policy: { deny: ['write'] } });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('removes non-readOnly tools in readOnly mode', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: true, policy: {} });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('expands coding profile', () => {
    const tools = [makeTool('read', true), makeTool('write'), makeTool('exec')];
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { profile: 'coding' },
    });
    expect(result.map((t) => t.name).sort()).toEqual(['exec', 'read', 'write']);
  });

  it('applies provider-specific policy', () => {
    const tools = [makeTool('read', true), makeTool('write')];
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { byProvider: { openai: { deny: ['write'] } } },
      provider: 'openai',
    });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('applies sender-specific policy', () => {
    const tools = [makeTool('read', true), makeTool('write')];
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { toolsBySender: { 'id:guest': { deny: ['write'] } } },
      sender: 'id:guest',
    });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('applies sandbox tool policy', () => {
    const tools = [makeTool('read', true), makeTool('write')];
    const result = applyToolPolicyPipeline({
      tools,
      readOnly: false,
      policy: { sandbox: { mode: 'all', tools: { deny: ['write'] } } },
    });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('empty allow list denies all tools', () => {
    const tools = [makeTool('read', true), makeTool('write', false, true)];
    const result = applyToolPolicyPipeline({ tools, readOnly: false, policy: { allow: [] } });
    expect(result).toHaveLength(0);
  });
});
