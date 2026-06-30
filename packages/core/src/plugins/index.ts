import type { ProviderModule, ProviderModuleRef } from '../sdk/provider-loader.js';

export { FixedBudgetPolicy } from './budget/fixed/index.js';
export { NoOpCompressor } from './compressor/no-op/index.js';
export { DefaultConfigProvider } from './config/default/index.js';
export { SimpleErrorHandler } from './error/simple/index.js';
export { SimpleMemoryProvider } from './memory/simple/index.js';
export { InMemorySessionProvider } from './session/in-memory/index.js';
export { FileSessionProvider } from './session/file/index.js';
export { LocalSessionProvider } from './session/local/index.js';

export { FileSkillProvider } from './skill/file/index.js';
export { createFileSystemTools } from './tool/file-system/index.js';
export { InMemoryToolProvider } from './tool/in-memory/index.js';
export { createProvider as createTitleProvider } from './title/llm/index.js';

const builtinLoaders: Record<string, ProviderModuleRef> = {
  'session/in-memory': () => import('./session/in-memory/index.js') as Promise<ProviderModule<any>>,
  'session/file':      () => import('./session/file/index.js') as Promise<ProviderModule<any>>,
  'session/local':     () => import('./session/local/index.js') as Promise<ProviderModule<any>>,
  'tool/file-system':  () => import('./tool/file-system/index.js') as Promise<ProviderModule<any>>,
  'tool/in-memory':    () => import('./tool/in-memory/index.js') as Promise<ProviderModule<any>>,
  'memory/simple':     () => import('./memory/simple/index.js') as Promise<ProviderModule<any>>,
  'skill/file':        () => import('./skill/file/index.js') as Promise<ProviderModule<any>>,
  'compressor/no-op':  () => import('./compressor/no-op/index.js') as Promise<ProviderModule<any>>,
  'error/simple':      () => import('./error/simple/index.js') as Promise<ProviderModule<any>>,
  'budget/fixed':      () => import('./budget/fixed/index.js') as Promise<ProviderModule<any>>,
  'title/llm':         () => import('./title/llm/index.js') as Promise<ProviderModule<any>>,
};

export const resolveBuiltinLoader: (kind: string, name: string) => ProviderModuleRef | undefined = (kind, name) => {
  return builtinLoaders[`${kind}/${name}`];
};
