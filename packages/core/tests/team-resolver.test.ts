import { describe, expect, it } from 'vitest';
import type { ResolvedAgentRole, TeamConfig } from '../src/index.js';
import { TeamResolver } from '../src/plugins/config/default/team-resolver.js';

const roles: Record<string, ResolvedAgentRole> = {
  organizer: { id: 'organizer', name: 'Organizer', corePrompt: 'Organize.' },
  architect: { id: 'architect', name: 'Architect', corePrompt: 'Design.' },
  reviewer: { id: 'reviewer', name: 'Reviewer', corePrompt: 'Review.' },
};

function resolver(teams: Record<string, TeamConfig>): TeamResolver {
  return new TeamResolver(teams, (id) => {
    const role = roles[id];
    if (!role) throw new Error(`Unknown agent: ${id}`);
    return role;
  });
}

describe('TeamResolver', () => {
  it('resolves organizer and members in configured order', () => {
    const team = resolver({
      engineering: { organizer: 'organizer', members: ['architect', 'reviewer'] },
    }).resolveTeam('engineering');

    expect(team).toMatchObject({
      id: 'engineering',
      organizer: { id: 'organizer' },
      members: [{ id: 'architect' }, { id: 'reviewer' }],
    });
  });

  it('rejects unknown teams and agents', () => {
    expect(() => resolver({}).resolveTeam('missing')).toThrow('Unknown team: missing');
    expect(() => resolver({ broken: { organizer: 'organizer', members: ['missing'] } }).resolveTeam('broken'))
      .toThrow('Unknown agent: missing');
  });

  it.each([
    { organizer: 'organizer', members: [] },
    { organizer: 'organizer', members: ['organizer'] },
    { organizer: 'organizer', members: ['architect', 'architect'] },
  ])('rejects invalid team configuration %#', (team) => {
    expect(() => resolver({ broken: team }).resolveTeam('broken')).toThrow('Invalid team: broken');
  });
});
