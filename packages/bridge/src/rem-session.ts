import type { TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ApprovalRequest, BusEvent, SessionActivity, StreamingSnapshot } from 'rem-agent-core';
import {
  ApprovalEngine, IterationBudget, addUsage, compactContentBlocks, emptyUsage,
  generateId, normalizeUsageDetail, reduceStreamEvent, type TokenUsageDetail,
} from 'rem-agent-core';
import type { REMAgent, REMAgentEvent } from 'rem-agent-core';

export type REMSessionStatus = 'idle' | 'running' | 'error';

export interface REMSessionParams {
  sessionId: string;
  workspace: string;
  publish: (event: BusEvent) => void;
}

/**
 * session 级全部内存状态（替代全局单例 AgentState）。
 * 状态迁移通过 publish 回调直接发 BusEvent（session-start/end/error/activity-change）。
 */
export class REMSession {
  readonly sessionId: string;
  readonly workspace: string;
  private root?: REMAgent;
  private readonly childAgents: REMAgent[] = [];

  status: REMSessionStatus = 'idle';
  budget = new IterationBudget({ maxTurns: 60 });
  activity: SessionActivity = 'idle';
  pendingToolCalls = new Set<string>();
  pendingApprovals: ApprovalRequest[] = [];
  readonly approvalEngine = new ApprovalEngine('');
  tokenUsage: Usage = emptyUsage();
  runController?: AbortController;
  streamingSnapshot?: StreamingSnapshot;

  private readonly publish: (event: BusEvent) => void;

  constructor(params: REMSessionParams) {
    this.sessionId = params.sessionId;
    this.workspace = params.workspace;
    this.publish = params.publish;
  }

  get rootAgent(): REMAgent | undefined {
    return this.root;
  }

  get childAgentCount(): number {
    return this.childAgents.length;
  }

  getOrCreateRootAgent(create: () => REMAgent): REMAgent {
    return (this.root ??= create());
  }

  addChildAgent(agent: REMAgent): void {
    this.childAgents.push(agent);
  }

  // ---- 运行生命周期 ----

  startRun(): AbortController {
    if (this.status === 'running') {
      throw new Error(`Session "${this.sessionId}" is already running`);
    }
    const controller = new AbortController();
    this.runController = controller;
    this.status = 'running';
    this.streamingSnapshot = undefined;
    this.activity = 'pending';
    this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-start' });
    this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'activity-change', activity: 'pending' });
    return controller;
  }

  interruptRun(): void {
    this.runController?.abort();
    this.root?.interrupt();
  }

  finishRun(error?: string): void {
    if (this.status !== 'running') return;
    if (error) {
      this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-error', error });
      this.status = 'error';
    } else {
      this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-end' });
      this.status = 'idle';
    }
    this.activity = 'idle';
    this.pendingToolCalls.clear();
    this.streamingSnapshot = undefined;
    this.runController = undefined;
  }

  // ---- 事件应用（port of AgentLiveState.applyChunk + AgentState snapshot 逻辑）----

  /** 返回需要发布的 BusEvent（activity-change）；chunk 由调用方发 */
  applyEvent(_agentId: string, event: REMAgentEvent): BusEvent[] {
    const out: BusEvent[] = [];

    // snapshot 维护
    if (event.type === 'message_start') {
      if ((event.message as { role?: string }).role === 'assistant') {
        this.streamingSnapshot = { messageId: generateId(), parts: [] };
      }
    } else if (event.type === 'message_update' && this.streamingSnapshot) {
      try {
        this.streamingSnapshot.parts = reduceStreamEvent(this.streamingSnapshot.parts, event.assistantMessageEvent);
      } catch {
        // snapshot best-effort
      }
    }

    const prev = this.activity;
    this.updateActivity(event);
    if (this.activity !== prev) {
      out.push({
        workspace: this.workspace,
        sessionId: this.sessionId,
        type: 'activity-change',
        activity: this.activity,
      });
    }
    return out;
  }

  private updateActivity(event: REMAgentEvent): void {
    if (event.type === 'finish' || event.type === 'error') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'turn_start') {
      this.activity = 'pending';
    } else if (event.type === 'turn_end') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      this.activity = 'calling-function';
    } else if (event.type === 'message_update') {
      this.applyAssistantEvent(event.assistantMessageEvent);
    }
  }

  private applyAssistantEvent(event: AssistantMessageEvent): void {
    if (event.type === 'thinking_delta' || event.type === 'thinking_start') {
      this.activity = 'thinking';
    } else if (event.type === 'toolcall_start') {
      this.activity = 'calling-function';
      const block = event.partial.content?.[event.contentIndex];
      if (block?.type === 'toolCall') {
        this.pendingToolCalls.add(block.id ?? 'unknown');
      }
    } else if (event.type === 'toolcall_end') {
      this.activity = 'calling-function';
      this.pendingToolCalls.add(event.toolCall.id ?? 'unknown');
    } else if (event.type === 'text_delta' || event.type === 'text_start') {
      if (this.status === 'running' && this.pendingToolCalls.size === 0) {
        this.activity = 'outputting';
      }
    } else if (event.type === 'text_end' || event.type === 'thinking_end') {
      this.activity = this.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
    }
  }

  // ---- usage ----

  addTokenUsage(usage: Usage): void {
    this.tokenUsage = addUsage(this.tokenUsage, usage);
  }

  restoreTokenUsage(history: TokenUsageDetail[]): void {
    this.tokenUsage = history
      .map((detail) => normalizeUsageDetail(detail))
      .reduce((acc, detail) => addUsage(acc, detail), emptyUsage());
  }

  // ---- snapshot ----

  getSnapshot(): StreamingSnapshot | undefined {
    return this.streamingSnapshot;
  }

  getSnapshotParts(): Array<TextContent | ThinkingContent | ToolCall> {
    return this.streamingSnapshot ? compactContentBlocks(this.streamingSnapshot.parts) : [];
  }
}
