import { Type } from '@sinclair/typebox';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentToolCapabilities, ToolCall, ToolContext, ToolDefinition, ToolProvider, ToolResult, ToolSet } from 'rem-agent-core';
import { REMAgent } from '../../src/agent/rem-agent.js';
import { createFakeAssembly, fakeSession } from './fake-di.js';
import { createScriptedModels, type ScriptedStep } from './scripted-models.js';

/** 测试用内存 ToolProvider：注册即工具，execute 不含审批 */
export class ScriptedToolProvider implements ToolProvider {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly executors = new Map<string, (input: never, ctx: ToolContext) => Promise<{ output: string }>>();

  registerRun(name: string, run: (input: Record<string, unknown>) => Promise<string>): void {
    this.register(
      { name, description: name, parameters: Type.Object({}) },
      (async (input: Record<string, unknown>) => ({ output: await run(input) })) as never,
    );
  }

  register<T extends import('@sinclair/typebox').TObject>(def: ToolDefinition<T>, executor: never): void {
    this.definitions.set(def.name, def);
    this.executors.set(def.name, executor);
  }

  getToolSet(): ToolSet {
    return [...this.definitions.values()].map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    }));
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    return Promise.all(
      calls.map(async (call) => {
        const executor = this.executors.get(call.toolName);
        if (!executor) {
          return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `unknown tool: ${call.toolName}` };
        }
        try {
          const result = await executor(call.input as never, ctx);
          return { toolCallId: call.toolCallId, toolName: call.toolName, output: result.output };
        } catch (error) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  }

  isDangerous(): boolean {
    return false;
  }
}

export interface TestAgentParams {
  steps: ScriptedStep[];
  tools?: Array<{ name: string; run: (input: Record<string, unknown>) => Promise<string> }>;
  maxTurns?: number;
  systemPrompt?: string;
  conversation?: Message[];
  agentId?: string;
  sessionId?: string;
  toolCapabilities?: AgentToolCapabilities;
}

export interface TestAgent {
  agent: REMAgent;
  state: { callCount: number };
  scripted: ReturnType<typeof createScriptedModels>;
}

/** 完整装配路径构造 REMAgent（scripted models 控制 LLM 响应；session 预置标题跳过标题 fork） */
export async function createTestAgent(params: TestAgentParams): Promise<TestAgent> {
  const scripted = createScriptedModels(params.steps);
  const toolProvider = new ScriptedToolProvider();
  for (const tool of params.tools ?? []) {
    toolProvider.registerRun(tool.name, tool.run);
  }
  const { di, runtimeConfig } = await createFakeAssembly({
    models: scripted.models,
    toolProvider,
    maxTurns: params.maxTurns,
  });
  const session = fakeSession(params.sessionId ?? 's-1');
  session.metadata.title = 'test';
  if (params.conversation) {
    session.conversation = params.conversation;
  }
  const agent = new REMAgent({
    di,
    runtimeConfig,
    session,
    workspace: 'default',
    agentId: params.agentId ?? 'root',
    sessionId: session.sessionId,
    maxTurns: params.maxTurns,
    systemPrompt: params.systemPrompt,
    toolCapabilities: params.toolCapabilities,
  });
  return { agent, state: scripted.state, scripted };
}
