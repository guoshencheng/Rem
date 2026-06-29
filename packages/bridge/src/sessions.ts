import type { SessionProvider, SessionSummary } from 'rem-agent-core';
import { ProviderManager } from 'rem-agent-core';

export class SessionService {
  async list(): Promise<SessionSummary[]> {
    const pm = await ProviderManager.getInstance();
    const sessionProvider = pm.require<SessionProvider>('session');
    return sessionProvider.list();
  }
}
