import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { CredentialStore } from '../src/local/credential-store.js';

describe('CredentialStore', () => {
  it('save/load/clear round-trip', async () => {
    const store = new CredentialStore(`cred-test-${Math.random().toString(36).slice(2)}`);
    expect(await store.load()).toBeNull();
    await store.save({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' });
    const loaded = await store.load();
    expect(loaded?.provider).toBe('anthropic');
    expect(loaded?.apiKey).toBe('sk-test');
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
