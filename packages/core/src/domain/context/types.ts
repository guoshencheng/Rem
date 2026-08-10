export interface ContextBinding {
  type: string;
  contextId: string;
  revision?: string;
  input?: unknown;
}

export interface ContextSet {
  bindings: ContextBinding[];
}

export interface ContextPatch {
  replace?: Readonly<Record<string, readonly ContextBinding[]>>;
  add?: readonly ContextBinding[];
}

export interface ResolvedContextItem {
  binding: ContextBinding;
  pluginId: string;
  pluginVersion: string;
  snapshot: unknown;
  snapshotHash: string;
}

export interface ResolvedContextSnapshot {
  items: ResolvedContextItem[];
  configLayers: Array<{ name: string; priority: number; value: unknown }>;
  promptSections: Array<{ name: string; priority: number; content: string }>;
}
