/** 缺省为 true；仅用于需要缩减内置工具集的单次 Agent run。 */
export interface AgentToolCapabilities {
  readSkill?: boolean;
  delegateTask?: boolean;
  todoWrite?: boolean;
}

export function isToolCapabilityEnabled(
  capabilities: AgentToolCapabilities | undefined,
  name: keyof AgentToolCapabilities,
): boolean {
  return capabilities?.[name] !== false;
}
