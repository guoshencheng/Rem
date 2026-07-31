export class InvalidDelegationDepthError extends Error {
  constructor(value: unknown) {
    super(`delegation.maxDepth must be an integer between 1 and 16; received ${String(value)}`);
    this.name = 'InvalidDelegationDepthError';
  }
}

export class DelegationDepthExceededError extends Error {
  constructor(depth: number, maxDepth: number) {
    super(`Delegation depth ${depth} exceeds configured maximum ${maxDepth}`);
    this.name = 'DelegationDepthExceededError';
  }
}
