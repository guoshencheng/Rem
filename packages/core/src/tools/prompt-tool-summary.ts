import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { ToolInfo } from '../sdk/system-prompt.js';
import { composeToolProviders } from './composer.js';
import { createTodoWriteToolDefinition } from '../capabilities/todo/tool.js';
import { createDelegateTaskToolDefinition } from '../capabilities/sub-agent/delegate-task.js';

/** systemPrompt 的工具清单：composed providers + delegate_task/todo_write 两个内建工具（无需真建 overlay） */
export function listPromptToolSummaries(params: {
  toolProvider: ToolProvider;
  skillProvider: SkillProvider;
}): ToolInfo[] {
  const composed = composeToolProviders(params);
  const delegateDef = createDelegateTaskToolDefinition();
  const todoDef = createTodoWriteToolDefinition();
  return [
    ...composed.getToolSet().map((t) => ({ name: t.name, description: t.description ?? '' })),
    { name: delegateDef.name, description: delegateDef.description },
    { name: todoDef.name, description: todoDef.description },
  ];
}
