export { type ModelMessage, type LanguageModelUsage } from 'ai';
export interface UserInput {
    content: string;
    timestamp?: Date;
}
export interface AgentOutput {
    content: string;
    completed: boolean;
}
export type AgentStatus = 'idle' | 'running' | 'error';
export interface ToolCallRecord {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: {
        success: boolean;
        output: string;
        error?: string;
        durationMs: number;
    };
    error?: string;
    durationMs: number;
    timestamp: Date;
}
//# sourceMappingURL=types.d.ts.map