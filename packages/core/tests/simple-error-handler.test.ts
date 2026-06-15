import { describe, it, expect } from 'vitest';
import { SimpleErrorHandler } from '../src/defaults/simple-error-handler.js';
import { APICallError } from 'ai';

describe('SimpleErrorHandler', () => {
  const handler = new SimpleErrorHandler();

  it('should classify APICallError as api_error', () => {
    const error = new APICallError({ message: 'rate limit', url: 'http://test', requestBodyValues: {} });
    expect(handler.classify(error)).toBe('api_error');
  });

  it('should classify generic Error as unknown', () => {
    expect(handler.classify(new Error('oops'))).toBe('unknown');
  });

  it('should classify string as unknown', () => {
    expect(handler.classify('string error')).toBe('unknown');
  });

  it('should mark api_error as retryable', () => {
    expect(handler.isRetryable('api_error')).toBe(true);
  });

  it('should mark unknown as not retryable', () => {
    expect(handler.isRetryable('unknown')).toBe(false);
  });

  it('should return undefined retry instruction for all categories', () => {
    expect(handler.getRetryInstruction('api_error')).toBeUndefined();
    expect(handler.getRetryInstruction('planning_only')).toBeUndefined();
  });
});
