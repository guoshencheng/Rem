import { readFile } from 'fs/promises';
import { join } from 'path';
import type { AgentInstructionLoader } from '../../sdk/system-prompt.js';

export class ProjectAgentsMdLoader implements AgentInstructionLoader {
  async load(workspaceRoot: string, _agentName: string): Promise<string | undefined> {
    const filePath = join(workspaceRoot, 'AGENTS.md');
    const content = await readFile(filePath, 'utf-8').catch(() => undefined);
    return content?.trim() || undefined;
  }
}
