# Darlulu Live Agent Flow Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加一个全自动 live 命令，让 Rem 的真实 LLM Agent 通过 Darlulu stdio MCP 自主完成父子装配流程，并保留工作台与完整运行证据供人工校验。

**Architecture:** 在 `packages/core/src/testing/darlulu-live/` 建立测试范围组件：MCP schema 适配、Rem `ToolProvider`、受控子进程、运行日志与 live runner。CLI 只解析参数并调用 runner；runner 启动 Darlulu Web、连接 MCP、注入外部 Darlulu skill、运行 `REMAgent`，并在 `connect_web` 成功后通过宿主 opener 打开装配专属 URL。

**Tech Stack:** TypeScript、Node.js 22、`@modelcontextprotocol/sdk` stdio client、Rem Core `REMAgent`/`ToolProvider`、TypeBox、Vitest、pnpm。

---

## 文件结构

- `packages/core/src/testing/darlulu-live/command-options.ts`：解析仓库路径、任务、日志目录和超时。
- `packages/core/src/testing/darlulu-live/json-schema.ts`：把 MCP JSON Schema 包装为 TypeBox `TObject`。
- `packages/core/src/testing/darlulu-live/mcp-tool-provider.ts`：动态发现并调用 MCP tools；只在 `connect_web` 成功后请求打开 URL。
- `packages/core/src/testing/darlulu-live/process-runtime.ts`：启动 Web、等待 HTTP ready、持有并精确清理子进程。
- `packages/core/src/testing/darlulu-live/run-log.ts`：同步终端输出与 JSONL 证据文件。
- `packages/core/src/testing/darlulu-live/external-skill-provider.ts`：只暴露 Darlulu assembly designer skill。
- `packages/core/src/testing/darlulu-live/run-darlulu-live.ts`：编排服务、MCP、Agent 与清理。
- `packages/core/src/testing/darlulu-live/types.ts`：上述组件共享的少量类型和默认任务。
- `packages/core/scripts/run-darlulu-live-agent.ts`：CLI 入口。
- `packages/core/tests/darlulu-live-*.test.ts`：单元测试，不发真实模型请求。
- `packages/core/package.json`、根 `package.json`、`pnpm-lock.yaml`：依赖和命令入口。
- `.gitignore`：忽略 `.rem-agent/runs/darlulu-live/*.jsonl` 运行产物。

### Task 1: CLI 参数与固定任务边界

**Files:**
- Create: `packages/core/src/testing/darlulu-live/types.ts`
- Create: `packages/core/src/testing/darlulu-live/command-options.ts`
- Create: `packages/core/tests/darlulu-live-command-options.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖默认 Darlulu 路径、`--darlulu-root`、`--task`、`--log-dir`、`--web-timeout-ms`，并验证空参数和非正超时被拒绝：

```ts
import { describe, expect, it } from 'vitest';
import { parseDarluluLiveOptions } from '../src/testing/darlulu-live/command-options.js';

describe('parseDarluluLiveOptions', () => {
  it('uses stable defaults', () => {
    expect(parseDarluluLiveOptions([])).toMatchObject({
      darluluRoot: '/Users/guoshencheng/Documents/work/darlulu',
      webTimeoutMs: 30_000,
    });
  });

  it('accepts explicit portable paths and task', () => {
    expect(parseDarluluLiveOptions([
      '--darlulu-root', '/work/darlulu', '--task', '建立抽屉实例',
      '--log-dir', '/tmp/rem-runs', '--web-timeout-ms', '45000',
    ])).toMatchObject({
      darluluRoot: '/work/darlulu', task: '建立抽屉实例',
      logDir: '/tmp/rem-runs', webTimeoutMs: 45_000,
    });
  });

  it('rejects invalid timeout', () => {
    expect(() => parseDarluluLiveOptions(['--web-timeout-ms', '0']))
      .toThrow('--web-timeout-ms 必须是正整数');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-command-options.test.ts`

Expected: FAIL，模块 `command-options.js` 不存在。

- [ ] **Step 3: 实现最小参数模型和默认任务**

在 `types.ts` 定义：

```ts
export interface DarluluLiveOptions {
  darluluRoot: string;
  task: string;
  logDir: string;
  webTimeoutMs: number;
}

export const DEFAULT_DARLULU_TASK = `使用 darlulu-assembly-designer skill 和提供的 Darlulu 工具，
在一个新 Workspace 中创建一个父装配体、一个可发布的子装配 Template，以及父装配体中的
至少一个 Template Instance。你必须自主查询 capability，验证并发布 Template，连接唯一的
Web 工作台，完成 render 并获取预览。不要使用第二个 Workspace 代替子装配。最后报告
assemblyId、主要操作和仍需人工检查的内容。`;
```

在 `command-options.ts` 使用 `node:util` 的 `parseArgs`，默认路径为用户指定路径，默认日志目录
为 `resolve('.rem-agent/runs/darlulu-live')`，并对 trim 后的路径、任务和正整数超时做显式检查。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/darlulu-live-command-options.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/testing/darlulu-live packages/core/tests/darlulu-live-command-options.test.ts
git commit -m "feat(core): define darlulu live validation options"
```

### Task 2: MCP JSON Schema 与 Rem ToolProvider

**Files:**
- Create: `packages/core/src/testing/darlulu-live/json-schema.ts`
- Create: `packages/core/src/testing/darlulu-live/mcp-tool-provider.ts`
- Create: `packages/core/tests/darlulu-live-mcp-tool-provider.test.ts`
- Modify: `packages/core/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 增加官方 MCP SDK 依赖**

Run: `pnpm --filter rem-agent-core add @modelcontextprotocol/sdk@^1.17.0`

Expected: `packages/core/package.json` 的 dependencies 出现 SDK，lockfile 更新。

- [ ] **Step 2: 写 provider 失败测试**

用一个只有 `listTools()`、`callTool()` 的 fake client 验证工具发现、参数透传、错误转发和 URL
打开钩子：

```ts
const client = {
  listTools: vi.fn().mockResolvedValue({ tools: [{
    name: 'connect_web', description: 'connect',
    inputSchema: { type: 'object', properties: { assemblyId: { type: 'string' } }, required: ['assemblyId'] },
  }, {
    name: 'get_assembly', description: 'read', inputSchema: { type: 'object', properties: {} },
  }] }),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ url: 'http://localhost:5173/?assemblyId=a1' }) }],
  }),
};
const openUrl = vi.fn().mockResolvedValue(undefined);
const provider = await DarluluMcpToolProvider.create(client, openUrl);
const [result] = await provider.execute([{
  toolCallId: 'c1', toolName: 'connect_web', input: { assemblyId: 'a1' },
}], { cwd: '/work', workspaceRoot: '/work' });
expect(client.callTool).toHaveBeenCalledWith({ name: 'connect_web', arguments: { assemblyId: 'a1' } });
expect(openUrl).toHaveBeenCalledWith('http://localhost:5173/?assemblyId=a1');
expect(result.error).toBeUndefined();
```

另加用例证明 `get_assembly` 不打开 URL，以及 `isError: true` 产生 `ToolResult.error`。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-mcp-tool-provider.test.ts`

Expected: FAIL，provider 模块不存在。

- [ ] **Step 4: 实现 schema 包装与 provider**

`json-schema.ts` 使用 `Type.Unsafe<TObject>(schema)`，但先强制根 schema 为
`{ type: 'object' }`，缺失 `properties` 时补空对象；非 object 根 schema 抛出包含工具名的错误。

`DarluluMcpToolProvider.create(client, openUrl)` 内部调用 `listTools()`，逐个向
`StaticToolProvider` 注册 definition/executor。executor 调 `callTool()`，把所有 text content
连接为 output，把原始结果放入 details；`isError` 转成异常。仅当工具名为 `connect_web` 且
成功结果中能递归找到合法 `http:`/`https:` URL 时调用 `openUrl`。provider 其余接口委托给
内部 `StaticToolProvider`。

- [ ] **Step 5: 运行测试确认通过并做类型检查**

Run: `pnpm vitest run packages/core/tests/darlulu-live-mcp-tool-provider.test.ts && pnpm --filter rem-agent-core typecheck`

Expected: PASS，TypeScript 无错误。

- [ ] **Step 6: 提交**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/testing/darlulu-live/json-schema.ts packages/core/src/testing/darlulu-live/mcp-tool-provider.ts packages/core/tests/darlulu-live-mcp-tool-provider.test.ts
git commit -m "feat(core): adapt darlulu mcp tools for live agents"
```

### Task 3: 外部 Skill Provider 与运行日志

**Files:**
- Create: `packages/core/src/testing/darlulu-live/external-skill-provider.ts`
- Create: `packages/core/src/testing/darlulu-live/run-log.ts`
- Create: `packages/core/tests/darlulu-live-support.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 写失败测试**

测试 provider 从 `<darluluRoot>/skills/darlulu-assembly-designer/SKILL.md` 返回唯一 skill，且
`readSkillRaw('darlulu-assembly-designer')` 返回原文；测试 logger 每行同时发送给终端 sink 并
写入 JSONL：

```ts
const logger = await JsonlRunLog.create(logDir, () => new Date('2026-08-04T10:00:00Z'));
logger.write('lifecycle', { status: 'mcp-connected' });
await logger.close();
expect(sink).toHaveBeenCalled();
expect(JSON.parse(await readFile(logger.path, 'utf8'))).toMatchObject({
  type: 'lifecycle', data: { status: 'mcp-connected' },
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-support.test.ts`

Expected: FAIL，support 模块不存在。

- [ ] **Step 3: 实现两个小组件**

`ExternalSkillProvider` 读取并用现有 `parseSkillMarkdown` 解析单个文件，catalog 复用
`DefaultSkillCatalog`；其他 skill 名返回 `undefined`。`JsonlRunLog` 用追加队列串行写 JSONL，
记录 `{timestamp,type,data}`，`close()` 等待队列完成。文件名使用 ISO 时间替换冒号，扩展名
`.jsonl`。

在 `.gitignore` 增加：

```gitignore
.rem-agent/runs/darlulu-live/
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/darlulu-live-support.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add .gitignore packages/core/src/testing/darlulu-live/external-skill-provider.ts packages/core/src/testing/darlulu-live/run-log.ts packages/core/tests/darlulu-live-support.test.ts
git commit -m "feat(core): record darlulu live agent evidence"
```

### Task 4: 受控 Web 进程与 URL opener

**Files:**
- Create: `packages/core/src/testing/darlulu-live/process-runtime.ts`
- Create: `packages/core/tests/darlulu-live-process-runtime.test.ts`

- [ ] **Step 1: 写失败测试**

注入 fake spawn/fetch/process，验证 readiness 重试、只清理自身 child、macOS opener 使用
`open <url>` 且不经过 shell：

```ts
const runtime = new OwnedProcessRuntime({ spawn: spawnFake, fetch: fetchFake });
await runtime.startWeb('/work/darlulu', 'http://127.0.0.1:5173', 1000);
await runtime.close();
expect(child.kill).toHaveBeenCalledWith('SIGTERM');
expect(spawnFake).toHaveBeenCalledWith('pnpm', ['dev', '--', '--host', '127.0.0.1'], expect.objectContaining({
  cwd: '/work/darlulu', shell: false,
}));
```

另测已 ready 的外部 Web 不创建 child，`close()` 因而不终止任何外部进程。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-process-runtime.test.ts`

Expected: FAIL，process runtime 不存在。

- [ ] **Step 3: 实现最小 process runtime**

先请求 URL；若已成功则标记 reused。否则用参数数组和 `shell:false` 启动 `pnpm dev`，每
250ms 请求一次直到超时。`openWorkbenchUrl()` 在 macOS 用 `open`，Linux 用 `xdg-open`，
Windows 用 `cmd /c start ""`；等待 opener exit code 0，否则抛错。`close()` 只遍历内部
`Set<ChildProcess>`，先 SIGTERM，并在短超时后对仍未退出的自有 child 使用 SIGKILL。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/darlulu-live-process-runtime.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/testing/darlulu-live/process-runtime.ts packages/core/tests/darlulu-live-process-runtime.test.ts
git commit -m "feat(core): supervise darlulu live web process"
```

### Task 5: 真实 Rem Agent 编排器

**Files:**
- Create: `packages/core/src/testing/darlulu-live/run-darlulu-live.ts`
- Create: `packages/core/tests/darlulu-live-runner.test.ts`

- [ ] **Step 1: 写编排失败测试**

通过依赖注入 fake runtime、MCP client/provider factory 和 fake agent 验证顺序与 finally 清理：

```ts
expect(order).toEqual([
  'log:create', 'web:start', 'mcp:connect', 'provider:create',
  'agent:create', 'agent:run', 'mcp:close', 'web:close', 'log:close',
]);
```

另加 agent 抛错用例，确认仍执行三个 close，并返回 `exitCode: 1`；正常结束返回日志路径和
`exitCode: 0`，不根据工具业务结果判断成败。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-runner.test.ts`

Expected: FAIL，runner 不存在。

- [ ] **Step 3: 实现 runner**

runner 的生产依赖执行以下步骤：

```ts
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(options.darluluRoot, 'packages/mcp-server/dist/index.js')],
  cwd: options.darluluRoot,
  env: { ...process.env, DARLULU_APP_URL: webUrl },
  stderr: 'pipe',
});
const client = new Client({ name: 'rem-darlulu-live', version: '0.1.0' });
await client.connect(transport);
```

在连接 MCP 前运行 `pnpm --filter @darlulu/mcp-server build`，失败立即结束。用
`createAgentFromEnv` 注入 `DarluluMcpToolProvider` 和 `ExternalSkillProvider`，临时 Rem 数据
目录用 `mkdtemp`，但 Darlulu 不设置临时 `DARLULU_DATA_DIR`，从而保留其正常 Workspace。

构造 `REMAgent` 时禁用 delegate/todo，只保留 `readSkill: true`。遍历 `agent.run()` 的事件，
用现有 `formatLiveAgentEvent` 写终端，并把原始 event 写 JSONL。最终输出也写入日志。catch
记录错误并返回 1；finally 按 MCP client、Web runtime、logger、Rem 临时目录的顺序释放。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/darlulu-live-runner.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/testing/darlulu-live/run-darlulu-live.ts packages/core/tests/darlulu-live-runner.test.ts
git commit -m "feat(core): orchestrate darlulu live agent validation"
```

### Task 6: CLI 与 package 命令

**Files:**
- Create: `packages/core/scripts/run-darlulu-live-agent.ts`
- Modify: `packages/core/package.json`
- Modify: `package.json`
- Create: `packages/core/tests/darlulu-live-cli-smoke.test.ts`

- [ ] **Step 1: 写 CLI smoke 失败测试**

把 CLI 主函数导出为可注入 runner，验证参数解析错误写 stderr/exit 1，成功调用 runner 并透传
退出码。入口文件只在直接执行时调用 main。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/darlulu-live-cli-smoke.test.ts`

Expected: FAIL，CLI 模块不存在。

- [ ] **Step 3: 实现入口与脚本命令**

入口核心为：

```ts
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseDarluluLiveOptions(argv);
  const result = await runDarluluLiveAgent(options, (line) => process.stdout.write(`${line}\n`));
  return result.exitCode;
}
```

`packages/core/package.json` 增加：

```json
"test:darlulu:live": "tsx scripts/run-darlulu-live-agent.ts"
```

根 `package.json` 增加：

```json
"test:darlulu:live": "pnpm --filter rem-agent-core test:darlulu:live"
```

- [ ] **Step 4: 运行测试与 help/错误 smoke**

Run: `pnpm vitest run packages/core/tests/darlulu-live-cli-smoke.test.ts && pnpm test:darlulu:live -- --web-timeout-ms 0`

Expected: 测试 PASS；命令输出参数错误并返回非零，不启动模型或 Darlulu 服务。

- [ ] **Step 5: 提交**

```bash
git add package.json packages/core/package.json packages/core/scripts/run-darlulu-live-agent.ts packages/core/tests/darlulu-live-cli-smoke.test.ts
git commit -m "feat: add darlulu live agent validation command"
```

### Task 7: 全量验证与人工 live 运行

**Files:**
- Modify only if verification exposes a defect in files introduced by Tasks 1–6.

- [ ] **Step 1: 运行新增测试**

Run: `pnpm vitest run packages/core/tests/darlulu-live-*.test.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 运行 Rem 项目标准验证**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: build/typecheck/test PASS；structure 不新增违规。已知既有 structure 报告应与开始前一致。

- [ ] **Step 3: 运行真实 live 验证**

Run: `pnpm test:darlulu:live`

Expected: 自动启动或复用 Darlulu Web、连接 MCP、运行真实 Agent、打开带 `assemblyId` 的工作台，
终端打印工具轨迹与最终回复，并输出 `.rem-agent/runs/darlulu-live/*.jsonl` 路径。人工检查工作台，
不把业务观感转成脚本断言。

- [ ] **Step 4: 检查清理与保留边界**

Run: `git status --short && test -d "$HOME/.darlulu"`

Expected: 日志未进入 Git；脚本创建的 Web/MCP 子进程已退出；Darlulu Workspace 数据和浏览器
页面仍可供人工查看。

- [ ] **Step 5: 若验证修复了缺陷，单独提交修复**

```bash
git add packages/core/src/testing/darlulu-live packages/core/scripts/run-darlulu-live-agent.ts packages/core/tests/darlulu-live-*.test.ts package.json packages/core/package.json pnpm-lock.yaml .gitignore
git commit -m "fix: stabilize darlulu live agent validation"
```

若这些路径中存在与验证缺陷无关的改动，则不执行本步骤，先把实际缺陷拆成前述路径内的独立
修复后再提交。
