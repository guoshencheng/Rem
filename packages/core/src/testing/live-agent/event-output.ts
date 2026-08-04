import type { REMAgentEvent } from '../../agent/agent-event.js';

export function formatLiveAgentEvent(event: REMAgentEvent): string {
  switch (event.type) {
    case 'tool_execution_start':
      return `工具开始：${event.toolName} ${formatJson(event.args)}`;
    case 'tool_execution_end':
      return `工具结束：${event.toolName}${event.isError ? '（失败）' : ''} ${formatJson(event.result)}`;
    case 'error':
      return `错误：${event.error.message}`;
    case 'finish':
      return `完成：${event.output.content}`;
    default:
      return formatJson(event);
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return '[无法序列化]';
  }
}
