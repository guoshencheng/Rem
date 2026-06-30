import type { IAgentService, SessionSummary } from "rem-agent-bridge";

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function handleNewSession(params: {
  agentService: IAgentService;
  sessionId: string;
  onNewSession: (id: string) => void;
  onClearChat: () => void;
  onUpdateStatus: () => void;
}): Promise<void> {
  params.agentService.interrupt(params.sessionId).catch(() => {});
  params.onNewSession(generateId());
  params.onClearChat();
  params.onUpdateStatus();
}

export async function handleResumeCommand(params: {
  agentService: IAgentService;
  onShowPicker: (sessions: SessionSummary[]) => void;
  onAddAssistantText: (text: string) => void;
}): Promise<void> {
  const sessions = await params.agentService.listSessions();
  if (sessions.length === 0) {
    params.onAddAssistantText("No sessions found.");
    return;
  }
  params.onShowPicker(sessions);
}
