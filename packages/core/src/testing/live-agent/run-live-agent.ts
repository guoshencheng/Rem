import type { AgentOutput } from '../../agent/types.js';
import type { LiveAgentCommandOptions, LiveAgentToolCall } from './types.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMAgent } from '../../agent/rem-agent.js';
import { createAgentFromEnv } from '../../assembly/agent-factory.js';
import { createDefaultAgentPaths } from '../../infrastructure/config/paths.js';
import { EmptySkillProvider } from '../../plugins/skill/empty/index.js';
import { assertLiveAgentResult } from './result-assertion.js';
import { formatLiveAgentEvent, isImportantLiveAgentEvent } from './event-output.js';
import { LiveAgentTestToolProvider } from './test-tool-provider.js';

export interface LiveAgentRunResult {
  exitCode: 0 | 1;
}

export async function runLiveAgent(
  options: LiveAgentCommandOptions,
  writeLine: (line: string) => void,
): Promise<LiveAgentRunResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'rem-agent-live-'));
  try {
    const toolProvider = new LiveAgentTestToolProvider(options.data);
    const assembly = await createAgentFromEnv({
      paths: createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: join(homedir(), '.rem-agent'),
      }),
      toolProvider,
      skillProvider: new EmptySkillProvider(),
    });
    const session = await assembly.di.sessionProvider.create();
    session.metadata.title = 'Live agent tool harness';
    const agent = new REMAgent({
      di: assembly.di,
      runtimeConfig: assembly.runtimeConfig,
      session,
      sessionId: session.sessionId,
      agentId: 'live-test',
      workspace: process.cwd(),
      toolCapabilities: { readSkill: false, delegateTask: false, todoWrite: false },
    });
    const errors: string[] = [];

    for await (const event of agent.run({ content: options.task })) {
      const line = formatLiveAgentEvent(event);
      if (line && (options.keepOutput || isImportantLiveAgentEvent(event))) writeLine(line);
      if (event.type === 'error') errors.push(event.error.message);
    }

    const output = agent.output ? await agent.output : undefined;
    return summarizeRun(output, errors, toolProvider.calls, options, writeLine);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function summarizeRun(
  output: AgentOutput | undefined,
  errors: string[],
  calls: LiveAgentToolCall[],
  options: LiveAgentCommandOptions,
  writeLine: (line: string) => void,
): LiveAgentRunResult {
  writeLine(`最终输出：${output?.content ?? '[无输出]'}`);
  writeLine(`测试工具调用：${formatCalls(calls)}`);

  const assertion = assertLiveAgentResult(calls, options.expectedResult);
  const reasons = [
    ...(output === undefined ? ['Agent 未产生最终输出'] : []),
    ...(output?.completed === false ? ['Agent 未完成运行'] : []),
    ...errors,
    ...(assertion.passed ? [] : [assertion.reason ?? '结果断言失败']),
  ];
  if (reasons.length > 0) {
    writeLine(`FAIL：${reasons.join('；')}`);
    return { exitCode: 1 };
  }
  writeLine('PASS');
  return { exitCode: 0 };
}

function formatCalls(calls: LiveAgentToolCall[]): string {
  if (calls.length === 0) return '[无]';
  return calls.map((call) => `${call.sequence}.${call.toolName}(${safeJson(call.input)})`).join(' → ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return '[无法序列化]';
  }
}
