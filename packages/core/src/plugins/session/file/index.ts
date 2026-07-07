import type { SessionSummary } from '../../../sdk/session-provider.js';
import { BaseSessionProvider } from '../base.js';

export class FileSessionProvider extends BaseSessionProvider {
  constructor(dir: string) {
    super(dir);
  }

  async list(): Promise<SessionSummary[]> {
    return this.store.listSummaries();
  }
}
