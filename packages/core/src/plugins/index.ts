import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BuiltinProviderResolver } from '../sdk/provider-loader.js';

export { FixedBudgetPolicy } from './budget/fixed/index.js';
export { NoOpCompressor } from './compressor/no-op/index.js';
export { DefaultConfigProvider } from './config/default/index.js';
export { SimpleErrorHandler } from './error/simple/index.js';
export { SimpleMemoryProvider } from './memory/simple/index.js';
export { InMemorySessionProvider } from './session/in-memory/index.js';
export { FileSessionProvider } from './session/file/index.js';
export { LocalSessionProvider } from './session/local/index.js';
export type { ServerMessage } from './session/local/index.js';
export { FileSkillProvider } from './skill/file/index.js';
export { createFileSystemTools } from './tool/file-system/index.js';
export { InMemoryToolProvider } from './tool/in-memory/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const builtinProviderResolver: BuiltinProviderResolver = (kind, name) => {
  return join(__dirname, kind, name, 'index.js');
};
