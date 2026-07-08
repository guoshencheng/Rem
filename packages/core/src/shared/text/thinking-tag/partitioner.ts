import type { ThinkingTagDelta, TagMatch } from "./types.js";
import { THINKING_TAG_RE } from "./types.js";
import { createCodeRegionScanner, type CodeRegion } from "../code-regions.js";
import { findIncompleteTagPrefix } from "./detection.js";

const TAG_START_RE = new RegExp("^" + THINKING_TAG_RE.source, "i");

interface CodeRegionTracker {
  regions: CodeRegion[];
  openStart: number | null;
}

export class ThinkingTagPartitioner {
  private tail = "";
  private thinkingDepth = 0;
  private codeRegions: CodeRegion[] = [];
  private openRegionStart: number | null = null;
  private scannedTo = 0;
  private searchFrom = 0;

  push(chunk: string): ThinkingTagDelta[] {
    this.tail += chunk;
    this.scanCodeRegions();
    return this.consume(false);
  }

  flush(): ThinkingTagDelta[] {
    return this.consume(true);
  }

  private scanCodeRegions(): void {
    if (this.scannedTo >= this.tail.length) return;

    const slice = this.tail.slice(this.scannedTo);
    const scanner = createCodeRegionScanner();
    const { regions, nextState } = scanner.scan(slice);

    let openStart: number | null = null;
    if (nextState.fenceOpen || nextState.inlineOpen) {
      const last = regions[regions.length - 1];
      if (last) {
        openStart = this.scannedTo + last.start;
      }
    }

    for (const r of regions) {
      this.codeRegions.push({
        start: this.scannedTo + r.start,
        end: this.scannedTo + r.end,
      });
    }

    this.scannedTo = this.tail.length;
    this.openRegionStart = openStart;
  }

  private isInsideCode(idx: number): boolean {
    if (this.openRegionStart !== null && idx >= this.openRegionStart) {
      return true;
    }
    for (const region of this.codeRegions) {
      if (idx >= region.start && idx < region.end) {
        return true;
      }
    }
    return false;
  }

  private advanceTail(to: number): void {
    this.tail = this.tail.slice(to);
    this.scannedTo = Math.max(0, this.scannedTo - to);
    // If the remaining tail starts with '<' we are buffering a possible tag
    // prefix; restart search from the beginning so the next chunk can complete it.
    this.searchFrom = this.tail.startsWith("<") ? 0 : Math.max(0, this.searchFrom - to);
    this.openRegionStart = this.openRegionStart === null ? null : Math.max(0, this.openRegionStart - to);

    const adjusted: CodeRegion[] = [];
    for (const region of this.codeRegions) {
      const start = region.start - to;
      const end = region.end - to;
      if (end <= 0) continue;
      adjusted.push({ start: Math.max(0, start), end });
    }
    this.codeRegions = adjusted;
  }

  private reset(): void {
    this.tail = "";
    this.thinkingDepth = 0;
    this.codeRegions = [];
    this.openRegionStart = null;
    this.scannedTo = 0;
    this.searchFrom = 0;
  }

  private findNextTag(): TagMatch | null {
    while (true) {
      const idx = this.tail.indexOf("<", this.searchFrom);
      if (idx === -1) return null;

      if (!this.isInsideCode(idx)) {
        const slice = this.tail.slice(idx);
        const match = slice.match(TAG_START_RE);
        if (match) {
          const text = match[0];
          this.searchFrom = idx + text.length;
          return { index: idx, text, isClose: match[1] === "/" };
        }
      }

      this.searchFrom = idx + 1;
    }
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
            } else {
              // keepFrom === 0: incomplete tag prefix at the start of tail;
              // reset search so the next chunk can complete and find it.
              this.searchFrom = 0;
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
            } else {
              // keepFrom === 0: incomplete tag prefix at the start of tail;
              // reset search so the next chunk can complete and find it.
              this.searchFrom = 0;
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
            this.searchFrom = Math.max(0, this.searchFrom - tag.text.length);
            this.scannedTo = Math.min(this.scannedTo, this.tail.length);
            this.openRegionStart = null;
          }
        } else {
          this.thinkingDepth += 1;
          this.tail = this.tail.slice(0, tag.index) + this.tail.slice(afterStart);
          this.searchFrom = Math.max(0, this.searchFrom - tag.text.length);
          this.scannedTo = Math.min(this.scannedTo, this.tail.length);
          this.openRegionStart = null;
        }
      }
    }
  }
}

export function partitionThinkingTags(text: string): ThinkingTagDelta[] {
  const partitioner = new ThinkingTagPartitioner();
  return [...partitioner.push(text), ...partitioner.flush()];
}
