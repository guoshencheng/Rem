import { homedir } from 'os';
import { join } from 'path';

// ─── 类型 ────────────────────────────────────────────

export interface AgentPaths {
  /** Agent 数据根目录 */
  readonly agentDir: string;

  /** 用户级技能目录，默认 ~/.agents/skills */
  readonly homeSkillsDir: string;

  /** 项目级技能目录，默认 <workspaceRoot>/.agents/skills */
  workspaceSkillsDir(workspaceRoot: string): string;

  /** 配置文件候选列表（优先级从高到低） */
  configCandidates(cwd: string): string[];

  /** home 级配置候选列表（~/.rem-agent/config.*），优先级从高到低 */
  homeConfigCandidates(): string[];

  /** workspace 级配置候选列表（cwd/rem-agent.config.* 与 cwd/.rem-agent/config.*），优先级从高到低 */
  workspaceConfigCandidates(cwd: string): string[];

  /** 会话存储目录 */
  readonly sessionsDir: string;

  /** 调试日志路径，null 表示禁用 */
  readonly debugLogFile: string | null;
}

export interface CreateAgentPathsOptions {
  agentDir?: string;
  homeAgentDir?: string;
  homeSkillsDir?: string;
  sessionsDir?: string;
  env?: Partial<NodeJS.ProcessEnv>;
}

// ─── 默认实现 ────────────────────────────────────────

export function createDefaultAgentPaths(opts: CreateAgentPathsOptions = {}): AgentPaths {
  const env = opts.env ?? process.env;

  const agentDir = opts.agentDir ?? resolveAgentDir(env);
  const homeAgentDir = opts.homeAgentDir ?? join(homedir(), '.rem-agent');
  const homeSkillsDir = opts.homeSkillsDir ?? join(homedir(), '.agents', 'skills');
  const sessionsDir = opts.sessionsDir ?? join(agentDir, 'sessions');
  const debugLogFile = resolveDebugLogFile(env, agentDir);

  return {
    agentDir,
    homeSkillsDir,

    workspaceSkillsDir(workspaceRoot: string) {
      return join(workspaceRoot, '.agents', 'skills');
    },

    configCandidates(cwd: string) {
      return [...this.workspaceConfigCandidates(cwd), ...this.homeConfigCandidates()];
    },

    homeConfigCandidates() {
      return [
        join(homeAgentDir, 'config.json'),
        join(homeAgentDir, 'config.yaml'),
        join(homeAgentDir, 'config.yml'),
      ];
    },

    workspaceConfigCandidates(cwd: string) {
      return [
        join(cwd, 'rem-agent.config.json'),
        join(cwd, 'rem-agent.config.yaml'),
        join(cwd, 'rem-agent.config.yml'),
        join(cwd, '.rem-agent', 'config.json'),
        join(cwd, '.rem-agent', 'config.yaml'),
        join(cwd, '.rem-agent', 'config.yml'),
      ];
    },

    sessionsDir,
    debugLogFile,
  };
}

// ─── 工具函数 ────────────────────────────────────────

/** 展开路径中的 ~ 为 home 目录，供 security 等模块使用 */
export function resolveTilde(rawPath: string): string {
  if (rawPath.startsWith('~')) {
    return join(homedir(), rawPath.slice(1));
  }
  return rawPath;
}

// ─── 内部 helpers ────────────────────────────────────

function resolveAgentDir(env: Partial<NodeJS.ProcessEnv>): string {
  const raw = env.REM_AGENT_HOME || env.REM_AGENT_DIR;
  if (raw) {
    return resolveTilde(raw);
  }
  return join(homedir(), '.rem-agent');
}

function resolveDebugLogFile(env: Partial<NodeJS.ProcessEnv>, agentDir: string): string | null {
  if (env.REM_AGENT_DEBUG_FILE) {
    return env.REM_AGENT_DEBUG_FILE;
  }
  if (env.REM_AGENT_DEBUG === '1') {
    return '/tmp/rem-agent-debug.log';
  }
  if (env.NODE_ENV === 'development') {
    return join(agentDir, 'debug.log');
  }
  return null;
}
