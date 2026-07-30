import type { BusEvent } from 'rem-agent-core';
import { log, type UserInput } from 'rem-agent-core';
import type { REMAgent, REMAgentEvent } from 'rem-agent-core';
import type { REMSession } from './rem-session.js';
import type { SessionService } from './session-service.js';

export interface AgentServiceDeps {
  sessionService: SessionService;
  publish: (event: BusEvent) => void;
}

/** 仅 Agent 的运行和监听：消费 REMAgent 事件流并做三路分发 */
export class AgentService {
  constructor(private readonly deps: AgentServiceDeps) {}

  /** 启动 root agent 的一次 run（后台驱动，立即返回） */
  run(session: REMSession, agent: REMAgent, input: UserInput): void {
    const events = agent.run(input);
    void this.drive(session, agent, events, true);
  }

  /** 监听已在运行的 agent（child-spawned 触发，递归覆盖 children） */
  listen(session: REMSession, agent: REMAgent): void {
    if (!agent.events) return;
    void this.drive(session, agent, agent.events, false);
  }

  private async drive(session: REMSession, agent: REMAgent, events: AsyncIterable<REMAgentEvent>, isRoot: boolean): Promise<void> {
    const { sessionService, publish } = this.deps;
    const ws = session.workspace;
    const sid = session.sessionId;
    log('agent-service', 'drive start', { sessionId: sid, agentId: agent.agentId, isRoot });
    try {
      for await (const event of events) {
        // ① 内部事件：落盘 / 聚合，不上总线
        if (event.type === 'message-persist') {
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
          continue;
        }
        if (event.type === 'usage') {
          session.addTokenUsage(event.usage);
          publish({ workspace: ws, sessionId: sid, type: 'usage-change', usage: session.tokenUsage });
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
          continue;
        }
        if (event.type === 'child-spawned') {
          this.listen(session, event.child);
          publish({
            workspace: ws, sessionId: sid, type: 'child-agent-update',
            childSessionId: event.child.sessionId ?? '',
            toolCallId: event.parentToolCallId,
            summary: event.child.summary ?? '',
            status: 'running',
          });
          continue;
        }
        // todo_write 工具经 agent 事件流抛出的 meta 事件 → 转 BusEvent（不作为 chunk 上总线）
        if (event.type === 'todo-updated') {
          publish({ workspace: ws, sessionId: event.sessionId ?? sid, type: 'todo-updated', todos: event.todos });
          continue;
        }

        // ② 内存状态 + ③ 总线 chunk
        for (const e of session.applyEvent(agent.agentId, event)) publish(e);
        publish({ workspace: ws, sessionId: sid, type: 'chunk', chunk: event, agentId: agent.agentId });

        if (event.type === 'session-title' || event.type === 'compress-end') {
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
        }
        if (isRoot && event.type === 'finish') {
          await sessionService.handleAgentEvent(sid, event);
          session.finishRun();
        } else if (isRoot && event.type === 'error') {
          session.finishRun(event.error.message);
        }
      }

      if (!isRoot) {
        publish({
          workspace: ws, sessionId: sid, type: 'child-agent-update',
          childSessionId: agent.sessionId ?? '',
          toolCallId: agent.parentToolCallId,
          summary: agent.summary ?? '',
          status: agent.status === 'error' ? 'failed' : 'completed',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('agent-service', 'drive failed', { sessionId: sid, agentId: agent.agentId, error: message });
      if (isRoot) {
        session.finishRun(message);
      } else {
        publish({
          workspace: ws, sessionId: sid, type: 'child-agent-update',
          childSessionId: agent.sessionId ?? '',
          toolCallId: agent.parentToolCallId,
          summary: agent.summary ?? '',
          status: 'failed',
        });
      }
    }
  }
}
