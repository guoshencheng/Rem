import type { SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { BaseSessionProvider } from '../base.js';

export interface FileSessionProviderOptions {
  dir: string;
}

export class FileSessionProvider extends BaseSessionProvider {
  constructor(dir: string) {
    super(dir);
  }

  async list(): Promise<SessionSummary[]> {
    return this.store.listSummaries();
  }
}

export function createProvider(options: FileSessionProviderOptions | undefined): FileSessionProvider {
  if (!options?.dir) {
    throw new Error('FileSessionProvider requires dir');
  }
  return new FileSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FileSessionProviderOptions {
  return { dir: ctx.sessionsDir };
}
