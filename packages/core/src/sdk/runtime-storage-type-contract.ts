import type { RuntimeStorage, RuntimeUnitOfWork } from './runtime-storage.js';

declare const storage: RuntimeStorage;
declare const uow: RuntimeUnitOfWork;
declare const condition: boolean;

if (false) {
  const result: Promise<string> = storage.transaction(() => 'sync');
  void result;
  void uow;

  // @ts-expect-error RuntimeStorage transaction callback 必须同步。
  storage.transaction(async () => 'async');

  // @ts-expect-error 包含 PromiseLike 成员的联合返回值同样不允许。
  storage.transaction(() => condition ? 'sync' : Promise.resolve('async'));
}
