'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { LocalAgentService, CredentialStore } from 'rem-agent-bridge/local';
import type { CustomTool, ProviderCredential } from 'rem-agent-bridge/local';
import { RemApp } from './rem-app';
import { CredentialSetup } from './credential-setup';

export interface RemLocalAppProps {
  tools?: CustomTool[];
  maxTurns?: number;
  className?: string;
}

export function RemLocalApp({ tools, maxTurns, className }: RemLocalAppProps) {
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
    }).catch(() => setLoading(false));
  }, [store]);

  useEffect(() => {
    if (!credential) {
      setService(null);
      return;
    }
    const svc = new LocalAgentService({ credential, tools, maxTurns });
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
  }, [credential, tools, maxTurns]);

  const handleSave = useCallback(async (c: ProviderCredential) => {
    await store.save(c);
    setCredential(c);
    setSettingsOpen(false);
  }, [store]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  if (!credential || settingsOpen) {
    return (
      <div className="flex h-full items-center justify-center">
        <CredentialSetup
          initial={credential}
          onSave={handleSave}
          onCancel={credential ? () => setSettingsOpen(false) : undefined}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-err">初始化失败：{error}</p>
        <button
          className="px-3 py-1.5 rounded-btn bg-ac text-ac-ink"
          onClick={() => { setError(null); setCredential({ ...credential }); }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!service) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  return (
    <div className={className ?? 'relative flex h-full'}>
      <RemApp service={service} className="flex h-full flex-1" />
      <button
        aria-label="settings"
        className="absolute top-2 right-2 z-40 p-1.5 rounded-btn text-tx3 hover:text-tx hover:bg-card transition-colors"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
