const providers = new Map<string, LLMProvider>();

export interface LLMProvider {
  generate(options: {
    model: string;
    system?: string;
    messages: unknown[];
    tools?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
  stream(options: {
    model: string;
    system?: string;
    messages: unknown[];
    tools?: Record<string, unknown>;
    signal?: AbortSignal;
  }): AsyncGenerator<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number },
    void,
    unknown
  >;
}

export function registerProvider(name: string, provider: LLMProvider): void {
  providers.set(name, provider);
}

export function clearProviders(): void {
  providers.clear();
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}
