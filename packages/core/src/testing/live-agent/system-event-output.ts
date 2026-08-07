import type { AgentSystemEvent } from '../../agent/bus-events.js';

export function shorten(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function describeAssistantContent(message: unknown): string {
  const msg = message as { content?: unknown };
  if (!Array.isArray(msg.content)) return shorten(msg.content ?? '');
  const parts = msg.content.map((part: { type?: string; text?: string; name?: string; arguments?: unknown }) => {
    if (part.type === 'text') return `text(${shorten(part.text ?? '', 120)})`;
    if (part.type === 'toolCall') return `toolCall(${part.name} ${shorten(part.arguments, 120)})`;
    return part.type ?? 'unknown';
  });
  return parts.join(' ');
}

export function makeSystemEventFormatter(threadNames: Map<string, string>) {
  const name = (threadId?: string) => (threadId ? threadNames.get(threadId) ?? threadId.slice(0, 8) : '?');
  return (event: AgentSystemEvent): string | null => {
    switch (event.type) {
      case 'session-start': return `[session] 开始 workspace=${event.workspace}`;
      case 'session-end': return `[session] 结束`;
      case 'session-error': return `[session] 错误: ${event.error}`;
      case 'activity-change': return `[activity] ${event.activity}`;
      case 'usage-change': {
        const u = event.usage;
        return `[usage] input=${u.input} output=${u.output} cacheRead=${u.cacheRead} cacheWrite=${u.cacheWrite}`;
      }
      case 'discussion-change': return `[discussion] ${event.status} (root=${event.rootUserMessageId.slice(0, 8)})`;
      case 'delivery-change': {
        const d = event.delivery;
        const extra = [
          `batch=${d.batchId.slice(0, 8)}`,
          `depth=${d.depth}`,
          `attempt=${d.attempt}`,
          d.error ? `error=${d.error}` : null,
        ].filter(Boolean).join(' ');
        return `[delivery] ${d.kind} → ${name(d.targetAgentThreadId)} : ${d.status} (${extra})`;
      }
      case 'chunk': {
        const who = event.agentId ?? name(event.agentThreadId);
        const chunk = event.chunk;
        switch (chunk.type) {
          case 'agent_start': return `[${who}] ── 运行开始 ──`;
          case 'agent_end': return `[${who}] ── 运行结束，新增 ${chunk.messages.length} 条消息 ──`;
          case 'turn_start': return `[${who}] turn 开始`;
          case 'turn_end': return `[${who}] turn 结束: ${describeAssistantContent(chunk.message)}${chunk.toolResults.length ? `, ${chunk.toolResults.length} 个工具结果` : ''}`;
          case 'tool_execution_start': return `[${who}] 调用工具 ${chunk.toolName} 参数: ${shorten(chunk.args, 160)}`;
          case 'tool_execution_end': return `[${who}] 工具 ${chunk.toolName} ${chunk.isError ? '失败' : '完成'}: ${shorten(chunk.result, 160)}`;
          case 'message_end': return `[${who}] 输出: ${describeAssistantContent(chunk.message)}`;
          case 'error': return `[${who}] 错误: ${chunk.error.message}${chunk.error.stack ? `\n${chunk.error.stack}` : ''}`;
          case 'finish': return `[${who}] finish: completed=${chunk.output.completed} ${shorten(chunk.output.content, 160)}`;
          default: return null;
        }
      }
      default: return null;
    }
  };
}
