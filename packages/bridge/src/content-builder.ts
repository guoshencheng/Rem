import type { ContentPart } from 'rem-agent-core';

export function buildPartsFromContent(content: unknown): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content } as ContentPart];
  }
  if (!Array.isArray(content)) return [];
  return content.map((item: Record<string, unknown>) => {
    if (item.type === 'text') return { type: 'text', text: String(item.text ?? '') } as ContentPart;
    if (item.type === 'reasoning') return { type: 'reasoning', text: String(item.text ?? '') } as ContentPart;
    if (item.type === 'tool-call') return {
      type: 'tool-call',
      toolCallId: String(item.toolCallId ?? ''),
      toolName: String(item.toolName ?? ''),
      arguments: (item.input as Record<string, unknown>) ?? {},
      result: item.result ? {
        success: Boolean((item.result as Record<string, unknown>).success),
        output: String((item.result as Record<string, unknown>).output ?? ''),
        error: (item.result as Record<string, unknown>).error as string | undefined,
        durationMs: Number((item.result as Record<string, unknown>).durationMs ?? 0),
      } : undefined,
    } as ContentPart;
    return { type: 'text', text: '' } as ContentPart;
  });
}
