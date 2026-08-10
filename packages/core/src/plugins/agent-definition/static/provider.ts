import type { AgentDefinition, ContextTypeConstraint } from '../../../domain/agent-definition/types.js';
import type { AgentDefinitionProvider } from '../../../sdk/agent-definition-provider.js';

/**
 * 静态定义 Provider：当前版本取 numeric localeCompare 最大的 revision，
 * list 保留构造输入顺序。
 */
export class StaticAgentDefinitionProvider implements AgentDefinitionProvider {
  private readonly definitions: AgentDefinition[];
  private readonly definitionsByAgent = new Map<string, Map<string, AgentDefinition>>();

  constructor(definitions: readonly AgentDefinition[]) {
    this.definitions = definitions.map((definition) => this.cloneDefinition(definition));

    for (const definition of this.definitions) {
      let revisions = this.definitionsByAgent.get(definition.agentId);
      if (!revisions) {
        revisions = new Map();
        this.definitionsByAgent.set(definition.agentId, revisions);
      }

      if (revisions.has(definition.revision)) {
        throw new Error(`Duplicate agent definition: ${definition.agentId}@${definition.revision}`);
      }

      revisions.set(definition.revision, definition);
    }
  }

  async init(): Promise<void> {}

  /** revision 省略时返回当前定义。 */
  async get(agentId: string, revision?: string): Promise<AgentDefinition | null> {
    const revisions = this.definitionsByAgent.get(agentId);
    if (!revisions) return null;

    if (revision !== undefined) {
      const definition = revisions.get(revision);
      return definition ? this.cloneDefinition(definition) : null;
    }

    const latestRevision = [...revisions.keys()]
      .sort((left, right) => {
        const numericComparison = left.localeCompare(right, undefined, { numeric: true });
        if (numericComparison) return numericComparison;
        return left === right ? 0 : left < right ? -1 : 1;
      })
      .at(-1);
    const definition = latestRevision !== undefined ? revisions.get(latestRevision) : undefined;
    return definition ? this.cloneDefinition(definition) : null;
  }

  /** 按构造输入顺序返回全部定义。 */
  async list(): Promise<AgentDefinition[]> {
    return this.definitions.map((definition) => this.cloneDefinition(definition));
  }

  private cloneDefinition(definition: AgentDefinition): AgentDefinition {
    return {
      ...definition,
      toolNames: [...definition.toolNames],
      acceptedTriggers: [...definition.acceptedTriggers],
      requiredContexts: this.cloneContexts(definition.requiredContexts),
      optionalContexts: this.cloneContexts(definition.optionalContexts),
      overridableContexts: definition.overridableContexts ? [...definition.overridableContexts] : undefined,
      execution: { ...definition.execution },
    };
  }

  private cloneContexts(
    contexts: readonly ContextTypeConstraint[] | undefined,
  ): ContextTypeConstraint[] | undefined {
    return contexts?.map((context) => ({ ...context }));
  }
}
