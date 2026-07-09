'use client';

interface WorkspaceOnboardingProps {
  onAdd: () => void;
}

export function WorkspaceOnboarding({ onAdd }: WorkspaceOnboardingProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-tx2">
      <h1 className="text-2xl font-semibold mb-2">Welcome to Rem Agent</h1>
      <p className="mb-6">Add a workspace to start chatting.</p>
      <button onClick={onAdd} className="px-6 py-2 rounded-btn text-sm bg-ac text-ac-ink hover:opacity-90 transition-opacity">Add Workspace</button>
    </div>
  );
}
