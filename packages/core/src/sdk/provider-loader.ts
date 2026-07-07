import type { ApprovalOrchestrator } from './approval-orchestrator.js';
import type { ToolPolicyConfig } from './tool-policy.js';

export type ProviderKind =
  | 'tool'
  | 'memory'
  | 'context'
  | 'skill'
  | 'session'
  | 'compressor'
  | 'budget'
  | 'error'
  | 'config'
  | 'loopStrategy'
  | 'turnRunner'
  | 'title'
  | 'approval'
  | 'state'
  | 'reason';

export interface ProviderLoaderContext {
  kind: ProviderKind;
  agentName: string;
  workspaceRoot: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  approvalOrchestrator?: ApprovalOrchestrator;
  sessionsDir: string;
  maxTurns: number;
  toolPolicy?: ToolPolicyConfig;
}

export interface ProviderDescriptor<T> {
  module: string;
  options?: unknown;
}

export type ProviderReference<T> = T | string | ProviderDescriptor<T>;

export interface ProviderModule<T> {
  createProvider(options: unknown): T;
  getDefaultOptions?(ctx: ProviderLoaderContext): unknown;
}

export interface ProviderLoader {
  load<T>(ref: ProviderReference<T>, ctx: ProviderLoaderContext): Promise<T>;
}

export type ProviderModuleRef = () => Promise<ProviderModule<any>>;

export type BuiltinProviderResolver = (kind: ProviderKind, name: string) => ProviderModuleRef | string | undefined;

export interface ProviderRegistry {
  initialize(): Promise<void>;
  has(kind: ProviderKind): boolean;
  get<T>(kind: ProviderKind): T | undefined;
  require<T>(kind: ProviderKind): T;
  register<T>(kind: ProviderKind, provider: T): void;
}
