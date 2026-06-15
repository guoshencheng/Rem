import { findCodeRegions, isInsideCode } from "./code-regions.js";

const THINKING_TAG_RE = /<\s*(\/?)\s*(?:think(?:ing)?|thought)\b[^<>]*>/gi;
const QUICK_TAG_RE = /<\s*\/?\s*(?:think(?:ing)?|thought)\b/i;

function trimKeepInterval(text: string, start: number, end: number): string {
  while (start < end && /\s/.test(text[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1;
  }
  return text.slice(start, end);
}

export function stripThinkingTags(text: string): string {
  if (!text || !QUICK_TAG_RE.test(text)) {
    return text;
  }

  const codeRegions = findCodeRegions(text);
  const matches = Array.from(text.matchAll(THINKING_TAG_RE)).filter(
    (m) => !isInsideCode(m.index ?? 0, codeRegions),
  );

  if (matches.length === 0) {
    return text;
  }

  const keptIntervals: Array<{ start: number; end: number }> = [];
  let lastEnd = 0;
  let i = 0;

  while (i < matches.length) {
    const match = matches[i];
    const idx = match.index ?? 0;
    const isClose = match[1] === "/";

    if (isClose) {
      // Orphan close tag: if there is visible text both before and after it,
      // the preceding text is likely leaked reasoning, so drop it.
      const afterStart = idx + match[0].length;
      const beforeText = text.slice(lastEnd, idx);
      const afterText = text.slice(afterStart);
      if (beforeText.trim().length > 0 && afterText.trim().length > 0) {
        // Drop everything up to the end of the close tag.
        lastEnd = afterStart;
      } else {
        keptIntervals.push({ start: lastEnd, end: idx });
        lastEnd = afterStart;
      }
      i += 1;
      continue;
    }

    // Find matching close tag, accounting for nesting.
    let depth = 1;
    let j = i + 1;
    while (j < matches.length && depth > 0) {
      if (matches[j][1] === "/") {
        depth -= 1;
      } else {
        depth += 1;
      }
      if (depth === 0) {
        break;
      }
      j += 1;
    }

    keptIntervals.push({ start: lastEnd, end: idx });

    if (depth === 0) {
      lastEnd = (matches[j].index ?? 0) + matches[j][0].length;
      i = j + 1;
    } else {
      // Unclosed opening tag: strip everything from here to the end.
      lastEnd = text.length;
      i = matches.length;
    }
  }

  keptIntervals.push({ start: lastEnd, end: text.length });

  // Rebuild result, trimming each kept interval and joining non-empty parts
  // with a single space.
  const parts: string[] = [];
  for (const interval of keptIntervals) {
    const part = trimKeepInterval(text, interval.start, interval.end);
    if (part.length > 0) {
      parts.push(part);
    }
  }

  return parts.join(" ");
}
