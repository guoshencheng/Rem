'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { MoreHorizontal, Pin, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/lib/use-agents';
import type { SessionActivity } from 'rem-agent-bridge';

function activityDot(activity?: SessionActivity) {
  switch (activity) {
    case 'pending':
      return <span className="w-1.5 h-1.5 rounded-full bg-tx3 animate-pulse flex-shrink-0" />;
    case 'thinking':
      return <span className="w-1.5 h-1.5 rounded-full bg-ac animate-pulse flex-shrink-0" />;
    case 'calling-function':
      return <span className="w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" />;
    case 'outputting':
      return <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />;
    default:
      return <span className="w-1.5 h-1.5 rounded-full bg-tx3/50 flex-shrink-0" />;
  }
}

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onSwitch(id: string): void;
  onDelete(id: string): void;
}

async function updateSession(id: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function SessionItem({ session, isActive, onSwitch, onDelete }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title ?? 'New Chat');
  const [pinned, setPinned] = useState(session.pinned ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleRename = () => {
    const trimmed = title.trim();
    if (trimmed) {
      updateSession(session.sessionId, { title: trimmed }).catch(() => {});
    }
    setEditing(false);
  };

  const handleTogglePin = () => {
    const newPinned = !pinned;
    setPinned(newPinned);
    updateSession(session.sessionId, { pinned: newPinned }).catch(() => {
      setPinned(!newPinned);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 cursor-pointer text-sm rounded-btn mx-2 transition-colors',
        isActive ? 'bg-card border-l-2 border-ac' : 'hover:bg-card/50',
      )}
      onClick={() => onSwitch(session.sessionId)}
    >
      {activityDot(session.activity)}
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bd border border-bd2 rounded px-2 py-0.5 text-xs text-tx outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-tx2 group-hover:text-tx transition-colors">
          {title}
        </span>
      )}

      {pinned && <Pin size={10} className="text-ac flex-shrink-0" />}

      {!editing && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bd transition-all"
          >
            <MoreHorizontal size={14} className="text-tx3" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-card border border-bd rounded-btn shadow-lg py-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleTogglePin(); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pin size={12} /> {pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pencil size={12} /> Rename
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-err hover:bg-err-bg transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-card border border-bd rounded-card p-4 max-w-xs mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-tx mb-1">Delete this conversation?</p>
            <p className="text-xs text-tx3 mb-3">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-btn text-xs text-tx2 hover:bg-bd transition-colors">Cancel</button>
              <button onClick={() => { onDelete(session.sessionId); setConfirmDelete(false); }} className="px-3 py-1.5 rounded-btn text-xs bg-err text-white hover:opacity-90 transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
