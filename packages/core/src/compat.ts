// 临时兼容出口：集中保留"不应长期存在"的旧 API 名称。
// 删除条件：bridge / routes / ui / web 等 workspace 调用方全部迁移到新名称后，本文件整体删除。

export {
  createDelegateTaskToolDefinition as createDelegateTaskToolDefinitionV2,
  createDelegateTaskExecutor as createDelegateTaskExecutorV2,
} from './capabilities/sub-agent/delegate-task.js';
export type {
  DelegateTaskInput as DelegateTaskInputV2,
} from './capabilities/sub-agent/delegate-task.js';
export type { RunDelegation as DelegateTaskExecutorV2Params } from './delegation/types.js';
