export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;
export const GREP_MAX_LINE_LENGTH = 2000;

export interface TruncationOptions {
  maxBytes?: number;
  maxLines?: number;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  firstLineExceedsLimit?: boolean;
  maxBytes?: number;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function truncateHead(text: string, options: TruncationOptions = {}): TruncationResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  const lines = splitLines(text);
  if (lines.length > maxLines) {
    const kept = lines.slice(lines.length - maxLines);
    const content = kept.join('\n');
    const truncated = content.length < text.length;
    return {
      content,
      truncated,
      maxBytes,
    };
  }

  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxBytes) {
    return { content: text, truncated: false, maxBytes };
  }

  const result = truncateBytesFromHead(text, maxBytes);
  return {
    content: result.content,
    truncated: result.truncated,
    firstLineExceedsLimit: result.firstLineExceedsLimit,
    maxBytes,
  };
}

function truncateBytesFromHead(
  text: string,
  maxBytes: number,
): { content: string; truncated: boolean; firstLineExceedsLimit?: boolean } {
  const lines = splitLines(text);
  let firstLineExceedsLimit = false;

  if (lines.length > 0) {
    const firstLineBytes = Buffer.byteLength(lines[0] ?? '', 'utf8');
    if (firstLineBytes > maxBytes) {
      firstLineExceedsLimit = true;
    }
  }

  const chars = Array.from(text);
  let bytes = 0;
  let cutIndex = chars.length;

  for (let i = chars.length - 1; i >= 0; i--) {
    const char = chars[i] ?? '';
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) {
      cutIndex = i + 1;
      break;
    }
    bytes += charBytes;
  }

  return {
    content: text.slice(cutIndex),
    truncated: cutIndex > 0,
    firstLineExceedsLimit,
  };
}

export function truncateTail(text: string, maxBytes: number): TruncationResult {
  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxBytes) {
    return { content: text, truncated: false, maxBytes };
  }

  const chars = Array.from(text);
  let bytes = 0;
  let cutIndex = chars.length;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? '';
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) {
      cutIndex = i;
      break;
    }
    bytes += charBytes;
  }

  return {
    content: text.slice(0, cutIndex),
    truncated: true,
    maxBytes,
  };
}

export function truncateLine(text: string, maxLength = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
  if (text.length <= maxLength) return { text, wasTruncated: false };
  return { text: `${text.slice(0, maxLength)}…`, wasTruncated: true };
}
