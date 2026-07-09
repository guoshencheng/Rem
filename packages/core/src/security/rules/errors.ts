
export type DenialReason = 'rule' | 'user' | 'workspace' | 'parse';

export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason: DenialReason,
    message?: string,
  ) {
    super(message ?? `Tool "${toolName}" denied: ${reason}`);
    this.name = 'ToolDeniedError';
  }
}
