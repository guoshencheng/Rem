import type { AgentDefinition } from '../domain/agent-definition/types.js';

export interface AgentDefinitionProvider {
  init(): Promise<void>;

  /** revision 省略时，返回 provider 选定的当前定义。 */
  get(agentId: string, revision?: string): Promise<AgentDefinition | null>;

  /** 返回顺序确定的全部定义；不同实现不要求遵循相同的排序规则。 */
  list(): Promise<AgentDefinition[]>;
}
