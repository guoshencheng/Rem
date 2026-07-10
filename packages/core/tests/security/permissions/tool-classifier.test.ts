import { describe, it, expect } from 'vitest';
import { classifyTool } from '../../../src/security/permissions/tool-classifier.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const editDef: ToolDefinition = {
  name: 'edit',
  description: 'edit',
  parameters: Type.Object({ path: Type.String(), oldString: Type.String(), newString: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const execDef: ToolDefinition = {
  name: 'exec',
  description: 'exec',
  parameters: Type.Object({ command: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { command: string }) => [`bash:${input.command}`],
};

describe('classifyTool', () => {
  it('classifies write tools as write', () => {
    expect(classifyTool('write', writeDef, ['file:src/foo.ts'])).toBe('write');
    expect(classifyTool('edit', editDef, ['file:src/foo.ts'])).toBe('write');
  });

  it('classifies safe exec as read', () => {
    expect(classifyTool('exec', execDef, ['bash:git status'])).toBe('read');
  });

  it('classifies non-safe exec as write', () => {
    expect(classifyTool('exec', execDef, ['bash:git push'])).toBe('write');
  });

  it('classifies ordinary read as read', () => {
    expect(classifyTool('read', readDef, ['file:src/foo.ts'])).toBe('read');
  });

  it('classifies sensitive read as sensitive-read', () => {
    expect(classifyTool('read', readDef, ['file:/project/.env'])).toBe('sensitive-read');
    expect(classifyTool('read', readDef, ['file:/project/secrets/vault.json'])).toBe('sensitive-read');
  });

  it('classifies ls as read', () => {
    const lsDef: ToolDefinition = {
      name: 'ls',
      description: 'ls',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    expect(classifyTool('ls', lsDef, ['file:src'])).toBe('read');
  });
});
