import { describe, it, expect } from 'vitest';
import { ServiceError } from 'rem-agent-bridge';
import { toErrorResponse } from '../src/errors.js';

describe('toErrorResponse', () => {
  it('ServiceError 保留 status 与 message', async () => {
    const res = toErrorResponse(new ServiceError('session not found', 404));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session not found' });
  });

  it('SyntaxError 映射为 400', async () => {
    const res = toErrorResponse(new SyntaxError('Unexpected token'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('普通 Error 映射为 500', async () => {
    const res = toErrorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('非 Error 映射为 500 Internal error', async () => {
    const res = toErrorResponse('nope');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
  });
});
