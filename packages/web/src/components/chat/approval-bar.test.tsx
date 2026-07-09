/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalBar } from './approval-bar';
import type { ApprovalRequest } from 'rem-agent-core';

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: 'a1',
    toolName: 'write',
    title: 'Write file',
    allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    patterns: [],
    alwaysOptions: [
      { label: 'src/foo.ts', rule: { permission: 'write', pattern: 'src/foo.ts', action: 'allow' } },
      { label: '*.ts', rule: { permission: 'write', pattern: '*.ts', action: 'allow' } },
    ],
    ...overrides,
  };
}

describe('ApprovalBar', () => {
  it('renders nothing when there are no approvals', () => {
    const { container } = render(<ApprovalBar approvals={[]} onResolve={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the always-options dropdown when allow-always is available', () => {
    render(<ApprovalBar approvals={[makeRequest()]} onResolve={vi.fn()} />);
    expect(screen.getByText('Always allow scope:')).toBeInTheDocument();
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('*.ts')).toBeInTheDocument();
  });

  it('omits the dropdown when no always options', () => {
    render(<ApprovalBar approvals={[makeRequest({ alwaysOptions: [], allowedDecisions: ['allow-once', 'deny'] })]} onResolve={vi.fn()} />);
    expect(screen.queryByText('Always allow scope:')).not.toBeInTheDocument();
  });

  it('resolves allow-always with the default option when none selected', () => {
    const onResolve = vi.fn();
    render(<ApprovalBar approvals={[makeRequest()]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Always allow'));
    expect(onResolve).toHaveBeenCalledWith('a1', 'allow-always', { permission: 'write', pattern: 'src/foo.ts', action: 'allow' });
  });

  it('resolves allow-always with the selected option', () => {
    const onResolve = vi.fn();
    render(<ApprovalBar approvals={[makeRequest()]} onResolve={onResolve} />);
    fireEvent.change(screen.getByDisplayValue('src/foo.ts'), { target: { value: '*.ts' } });
    fireEvent.click(screen.getByText('Always allow'));
    expect(onResolve).toHaveBeenCalledWith('a1', 'allow-always', { permission: 'write', pattern: '*.ts', action: 'allow' });
  });

  it('resolves allow-once without a rule', () => {
    const onResolve = vi.fn();
    render(<ApprovalBar approvals={[makeRequest()]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Allow once'));
    expect(onResolve).toHaveBeenCalledWith('a1', 'allow-once');
  });
});
