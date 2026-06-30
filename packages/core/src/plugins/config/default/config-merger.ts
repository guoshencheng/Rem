import type { AgentConfig, AgentBehaviorConfig } from '../../../sdk/config-provider.js';
import { getDefaultSessionsDir, getDefaultSkillsDir } from '../../../config/paths.js';
import { pickToolPolicy, pickModels, pickModelConfig } from './config-parser.js';

export function mergeFileConfig(base: AgentConfig, file: Record<string, unknown>): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (typeof file.name === 'string') merged.name = file.name;
  if (typeof file.maxTurns === 'number') merged.maxTurns = file.maxTurns;
  if (typeof file.workspaceRoot === 'string') merged.workspaceRoot = file.workspaceRoot;
  if (typeof file.readOnly === 'boolean') merged.readOnly = file.readOnly;
  if (typeof file.sessionsDir === 'string') merged.sessionsDir = file.sessionsDir;
  if (typeof file.skillsDir === 'string') merged.skillsDir = file.skillsDir;
  const toolPolicy = pickToolPolicy(file.toolPolicy);
  if (toolPolicy) merged.toolPolicy = toolPolicy;
  const models = pickModels(file.models);
  if (models) merged.models = models;
  const singleModel = pickModelConfig(file.model);
  if (singleModel) merged.model = singleModel;
  if (typeof file.activeModel === 'string') merged.activeModel = file.activeModel;
  return merged;
}

export function mergeEnvConfig(base: AgentConfig, env: NodeJS.ProcessEnv): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (env.REM_AGENT_NAME) merged.name = env.REM_AGENT_NAME;
  if (env.REM_AGENT_MAX_TURNS) merged.maxTurns = parseInt(env.REM_AGENT_MAX_TURNS, 10);
  if (env.REM_AGENT_WORKSPACE_ROOT) merged.workspaceRoot = env.REM_AGENT_WORKSPACE_ROOT;
  if (env.REM_AGENT_READ_ONLY) merged.readOnly = env.REM_AGENT_READ_ONLY === 'true';
  if (env.REM_AGENT_SESSIONS_DIR) merged.sessionsDir = env.REM_AGENT_SESSIONS_DIR;
  if (env.REM_AGENT_SKILLS_DIR) merged.skillsDir = env.REM_AGENT_SKILLS_DIR;
  if (env.REM_AGENT_ACTIVE_MODEL) merged.activeModel = env.REM_AGENT_ACTIVE_MODEL;
  return merged;
}

export function applyBehaviorDefaults(config: AgentConfig): Required<AgentBehaviorConfig> {
  return {
    name: config.name ?? 'Rem Agent',
    maxTurns: config.maxTurns ?? 60,
    workspaceRoot: config.workspaceRoot ?? process.cwd(),
    readOnly: config.readOnly ?? false,
    sessionsDir: config.sessionsDir ?? getDefaultSessionsDir(),
    skillsDir: config.skillsDir ?? getDefaultSkillsDir(),
  };
}
