import { describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { AgentToolRegistry } from '../src/tools/registry.js';
import { ToolOverlay, defineOverlayTool } from '../src/tools/overlay.js';
import { WorkspaceOutsideError } from '../src/security/workspace/workspace-outside-error.js';
import type { ToolProvider, ToolCall, ToolContext, ToolDefinition, ToolExecutor } from '../src/sdk/tool-provider.js';

// ─── registry ────────────────────────────────────────────────────

const echoParam = Type.Object({ message: Type.String() });
const echoDef: ToolDefinition<typeof echoParam> = {
  name: 'echo', description: 'echoes message', parameters: echoParam,
};
const createEchoExecutor = (): ToolExecutor<typeof echoParam> =>
  vi.fn().mockResolvedValue({ output: 'ok' });

const createToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  toolCallId: 'tc1', toolName: 'echo', input: { message: 'hi' }, ...overrides,
});

const ctx: ToolContext = { cwd: '/', workspaceRoot: '/' };

describe('AgentToolRegistry', () => {
  it('registers and retrieves tool definition', () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    registry.register(echoDef, createEchoExecutor());
    expect(registry.getToolDefinition('echo')?.name).toBe('echo');
    expect(registry.getToolDefinition('unknown')).toBeUndefined();
  });

  it('getToolSet returns tools without policy', () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    registry.register(echoDef, createEchoExecutor());
    const toolSet = registry.getToolSet();
    expect(toolSet).toHaveLength(1);
    expect(toolSet[0].name).toBe('echo');
  });

  it('filters readOnly tools when readOnly option is set', () => {
    const readOnlyDef: ToolDefinition = {
      name: 'read', description: 'read', parameters: Type.Object({}),
      readOnly: true,
    };
    const writeDef: ToolDefinition = {
      name: 'write', description: 'write', parameters: Type.Object({}),
    };
    const registry = new AgentToolRegistry({ workspaceRoot: '/', readOnly: true });
    registry.register(readOnlyDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    registry.register(writeDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    const toolSet = registry.getToolSet();
    expect(toolSet).toHaveLength(1);
    expect(toolSet[0].name).toBe('read');
  });

  it('isDangerous checks tool definition', () => {
    const dangerDef: ToolDefinition = {
      name: 'danger', description: 'danger', parameters: Type.Object({}), dangerous: true,
    };
    const safeDef: ToolDefinition = {
      name: 'safe', description: 'safe', parameters: Type.Object({}),
    };
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    registry.register(dangerDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    registry.register(safeDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    expect(registry.isDangerous('danger')).toBe(true);
    expect(registry.isDangerous('safe')).toBe(false);
    expect(registry.isDangerous('unknown')).toBe(false);
  });

  it('executes a known tool successfully', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const executor = vi.fn().mockResolvedValue({ output: 'hello', details: { extra: 1 } });
    registry.register(echoDef, executor);
    const results = await registry.execute([createToolCall()], ctx);
    expect(results).toEqual([{ toolCallId: 'tc1', toolName: 'echo', output: 'hello', details: { extra: 1 } }]);
  });

  it('returns error for unknown tool', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const results = await registry.execute([createToolCall({ toolName: 'ghost' })], ctx);
    expect(results[0].error).toBe('Tool "ghost" not found');
  });

  it('returns error for invalid input', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    registry.register(echoDef, createEchoExecutor());
    const results = await registry.execute([createToolCall({ input: { message: 42 } })], ctx);
    expect(results[0].error).toMatch(/Invalid input for tool "echo"/);
  });

  it('catches executor errors', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const executor = vi.fn().mockRejectedValue(new Error('boom'));
    registry.register(echoDef, executor);
    const results = await registry.execute([createToolCall()], ctx);
    expect(results[0].error).toBe('boom');
  });

  it('catches executor errors that are not Error instances', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const executor = vi.fn().mockRejectedValue('string error');
    registry.register(echoDef, executor);
    const results = await registry.execute([createToolCall()], ctx);
    expect(results[0].error).toBe('string error');
  });

  it('re-throws WorkspaceOutsideError', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const wsError = new WorkspaceOutsideError('/etc', '/');
    const executor = vi.fn().mockRejectedValue(wsError);
    registry.register(echoDef, executor);
    await expect(registry.execute([createToolCall()], ctx)).rejects.toThrow(wsError);
  });

  it('executes multiple calls', async () => {
    const registry = new AgentToolRegistry({ workspaceRoot: '/' });
    const executor = vi.fn().mockResolvedValue({ output: 'ok' });
    registry.register(echoDef, executor);
    const results = await registry.execute([
      createToolCall({ toolCallId: 'a' }),
      createToolCall({ toolCallId: 'b' }),
    ], ctx);
    expect(results).toHaveLength(2);
    expect(results[0].toolCallId).toBe('a');
    expect(results[1].toolCallId).toBe('b');
  });
});

// ─── overlay ────────────────────────────────────────────────────

class FakeBase implements ToolProvider {
  private defs = new Map<string, ToolDefinition>();
  private execs = new Map<string, ToolExecutor>();

  setup(name: string, dangerous = false, executor?: ToolExecutor) {
    const def: ToolDefinition = { name, description: name, parameters: Type.Object({}), dangerous };
    this.defs.set(name, def);
    this.execs.set(name, executor ?? vi.fn().mockResolvedValue({ output: 'base' }));
  }

  register<T extends import('@sinclair/typebox').TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.defs.set(def.name, def as unknown as ToolDefinition);
    this.execs.set(def.name, executor as ToolExecutor);
  }

  getToolSet() { return [{ name: 'base1', description: 'd1', parameters: {} }, { name: 'base2', description: 'd2', parameters: {} }]; }
  getToolDefinition(name: string) { return this.defs.get(name); }
  isDangerous(name: string) { return this.defs.get(name)?.dangerous === true; }
  async execute(calls: ToolCall[], _ctx: ToolContext) {
    return calls.map((c) => {
      const exec = this.execs.get(c.toolName);
      return exec ? { toolCallId: c.toolCallId, toolName: c.toolName, output: 'base' } : { toolCallId: c.toolCallId, toolName: c.toolName, output: '', error: 'not found' };
    });
  }
}

const overlayParam = Type.Object({ value: Type.String() });
const overlayDef: ToolDefinition<typeof overlayParam> = {
  name: 'overlay1', description: 'overlays base', parameters: overlayParam,
};

describe('defineOverlayTool', () => {
  it('returns entry with def and executor', () => {
    const executor = vi.fn().mockResolvedValue({ output: 'ok' });
    const entry = defineOverlayTool(overlayDef, executor);
    expect(entry.def.name).toBe('overlay1');
    expect(entry.executor).toBe(executor);
  });
});

describe('ToolOverlay', () => {
  it('proxies getToolSet and merges overlays', () => {
    const base = new FakeBase();
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, vi.fn().mockResolvedValue({ output: 'ok' }))]);
    const toolSet = overlay.getToolSet();
    const names = toolSet.map((t) => t.name);
    expect(names).toContain('base1');
    expect(names).toContain('base2');
    expect(names).toContain('overlay1');
  });

  it('overlays shadow base tools with same name', () => {
    const base = new FakeBase();
    const shadowDef: ToolDefinition = { name: 'base1', description: 'shadowed', parameters: Type.Object({}) };
    const overlay = new ToolOverlay(base, [defineOverlayTool(shadowDef, vi.fn().mockResolvedValue({ output: 'shadow' }))]);
    const toolSet = overlay.getToolSet();
    const base1Tool = toolSet.find((t) => t.name === 'base1');
    expect(base1Tool?.description).toBe('shadowed');
  });

  it('isDangerous falls back to base when not in overlay', () => {
    const base = new FakeBase();
    base.setup('base1', true);
    const overlay = new ToolOverlay(base);
    expect(overlay.isDangerous('base1')).toBe(true);
    expect(overlay.isDangerous('unknown')).toBe(false);
  });

  it('isDangerous uses overlay definition', () => {
    const base = new FakeBase();
    const dangerDef: ToolDefinition = { name: 'danger', description: '', parameters: Type.Object({}), dangerous: true };
    const overlay = new ToolOverlay(base, [defineOverlayTool(dangerDef, vi.fn().mockResolvedValue({ output: 'ok' }))]);
    expect(overlay.isDangerous('danger')).toBe(true);
  });

  it('getToolDefinition falls back to base when not in overlay', () => {
    const base = new FakeBase();
    base.setup('base1');
    const overlay = new ToolOverlay(base);
    expect(overlay.getToolDefinition('base1')?.name).toBe('base1');
    expect(overlay.getToolDefinition('unknown')).toBeUndefined();
  });

  it('getToolDefinition uses overlay definition', () => {
    const base = new FakeBase();
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, vi.fn().mockResolvedValue({ output: 'ok' }))]);
    expect(overlay.getToolDefinition('overlay1')?.name).toBe('overlay1');
  });

  it('register method adds overlay entry', () => {
    const base = new FakeBase();
    const overlay = new ToolOverlay(base);
    const regDef: ToolDefinition = { name: 'regtest', description: 'r', parameters: Type.Object({ x: Type.String() }) };
    overlay.register(regDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    const toolSet = overlay.getToolSet();
    expect(toolSet.some((t) => t.name === 'regtest')).toBe(true);
  });

  it('execute dispatches to base for non-overlay tools', async () => {
    const base = new FakeBase();
    base.setup('base1');
    const overlay = new ToolOverlay(base);
    const results = await overlay.execute([{ toolCallId: '1', toolName: 'base1', input: {} }], ctx);
    expect(results[0].output).toBe('base');
  });

  it('execute dispatches to overlay for overlay tools', async () => {
    const base = new FakeBase();
    const executor = vi.fn().mockResolvedValue({ output: 'overlay-output' });
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, executor)]);
    const results = await overlay.execute([{ toolCallId: '1', toolName: 'overlay1', input: { value: 'test' } }], ctx);
    expect(results[0].output).toBe('overlay-output');
  });

  it('execute returns validation error for invalid overlay input', async () => {
    const base = new FakeBase();
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, vi.fn().mockResolvedValue({ output: 'ok' }))]);
    const results = await overlay.execute([{ toolCallId: '1', toolName: 'overlay1', input: { value: 42 } }], ctx);
    expect(results[0].error).toMatch(/Invalid input/);
  });

  it('execute handles overlay executor errors', async () => {
    const base = new FakeBase();
    const executor = vi.fn().mockRejectedValue(new Error('bang'));
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, executor)]);
    const results = await overlay.execute([{ toolCallId: '1', toolName: 'overlay1', input: { value: 'test' } }], ctx);
    expect(results[0].error).toBe('bang');
  });

  it('execute handles non-Error overlay executor errors', async () => {
    const base = new FakeBase();
    const executor = vi.fn().mockRejectedValue({ message: 'obj err' });
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, executor)]);
    const results = await overlay.execute([{ toolCallId: '1', toolName: 'overlay1', input: { value: 'test' } }], ctx);
    expect(results[0].error).toBe('[object Object]');
  });

  it('execute mixes base and overlay calls', async () => {
    const base = new FakeBase();
    base.setup('base1');
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, vi.fn().mockResolvedValue({ output: 'overlay' }))]);
    const results = await overlay.execute([
      { toolCallId: '1', toolName: 'base1', input: {} },
      { toolCallId: '2', toolName: 'overlay1', input: { value: 'test' } },
    ], ctx);
    expect(results).toHaveLength(2);
    expect(results[0].output).toBe('base');
    expect(results[1].output).toBe('overlay');
  });

  it('overlay isDangerous returns false for non-dangerous overlay', () => {
    const base = new FakeBase();
    const overlay = new ToolOverlay(base, [defineOverlayTool(overlayDef, vi.fn().mockResolvedValue({ output: 'ok' }))]);
    expect(overlay.isDangerous('overlay1')).toBe(false);
  });
});
