import type { ThinkingTagDelta, TagMatch } from "./types.js";
import { THINKING_TAG_RE } from "./types.js";
import {
  closedCodeRegionState,
  createCodeRegionScanner,
  getCodeStateAt,
  isInsideCode,
  type CodeRegionState,
} from "../code-regions.js";
import { findIncompleteTagPrefix } from "./detection.js";

export class ThinkingTagPartitioner {
  private tail = "";
  private thinkingDepth = 0;
  private codeState: CodeRegionState = { ...closedCodeRegionState };

  push(chunk: string): ThinkingTagDelta[] {
    this.tail += chunk;
    return this.consume(false);
  }

  flush(): ThinkingTagDelta[] {
    return this.consume(true);
  }

  private findNextTag(): TagMatch | null {
    const scanner = createCodeRegionScanner(this.codeState);
    const { regions } = scanner.scan(this.tail);

    const re = new RegExp(THINKING_TAG_RE.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.tail)) !== null) {
      if (!isInsideCode(match.index, regions)) {
        return { index: match.index, text: match[0], isClose: match[1] === "/" };
      }
    }
    return null;
  }

  private advanceTail(to: number): void {
    this.codeState = getCodeStateAt(this.tail, to, this.codeState);
    this.tail = this.tail.slice(to);
  }

  private reset(): void {
    this.tail = "";
    this.thinkingDepth = 0;
    this.codeState = { ...closedCodeRegionState };
  }

  private consume(final: boolean): ThinkingTagDelta[] {
    const deltas: ThinkingTagDelta[] = [];

    const emit = (type: "text" | "thinking", text: string) => {
      if (!text) return;
      const last = deltas[deltas.length - 1];
      if (last && last.type === type) {
        last.text += text;
        return;
      }
      deltas.push({ type, text });
    };

    while (true) {
      const tag = this.findNextTag();

      if (!tag) {
        if (this.thinkingDepth > 0) {
          if (final) {
            emit("thinking", this.tail);
            this.reset();
          } else {
            const keepFrom = findIncompleteTagPrefix(this.tail);
            if (keepFrom > 0) {
              emit("thinking", this.tail.slice(0, keepFrom));
              this.advanceTail(keepFrom);
            } else if (keepFrom === -1) {
              emit("thinking", this.tail);
              this.advanceTail(this.tail.length);
            }
          }
        } else {
          if (final) {
            emit("text", this.tail);
            this.reset();
          } else {
            const keepFrom = findIncompleteTagPrefix(this.tail);
            if (keepFrom > 0) {
              emit("text", this.tail.slice(0, keepFrom));
              this.advanceTail(keepFrom);
            } else if (keepFrom === -1) {
              emit("text", this.tail);
              this.advanceTail(this.tail.length);
            }
          }
        }
        return deltas;
      }

      const before = this.tail.slice(0, tag.index);
      const afterStart = tag.index + tag.text.length;

      if (tag.isClose && this.thinkingDepth === 0) {
        if (before.trim().length > 0 && this.tail.slice(afterStart).trim().length > 0) {
          this.advanceTail(afterStart);
        } else {
          emit("text", before);
          this.advanceTail(afterStart);
        }
        continue;
      }

      if (this.thinkingDepth === 0) {
        emit("text", before);
        this.thinkingDepth = 1;
        this.advanceTail(afterStart);
      } else {
        if (tag.isClose) {
          this.thinkingDepth -= 1;
          if (this.thinkingDepth === 0) {
            emit("thinking", before);
            this.advanceTail(afterStart);
          } else {
            this.tail = this.tail.slice(0, tag.index) + this.tail.slice(afterStart);
          }
        } else {
          this.thinkingDepth += 1;
          this.tail = this.tail.slice(0, tag.index) + this.tail.slice(afterStart);
        }
      }
    }
  }
}

export function partitionThinkingTags(text: string): ThinkingTagDelta[] {
  const partitioner = new ThinkingTagPartitioner();
  return [...partitioner.push(text), ...partitioner.flush()];
}
