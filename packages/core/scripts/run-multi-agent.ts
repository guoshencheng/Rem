import { createAgentSystem } from '../src/system/create-agent-system.js';
import type { AgentSystemEvent } from '../src/agent/bus-events.js';
import { createFakeAssembly } from '../tests/helpers/fake-di.js';
import {
  createScriptedModels, fauxAssistantMessage, fauxToolCall, type ScriptedStep,
} from '../tests/helpers/scripted-models.js';

const responder: Exclude<ScriptedStep, import('@earendil-works/pi-ai').AssistantMessage> = ({ context }) => {
  const serialized = JSON.stringify(context.messages);
  if (context.systemPrompt.includes('architect prompt')) return fauxAssistantMessage('架构方案：采用分层架构，Core 最小化。');
  if (context.systemPrompt.includes('reviewer prompt')) return fauxAssistantMessage('评审意见：方案可行，建议补充预算护栏。');
  if (!serialized.includes('send_message')) {
    return fauxAssistantMessage([fauxToolCall('send_message', {
      to: ['architect', 'reviewer'], content: '请分别给出架构方案与评审意见',
    })]);
  }
  if (!serialized.includes('finish_discussion')) {
    return fauxAssistantMessage([fauxToolCall('finish_discussion', {
      answer: '最终方案：分层架构 + 预算护栏，已综合架构与评审结论。',
    })]);
  }
  return fauxAssistantMessage('讨论结束。');
};

function makeFormatter(threadNames: Map<string, string>) {
  const name = (threadId: string) => threadNames.get(threadId) ?? threadId.slice(0, 8);
  return (event: AgentSystemEvent): string | null => {
    switch (event.type) {
      case 'session-start': return `[session] 开始`;
      case 'session-end': return `[session] 结束`;
      case 'session-error': return `[session] 错误: ${event.error}`;
      case 'discussion-change': return `[discussion] ${event.status}`;
      case 'delivery-change': {
        const d = event.delivery;
        return `[delivery] ${d.kind} → ${name(d.targetAgentThreadId)} : ${d.status}`;
      }
      case 'chunk': {
        const chunk = event.chunk;
        if (chunk.type === 'text-delta') return null;
        return `[chunk] ${event.agentId ?? name(event.agentThreadId ?? '')}: ${chunk.type}`;
      }
      default: return null;
    }
  };
}

async function main(): Promise<void> {
  const scripted = createScriptedModels(Array.from({ length: 12 }, () => responder));
  const assembly = await createFakeAssembly({ models: scripted.models });
  const config = assembly.di.configProvider;
  config.resolveAgent = (id) => {
    const agentId = id || 'default';
    return { id: agentId, name: agentId, corePrompt: `${agentId} prompt` };
  };
  config.resolveTeam = (id) => {
    if (id !== 'engineering') throw new Error(`Unknown team: ${id}`);
    return { id, organizer: config.resolveAgent('organizer'),
      members: [config.resolveAgent('architect'), config.resolveAgent('reviewer')] };
  };
  const system = createAgentSystem(assembly);
  const session = await system.createSession({ workspace: 'ws', teamId: 'engineering' });
  const threads = await system.getSessionThreads(session.sessionId);
  const formatEvent = makeFormatter(new Map(threads.map((t) => [t.agentThreadId, t.agentId])));
  console.log(`session=${session.sessionId} mode=${session.mode} team=${session.teamId}\n`);

  const printing = (async () => {
    for await (const event of system.events()) {
      const line = formatEvent(event);
      if (line) console.log(line);
      if (event.type === 'session-end' || event.type === 'session-error') return;
    }
  })();

  await system.send({ sessionId: session.sessionId, content: '设计一个多 Agent 讨论流程' });
  await printing;

  const chat = await system.getSessionChat(session.sessionId);
  console.log(`\n最终回答：${JSON.stringify(chat.at(-1)?.message)}`);
  console.log(`LLM 调用次数：${scripted.state.callCount}`);
  process.exitCode = 0;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
