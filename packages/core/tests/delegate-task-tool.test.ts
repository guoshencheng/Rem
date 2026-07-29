import { describe, it, expect } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createDelegateTaskToolExecutor } from '../src/plugins/tool/builtin/delegate-task.js';
import { AgentState } from '../src/agent-state.js';
import { createFauxDi, stubRuntimeConfig } from './run-agent/faux-di.js';
import type { BusEvent } from '../src/bus-events.js';

describe('delegate_task tool', () => {
  it('creates a child session and returns XML result', async () => {
    const { di, sessionProvider } = createFauxDi({ responses: [fauxAssistantMessage('child result')] });
    const agentState = new AgentState();

    const executor = createDelegateTaskToolExecutor(di, stubRuntimeConfig(), agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('<task id="');
    expect(result.output).toContain('state="completed"');
    expect(result.output).toContain('<summary>do sub work</summary>');
    expect(result.output).toContain('child result');

    const sessions = await sessionProvider.list();
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('propagates errors from child agent as failed XML', async () => {
    const { di } = createFauxDi({
      responses: [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'child boom' })],
    });
    const agentState = new AgentState();

    const executor = createDelegateTaskToolExecutor(di, stubRuntimeConfig(), agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('state="failed"');
    expect(result.output).toContain('child boom');
  });

  it('tags child-agent-update events with the parent toolCallId', async () => {
    const { di } = createFauxDi({ responses: [fauxAssistantMessage('child result')] });
    const agentState = new AgentState();
    const events: BusEvent[] = [];
    agentState.subscribe((e) => events.push(e));

    const executor = createDelegateTaskToolExecutor(di, stubRuntimeConfig(), agentState, 'default');
    await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1', toolCallId: 'tc-1' });

    const updates = events.filter((e) => e.type === 'child-agent-update');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((e) => e.type === 'child-agent-update' && e.toolCallId === 'tc-1')).toBe(true);
    expect(updates.some((e) => e.type === 'child-agent-update' && e.status === 'completed')).toBe(true);
  });
});
