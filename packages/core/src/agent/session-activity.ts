import type { REMAgentEvent } from './agent-event.js';
import type { SessionActivity } from './bus-events.js';

/** 将单 Agent 事件归约为用户可观察的 Session 活动。 */
export function reduceSessionActivity(
  current: SessionActivity,
  event: REMAgentEvent,
): SessionActivity {
  if (event.type === 'turn_start') return 'pending';
  if (event.type === 'turn_end' || event.type === 'finish' || event.type === 'error') return 'idle';
  if (event.type === 'compress-start') return 'compressing';
  if (event.type === 'compress-end' || event.type === 'compress-error') return 'idle';
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
    return 'calling-function';
  }
  if (event.type !== 'message_update') return current;
  const update = event.assistantMessageEvent;
  if (update.type === 'thinking_start' || update.type === 'thinking_delta') return 'thinking';
  if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
    return 'calling-function';
  }
  if (update.type === 'text_start' || update.type === 'text_delta') return 'outputting';
  if (update.type === 'text_end' || update.type === 'thinking_end') return 'idle';
  return current;
}
