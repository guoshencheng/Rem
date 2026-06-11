import { APICallError } from 'ai';
import type { ErrorHandler, ErrorCategory } from '../sdk/error-handler.js';

export class SimpleErrorHandler implements ErrorHandler {
  classify(error: unknown): ErrorCategory {
    if (error instanceof APICallError) return 'api_error';
    return 'unknown';
  }

  isRetryable(category: ErrorCategory): boolean {
    return category === 'api_error';
  }

  getRetryInstruction(): string | undefined {
    return undefined;
  }
}
