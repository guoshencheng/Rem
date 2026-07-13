import { describe, it, expect } from 'vitest';
import { formatTaskResult } from '../../src/sub-agent/format-task-result.js';

describe('formatTaskResult', () => {
  it('formats completed result', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'search', content: 'found' });
    expect(result).toContain('<task id="c-1" state="completed">');
    expect(result).toContain('<summary>search</summary>');
    expect(result).toContain('<task_result>\nfound\n  </task_result>');
  });

  it('escapes XML in summary', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'a < b', content: 'ok' });
    expect(result).toContain('<summary>a &lt; b</summary>');
  });

  it('marks failed state', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'search', content: 'error', failed: true });
    expect(result).toContain('state="failed"');
  });
});
