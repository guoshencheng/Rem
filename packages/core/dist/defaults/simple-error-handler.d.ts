import type { ErrorHandler, ErrorCategory } from '../sdk/error-handler.js';
export declare class SimpleErrorHandler implements ErrorHandler {
    classify(error: unknown): ErrorCategory;
    isRetryable(category: ErrorCategory): boolean;
    getRetryInstruction(): string | undefined;
}
//# sourceMappingURL=simple-error-handler.d.ts.map