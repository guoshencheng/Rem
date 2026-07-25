import { useCallback, useEffect, useState } from 'react';
import { LocalAgentService, CredentialStore } from 'rem-agent-bridge/local';
import type { CustomTool, Provider, ProviderCredential } from 'rem-agent-bridge/local';

export interface UseLocalAgentServiceOptions {
  tools?: CustomTool[];
  maxTurns?: number;
  customProviders?: Provider[];
}

export interface LocalAgentServiceState {
  store: CredentialStore;
  credential: ProviderCredential | null;
  service: LocalAgentService | null;
  loading: boolean;
  error: string | null;
  settingsOpen: boolean;
  setSettingsOpen(open: boolean): void;
  handleSave(c: ProviderCredential): Promise<void>;
  retry(): void;
}

/** RemLocalApp / RemLocalChat 共用：凭据加载 + LocalAgentService 装配。 */
export function useLocalAgentService(options: UseLocalAgentServiceOptions = {}): LocalAgentServiceState {
  const { tools, maxTurns, customProviders } = options;
  const [store] = useState(() => new CredentialStore());
  const [credential, setCredential] = useState<ProviderCredential | null>(null);
  const [service, setService] = useState<LocalAgentService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    store.load().then((c) => {
      setCredential(c);
      setLoading(false);
      // 旧版本可能存过没有 model 的凭据，直接打开设置页补全
      if (c && !c.model) {
        setSettingsOpen(true);
      }
    }).catch(() => setLoading(false));
  }, [store]);

  useEffect(() => {
    if (!credential) {
      setService(null);
      return;
    }
    const svc = new LocalAgentService({ credential, tools, maxTurns, customProviders });
    let cancelled = false;
    svc.init().then(() => {
      if (!cancelled) {
        setService(svc);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [credential, tools, maxTurns, customProviders]);

  const handleSave = useCallback(async (c: ProviderCredential) => {
    await store.save(c);
    setCredential(c);
    setSettingsOpen(false);
  }, [store]);

  const retry = useCallback(() => {
    setError(null);
    setCredential((c) => (c ? { ...c } : c));
  }, []);

  return { store, credential, service, loading, error, settingsOpen, setSettingsOpen, handleSave, retry };
}
