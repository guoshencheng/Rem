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
