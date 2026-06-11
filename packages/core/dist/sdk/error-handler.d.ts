export type ErrorCategory = 'api_error' | 'invalid_response' | 'planning_only' | 'reasoning_only' | 'empty_response' | 'tool_error' | 'timeout' | 'unknown';
export interface ErrorHandler {
    classify(error: unknown): ErrorCategory;
    isRetryable(category: ErrorCategory): boolean;
    getRetryInstruction(category: ErrorCategory): string | undefined;
}
//# sourceMappingURL=error-handler.d.ts.map