import { describe, expect, it } from 'vitest';
import type { AssistantMessage, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { AgentProfile } from '../src/agent-profile/model.js';
import type { AgentThread } from '../src/session/agent-thread/model.js';
import type { MessageEntryPayload, SessionTreeEntry } from '../src/session/tree/types.js';
import {
  ProjectionError,
  projectSessionChat,
  projectThreadContext,
} from '../src/session/messages/index.js';

const now = new Date(1);
const profileA: AgentProfile = { agentProfileId: 'pa', name: 'A', createdAt: now, updatedAt: now };
const profileB: AgentProfile = { agentProfileId: 'pb', name: 'B', createdAt: now, updatedAt: now };
const threadA: AgentThread = {
  agentThreadId: 'ta', sessionId: 's', agentProfileId: 'pa', role: 'primary',
  lifecycle: 'persistent', createdAt: now, updatedAt: now,
};
const threadB: AgentThread = {
  agentThreadId: 'tb', sessionId: 's', agentProfileId: 'pb', role: 'member',
  lifecycle: 'persistent', createdAt: now, updatedAt: now,
};

function assistant(text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant', api: 'test', provider: 'test', model: 'test',
    content: [{ type: 'text', text }], stopReason: 'stop', timestamp,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function tool(text: string, timestamp: number): ToolResultMessage {
  return {
    role: 'toolResult', toolCallId: `call-${timestamp}`, toolName: 'test',
    content: [{ type: 'text', text }], isError: false, timestamp,
  };
}

function entry(id: string, parentId: string | null, payload: MessageEntryPayload): SessionTreeEntry {
  return { id, sessionId: 's', parentId, type: 'message', payload, timestamp: 1 };
}

function fixture(): SessionTreeEntry[] {
  return [
    entry('u', null, {
      message: { role: 'user', content: 'question', timestamp: 1 }, messageId: 'mu',
      mentions: ['ta', 'tb'], rootUserMessageId: 'mu',
    }),
    entry('a', 'u', {
      message: assistant('A public', 2), messageId: 'ma',
      author: { type: 'agent', agentThreadId: 'ta' }, scope: { type: 'session' },
      replyToMessageId: 'mu', rootUserMessageId: 'mu',
    }),
    entry('at', 'a', {
      message: tool('A private', 3), messageId: 'mat',
      author: { type: 'tool', agentThreadId: 'ta' },
      scope: { type: 'thread', agentThreadId: 'ta' },
    }),
    entry('b', 'at', {
      message: assistant('B public', 4), messageId: 'mb',
      author: { type: 'agent', agentThreadId: 'tb' }, scope: { type: 'session' },
    }),
    entry('bt', 'b', {
      message: tool('B private', 5), messageId: 'mbt',
      author: { type: 'tool', agentThreadId: 'tb' },
      scope: { type: 'thread', agentThreadId: 'tb' },
    }),
    entry('branch', 'u', { message: assistant('inactive', 6), messageId: 'branch' }),
  ];
}

describe('message projection', () => {
  it('projects active public messages for group chat with discussion metadata', () => {
    const projected = projectSessionChat(fixture(), 'bt', 'ta');
    expect(projected.map((item) => item.messageId)).toEqual(['mu', 'ma', 'mb']);
    expect(projected[0]).toMatchObject({ mentions: ['ta', 'tb'], rootUserMessageId: 'mu' });
    expect(projected[1]).toMatchObject({ authorThreadId: 'ta', replyToMessageId: 'mu' });
    expect(projected[2]?.authorThreadId).toBe('tb');
  });

  it('projects a target thread context without duplicating or mutating messages', () => {
    const entries = fixture();
    const originalB = (entries[3]?.payload as MessageEntryPayload).message;
    const projected = projectThreadContext({
      entries, leafId: 'bt', target: threadA, threads: [threadA, threadB], profiles: [profileA, profileB],
    });
    expect(projected.map((message) => message.role)).toEqual([
      'user', 'assistant', 'toolResult', 'user',
    ]);
    expect(projected[3]).toMatchObject({
      role: 'user', content: [{ type: 'text', text: '[Agent: B]' }, { type: 'text', text: 'B public' }],
    });
    expect((projected[2] as ToolResultMessage).content[0]).toMatchObject({ text: 'A private' });
    expect((entries[3]?.payload as MessageEntryPayload).message).toBe(originalB);
  });

  it('throws when a referenced thread or profile cannot be resolved', () => {
    const input = { entries: fixture(), leafId: 'bt', target: threadA, threads: [threadA, threadB] };
    expect(() => projectThreadContext({ ...input, profiles: [profileA] })).toThrow(ProjectionError);
    expect(() => projectThreadContext({ ...input, threads: [threadA], profiles: [profileA] }))
      .toThrow('agent thread not found: tb');
  });

  it('omits public assistant messages containing only private reasoning', () => {
    const reasoning = assistant('', 7);
    reasoning.content = [{ type: 'thinking', thinking: 'secret' }];
    const entries = [entry('r', null, {
      message: reasoning as Message, messageId: 'r',
      author: { type: 'agent', agentThreadId: 'tb' }, scope: { type: 'session' },
    })];
    expect(projectSessionChat(entries, 'r', 'ta')).toEqual([]);
    expect(projectThreadContext({
      entries, leafId: 'r', target: threadA, threads: [threadA, threadB], profiles: [profileA, profileB],
    })).toEqual([]);
  });
});
