export interface AgentProfile {
  agentProfileId: string;
  name: string;
  systemPrompt?: string;
  model?: { provider: string; model: string };
  toolPolicy?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
