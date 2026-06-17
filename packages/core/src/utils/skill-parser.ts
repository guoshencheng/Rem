import { parse } from 'yaml';
import type { Skill } from '../sdk/skill-provider.js';

export interface SkillParseResult {
  skill: Skill | null;
  diagnostics: string[];
}

const FRONTMATTER_DELIMITER = '---';

export function parseSkillMarkdown(raw: string, filePath: string): SkillParseResult {
  const diagnostics: string[] = [];
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    diagnostics.push('SKILL.md must start with YAML frontmatter delimiters');
    return { skill: null, diagnostics };
  }

  const endIndex = trimmed.indexOf('\n---', FRONTMATTER_DELIMITER.length);
  if (endIndex === -1) {
    diagnostics.push('SKILL.md frontmatter is missing closing delimiter');
    return { skill: null, diagnostics };
  }

  const frontmatterRaw = trimmed.slice(FRONTMATTER_DELIMITER.length, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trimStart();

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parse(frontmatterRaw) as Record<string, unknown> ?? {};
  } catch (error) {
    diagnostics.push(`Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
    return { skill: null, diagnostics };
  }

  const name = extractStringField(frontmatter, 'name');
  const description = extractStringField(frontmatter, 'description');

  if (!description || description.trim() === '') {
    diagnostics.push('SKILL.md is missing required "description" field');
    return { skill: null, diagnostics };
  }

  const effectiveName = name && name.trim() !== '' ? name.trim() : '';

  if (effectiveName === '') {
    diagnostics.push('SKILL.md is missing required "name" field');
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name: effectiveName,
      description: description.trim(),
      location: filePath,
      content: body,
    },
    diagnostics,
  };
}

function extractStringField(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}
