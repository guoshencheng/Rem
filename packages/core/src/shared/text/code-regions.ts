export interface CodeRegion {
  start: number;
  end: number;
}

export interface CodeRegionState {
  inlineOpen: boolean;
  inlineTicks: number;
  fenceOpen: boolean;
  fenceMarker: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const closedCodeRegionState: CodeRegionState = {
  inlineOpen: false,
  inlineTicks: 0,
  fenceOpen: false,
  fenceMarker: "",
};

export function findCodeRegions(text: string): CodeRegion[] {
  const scanner = createCodeRegionScanner();
  return scanner.scan(text).regions;
}

export function getCodeStateAt(
  text: string,
  index: number,
  initialState: CodeRegionState = closedCodeRegionState,
): CodeRegionState {
  const scanner = createCodeRegionScanner(initialState);
  return scanner.scanTo(text, index);
}

export function createCodeRegionScanner(initialState: CodeRegionState = closedCodeRegionState) {
  let state: CodeRegionState = { ...initialState };

  function scan(text: string): { regions: CodeRegion[]; nextState: CodeRegionState } {
    const regions: CodeRegion[] = [];
    let i = 0;

    while (i < text.length) {
      const step = processNext(text, i, regions, text.length);
      if (step.done) {
        break;
      }
      i = step.nextIndex;
    }

    return { regions, nextState: { ...state } };
  }

  function scanTo(text: string, stopAt: number): CodeRegionState {
    const regions: CodeRegion[] = [];
    let i = 0;

    while (i < Math.min(text.length, stopAt)) {
      const step = processNext(text, i, regions, stopAt);
      if (step.done) {
        break;
      }
      i = step.nextIndex;
    }

    return { ...state };
  }

  function processNext(
    text: string,
    i: number,
    regions: CodeRegion[],
    stopAt: number,
  ): { done: true } | { done: false; nextIndex: number } {
    if (state.fenceOpen) {
      const rest = text.slice(i, stopAt);
      const closeRe = new RegExp(
        `(?:^|\\n)${escapeRegex(state.fenceMarker)}[^\\S\\r\\n]*(?:\\r?\\n|$)`,
        "g",
      );
      const match = closeRe.exec(rest);
      if (match) {
        const end = i + match.index + match[0].length;
        regions.push({ start: i, end });
        state = { ...closedCodeRegionState };
        return { done: false, nextIndex: end };
      }
      regions.push({ start: i, end: stopAt });
      return { done: true };
    }

    if (state.inlineOpen) {
      const closeRe = new RegExp(`\`{${state.inlineTicks}}`);
      const rest = text.slice(i, stopAt);
      const match = closeRe.exec(rest);
      if (match) {
        const end = i + match.index + match[0].length;
        regions.push({ start: i, end });
        state = { ...closedCodeRegionState };
        return { done: false, nextIndex: end };
      }
      regions.push({ start: i, end: stopAt });
      return { done: true };
    }

    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart) {
      const fenceMatch = text.slice(i, stopAt).match(/^(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (marker.length >= 3) {
          const afterFence = i + fenceMatch[0].length;
          const rest = text.slice(afterFence, stopAt);
          const closeRe = new RegExp(
            `(?:^|\\n)${escapeRegex(marker)}[^\\S\\r\\n]*(?:\\r?\\n|$)`,
            "g",
          );
          const closeMatch = closeRe.exec(rest);
          if (closeMatch) {
            const end = afterFence + closeMatch.index + closeMatch[0].length;
            regions.push({ start: i, end });
            return { done: false, nextIndex: end };
          }
          state = { fenceOpen: true, fenceMarker: marker, inlineOpen: false, inlineTicks: 0 };
          regions.push({ start: i, end: stopAt });
          return { done: true };
        }
      }
    }

    if (text[i] === "`") {
      const tickStart = i;
      let tickCount = 0;
      while (i < stopAt && text[i] === "`") {
        tickCount += 1;
        i += 1;
      }
      const rest = text.slice(i, stopAt);
      const closeRe = new RegExp(`\`{${tickCount}}`);
      const match = closeRe.exec(rest);
      if (match) {
        const end = i + match.index + match[0].length;
        regions.push({ start: tickStart, end });
        return { done: false, nextIndex: end };
      }
      state = { inlineOpen: true, inlineTicks: tickCount, fenceOpen: false, fenceMarker: "" };
      regions.push({ start: tickStart, end: stopAt });
      return { done: true };
    }

    return { done: false, nextIndex: i + 1 };
  }

  return {
    scan,
    scanTo,
    getState: () => ({ ...state }),
    reset: () => {
      state = { ...closedCodeRegionState };
    },
  };
}

export function isInsideCode(index: number, regions: CodeRegion[]): boolean {
  for (const region of regions) {
    if (index >= region.start && index < region.end) {
      return true;
    }
  }
  return false;
}
