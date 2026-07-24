'use client';

import { useState } from 'react';

interface AddWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (path: string) => void | Promise<void>;
}

export function AddWorkspaceDialog({ open, onClose, onAdd }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleAdd = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Please enter a workspace path');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onAdd(trimmed);
      setPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add workspace');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setPath('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-bd p-6 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold text-tx mb-4">Add Workspace</h2>
        <label className="block text-sm text-tx2 mb-1">Project Directory</label>
        <input
          className="w-full bg-bd border border-bd2 rounded px-3 py-2 mb-2 text-tx text-sm outline-none"
          value={path}
          onChange={(e) => { setPath(e.target.value); setError(null); }}
          placeholder="/absolute/path/to/project"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
          disabled={submitting}
        />
        {error && (
          <p className="text-red-500 text-sm mb-4">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-btn text-sm text-tx2 hover:bg-bd transition-colors"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-btn text-sm bg-ac text-ac-ink hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={() => void handleAdd()}
            disabled={submitting}
          >
            {submitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
