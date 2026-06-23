export interface Edit {
  oldText: string;
  newText: string;
}

export interface EditDiffResult {
  diff: string;
  patch: string;
  firstChangedLine?: number;
}

export interface EditDiffError {
  error: Error;
}

export function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

export function detectLineEnding(text: string): string {
  if (text.includes('\r\n')) return '\r\n';
  return '\n';
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function restoreLineEndings(text: string, lineEnding: string): string {
  if (lineEnding === '\r\n') return text.replace(/\n/g, '\r\n');
  return text;
}

export function applyEditsToNormalizedContent(content: string, edits: Edit[]): string {
  let result = content;
  for (const edit of edits) {
    const normalizedOld = normalizeToLF(edit.oldText);
    const count = result.split(normalizedOld).length - 1;
    if (count !== 1) {
      throw new Error(
        `Could not find the exact text in the file (found ${count} matches).`,
      );
    }
    result = result.split(normalizedOld).join(normalizeToLF(edit.newText));
  }
  return result;
}

function findFirstChangedLine(originalLines: string[], newLines: string[]): number | undefined {
  for (let i = 0; i < Math.max(originalLines.length, newLines.length); i++) {
    if (originalLines[i] !== newLines[i]) return i + 1;
  }
  return undefined;
}

export function generateDiffString(original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const result: string[] = [];

  let i = 0;
  let j = 0;
  while (i < originalLines.length || j < modifiedLines.length) {
    if (i >= originalLines.length) {
      result.push(`+${modifiedLines[j] ?? ''}`);
      j++;
    } else if (j >= modifiedLines.length) {
      result.push(`-${originalLines[i] ?? ''}`);
      i++;
    } else if (originalLines[i] === modifiedLines[j]) {
      result.push(` ${originalLines[i] ?? ''}`);
      i++;
      j++;
    } else {
      result.push(`-${originalLines[i] ?? ''}`);
      result.push(`+${modifiedLines[j] ?? ''}`);
      i++;
      j++;
    }
  }

  return result.join('\n');
}

export function generateUnifiedPatch(path: string, original: string, modified: string): string {
  const diff = generateDiffString(original, modified);
  return `--- ${path}\n+++ ${path}\n${diff}`;
}

export function computeEditsDiff(
  path: string,
  originalContent: string,
  edits: Edit[],
): EditDiffResult | EditDiffError {
  try {
    const bom = originalContent.startsWith('\uFEFF') ? '\uFEFF' : '';
    const withoutBom = stripBom(originalContent);
    const lineEnding = detectLineEnding(withoutBom);
    const normalized = normalizeToLF(withoutBom);
    const modifiedNormalized = applyEditsToNormalizedContent(normalized, edits);
    const modified = restoreLineEndings(modifiedNormalized, lineEnding);
    const final = bom + modified;
    const originalLines = originalContent.split(/\r?\n/);
    const newLines = final.split(/\r?\n/);

    return {
      diff: generateDiffString(originalContent, final),
      patch: generateUnifiedPatch(path, originalContent, final),
      firstChangedLine: findFirstChangedLine(originalLines, newLines),
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}
