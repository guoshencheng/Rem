import { APICallError } from 'ai';
export class SimpleErrorHandler {
    classify(error) {
        if (error instanceof APICallError)
            return 'api_error';
        return 'unknown';
    }
    isRetryable(category) {
        return category === 'api_error';
    }
    getRetryInstruction() {
        return undefined;
    }
}
//# sourceMappingURL=simple-error-handler.js.map