import { createAgentSystem } from '../src/system/create-agent-system.js';
import { createFakeAssembly } from '../tests/helpers/fake-di.js';
import {
  createScriptedModels, fauxAssistantMessage, fauxToolCall, type ScriptedStep,
} from '../tests/helpers/scripted-models.js';
import {
  describeAssistantContent, makeSystemEventFormatter,
} from '../src/testing/live-agent/system-event-output.js';

const responder: Exclude<ScriptedStep, import('@earendil-works/pi-ai').AssistantMessage> = ({ context }) => {
  const { systemPrompt } = context;
  if (systemPrompt.includes('architect prompt')) {
    return fauxAssistantMessage('架构方案：采用分层架构，Core 最小化，接入层只做组装。');
  }
  if (systemPrompt.includes('reviewer prompt')) {
    return fauxAssistantMessage('评审意见：方案可行，建议补充预算护栏与中止策略。');
  }
  if (systemPrompt.includes('security prompt')) {
    return fauxAssistantMessage('安全评估：需补充鉴权与审计日志，敏感操作要二次确认。');
  }
  if (systemPrompt.includes('performance prompt')) {
    return fauxAssistantMessage('性能评估：建议引入缓存与队列削峰，避免高峰期阻塞。');
  }

  const serialized = JSON.stringify(context.messages);
  const sendRounds = (serialized.match(/"name":"send_message"/g) ?? []).length;
  if (serialized.includes('"name":"finish_discussion"')) return fauxAssistantMessage('讨论结束。');
  if (sendRounds === 0) {
    return fauxAssistantMessage([fauxToolCall('send_message', {
      to: ['architect', 'reviewer'], content: '请分别给出架构方案与评审意见',
    })]);
  }
  if (sendRounds === 1 && serialized.includes('Core 最小化') && serialized.includes('预算护栏')) {
    return fauxAssistantMessage([fauxToolCall('send_message', {
      to: ['security', 'performance'],
      content: '已有初步方案与评审结论，请分别从安全与性能角度给出评估意见',
    })]);
  }
  if (sendRounds >= 2 && serialized.includes('鉴权与审计') && serialized.includes('削峰')) {
    return fauxAssistantMessage([fauxToolCall('finish_discussion', {
      answer: '最终方案：分层架构 + 预算护栏 + 鉴权审计 + 缓存削峰，已综合架构、评审、安全与性能结论。',
    })]);
  }
  return fauxAssistantMessage('已发出本轮消息，等待成员回复。');
};

async function main(): Promise<void> {
  const scripted = createScriptedModels(Array.from({ length: 16 }, () => responder));
  const assembly = await createFakeAssembly({ models: scripted.models });
  const config = assembly.di.configProvider;
  config.resolveAgent = (id) => {
    const agentId = id || 'default';
    return { id: agentId, name: agentId, corePrompt: `${agentId} prompt` };
  };
  config.resolveTeam = (id) => {
    if (id !== 'engineering') throw new Error(`Unknown team: ${id}`);
    return { id, organizer: config.resolveAgent('organizer'),
      members: ['architect', 'reviewer', 'security', 'performance'].map((m) => config.resolveAgent(m)) };
  };
  const system = createAgentSystem(assembly);
  const session = await system.createSession({ workspace: 'ws', teamId: 'engineering' });
  const threads = await system.getSessionThreads(session.sessionId);
  const threadNames = new Map(threads.map((t) => [t.agentThreadId, t.agentId]));
  const formatEvent = makeSystemEventFormatter(threadNames);
  console.log(`session=${session.sessionId} mode=${session.mode} team=${session.teamId}`);
  console.log('threads:');
  for (const t of threads) {
    console.log(`  - ${t.agentId} (${t.agentThreadId.slice(0, 8)}) role=${t.role} lifecycle=${t.lifecycle}`);
  }
  console.log('');

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
  console.log('\n── 会话消息记录 ──');
  for (const item of chat) {
    const who = item.authorThreadId ? threadNames.get(item.authorThreadId) ?? item.authorThreadId.slice(0, 8) : item.message.role;
    console.log(`[${who}] ${describeAssistantContent(item.message)}`);
  }
  console.log(`\n最终回答：${JSON.stringify(chat.at(-1)?.message)}`);
  console.log(`LLM 调用次数：${scripted.state.callCount}`);
  process.exitCode = 0;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
