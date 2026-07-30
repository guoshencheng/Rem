import { describe, it, expect, vi } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { runAgent } from '../src/run-agent.js';
import { AgentState } from '../src/agent-state.js';
import { createFauxDi, stubRuntimeConfig } from './run-agent/faux-di.js';
import type { PromptBuildContext } from '../src/sdk/system-prompt.js';

const runOnce = async (params: {
  contexts: PromptBuildContext[];
  runParams: { workspace?: string; workspaceRoot?: string };
  behaviorWorkspaceRoot?: string;
}) => {
  const { contexts } = params;
  const { di } = createFauxDi({
    responses: [fauxAssistantMessage('done')],
    configOverrides: {
      getBehaviorConfig: () => ({ name: 'test', maxTurns: 5, workspaceRoot: params.behaviorWorkspaceRoot ?? '/behavior', readOnly: false, autoApproveDangerous: false }),
    },
    diOverrides: {
      systemPromptAssembler: { assemble: vi.fn(async (ctx: PromptBuildContext) => { contexts.push(ctx); return 'sys'; }) },
    },
  });

  const result = runAgent({
    input: { content: 'hi' },
    sessionId: `ws-${Math.random()}`,
    di, runtimeConfig: stubRuntimeConfig(),
    agentState: new AgentState(),
    ...params.runParams,
  });
  for await (const _chunk of result.stream.fullStream) {
    // drain
  }
  await result.output;
};

describe('runAgent workspaceRoot', () => {
  it('uses explicit workspaceRoot over behavior.workspaceRoot', async () => {
    const contexts: PromptBuildContext[] = [];
    await runOnce({ contexts, runParams: { workspaceRoot: '/explicit', workspace: '/ws' } });
    expect(contexts[0].workspaceRoot).toBe('/explicit');
  });

  it('defaults workspaceRoot to workspace when workspaceRoot is omitted', async () => {
    const contexts: PromptBuildContext[] = [];
    await runOnce({ contexts, runParams: { workspace: '/ws' } });
    expect(contexts[0].workspaceRoot).toBe('/ws');
  });

  it('falls back to behavior.workspaceRoot when neither workspace nor workspaceRoot is provided', async () => {
    const contexts: PromptBuildContext[] = [];
    await runOnce({ contexts, runParams: {}, behaviorWorkspaceRoot: '/behavior' });
    expect(contexts[0].workspaceRoot).toBe('/behavior');
  });
});
