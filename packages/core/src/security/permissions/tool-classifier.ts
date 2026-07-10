import { matchPattern } from '../rules/matcher.js';
import { BUILT_IN_SENSITIVE_READ_PATTERNS } from './sensitive-patterns.js';
import { classifyCommand } from '../exec-classifier.js';
import type { ToolDefinition } from '../../sdk/tool-provider.js';

export type ToolCategory = 'write' | 'sensitive-read' | 'read';

export function classifyTool(
  toolName: string,
  toolDef: ToolDefinition,
  derivedPatterns: string[],
): ToolCategory {
  if (toolName === 'write' || toolName === 'edit') {
    return 'write';
  }

  if (toolName === 'exec') {
    const command = extractCommandFromPatterns(derivedPatterns);
    if (command) {
      const risk = classifyCommand(command).risk;
      if (risk === 'safe') {
        return isSensitiveRead(derivedPatterns) ? 'sensitive-read' : 'read';
      }
      return 'write';
    }
    return 'write';
  }

  if (toolDef.readOnly) {
    return isSensitiveRead(derivedPatterns) ? 'sensitive-read' : 'read';
  }

  return 'write';
}

function extractCommandFromPatterns(patterns: string[]): string | undefined {
  for (const p of patterns) {
    if (p.startsWith('bash:')) {
      return p.slice('bash:'.length);
    }
  }
  return undefined;
}

function isSensitiveRead(patterns: string[]): boolean {
  for (const p of patterns) {
    if (BUILT_IN_SENSITIVE_READ_PATTERNS.some((sp) => matchPattern(p, sp))) {
      return true;
    }
  }
  return false;
}
