import type { RuntimeStorage } from './runtime-storage.js';

/** Runtime 生命周期只拥有这一组存储能力。 */
export interface RuntimeStorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  checkHealth(): Promise<void>;
  readonly runtimeStore: RuntimeStorage;
}
