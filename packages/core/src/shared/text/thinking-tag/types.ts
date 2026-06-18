export type ThinkingTagDelta =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string };

export interface TagMatch {
  index: number;
  text: string;
  isClose: boolean;
}

export const THINKING_TAG_RE = /<\s*(\/?)\s*(?:[\w-]+:)?\s*(?:think(?:ing)?|thought)\b[^<>]*>/gi;
