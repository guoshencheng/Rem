import { type ToolSet } from 'ai';
import type { ToolProvider, ToolDefinition, ToolCall, ToolResult } from '../sdk/tool-provider.js';
export declare class InMemoryToolProvider implements ToolProvider {
    private tools;
    register(def: ToolDefinition, executor: (input: unknown) => Promise<string>): void;
    getToolSet(): ToolSet;
    execute(calls: ToolCall[]): Promise<ToolResult[]>;
}
//# sourceMappingURL=in-memory-tool-provider.d.ts.map