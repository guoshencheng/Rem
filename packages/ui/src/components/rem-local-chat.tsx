'use client';

import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import type { CustomTool, Provider } from 'rem-agent-bridge/local';
import { RemChat } from './rem-chat';
import { CredentialSetup } from './credential-setup';
import { useLocalAgentService } from '../lib/use-local-agent-service';

export interface RemLocalChatProps {
  /** 指定会话；缺省时自动创建新会话并把 id 写入 URL query（session 参数） */
  sessionId?: string;
  workspace?: string;
  tools?: CustomTool[];
  maxTurns?: number;
  customProviders?: Provider[];
  className?: string;
}

export function RemLocalChat({
  sessionId: sessionIdProp,
  workspace = 'default',
  tools,
  maxTurns,
  customProviders,
  className,
}: RemLocalChatProps) {
  const {
    credential, service, loading, error,
    settingsOpen, setSettingsOpen, handleSave, retry,
  } = useLocalAgentService({ tools, maxTurns, customProviders });
  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);

  // 外部 sessionId 变化时同步
  useEffect(() => {
    if (sessionIdProp) setSessionId(sessionIdProp);
  }, [sessionIdProp]);

  // 无 sessionId：service 就绪后自动创建会话，并写入 URL（刷新后回到同一会话）
  useEffect(() => {
    if (!service || sessionId) return;
    let cancelled = false;
    service.createSession(workspace).then((s) => {
      if (cancelled) return;
      setSessionId(s.sessionId);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('session', s.sessionId);
        window.history.replaceState(null, '', url);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [service, sessionId, workspace]);

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
        <button className="px-3 py-1.5 rounded-btn bg-ac text-ac-ink" onClick={retry}>重试</button>
      </div>
    );
  }

  if (!service || !sessionId) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  return (
    <div className={className ?? 'relative flex h-full'}>
      <RemChat service={service} sessionId={sessionId} workspace={workspace} className="flex h-full flex-1" />
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
