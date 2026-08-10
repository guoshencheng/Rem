#!/usr/bin/env node
// packages/core 结构检查：依赖方向、文件行数上限、kebab-case、.js 扩展名。
// 用法: node packages/core/scripts/check-structure.mjs（任意目录下可运行）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const configuredSrcRoot = process.argv.find((arg) => arg.startsWith('--src-root='));
const srcRoot = configuredSrcRoot
  ? resolve(configuredSrcRoot.slice('--src-root='.length))
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const DOMAINS = [
  'agent', 'agent-profile', 'application', 'assembly', 'capabilities', 'delegation',
  'domain', 'execution', 'infrastructure', 'orchestration', 'plugin-system', 'plugins',
  'runtime', 'runtime-events', 'sdk', 'security', 'session', 'shared', 'system',
  'system-prompt', 'testing', 'tools',
];

// 规格第 7 节硬约束（只列禁止边；未列出的边不限制）
const FORBIDDEN = [
  ['domain', [...DOMAINS.filter((d) => d !== 'domain'), '(root)']],
  ['sdk', ['(root)', 'application', 'execution', 'plugins', 'assembly']],
  ['agent', ['plugins']],
  ['shared', DOMAINS.filter((d) => d !== 'shared')],
  ['plugins', ['assembly']],
];

const ENTRY_MAX_LINES = 120; // index.ts 等入口/聚合文件
const IMPL_MAX_LINES = 200;  // 实现文件

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.ts')) files.push(p);
  }
};
walk(srcRoot);

const domainOf = (abs) => {
  const rel = relative(srcRoot, abs);
  const first = rel.split(sep)[0];
  return DOMAINS.includes(first) ? first : '(root)';
};

const errors = [];
const importRe = /(?:from|import\s*\()\s*['"](\.[^'"]+)['"]/g;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(srcRoot, file);
  const base = file.split(sep).pop();

  // kebab-case
  if (!/^[a-z0-9.-]+\.ts$/.test(base)) {
    errors.push(`${rel}: 文件名必须 kebab-case`);
  }

  // 行数上限（.d.ts 豁免）
  // 分类规则：index.ts 且不含运行时代码导出（纯 re-export/type）才算"入口/聚合文件"（上限 120）；
  // 名为 index.ts 但含实现导出的按实现文件处理（上限 200）。
  if (!base.endsWith('.d.ts')) {
    const lines = content.split('\n').length;
    const hasRuntimeExport = /^\s*export\s+(async\s+)?(function|class|const|let|var)\s/m.test(content);
    const isEntry = base === 'index.ts' && !hasRuntimeExport;
    const max = isEntry ? ENTRY_MAX_LINES : IMPL_MAX_LINES;
    if (lines > max) {
      errors.push(`${rel}: ${lines} 行，超过上限 ${max}`);
    }
  }

  // 依赖方向 + .js 扩展名
  const fromDomain = domainOf(file);
  for (const m of content.matchAll(importRe)) {
    const spec = m[1];
    if (!spec.endsWith('.js')) {
      errors.push(`${rel}: 相对导入缺少 .js 扩展名 → ${spec}`);
      continue;
    }
    const targetAbs = join(dirname(file), spec.replace(/\.js$/, '.ts'));
    const toDomain = domainOf(targetAbs);
    for (const [from, tos] of FORBIDDEN) {
      if (fromDomain === from && tos.includes(toDomain)) {
        errors.push(`${rel}: 禁止 ${from} → ${toDomain}（${spec}）`);
      }
    }
  }

  // runtime/ 不得读取环境配置
  if (fromDomain === 'runtime' && /process\.env/.test(content)) {
    errors.push(`${rel}: runtime/ 不得读取 process.env`);
  }

}

if (errors.length) {
  console.error(`结构检查失败（${errors.length} 项）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`结构检查通过（${files.length} 个文件）`);
