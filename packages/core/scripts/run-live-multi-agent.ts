import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createAgentFromEnv } from '../src/assembly/agent-factory.js';
import { createDefaultAgentPaths } from '../src/infrastructure/config/paths.js';
import { EmptySkillProvider } from '../src/plugins/skill/empty/index.js';
import { StaticToolProvider } from '../src/plugins/tool/static/index.js';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import {
  describeAssistantContent, makeSystemEventFormatter,
} from '../src/testing/live-agent/system-event-output.js';

const AGENT_PROMPTS: Record<string, string> = {
  organizer: `你是技术团队的组织者。团队成员固定为：architect（架构师）、reviewer（评审者）、security（安全专家）、performance（性能专家），只能向这四个 id 发消息。
工作流程：
1. 收到用户任务后，用一次 send_message 把任务同时发给全部四名成员。
2. 发送成功后，用一句简短文本结束本轮（严禁此时调用 finish_discussion），等待成员回复。
3. 收齐四名成员的回复后，调用一次 finish_discussion 提交综合结论，然后用一句简短文本结束。
不要使用 todowrite。工作语言为中文。`,
  architect: '你是资深架构师，关注模块边界、分层与可维护性。用中文作答，200 字以内，直接给出方案要点。',
  reviewer: '你是严格的方案评审者，关注风险、预算与中止策略。用中文作答，200 字以内，直接给出评审意见。',
  security: '你是安全专家，关注鉴权、审计日志与数据保护。用中文作答，200 字以内，直接给出安全评估。',
  performance: '你是性能专家，关注延迟、吞吐与资源消耗。用中文作答，200 字以内，直接给出性能评估。',
};

const MEMBER_IDS = ['architect', 'reviewer', 'security', 'performance'];

function parseOptions(argv: string[]): { task: string } {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: { task: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  return { task: values.task?.trim() || '设计一个支持多租户的 Agent 调度系统，给出架构方案并评估风险' };
}

async function main(): Promise<void> {
  const { task } = parseOptions(process.argv.slice(2));
  const tempDir = await mkdtemp(join(tmpdir(), 'rem-agent-live-multi-'));
  try {
    const assembly = await createAgentFromEnv({
      paths: createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: join(homedir(), '.rem-agent'),
      }),
      toolProvider: new StaticToolProvider(),
      skillProvider: new EmptySkillProvider(),
    });
    const config = assembly.di.configProvider;
    config.resolveAgent = (id) => {
      const agentId = id || 'organizer';
      return { id: agentId, name: agentId, corePrompt: AGENT_PROMPTS[agentId] ?? `你是 ${agentId}。` };
    };
    config.resolveTeam = (id) => {
      if (id !== 'engineering') throw new Error(`Unknown team: ${id}`);
      return { id, organizer: config.resolveAgent('organizer'), members: MEMBER_IDS.map((m) => config.resolveAgent(m)) };
    };
    config.forWorkspace = () => config;

    const system = createAgentSystem(assembly);
    const session = await system.createSession({ workspace: 'ws', teamId: 'engineering' });
    const threads = await system.getSessionThreads(session.sessionId);
    const threadNames = new Map(threads.map((t) => [t.agentThreadId, t.agentId]));
    const formatEvent = makeSystemEventFormatter(threadNames);
    console.log(`session=${session.sessionId} mode=${session.mode} team=${session.teamId}`);
    console.log(`task=${task}`);
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

    await system.send({ sessionId: session.sessionId, content: task }).catch(async (error) => {
      const entries = await assembly.di.sessionProvider.listEntries(session.sessionId);
      const leafId = await assembly.di.sessionProvider.getActiveLeafId(session.sessionId);
      const summarize = (payload: unknown) => {
        const p = payload as { messageId?: string; author?: unknown; message?: { role?: string; content?: unknown; toolCallId?: string } };
        const content = Array.isArray(p.message?.content) ? p.message.content : [];
        return {
          messageId: p.messageId, author: p.author, role: p.message?.role,
          toolCallId: p.message?.toolCallId,
          parts: content.map((part) => {
            const item = part as { type?: string; text?: string; name?: string; id?: string };
            return item.type === 'text' ? `text:${(item.text ?? '').slice(0, 40)}`
              : item.type === 'toolCall' ? `toolCall:${item.name}#${item.id}` : item.type;
          }),
        };
      };
      const dump = {
        activeLeafId: leafId,
        entries: entries.map((e) => ({ id: e.id, parentId: e.parentId, type: e.type, ...summarize(e.payload) })),
      };
      const dumpPath = join(tmpdir(), 'rem-live-multi-entries.json');
      await writeFile(dumpPath, JSON.stringify(dump, null, 2));
      console.error(`\n[debug] raw entries 已转储到 ${dumpPath}`);
      throw error;
    });
    await printing;

    const chat = await system.getSessionChat(session.sessionId);
    console.log('\n── 会话消息记录 ──');
    for (const item of chat) {
      const who = item.authorThreadId ? threadNames.get(item.authorThreadId) ?? item.authorThreadId.slice(0, 8) : item.message.role;
      console.log(`[${who}] ${describeAssistantContent(item.message)}`);
    }
    console.log(`\n最终回答：${JSON.stringify(chat.at(-1)?.message)}`);
    process.exitCode = 0;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
