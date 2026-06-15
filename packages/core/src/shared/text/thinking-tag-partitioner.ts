import {
  closedCodeRegionState,
  createCodeRegionScanner,
  getCodeStateAt,
  isInsideCode,
  type CodeRegionState,
} from "./code-regions.js";

export type ThinkingTagDelta =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string };

const THINKING_TAG_RE = /<\s*(\/?)\s*(?:think(?:ing)?|thought)\b[^<>]*>/gi;

function isReasoningTagPrefix(text: string): boolean {
  if (!text.startsWith("<") || text.includes(">")) {
    return false;
  }
  const afterBracket = text
    .slice(1)
    .replace(/^\s*\/?\s*/, "")
    .toLowerCase()
    .trimStart();
  if (afterBracket.length === 0) {
    return true;
  }
  const names = ["think", "thinking", "thought"];
  return names.some((name) => name.startsWith(afterBracket));
}

function findIncompleteTagPrefix(text: string): number {
  for (let i = text.lastIndexOf("<"); i >= 0; i = text.lastIndexOf("<", i - 1)) {
    if (isReasoningTagPrefix(text.slice(i))) {
      return i;
    }
  }
  return -1;
}

export interface ThinkingTagPartitioner {
  push(chunk: string): ThinkingTagDelta[];
  flush(): ThinkingTagDelta[];
}

export function createThinkingTagPartitioner(): ThinkingTagPartitioner {
  let buffer = "";
  let cursor = 0;
  let thinkingDepth = 0;
  let emittedVisibleText = false;
  let codeState: CodeRegionState = { ...closedCodeRegionState };

  function findNextTag(): { index: number; text: string; isClose: boolean } | null {
    const text = buffer.slice(cursor);
    const scanner = createCodeRegionScanner(codeState);
    const { regions } = scanner.scan(text);

    const re = new RegExp(THINKING_TAG_RE.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (!isInsideCode(match.index, regions)) {
        return { index: cursor + match.index, text: match[0], isClose: match[1] === "/" };
      }
    }
    return null;
  }

  function advanceCursor(to: number): void {
    codeState = getCodeStateAt(buffer.slice(cursor), to - cursor, codeState);
    cursor = to;
  }

  function reset() {
    buffer = "";
    cursor = 0;
    thinkingDepth = 0;
    emittedVisibleText = false;
    codeState = { ...closedCodeRegionState };
  }

  function consume(final: boolean): ThinkingTagDelta[] {
    const deltas: ThinkingTagDelta[] = [];

    const emit = (type: "text" | "thinking", text: string) => {
      if (!text) {
        return;
      }
      if (type === "text" && text.trim().length > 0) {
        emittedVisibleText = true;
      }
      const last = deltas[deltas.length - 1];
      if (last && last.type === type) {
        last.text += text;
        return;
      }
      deltas.push({ type, text });
    };

    while (true) {
      const tag = findNextTag();

      if (!tag) {
        if (thinkingDepth > 0) {
          if (final) {
            emit("thinking", buffer.slice(cursor));
            reset();
          } else {
            const tail = buffer.slice(cursor);
            const keepFrom = findIncompleteTagPrefix(tail);
            if (keepFrom > 0) {
              emit("thinking", tail.slice(0, keepFrom));
              advanceCursor(cursor + keepFrom);
            } else if (keepFrom === -1) {
              emit("thinking", tail);
              advanceCursor(buffer.length);
            }
          }
        } else {
          if (final) {
            emit("text", buffer.slice(cursor));
            reset();
          } else {
            const tail = buffer.slice(cursor);
            const keepFrom = findIncompleteTagPrefix(tail);
            if (keepFrom > 0) {
              emit("text", tail.slice(0, keepFrom));
              advanceCursor(cursor + keepFrom);
            } else if (keepFrom === -1) {
              emit("text", tail);
              advanceCursor(buffer.length);
            }
          }
        }
        return deltas;
      }

      const before = buffer.slice(cursor, tag.index);
      const afterStart = tag.index + tag.text.length;

      if (tag.isClose && thinkingDepth === 0) {
        // Orphan close tag.
        if (before.trim().length > 0 && buffer.slice(afterStart).trim().length > 0) {
          // Drop preceding text as leaked reasoning, skip the tag.
          advanceCursor(afterStart);
        } else {
          emit("text", before);
          advanceCursor(afterStart);
        }
        continue;
      }

      if (thinkingDepth === 0) {
        // Entering a thinking block.
        emit("text", before);
        thinkingDepth = 1;
        advanceCursor(afterStart);
      } else {
        // Already inside a thinking block.
        if (tag.isClose) {
          thinkingDepth -= 1;
          if (thinkingDepth === 0) {
            emit("thinking", before);
            advanceCursor(afterStart);
          } else {
            // Nested close tag: remove the tag but keep the surrounding content
            // in the thinking buffer.
            buffer = buffer.slice(0, tag.index) + buffer.slice(afterStart);
          }
        } else {
          // Nested open tag: increase depth and remove the tag.
          thinkingDepth += 1;
          buffer = buffer.slice(0, tag.index) + buffer.slice(afterStart);
        }
      }
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      return consume(false);
    },
    flush() {
      return consume(true);
    },
  };
}

export function partitionThinkingTags(text: string): ThinkingTagDelta[] {
  const partitioner = createThinkingTagPartitioner();
  const deltas = partitioner.push(text);
  return [...deltas, ...partitioner.flush()];
}
