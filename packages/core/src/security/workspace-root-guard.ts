import { accessSync, constants, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = '\u202F';

export function expandPath(filePath: string): string {
  const normalized = filePath.replace(UNICODE_SPACES, ' ').trim();
  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return normalized;
    }
  }
  if (normalized === '~') return os.homedir();
  if (normalized.startsWith('~/')) return os.homedir() + normalized.slice(1);
  return normalized;
}

export function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
}

function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  return filePath.normalize('NFD');
}

function tryCurlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, '\u2019');
}

export function resolveReadPath(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);
  if (fileExists(resolved)) return resolved;

  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;

  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;

  return resolved;
}

export function assertWithinWorkspaceRoot(
  absolutePath: string,
  workspaceRoot: string,
): void {
  const resolvedRoot = resolve(workspaceRoot);
  const realRoot = safeRealpath(resolvedRoot);
  const realPath = safeRealpath(absolutePath);
  const rel = relative(realRoot, realPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Path "${absolutePath}" resolves outside workspace root "${workspaceRoot}"`,
    );
  }
}

function safeRealpath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

export function resolveWorkspacePath(
  filePath: string,
  ctx: { cwd: string; workspaceRoot: string },
): string {
  const cwd = safeRealpath(ctx.cwd);
  const root = safeRealpath(ctx.workspaceRoot);
  const resolved = resolveToCwd(filePath, cwd);
  assertWithinWorkspaceRoot(resolved, root);
  return resolved;
}
