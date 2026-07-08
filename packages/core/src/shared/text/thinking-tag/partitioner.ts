import type { ThinkingTagDelta } from "./types.js";

const TAG_NAMES = ["think", "thinking", "thought"] as const;

interface CodeBlock {
  fenceMarker: string | null;
  inlineTicks: number;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isWord(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 95 ||
    c === 45
  );
}

/** Check if any known tag name starts with `prefix` (case-insensitive). */
function anyTagStartsWith(prefix: string): boolean {
  const lower = prefix.toLowerCase();
  for (const name of TAG_NAMES) {
    if (name.startsWith(lower)) return true;
  }
  return false;
}

/** Check if `name` equals a known tag name (case-insensitive). */
function isTagName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const n of TAG_NAMES) {
    if (lower === n) return true;
  }
  return false;
}

// ---- tag parsing result ----

/** Tag fully parsed and matched. */
interface TagMatch {
  kind: "match";
  isClose: boolean;
  endIdx: number;
}
/** Tag fully parsed but does NOT match any known name. */
interface TagNoMatch {
  kind: "no-match";
}
/** The `<` starts something that COULD become a tag but `>` is not yet in the buffer. */
interface TagNeedMore {
  kind: "need-more";
}

type TagResult = TagMatch | TagNoMatch | TagNeedMore;

export class ThinkingTagPartitioner {
  private tail = "";
  private thinkingDepth = 0;
  private code: CodeBlock = { fenceMarker: null, inlineTicks: 0 };

  push(chunk: string): ThinkingTagDelta[] {
    this.tail += chunk;
    return this.consume(false);
  }

  flush(): ThinkingTagDelta[] {
    return this.consume(true);
  }

  // ---- consume ----

  private consume(final: boolean): ThinkingTagDelta[] {
    const deltas: ThinkingTagDelta[] = [];
    let out = "";

    const emit = () => {
      if (!out) return;
      const type = this.thinkingDepth > 0 ? "thinking" : "text";
      const last = deltas[deltas.length - 1];
      if (last && last.type === type) {
        last.text += out;
      } else {
        deltas.push({ type, text: out });
      }
      out = "";
    };

    let i = 0;

    loop: while (i < this.tail.length) {
      // --- fenced code block ---
      if (this.code.fenceMarker) {
        const close = "\n" + this.code.fenceMarker;
        const idx = this.tail.indexOf(close, i);
        if (idx !== -1) {
          out += this.tail.slice(i, idx + close.length);
          i = idx + close.length;
          this.code.fenceMarker = null;
          continue;
        }
        out += this.tail.slice(i);
        i = this.tail.length;
        this.code.fenceMarker = null; // final flush
        continue;
      }

      // --- inline code ---
      if (this.code.inlineTicks > 0) {
        const close = "`".repeat(this.code.inlineTicks);
        const idx = this.tail.indexOf(close, i);
        if (idx !== -1) {
          out += this.tail.slice(i, idx + close.length);
          i = idx + close.length;
          this.code.inlineTicks = 0;
          continue;
        }
        out += this.tail.slice(i);
        i = this.tail.length;
        continue;
      }

      const ch = this.tail[i];

      // --- fence open ---
      if ((i === 0 || this.tail[i - 1] === "\n") && (ch === "`" || ch === "~")) {
        const m = this.tail.slice(i).match(/^(```+|~~~+)/);
        if (m && m[1].length >= 3) {
          emit();
          const marker = m[1];
          const after = i + marker.length;
          const rest = this.tail.slice(after);
          const closeRe = new RegExp(
            "(?:^|\\n)" +
              marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "[^\\S\\r\\n]*(?:\\r?\\n|$)",
          );
          const cm = closeRe.exec(rest);
          if (cm) {
            const end = after + cm.index + cm[0].length;
            out += this.tail.slice(i, end);
            i = end;
            continue;
          }
          this.code.fenceMarker = marker;
          out += this.tail.slice(i, after);
          i = after;
          continue;
        }
      }

      // --- inline code open ---
      if (ch === "`") {
        let ticks = 0;
        let j = i;
        while (j < this.tail.length && this.tail[j] === "`") {
          ticks++;
          j++;
        }
        const close = "`".repeat(ticks);
        const end = this.tail.indexOf(close, j);
        if (end !== -1) {
          out += this.tail.slice(i, end + close.length);
          i = end + close.length;
          continue;
        }
        this.code.inlineTicks = ticks;
        out += this.tail.slice(i, j);
        i = j;
        continue;
      }

      // --- possible tag ---
      if (ch === "<") {
        const result = this.parseTag(i);

        if (result.kind === "need-more") {
          // Stop here; keep everything from i for the next chunk.
          if (!final) break loop;
          // On final flush, emit the remaining tail as literal text.
          out += this.tail.slice(i);
          i = this.tail.length;
          continue;
        }

        if (result.kind === "no-match") {
          // This <...> is not a thinking tag — emit as regular text.
          out += ch;
          i++;
          continue;
        }

        // kind === "match"

        if (result.isClose && this.thinkingDepth === 0) {
          // Orphan close tag: if there's visible text AFTER the tag,
          // the accumulated text before it is leaked reasoning → drop it.
          const after = this.tail.slice(result.endIdx);
          out = "";
          emit();
          if (after.trim().length > 0) {
            i = result.endIdx;
            continue;
          }
          i = result.endIdx;
          continue;
        }

        emit();

        if (result.isClose) {
          this.thinkingDepth = Math.max(0, this.thinkingDepth - 1);
        } else {
          this.thinkingDepth++;
        }
        i = result.endIdx;
        continue;
      }

      // --- regular char ---
      out += ch;
      i++;
    }

    emit();

    // Keep unprocessed tail for next chunk.
    if (i < this.tail.length) {
      this.tail = this.tail.slice(i);
    } else {
      this.tail = "";
    }

    return deltas;
  }

  // ---- tag parsing ----

  /**
   * Attempt to parse a complete thinking-tag starting at `startIdx` (the '<').
   *
   * Returns:
   * - `{ kind: "match", isClose, endIdx }` — recognised thinking tag.
   * - `{ kind: "no-match" }` — definitely NOT a thinking tag (emit '<' as text).
   * - `{ kind: "need-more" }` — partial content that could still become a tag;
   *   we must wait for the next chunk.
   */
  private parseTag(startIdx: number): TagResult {
    const slice = this.tail.slice(startIdx);
    // Find the closing '>'
    const gtIdx = slice.indexOf(">");
    if (gtIdx === -1) {
      // No '>' yet — check if partial content could still become a tag.
      return this.couldBePartialTag(slice.slice(1));
    }

    // We have a complete <...> span.
    const full = slice.slice(0, gtIdx + 1); // includes '>'
    const inner = slice.slice(1, gtIdx); // between '<' and '>'

    // Parse: [whitespace] [optional /] [whitespace] [optional ns:] name [rest]
    let pos = 0;
    // skip whitespace
    while (pos < inner.length && isSpace(inner[pos])) pos++;
    // optional slash
    const isClose = pos < inner.length && inner[pos] === "/";
    if (isClose) pos++;
    // skip whitespace after slash
    while (pos < inner.length && isSpace(inner[pos])) pos++;
    // optional namespace prefix
    let nameStart = pos;
    while (pos < inner.length && isWord(inner[pos])) pos++;
    if (pos < inner.length && inner[pos] === ":") {
      pos++;
      nameStart = pos;
      while (pos < inner.length && isWord(inner[pos])) pos++;
    }

    const namePart = inner.slice(nameStart, pos);

    if (isTagName(namePart)) {
      return { kind: "match", isClose, endIdx: startIdx + gtIdx + 1 };
    }

    return { kind: "no-match" };
  }

  /**
   * Check if the text after '<' could still become a thinking tag once more
   * data arrives. We look for the pattern: [ws] [/] [ws] [ns:] name...
   */
  private couldBePartialTag(afterLt: string): TagResult {
    if (afterLt.length === 0) return { kind: "need-more" };

    let pos = 0;
    // whitespace is allowed
    while (pos < afterLt.length && isSpace(afterLt[pos])) pos++;
    if (pos >= afterLt.length) return { kind: "need-more" };

    // optional slash
    if (afterLt[pos] === "/") pos++;
    if (pos >= afterLt.length) return { kind: "need-more" };

    // whitespace after slash
    while (pos < afterLt.length && isSpace(afterLt[pos])) pos++;
    if (pos >= afterLt.length) return { kind: "need-more" };

    // optional namespace
    let nsEnd = pos;
    while (nsEnd < afterLt.length && isWord(afterLt[nsEnd])) nsEnd++;
    if (nsEnd < afterLt.length && afterLt[nsEnd] === ":") {
      pos = nsEnd + 1;
      if (pos >= afterLt.length) return { kind: "need-more" };
    }

    // Read the tag name prefix
    return anyTagStartsWith(afterLt.slice(pos)) ? { kind: "need-more" } : { kind: "no-match" };
  }
}

export function partitionThinkingTags(text: string): ThinkingTagDelta[] {
  const partitioner = new ThinkingTagPartitioner();
  return [...partitioner.push(text), ...partitioner.flush()];
}
