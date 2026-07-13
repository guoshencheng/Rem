import { describe, it, expect } from 'vitest';
import { renderAgentRoleVariables } from '../src/system-prompt/variables/agent-role-variables.js';

describe('renderAgentRoleVariables', () => {
  it('replaces agentName and agentRolePrompt', () => {
    const result = renderAgentRoleVariables(
      'You are {{agentName}}.\n\n{{agentRolePrompt}}\n\n# Tone',
      { agentName: 'Coder', agentCorePrompt: 'Focus on code.' },
    );
    expect(result).toBe('You are Coder.\n\nFocus on code.\n\n# Tone');
  });

  it('leaves unknown variables intact', () => {
    const result = renderAgentRoleVariables('{{unknown}}', { agentName: 'X', agentCorePrompt: 'Y' });
    expect(result).toBe('{{unknown}}');
  });
});
