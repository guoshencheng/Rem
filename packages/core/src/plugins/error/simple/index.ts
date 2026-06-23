import type { ErrorHandler, ErrorCategory } from '../../../sdk/error-handler.js';

interface ApiLikeError extends Error {
  name: 'APIError';
  status?: number;
}

function isApiLikeError(error: unknown): error is ApiLikeError {
  if (!(error instanceof Error)) return false;
  const err = error as ApiLikeError;
  return err.name === 'APIError' || typeof err.status === 'number';
}

export class SimpleErrorHandler implements ErrorHandler {
  classify(error: unknown): ErrorCategory {
    if (isApiLikeError(error)) return 'api_error';
    return 'unknown';
  }

  isRetryable(category: ErrorCategory): boolean {
    return category === 'api_error';
  }

  getRetryInstruction(_category: ErrorCategory): string | undefined {
    return undefined;
  }
}

export function createProvider(): SimpleErrorHandler {
  return new SimpleErrorHandler();
}
