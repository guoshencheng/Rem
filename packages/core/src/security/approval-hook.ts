import type { ToolContext } from '../sdk/tool-provider.js';

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

export type ApprovalHook = (
  toolName: string,
  input: unknown,
  ctx: ToolContext,
) => Promise<ApprovalResult>;

export const defaultApprovalHook: ApprovalHook = async () => ({
  approved: true,
});
