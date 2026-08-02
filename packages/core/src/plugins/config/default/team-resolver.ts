import type { ResolvedAgentRole, ResolvedTeam } from '../../../sdk/agent-role.js';
import type { TeamConfig } from '../../../sdk/config-provider.js';

export class TeamResolver {
  constructor(
    private readonly teams: Record<string, TeamConfig>,
    private readonly resolveAgent: (id: string) => ResolvedAgentRole,
  ) {}

  resolveTeam(id: string): ResolvedTeam {
    const team = this.teams[id];
    if (!team) throw new Error(`Unknown team: ${id}`);
    this.validate(id, team);
    return {
      id,
      organizer: this.resolveAgent(team.organizer),
      members: team.members.map((memberId) => this.resolveAgent(memberId)),
    };
  }

  private validate(id: string, team: TeamConfig): void {
    const memberIds = new Set(team.members);
    if (
      !team.organizer
      || team.members.length === 0
      || memberIds.size !== team.members.length
      || memberIds.has(team.organizer)
    ) {
      throw new Error(`Invalid team: ${id}`);
    }
  }
}
