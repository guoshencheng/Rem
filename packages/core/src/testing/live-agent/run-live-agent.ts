import type { LiveAgentCommandOptions } from './types.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMAgent } from '../../agent/rem-agent.js';
import { createAgentFromEnv } from '../../assembly/agent-factory.js';
import { createDefaultAgentPaths } from '../../infrastructure/config/paths.js';
import { EmptySkillProvider } from '../../plugins/skill/empty/index.js';
import { StaticToolProvider } from '../../plugins/tool/static/index.js';
import { formatLiveAgentEvent } from './event-output.js';

export interface LiveAgentRunResult {
  exitCode: 0 | 1;
}

export async function runLiveAgent(
  options: LiveAgentCommandOptions,
  writeLine: (line: string) => void,
): Promise<LiveAgentRunResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'rem-agent-live-'));
  try {
    const assembly = await createAgentFromEnv({
      paths: createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: join(homedir(), '.rem-agent'),
      }),
      toolProvider: new StaticToolProvider(),
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
      writeLine(formatLiveAgentEvent(event));
      if (event.type === 'error') errors.push(event.error.message);
    }

    const output = agent.output ? await agent.output : undefined;
    writeLine(`最终输出：${output?.content ?? '[无输出]'}`);
    return { exitCode: errors.length > 0 ? 1 : 0 };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
