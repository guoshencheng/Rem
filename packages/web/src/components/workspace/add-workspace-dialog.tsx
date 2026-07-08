'use client';

import { useState } from 'react';

interface AddWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (path: string, name?: string) => void | Promise<void>;
}

export function AddWorkspaceDialog({ open, onClose, onAdd }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');

  if (!open) return null;

  const handleAdd = () => {
    void onAdd(path, name || undefined);
    setPath('');
    setName('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg1 p-6 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Add Workspace</h2>
        <label className="block text-sm mb-1">Path</label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/absolute/path/to/project"
        />
        <label className="block text-sm mb-1">Name (optional)</label>
        <input
          className="w-full border rounded px-3 py-2 mb-4"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project"
        />
        <div className="flex justify-end gap-2">
          <button className="px-4 py-2" onClick={onClose}>Cancel</button>
          <button
            className="px-4 py-2 bg-primary text-white rounded"
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
