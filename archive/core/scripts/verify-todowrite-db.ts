/**
 * 独立验证脚本：SqliteTodoStore 的数据库读写
 *
 * 用法：
 *   # 内存数据库（默认，隔离测试）
 *   pnpm --filter rem-agent-core exec tsx scripts/verify-todowrite-db.ts
 *
 *   # 真实数据库
 *   pnpm --filter rem-agent-core exec tsx scripts/verify-todowrite-db.ts --real
 *
 *   # 真实数据库 + 清理测试数据
 *   pnpm --filter rem-agent-core exec tsx scripts/verify-todowrite-db.ts --real --cleanup
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteTodoStore } from '../src/plugins/storage/sqlite/todo-store.js';
import type { TodoItem } from '../src/todo/types.js';
import { SqliteStorageProvider } from '../src/index.js';

const USE_REAL_DB = process.argv.includes('--real');
const DB_PATH = USE_REAL_DB
  ? join(homedir(), '.rem-agent', 'rem-agent.db')
  : ':memory:';
const SESSION_ID = 'verify-todowrite-session';

function log(step: string, data?: unknown) {
  console.log(`\n[${step}]`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log(`数据库: ${DB_PATH}`);
  console.log(`会话ID: ${SESSION_ID}`);

  const storageProvider = new SqliteStorageProvider({
    dbPath: DB_PATH
  });
  await storageProvider.init();

  // 2. 第一次写入：全量写入
  log('STEP 1: 第一次 replaceForSession（全量写入）');
  const firstTodos: TodoItem[] = [
    { content: '与用户对齐「三步写诗」的具体定义（题目/体裁/用途等）', status: 'completed', priority: 'high' },
    { content: '第二步：起草与意象打磨（出七言初稿）', status: 'completed', priority: 'high' },
    { content: '第三步：定稿与韵律微调', status: 'completed', priority: 'medium' },
    { content: '交付诗作并询问是否需要调整', status: 'completed', priority: 'medium' },
  ];

  const firstResult = await storageProvider.todoStore.replaceForSession(SESSION_ID, firstTodos);
  log('第一次写入结果', firstResult);

  const firstRow = await storageProvider.todoStore.getBySession(SESSION_ID);
  log('数据库中的记录（第一次）', firstRow);

  // 3. 第二次写入：全量替换（修改内容）
  log('STEP 2: 第二次 replaceForSession（全量替换，修改内容）');
  const secondTodos: TodoItem[] = [
    { content: '与用户对齐「三步写诗」的具体定义（题目/体裁/用途等）', status: 'completed', priority: 'high' },
    { content: '第二步：起草与意象打磨（出七言初稿）', status: 'completed', priority: 'high' },
    { content: '第三步：定稿与韵律微调', status: 'completed', priority: 'medium' },
    { content: '交付诗作并询问是否需要调整', status: 'completed', priority: 'medium' },
  ];

  const secondResult = await storageProvider.todoStore.replaceForSession(SESSION_ID, secondTodos);
  log('第二次写入结果', secondResult);

  const secondRow = storageProvider.todoStore.getBySession(SESSION_ID)
  log('数据库中的记录（第二次）', secondRow);

  // 5. 第三次写入：删除一项 + 新增一项
  log('STEP 4: 第三次 replaceForSession（删除一项 + 新增一项）');
  const thirdTodos: TodoItem[] = [
    { content: '与用户对齐「三步写诗」的具体定义（题目/体裁/用途等）', status: 'completed', priority: 'high' },
    { content: '第二步：起草与意象打磨（出七言初稿）', status: 'completed', priority: 'high' },
    // 删除第三项
    { content: '新增：润色与朗诵测试', status: 'pending', priority: 'low' },
  ];

  const thirdResult = await storageProvider.todoStore.replaceForSession(SESSION_ID, thirdTodos);
  log('第三次写入结果', thirdResult);

  const thirdRow = storageProvider.todoStore.getBySession(SESSION_ID);
  log('数据库中的记录（第三次）', thirdRow);
  storageProvider.clean();
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
