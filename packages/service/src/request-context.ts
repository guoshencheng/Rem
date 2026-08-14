import type { RuntimeRequestContext } from 'rem-agent-core';
import { RuntimeError } from 'rem-agent-core';
import type { RuntimeAuthenticator } from './types.js';

export async function authenticateRequest(
  authenticator: RuntimeAuthenticator,
  request: Request,
): Promise<RuntimeRequestContext> {
  try {
    const context = await authenticator.authenticate(request);
    if (!context || typeof context !== 'object') {
      throw new RuntimeError('UNAUTHENTICATED', 'Authentication did not return a request context');
    }
    return context;
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError('UNAUTHENTICATED', 'Authentication failed', false, undefined, { cause: error });
  }
}
