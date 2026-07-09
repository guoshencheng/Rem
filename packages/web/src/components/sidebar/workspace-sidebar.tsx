'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Menu, X, ChevronRight, ChevronDown, Trash2, Folder, MessageSquarePlus } from 'lucide-react';
import { SessionList } from './session-list';
import type { SessionSummary } from '@/lib/use-agents';
import type { Workspace } from 'rem-agent-bridge';

interface WorkspaceSidebarProps {
  workspaces: Workspace[];
  activeWorkspace: string | null;
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSelectWorkspace(path: string): void;
  onAddWorkspace(): void;
  onRemoveWorkspace(path: string): void;
  onSwitchSession(id: string): void;
  onCreateSession(workspace: string): void;
  onDeleteSession(id: string): void;
  onSearch(query: string): void;
}

export function WorkspaceSidebar({
  workspaces,
  activeWorkspace,
  sessions,
  currentSessionId,
  onSelectWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onSearch,
}: WorkspaceSidebarProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-expand when active workspace changes from outside
  useEffect(() => {
    if (activeWorkspace) {
      setExpandedWorkspace(activeWorkspace);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, onSearch]);

  const handleWorkspaceClick = (wsPath: string) => {
    if (wsPath === activeWorkspace) {
      // Toggle expand/collapse for active workspace
      setExpandedWorkspace((prev) => prev === wsPath ? null : wsPath);
    } else {
      // Select and expand new workspace
      onSelectWorkspace(wsPath);
      setExpandedWorkspace(wsPath);
    }
  };

  const sidebar = (
    <div className="flex flex-col h-full bg-sb border-r border-bd w-64 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-bd">
        <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-bd">
          <X size={16} className="text-tx2" />
        </button>
        <span className="text-sm font-semibold text-tx">Rem Agent</span>
      </div>

      {/* Add Workspace */}
      <div className="px-3 py-2">
        <button
          onClick={() => { onAddWorkspace(); setOpen(false); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn bg-ac text-ac-ink text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> Add Workspace
        </button>
      </div>

      {/* Search */}
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

      {/* Workspace + Session tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {workspaces.map((ws) => {
          const isActive = ws.path === activeWorkspace;
          const isExpanded = ws.path === expandedWorkspace;
          return (
            <div key={ws.path}>
              {/* Workspace row */}
              <div
                className={`group flex items-center gap-1 px-2 py-1.5 mx-2 rounded-btn cursor-pointer text-xs transition-colors ${isActive ? 'bg-card border-l-2 border-ac' : 'hover:bg-card/50'}`}
                onClick={() => handleWorkspaceClick(ws.path)}
              >
                {isExpanded ? <ChevronDown size={12} className="text-tx3 flex-shrink-0" /> : <ChevronRight size={12} className="text-tx3 flex-shrink-0" />}
                <Folder size={12} className="text-tx3 flex-shrink-0" />
                <span className={`flex-1 truncate font-medium ${isActive ? 'text-tx' : 'text-tx2'}`}>{ws.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateSession(ws.path); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bd transition-all flex-shrink-0"
                  title="New chat"
                >
                  <MessageSquarePlus size={14} className="text-tx3 hover:text-ac" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveWorkspace(ws.path); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bd transition-all flex-shrink-0"
                  title="Remove workspace"
                >
                  <Trash2 size={12} className="text-tx3 hover:text-err" />
                </button>
              </div>

              {/* Sessions under expanded workspace */}
              {isExpanded && (
                <div className="ml-3 border-l border-bd/50">
                  <SessionList
                    sessions={isActive ? sessions : []}
                    currentSessionId={isActive ? currentSessionId : null}
                    workspace={ws.path}
                    onSwitch={(id) => { onSwitchSession(id); setOpen(false); }}
                    onDelete={onDeleteSession}
                  />
                </div>
              )}
            </div>
          );
        })}

        {workspaces.length === 0 && (
          <div className="px-4 py-8 text-xs text-tx3 text-center">
            No workspaces. Click "Add Workspace" to get started.
          </div>
        )}
      </div>
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
