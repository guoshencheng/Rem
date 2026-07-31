import { DelegationDepthExceededError, InvalidDelegationDepthError } from './errors.js';

export const DEFAULT_DELEGATION_MAX_DEPTH = 3;

export function resolveDelegationMaxDepth(value?: number): number {
  const resolved = value ?? DEFAULT_DELEGATION_MAX_DEPTH;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 16) {
    throw new InvalidDelegationDepthError(value);
  }
  return resolved;
}

export function assertDelegationDepth(depth: number, maxDepth: number): void {
  if (depth > maxDepth) throw new DelegationDepthExceededError(depth, maxDepth);
}
