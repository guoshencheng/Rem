import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ClaudeAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'claude';
  private content?: string;

  async render(ctx: PromptBuildContext): Promise<string> {
    if (this.content === undefined) {
      this.content = await readFile(join(__dirname, 'claude-template.md'), 'utf-8');
    }
    return this.content.replace(/{{agentName}}/g, ctx.agentName);
  }
}
