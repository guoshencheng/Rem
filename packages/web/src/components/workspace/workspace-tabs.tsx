'use client';

import type { Workspace } from 'rem-agent-bridge';

interface WorkspaceTabsProps {
  workspaces: Workspace[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function WorkspaceTabs({ workspaces, activePath, onSelect, onClose, onAdd }: WorkspaceTabsProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      {workspaces.map((ws) => (
        <button
          key={ws.path}
          onClick={() => onSelect(ws.path)}
          className={`flex items-center gap-2 px-3 py-1 rounded-t ${activePath === ws.path ? 'bg-bg1 border-t border-x' : ''}`}
        >
          <span className="truncate max-w-[160px]">{ws.name}</span>
          <span
            onClick={(e) => { e.stopPropagation(); onClose(ws.path); }}
            className="text-tx3 hover:text-tx1"
          >
            ×
          </span>
        </button>
      ))}
      <button onClick={onAdd} className="px-2 py-1 text-primary">+</button>
    </div>
  );
}
