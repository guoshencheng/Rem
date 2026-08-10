import type { AgentDefinition, ContextTypeConstraint } from '../../../domain/agent-definition/types.js';
import type { AgentDefinitionProvider } from '../../../sdk/agent-definition-provider.js';

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

  async get(agentId: string, revision?: string): Promise<AgentDefinition | null> {
    const revisions = this.definitionsByAgent.get(agentId);
    if (!revisions) return null;

    if (revision !== undefined) {
      const definition = revisions.get(revision);
      return definition ? this.cloneDefinition(definition) : null;
    }

    const latestRevision = [...revisions.keys()].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    ).at(-1);
    const definition = latestRevision ? revisions.get(latestRevision) : undefined;
    return definition ? this.cloneDefinition(definition) : null;
  }

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
