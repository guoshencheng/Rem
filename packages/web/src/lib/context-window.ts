export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

export function getContextWindow(_provider?: string, _model?: string): number {
  return DEFAULT_CONTEXT_WINDOW;
}
