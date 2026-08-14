import type { AgentDefinition } from '../domain/agent-definition/types.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import type {
  ResolvedRuntimeModelConfig, RuntimeBehaviorDefaults, RuntimeCompressionDefaults,
  RuntimeConfigProvider, RuntimeOrchestrationDefaults, RuntimeToolDefaults,
} from '../sdk/runtime-config-provider.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';

export interface RuntimeConfigLayer {
  name: string;
  priority: number;
  value: unknown;
}

export interface RuntimeConfigResolution {
  /** Known fields are normalized below; plugin-specific fields remain available through getConfig(). */
  config: Record<string, unknown>;
  behavior: RuntimeBehaviorDefaults;
  compression: RuntimeCompressionDefaults;
  tool: RuntimeToolDefaults;
  model: ResolvedRuntimeModelConfig;
  orchestration: RuntimeOrchestrationDefaults;
}

/** 将不可变 Context config layers 映射到当前 Core 已理解的配置面。 */
export function resolveRuntimeConfigLayers(
  provider: RuntimeConfigProvider,
  definition: AgentDefinition,
  layers: readonly RuntimeConfigLayer[],
): RuntimeConfigResolution {
  const defaults = provider.getDefaults();
  const baseBehavior = defaults.behavior;
  const baseCompression = defaults.compression;
  const baseTool = defaults.tool;
  const baseOrchestration = defaults.orchestration;
  const baseConfig = cloneCanonicalJson(defaults.config, { omitUndefinedProperties: true }) as Record<string, unknown>;
  const merged = mergeLayers(layers);
  const direct = merged;
  const behaviorOverrides = record(direct.behavior) ?? direct;
  const compressionOverrides = record(behaviorOverrides.compression) ?? record(direct.compression) ?? {};
  const toolOverrides = record(direct.tool) ?? {};
  const policy = record(direct.toolPolicy) ?? record(direct.policy) ?? record(toolOverrides.policy);
  const modelId = typeof direct.modelId === 'string' ? direct.modelId : definition.modelId;
  const selectedModel = resolveModel(provider, modelId);
  const modelOverrides = record(direct.model);
  const model = cloneCanonicalJson({
    ...selectedModel,
    ...(typeof modelOverrides?.provider === 'string' ? { provider: modelOverrides.provider } : {}),
    ...(typeof modelOverrides?.model === 'string' ? { model: modelOverrides.model } : {}),
    ...(typeof modelOverrides?.baseURL === 'string' ? { baseURL: modelOverrides.baseURL } : {}),
    ...(typeof modelOverrides?.reasoning === 'string' ? { reasoning: modelOverrides.reasoning as ResolvedRuntimeModelConfig['reasoning'] } : {}),
  }, { omitUndefinedProperties: true }) as ResolvedRuntimeModelConfig;
  const orchestration = { ...baseOrchestration, ...pickOrchestration(record(direct.orchestration) ?? {}) };
  const compression = { ...baseCompression, ...pickCompression(compressionOverrides) };
  const behavior = {
    ...baseBehavior,
    ...pickBehavior(behaviorOverrides),
    compression,
  };
  const config = mergeConfig(baseConfig, merged);
  Object.assign(config, cloneCanonicalJson(behavior) as Record<string, unknown>);
  config.compression = cloneCanonicalJson(compression);
  if (policy) config.policy = cloneCanonicalJson(policy);
  else if (baseTool.policy !== undefined) config.policy = cloneCanonicalJson(baseTool.policy);
  else delete config.policy;
  config.model = cloneCanonicalJson(model);
  config.orchestration = cloneCanonicalJson(orchestration);
  return {
    config,
    behavior,
    compression,
    tool: { ...baseTool, ...(policy ? { policy: cloneCanonicalJson(policy) as ToolPolicyConfig } : {}) },
    model,
    orchestration,
  };
}

function mergeConfig(base: Record<string, unknown>, layers: Record<string, unknown>): Record<string, unknown> {
  const output = cloneCanonicalJson(base) as Record<string, unknown>;
  mergeRecord(output, layers);
  return output;
}

function mergeLayers(layers: readonly RuntimeConfigLayer[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const layer of layers.slice().sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))) {
    const value = record(layer.value);
    if (!value) continue;
    const source = record(value.config) ?? value;
    mergeRecord(output, source);
  }
  return output;
}

function mergeRecord(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const nested = record(value);
    if (nested && Object.hasOwn(target, key) && record(target[key])) {
      mergeRecord(target[key] as Record<string, unknown>, nested);
    } else {
      Object.defineProperty(target, key, {
        value: cloneCanonicalJson(value), enumerable: true, writable: true, configurable: true,
      });
    }
  }
}

function pickBehavior(value: Record<string, unknown>): Partial<RuntimeBehaviorDefaults> {
  const result: Partial<RuntimeBehaviorDefaults> = {};
  if (typeof value.name === 'string') result.name = value.name;
  if (typeof value.maxTurns === 'number') result.maxTurns = value.maxTurns;
  if (typeof value.executionRoot === 'string') result.executionRoot = value.executionRoot;
  if (typeof value.readOnly === 'boolean') result.readOnly = value.readOnly;
  if (typeof value.autoApproveDangerous === 'boolean') result.autoApproveDangerous = value.autoApproveDangerous;
  return result;
}

function pickCompression(value: Record<string, unknown>): Partial<RuntimeCompressionDefaults> {
  const result: Partial<RuntimeCompressionDefaults> = {};
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
  if (typeof value.thresholdRatio === 'number') result.thresholdRatio = value.thresholdRatio;
  if (typeof value.protectHead === 'number') result.protectHead = value.protectHead;
  if (typeof value.protectTail === 'number') result.protectTail = value.protectTail;
  return result;
}

function pickOrchestration(value: Record<string, unknown>): Partial<RuntimeOrchestrationDefaults> {
  const result: Partial<RuntimeOrchestrationDefaults> = {};
  for (const key of ['maxAgentRuns', 'maxMessages', 'maxDepth', 'timeoutMs', 'maxTokens', 'maxParallelAgents'] as const) {
    if (typeof value[key] === 'number') result[key] = value[key];
  }
  return result;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resolveModel(provider: RuntimeConfigProvider, modelId: string): ResolvedRuntimeModelConfig {
  try { return provider.resolveModel(modelId); }
  catch (cause) {
    throw new RuntimeError('MODEL_UNAVAILABLE', 'Configured model is unavailable', false, undefined, { cause });
  }
}
