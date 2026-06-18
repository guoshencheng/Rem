import { describe, it, expect } from "vitest";
import { StreamCollector, type StreamChunk } from "../src/llm/types.js";
import { createThinkingTagPartitioner } from "../src/shared/text/thinking-tag-partitioner.js";

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

function* parseOpenAIChunk(
  chunk: { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string }>; usage?: unknown },
  pending: Map<number, PendingToolCall>,
): Generator<StreamChunk> {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;

  if (delta?.content && typeof delta.content === 'string') {
    yield { type: 'text', text: delta.content };
  }

  if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
      const index = (tc.index as number) ?? 0;
      let current = pending.get(index);
      if (!current) {
        current = { id: (tc.id as string) ?? '', name: '', arguments: '' };
        pending.set(index, current);
      }
      if (tc.id) current.id = tc.id as string;
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn?.name) current.name += fn.name as string;
      if (fn?.arguments) current.arguments += fn.arguments as string;
    }
  }

  if (finishReason === 'tool_calls' || finishReason === 'stop') {
    for (const pc of pending.values()) {
      if (!pc.name) continue;
      yield { type: 'tool-call', toolCallId: pc.id, toolName: pc.name, input: safeJsonParse(pc.arguments || '{}') };
    }
    pending.clear();
  }

  if (chunk.usage && typeof chunk.usage === 'object') {
    const u = chunk.usage as Record<string, number>;
    yield { type: 'usage', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 };
  }
}

describe("MiniMax M3 trace", () => {
  it("parses empty assistant delta (no content)", () => {
    const pending = new Map<number, PendingToolCall>();
    const chunks = Array.from(parseOpenAIChunk(
      { choices: [{ delta: { role: "assistant" } }] },
      pending,
    ));
    expect(chunks).toHaveLength(0);
  });

  it("parses stop finish with no pending tool calls", () => {
    const pending = new Map<number, PendingToolCall>();
    const chunks = Array.from(parseOpenAIChunk(
      { choices: [{ delta: { role: "assistant" }, finish_reason: "stop" }] },
      pending,
    ));
    expect(chunks).toHaveLength(0);
  });

  it("parses thinking content from 3 MiniMax deltas", () => {
    const pending = new Map<number, PendingToolCall>();
    const allChunks: StreamChunk[] = [];

    // Delta 1: opening think tag
    for (const c of parseOpenAIChunk({
      choices: [{ delta: { content: "<think>\nThe user is asking me to look", role: "assistant", name: "MiniMax AI", audio_content: "" } }],
    }, pending)) allChunks.push(c);

    // Delta 2: middle of thinking
    for (const c of parseOpenAIChunk({
      choices: [{ delta: { content: " at documents in a specific directory and choose one to summarize. However, I don't have access to file systems or the ability to view files on the", role: "assistant", name: "MiniMax AI", audio_content: "" } }],
    }, pending)) allChunks.push(c);

    // Delta 3: close think tag, finish=length
    for (const c of parseOpenAIChunk({
      choices: [{ delta: { content: " user's computer. I should let the user know that I cannot access\n</think>\n", role: "assistant", name: "MiniMax AI", audio_content: "" }, finish_reason: "length" }],
    }, pending)) allChunks.push(c);

    // All should be text type
    const textChunks = allChunks.filter(c => c.type === 'text');
    expect(textChunks.length).toBe(3);
    expect(textChunks[0].text).toContain("<think>");
    expect(textChunks[2].text).toContain("</think>");
  });

  it("partitions <think> tags into reasoning deltas", () => {
    // Simulate the full stream through the partitioner
    const partitioner = createThinkingTagPartitioner();
    const allDeltas: StreamChunk[] = [];

    function* mapDeltas(deltas: ReturnType<typeof partitioner.push>) {
      for (const d of deltas) {
        if (!d.text) continue;
        if (d.type === 'thinking') yield { type: 'reasoning' as const, text: d.text };
        else yield { type: 'text' as const, text: d.text };
      }
    }

    // Feed the 3 text chunks through the partitioner
    const texts = [
      "<think>\nThe user is asking me to look",
      " at documents in a specific directory and choose one to summarize.",
      "\n</think>\nHello, I can help you with that.",
    ];

    for (const text of texts) {
      for (const c of mapDeltas(partitioner.push(text))) {
        allDeltas.push(c);
      }
    }
    for (const c of mapDeltas(partitioner.flush())) {
      allDeltas.push(c);
    }

    const reasoningChunks = allDeltas.filter(c => c.type === 'reasoning');
    const textChunks = allDeltas.filter(c => c.type === 'text');

    expect(reasoningChunks.length).toBeGreaterThanOrEqual(1);
    expect(textChunks.length).toBeGreaterThanOrEqual(1);
    expect(reasoningChunks.map(r => r.text).join('')).toContain("The user is asking me to look");
    expect(textChunks.map(t => t.text).join('')).toContain("Hello");
  });

  it("full pipeline: parse + partition + collect with MiniMax data", () => {
    const pending = new Map<number, PendingToolCall>();
    const partitioner = createThinkingTagPartitioner();
    const collector = new StreamCollector();

    function* mapDeltas(deltas: ReturnType<typeof partitioner.push>) {
      for (const d of deltas) {
        if (!d.text) continue;
        if (d.type === 'thinking') yield { type: 'reasoning' as const, text: d.text };
        else yield { type: 'text' as const, text: d.text };
      }
    }

    // Exact MiniMax deltas from debug log
    const miniMaxChunks: Array<{ choices: Array<{ delta: Record<string, unknown>; finish_reason?: string }> }> = [
      // Delta 1
      { choices: [{ delta: { content: "<think>\nThe user is asking me to look", role: "assistant", name: "MiniMax AI", audio_content: "" } }] },
      // Delta 2
      { choices: [{ delta: { content: " at documents in a specific directory and choose one to summarize. However, I don't have access to file systems or the ability to view files on the", role: "assistant", name: "MiniMax AI", audio_content: "" } }] },
      // Delta 3
      { choices: [{ delta: { content: " user's computer. I should let the user know that I cannot access\n</think>\n", role: "assistant", name: "MiniMax AI", audio_content: "" }, finish_reason: "length" }] },
    ];

    for (const chunk of miniMaxChunks) {
      for (const sc of parseOpenAIChunk(chunk, pending)) {
        if (sc.type === 'text') {
          for (const c of mapDeltas(partitioner.push(sc.text))) {
            collector.feed(c);
          }
        } else {
          for (const c of mapDeltas(partitioner.flush())) {
            collector.feed(c);
          }
          collector.feed(sc);
        }
      }
    }
    // flush remaining and feed finish
    for (const c of mapDeltas(partitioner.flush())) {
      collector.feed(c);
    }
    // Also feed the finish chunk (the openai provider appends it after the stream)
    collector.feed({ type: 'finish', reason: 'length' });

    const result = collector.result();

    // Should have reasoning content
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning!.length).toBeGreaterThan(10);
    expect(result.reasoning).toContain("The user is asking me to look");

    // Text should be empty or just whitespace (everything was inside <think>)
    console.log("text:", JSON.stringify(result.text));
    console.log("reasoning:", JSON.stringify(result.reasoning?.slice(0, 100)));
    console.log("finishReason:", result.finishReason);

    // The key check: we MUST have either text or reasoning
    const hasContent = (result.reasoning?.trim().length ?? 0) > 0 || result.text.trim().length > 0;
    expect(hasContent).toBe(true);
  });

  it("pushes thinking content immediately during streaming (incremental emit)", () => {
    const partitioner = createThinkingTagPartitioner();
    function* map(deltas: ReturnType<typeof partitioner.push>) {
      for (const d of deltas) { if (!d.text) continue; yield d; }
    }
    const deltas = [...map(partitioner.push("<think>\ncontent here"))];
    // The partitioner emits thinking content incrementally so the TUI can
    // stream it — it does NOT wait for flush.
    expect(deltas).toHaveLength(1);
    expect(deltas[0].type).toBe("thinking");
    expect(deltas[0].text).toContain("content here");
  });

  it("collector stores finish reason", () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'text', text: 'hi' });
    collector.feed({ type: 'finish', reason: 'length' });
    const result = collector.result();
    expect(result.finishReason).toBe('length');
  });
});
