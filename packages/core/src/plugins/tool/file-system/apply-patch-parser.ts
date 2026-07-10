export interface PatchHunk {
  context: string;
  oldLines: string[];
  newLines: string[];
}

export interface PatchOperation {
  type: 'add' | 'update' | 'delete' | 'move';
  path: string;
  newPath?: string;
  hunks: PatchHunk[];
}

export function parsePatchText(patchText: string): PatchOperation[] {
  const lines = patchText.split(/\r?\n/);
  const operations: PatchOperation[] = [];
  let currentOperation: PatchOperation | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.startsWith('*** Add File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'add', path: parsePath(line, '*** Add File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Update File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'update', path: parsePath(line, '*** Update File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Delete File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'delete', path: parsePath(line, '*** Delete File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Move to:')) {
      if (!currentOperation || currentOperation.type !== 'update') {
        throw new Error(`Line ${i + 1}: "Move to" must follow an Update File`);
      }
      currentOperation.newPath = parsePath(line, '*** Move to:');
      continue;
    }

    if (line.startsWith('@@')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = { context: line.startsWith('@@ ') ? line.slice(3) : line.slice(2), oldLines: [], newLines: [] };
      continue;
    }

    if (
      line.startsWith('*** End File') ||
      line.startsWith('*** End of File') ||
      line.startsWith('*** End Patch') ||
      line.startsWith('*** Begin Patch') ||
      line.trim() === ''
    ) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      continue;
    }

    if (line.startsWith('*** ')) {
      throw new Error(`Line ${i + 1}: unrecognized patch directive: ${line}`);
    }

    if (currentHunk) {
      const marker = line[0];
      const content = stripMarker(line);
      if (marker === ' ') currentHunk.oldLines.push(content);
      else if (marker === '+') currentHunk.newLines.push(content);
      else if (marker === '-') currentHunk.oldLines.push(content);
      else throw new Error(`Line ${i + 1}: invalid hunk line: ${line}`);
    }
  }

  flushHunk(currentOperation, currentHunk);
  return operations;
}

function stripMarker(line: string): string {
  if (line.length <= 1) return '';
  const withoutMarker = line.slice(1);
  if (withoutMarker.startsWith(' ')) return withoutMarker.slice(1);
  return withoutMarker;
}

function parsePath(line: string, prefix: string): string {
  return line.slice(prefix.length).trim();
}

function flushHunk(operation: PatchOperation | null, hunk: PatchHunk | null) {
  if (operation && hunk && (hunk.oldLines.length > 0 || hunk.newLines.length > 0)) {
    operation.hunks.push(hunk);
  }
}
