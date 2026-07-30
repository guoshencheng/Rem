import parse from 'bash-parser';

export const SAFE_BINS = new Set([
  'ls', 'cat', 'grep', 'find', 'pwd', 'echo', 'head', 'tail',
  'git', // git subcommands filtered below
]);

export const SAFE_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'branch', 'show', 'remote', 'config',
]);

export const DANGEROUS_BINS = new Set([
  'rm', 'sudo', 'curl', 'wget', 'sh', 'bash', 'eval',
]);

export type CommandRisk = 'safe' | 'normal' | 'dangerous' | 'complex';

export interface CommandClassification {
  risk: CommandRisk;
  baseCommand: string;
  subCommand?: string;
  patterns: string[];
}

export function classifyCommand(command: string): CommandClassification {
  try {
    const ast = parse(command);
    if (!isSimpleCommand(ast)) {
      return { risk: 'complex', baseCommand: '', patterns: ['bash:*'] };
    }
    const { name, args } = extractSimpleCommand(ast);
    const subCommand = name === 'git' ? args[0] : undefined;
    const risk = computeRisk(name, subCommand, args);
    return {
      risk,
      baseCommand: name,
      subCommand,
      patterns: buildPatterns(name, subCommand, command, risk),
    };
  } catch {
    return { risk: 'complex', baseCommand: '', patterns: ['bash:*'] };
  }
}

function isSimpleCommand(ast: unknown): boolean {
  const node = ast as any;
  if (node?.type !== 'Script') return false;
  if (node.commands?.length !== 1) return false;
  const cmd = node.commands[0];
  return cmd.type === 'Command';
}

function extractSimpleCommand(ast: unknown): { name: string; args: string[] } {
  const cmd = (ast as any).commands[0];
  const name = cmd.name?.text ?? '';
  const args = (cmd.suffix ?? [])
    .filter((s: any) => s.type === 'Word')
    .map((s: any) => s.text);
  return { name, args };
}

function computeRisk(baseCommand: string, subCommand: string | undefined, args: string[]): CommandRisk {
  if (baseCommand === 'bash' || baseCommand === 'sh') {
    // `bash -c` and `sh -c` execute arbitrary strings
    if (args.includes('-c')) return 'complex';
    return 'dangerous';
  }
  if (DANGEROUS_BINS.has(baseCommand)) return 'dangerous';
  if (baseCommand === 'git' && subCommand && !SAFE_GIT_SUBCOMMANDS.has(subCommand)) {
    return 'normal';
  }
  if (SAFE_BINS.has(baseCommand)) return 'safe';
  return 'normal';
}

function buildPatterns(name: string, subCommand: string | undefined, command: string, risk: CommandRisk): string[] {
  const exact = `bash:${command}`;
  const byBase = `bash:${name}${subCommand ? ` ${subCommand}` : ''} *`;
  const byName = `bash:${name} *`;

  if (risk === 'complex') return [];
  if (risk === 'dangerous') return [exact, byName];
  if (risk === 'safe') return [exact, byBase, byName, 'bash:safe-bins:*'];
  return [exact, byBase, byName];
}
