import type { TObject } from '@sinclair/typebox';
import type { ContextBinding, ResolvedContextSnapshot } from '../domain/context/types.js';
import type { RuntimeRequestContext } from '../domain/identity/types.js';
import type { ToolDefinition, ToolExecutor } from './tool-provider.js';

export interface RuntimeToolContribution<T extends TObject = TObject> {
  definition: ToolDefinition<T>;
  executor: ToolExecutor<T>;
}

export interface ContextResolutionInput {
  binding: ContextBinding;
  request: RuntimeRequestContext;
}

export interface ContextResolution {
  snapshot: unknown;
}

export interface ContextRuntimeContributions {
  configLayers?: Array<{ name: string; priority: number; value: unknown }>;
  promptSections?: Array<{ name: string; priority: number; content: string }>;
  tools?: RuntimeToolContribution[];
}

export interface ContextTypeContribution {
  type: string;
  resolve(input: ContextResolutionInput): Promise<ContextResolution>;
  materialize(snapshot: unknown): Promise<ContextRuntimeContributions>;
}

export interface RuntimePluginRegistrar {
  addContextType(contribution: ContextTypeContribution): void;
}

export interface RuntimePlugin {
  manifest: { pluginId: string; version: string; dependencies?: readonly string[] };
  register(registrar: RuntimePluginRegistrar): void;
}

export interface ResolvedRuntimeContext {
  snapshot: ResolvedContextSnapshot;
  tools: RuntimeToolContribution[];
}
