import { describe, it, expect } from 'vitest';
import { getWorkspace } from '../src/workspace-param.js';

describe('getWorkspace', () => {
  it('读取 workspace 查询参数', () => {
    const req = new Request('http://localhost/api/rem/agent/run?workspace=proj');
    expect(getWorkspace(req)).toBe('proj');
  });

  it('缺失时返回 default', () => {
    const req = new Request('http://localhost/api/rem/agent/run');
    expect(getWorkspace(req)).toBe('default');
  });

  it('对编码后的值解码', () => {
    const req = new Request('http://localhost/api/rem/agent/run?workspace=%2Ftmp%2Fws');
    expect(getWorkspace(req)).toBe('/tmp/ws');
  });
});
