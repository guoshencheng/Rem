import { describe, expect, it } from 'vitest';
import { cloneCanonicalJson, hashCanonicalJson } from '../src/application/contexts/canonical-json.js';

describe('canonical-json omitUndefinedProperties', () => {
  it('选项开启：显式 undefined own 属性被省略，其余字段正常克隆', () => {
    const input = { role: 'assistant', errorMessage: undefined, nested: { responseId: undefined, kept: 1 } };
    const cloned = cloneCanonicalJson(input, { omitUndefinedProperties: true }) as Record<string, unknown>;

    expect(Object.hasOwn(cloned, 'errorMessage')).toBe(false);
    expect(cloned.role).toBe('assistant');
    expect(cloned.nested).toEqual({ kept: 1 });
    expect(Object.hasOwn(cloned.nested as Record<string, unknown>, 'responseId')).toBe(false);
    // 克隆是深拷贝，不与输入共享引用
    expect(cloned.nested).not.toBe(input.nested);
  });

  it('选项关闭（默认）：同样的输入仍然抛错，锁定旧行为', () => {
    const input = { role: 'assistant', errorMessage: undefined };
    expect(() => cloneCanonicalJson(input)).toThrow('Unsupported JSON value: undefined');
    expect(() => cloneCanonicalJson(input, { omitUndefinedProperties: false })).toThrow('Unsupported JSON value: undefined');
  });

  it('数组中的 undefined 元素即使选项开启也仍然抛错', () => {
    expect(() => cloneCanonicalJson([1, undefined, 3], { omitUndefinedProperties: true }))
      .toThrow('Unsupported JSON value: undefined');
  });

  it('hashCanonicalJson 不受该模式影响：默认行为与确定性不变', () => {
    const input = { b: 2, a: { d: [1, 2], c: 'x' } };
    expect(hashCanonicalJson(input)).toBe(hashCanonicalJson(input));
    // 键序不影响哈希（canonical 排序），省略模式不改变哈希入口
    expect(hashCanonicalJson(input)).toBe(hashCanonicalJson({ a: { c: 'x', d: [1, 2] }, b: 2 }));
    // 含 undefined 属性的输入在默认模式下行为不变：仍然抛错
    expect(() => hashCanonicalJson({ a: undefined })).toThrow('Unsupported JSON value: undefined');
    // 先以省略模式克隆再哈希，与等价的无 undefined 输入哈希一致
    const omitted = cloneCanonicalJson({ a: 1, b: undefined }, { omitUndefinedProperties: true });
    expect(hashCanonicalJson(omitted)).toBe(hashCanonicalJson({ a: 1 }));
  });
});
