import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { SkillProvider } from '../../../sdk/skill-provider.js';

const readSkillSchema = Type.Object(
  {
    name: Type.String({ description: 'Name of the skill to load' }),
  },
  { additionalProperties: false },
);

export type ReadSkillToolInput = Static<typeof readSkillSchema>;

export function createReadSkillToolDefinition(): ToolDefinition<typeof readSkillSchema> {
  return {
    name: 'read_skill',
    description:
      'Load the full SKILL.md content for a named skill so its specialized instructions can be followed.',
    parameters: readSkillSchema,
    readOnly: true,
  };
}

export function createReadSkillToolExecutor(
  getSkillProvider: () => SkillProvider,
): ToolExecutor<typeof readSkillSchema> {
  return async (input: ReadSkillToolInput, _ctx: ToolContext) => {
    const skillProvider = getSkillProvider();
    const raw = await skillProvider.readSkillRaw(input.name);

    if (raw === undefined) {
      return {
        output: '',
        error: `Skill "${input.name}" not found`,
      };
    }

    return { output: raw };
  };
}
