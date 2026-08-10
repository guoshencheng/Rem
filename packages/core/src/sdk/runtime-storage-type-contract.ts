import type { RuntimeStorage, RuntimeUnitOfWork } from './runtime-storage.js';

declare const storage: RuntimeStorage;
declare const uow: RuntimeUnitOfWork;

if (false) {
  const result: Promise<string> = storage.transaction(() => 'sync');
  void result;
  void uow;

  // @ts-expect-error RuntimeStorage transaction callback 必须同步。
  storage.transaction(async () => 'async');
}
