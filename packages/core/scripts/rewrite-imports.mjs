#!/usr/bin/env node
// 用法: node packages/core/scripts/rewrite-imports.mjs <mapping.json>
// mapping: { "<old src 相对路径>.ts": "<new src 相对路径>.ts" }
// 前置条件：文件已完成 git mv。本脚本重写 packages/core/src 与 packages/core/tests
// 下所有 .ts 文件中的相对 import/export，使其指向移动后的位置。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(coreRoot, 'src');
const mappingPath = resolve(process.cwd(), process.argv[2]);
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));

const oldToNew = new Map();
const newToOld = new Map();
for (const [oldRel, newRel] of Object.entries(mapping)) {
  const oldAbs = join(srcRoot, oldRel);
  const newAbs = join(srcRoot, newRel);
  oldToNew.set(oldAbs, newAbs);
  newToOld.set(newAbs, oldAbs);
}

const files = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.ts')) files.push(p);
  }
};
walk(srcRoot);
walk(join(coreRoot, 'tests'));

const specifierRe = /((?:from|import\s*\()\s*['"])(\.[^'"]+)(['"])/g;
let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;
const unresolved = [];

for (const file of files) {
  // 移动过的文件：其内容的相对导入仍相对于旧位置解析
  const oldLoc = newToOld.get(file) ?? file;
  const content = readFileSync(file, 'utf8');
  let changed = false;
  const next = content.replace(specifierRe, (whole, prefix, spec, suffix) => {
    if (!spec.endsWith('.js')) return whole;
    const targetOld = resolve(dirname(oldLoc), spec.replace(/\.js$/, '.ts'));
    let targetNew = oldToNew.get(targetOld);
    if (!targetNew) {
      if (!existsSync(targetOld)) {
        unresolved.push(`${relative(coreRoot, file)}: ${spec}`);
        return whole;
      }
      targetNew = targetOld;
    }
    let rel = relative(dirname(file), targetNew).split(sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    const newSpec = rel.replace(/\.ts$/, '.js');
    if (newSpec === spec) return whole;
    changed = true;
    rewrittenSpecifiers++;
    return prefix + newSpec + suffix;
  });
  if (changed) {
    writeFileSync(file, next);
    rewrittenFiles++;
  }
}

console.log(`重写 ${rewrittenSpecifiers} 处导入，涉及 ${rewrittenFiles} 个文件`);
if (unresolved.length) {
  console.warn('以下导入未能解析（保持原样，需人工检查）：');
  for (const u of unresolved) console.warn(`  - ${u}`);
  process.exitCode = 2;
}
