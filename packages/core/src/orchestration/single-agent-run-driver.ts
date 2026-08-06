import type { AgentSystemEvent, SessionActivity } from '../agent/bus-events.js';
import type { REMAgentEvent } from '../agent/agent-event.js';
import type { REMAgent } from '../agent/rem-agent.js';
import type { SessionRuntime } from '../session/runtime.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import { reduceSessionActivity } from '../agent/session-activity.js';

type SystemEventBody<T = AgentSystemEvent> = T extends AgentSystemEvent
  ? Omit<T, 'workspace' | 'sessionId'>
  : never;

export interface SingleAgentRunDriverDeps {
  sessionUsecase: SessionUsecase;
  publish: (event: AgentSystemEvent) => void;
}

/** 单 Agent 的 run 驱动器：串行消费一次 root Agent 的事件流，持久化并发布公开系统事件。仅供 SingleAgentCoordinator 内部使用。 */
export class SingleAgentRunDriver {
  constructor(private readonly deps: SingleAgentRunDriverDeps) {}

  async drive(
    runtime: SessionRuntime,
    agent: REMAgent,
    events: AsyncIterable<REMAgentEvent>,
  ): Promise<void> {
    let activity: SessionActivity = 'pending';
    try {
      for await (const event of events) {
        if (event.type === 'message-persist') {
          await this.deps.sessionUsecase.persistAgentEvent(
            runtime.sessionId, runtime.agentThreadId, event,
          );
          continue;
        }
        if (event.type === 'usage') {
          await this.deps.sessionUsecase.persistAgentEvent(
            runtime.sessionId, runtime.agentThreadId, event,
          );
          this.publish(runtime, { type: 'usage-change', usage: event.usage });
          continue;
        }
        if (event.type === 'todo-updated') {
          this.publish(runtime, { type: 'todo-updated', todos: event.todos });
          continue;
        }
        if (event.type === 'session-title' || event.type === 'compress-end') {
          await this.deps.sessionUsecase.persistAgentEvent(
            runtime.sessionId, runtime.agentThreadId, event,
          );
        }
        const nextActivity = reduceSessionActivity(activity, event);
        if (nextActivity !== activity) {
          activity = nextActivity;
          this.publish(runtime, { type: 'activity-change', activity });
        }
        this.publish(runtime, { type: 'chunk', chunk: event, agentId: agent.agentId, agentThreadId: runtime.agentThreadId });
        if (event.type === 'finish') {
          await this.deps.sessionUsecase.persistAgentEvent(
            runtime.sessionId, runtime.agentThreadId, event,
          );
          runtime.finishRun();
          this.publish(runtime, { type: 'session-end' });
          return;
        }
        if (event.type === 'error') {
          runtime.failRun();
          this.publish(runtime, { type: 'session-error', error: event.error.message });
          return;
        }
      }
    } catch (error) {
      runtime.interrupt();
      runtime.failRun();
      this.publish(runtime, {
        type: 'session-error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private publish(
    runtime: SessionRuntime,
    event: SystemEventBody,
  ): void {
    this.deps.publish({ ...event, workspace: runtime.workspace, sessionId: runtime.sessionId } as AgentSystemEvent);
  }
}
