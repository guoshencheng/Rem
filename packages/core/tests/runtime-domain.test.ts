import { describe, expect, it } from 'vitest';
import { applyContextPatch } from '../src/domain/context/apply-context-patch.js';
import { isTerminalRunStatus, transitionRun } from '../src/domain/run/run-state.js';

describe('runtime domain', () => {
  it('按类型显式替换，并保留未替换类型的顺序', () => {
    const result = applyContextPatch(
      { bindings: [
        { type: 'acme/repository', contextId: 'rem' },
        { type: 'acme/customer', contextId: 'c-1' },
      ] },
      {
        replace: {
          'acme/repository': [{ type: 'acme/repository', contextId: 'sdk' }],
        },
        add: [{ type: 'acme/incident', contextId: 'inc-1' }],
      },
    );

    expect(result.bindings.map((item) => item.contextId)).toEqual(['c-1', 'sdk', 'inc-1']);
  });

  it('拒绝未声明的隐式重复绑定', () => {
    expect(() => applyContextPatch(
      { bindings: [{ type: 'acme/repository', contextId: 'rem' }] },
      { add: [{ type: 'acme/repository', contextId: 'rem' }] },
    )).toThrow('Duplicate context binding');
  });

  it('无 patch 时仍拒绝重复绑定', () => {
    expect(() => applyContextPatch(
      { bindings: [
        { type: 'acme/repository', contextId: 'rem' },
        { type: 'acme/repository', contextId: 'rem' },
      ] },
    )).toThrow('Duplicate context binding');
  });

  it('返回独立的 binding 与 input 副本', () => {
    const base = {
      bindings: [{
        type: 'acme/repository',
        contextId: 'rem',
        input: { branch: 'main' },
      }],
    };
    const result = applyContextPatch(base);
    const binding = result.bindings[0];

    binding.contextId = 'sdk';
    (binding.input as { branch: string }).branch = 'next';

    expect(base.bindings[0]).toEqual({
      type: 'acme/repository',
      contextId: 'rem',
      input: { branch: 'main' },
    });
  });

  it('不将包含 NUL 的不同 type 与 contextId 元组误判为重复', () => {
    expect(() => applyContextPatch(
      { bindings: [
        { type: 'acme\u0000repository', contextId: 'rem' },
        { type: 'acme', contextId: 'repository\u0000rem' },
      ] },
      {},
    )).not.toThrow();
  });

  it('拒绝与 replace key 类型不匹配的 replacement', () => {
    expect(() => applyContextPatch(
      { bindings: [] },
      {
        replace: {
          'acme/repository': [{ type: 'acme/customer', contextId: 'c-1' }],
        },
      },
    )).toThrow('Context replacement type mismatch');
  });

  it('只允许合法 Run 状态迁移', () => {
    expect(transitionRun('queued', 'running')).toBe('running');
    expect(transitionRun('running', 'completed')).toBe('completed');
    expect(transitionRun('waiting', 'queued')).toBe('queued');
    expect(() => transitionRun('running', 'queued')).toThrow('Illegal run transition');
    expect(() => transitionRun('completed', 'running')).toThrow('Illegal run transition');
  });

  it('仅将已完成、失败和取消判定为终态', () => {
    expect(isTerminalRunStatus('queued')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('waiting')).toBe(false);
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
  });
});
