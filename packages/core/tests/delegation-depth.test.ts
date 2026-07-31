import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELEGATION_MAX_DEPTH, assertDelegationDepth, resolveDelegationMaxDepth,
} from '../src/delegation/depth.js';
import { DelegationDepthExceededError, InvalidDelegationDepthError } from '../src/delegation/errors.js';

describe('delegation depth', () => {
  it('默认 3，接受 1..16 的整数', () => {
    expect(resolveDelegationMaxDepth()).toBe(DEFAULT_DELEGATION_MAX_DEPTH);
    expect(resolveDelegationMaxDepth(1)).toBe(1);
    expect(resolveDelegationMaxDepth(16)).toBe(16);
  });

  it('拒绝无效配置和运行时超限', () => {
    expect(() => resolveDelegationMaxDepth(0)).toThrow(InvalidDelegationDepthError);
    expect(() => resolveDelegationMaxDepth(1.5)).toThrow(InvalidDelegationDepthError);
    expect(() => assertDelegationDepth(4, 3)).toThrow(DelegationDepthExceededError);
  });
});
