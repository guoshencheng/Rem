'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { MoreHorizontal, Pin, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/lib/types';
import { useSessionStore } from '@/lib/session-store';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
}

export function SessionItem({ session, isActive }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectSession = useSessionStore((s) => s.selectSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const togglePin = useSessionStore((s) => s.togglePin);

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
    const trimmed = editTitle.trim();
    if (trimmed) {
      renameSession(session.sessionId, trimmed);
    }
    setEditing(false);
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
      onClick={() => selectSession(session.sessionId)}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bd border border-bd2 rounded px-2 py-0.5 text-xs text-tx outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-tx2 group-hover:text-tx transition-colors">
          {session.title ?? 'New Chat'}
        </span>
      )}

      {session.pinned && <Pin size={10} className="text-ac flex-shrink-0" />}

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
                onClick={(e) => { e.stopPropagation(); togglePin(session.sessionId); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pin size={12} /> {session.pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pencil size={12} /> 重命名
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-err hover:bg-err-bg transition-colors"
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-card border border-bd rounded-card p-4 max-w-xs mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-tx mb-1">确定要删除这个会话吗？</p>
            <p className="text-xs text-tx3 mb-3">此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-btn text-xs text-tx2 hover:bg-bd transition-colors">取消</button>
              <button onClick={() => { deleteSession(session.sessionId); setConfirmDelete(false); }} className="px-3 py-1.5 rounded-btn text-xs bg-err text-white hover:opacity-90 transition-opacity">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
