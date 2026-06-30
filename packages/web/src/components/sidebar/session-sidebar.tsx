'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Menu, X } from 'lucide-react';
import { SessionList } from './session-list';
import type { SessionSummary } from '@/lib/use-agents';

interface SessionSidebarProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSwitch(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
  onSearch(query: string): void;
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSwitch,
  onCreate,
  onDelete,
  onSearch,
}: SessionSidebarProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, onSearch]);

  const sidebar = (
    <div className="flex flex-col h-full bg-sb border-r border-bd w-64 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-bd">
        <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-bd">
          <X size={16} className="text-tx2" />
        </button>
        <span className="text-sm font-semibold text-tx">Rem Agent</span>
      </div>

      <div className="px-3 py-2">
        <button
          onClick={() => { onCreate(); setOpen(false); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn bg-ac text-ac-ink text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> New Chat
        </button>
      </div>

      <div className="px-3 py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-btn bg-card border border-bd2">
          <Search size={14} className="text-tx3 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-xs text-tx placeholder-tx3 outline-none"
          />
        </div>
      </div>

      <SessionList
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitch={onSwitch}
        onDelete={onDelete}
      />
    </div>
  );

  return (
    <>
      <div className="hidden lg:block h-full">{sidebar}</div>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-btn bg-sb border border-bd text-tx2 hover:text-tx"
      >
        <Menu size={18} />
      </button>
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50">{sidebar}</div>
        </>
      )}
    </>
  );
}
