/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatComposer } from './chat-composer';
import type { LanguageModelUsage } from 'rem-agent-core';

const baseUsage: LanguageModelUsage = {
  inputTokens: 6789,
  outputTokens: 5556,
  totalTokens: 12345,
};

const noop = () => {};

describe('ChatComposer', () => {
  it('renders idle status and disabled send button', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        tokenUsage={baseUsage}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText(/12,345 tokens/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument();
  });

  it('shows stop button while streaming', () => {
    render(
      <ChatComposer
        streaming
        initialized
        activity="thinking"
        tokenUsage={baseUsage}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('renders approval requests inside the block', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        tokenUsage={baseUsage}
        pendingApprovals={[
          {
            approvalId: 'a1',
            title: 'Approve file write',
            description: 'Modify /src/config.ts',
            severity: 'warning',
            allowedDecisions: ['allow-once', 'deny'],
          },
        ]}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Approve file write')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /allow once/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('calls onSend when user types and clicks send', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        onSend={onSend}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    const textarea = screen.getByPlaceholderText('Message...');
    await user.type(textarea, 'Hello');

    const sendButton = screen.getByRole('button', { name: /send/i });
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('calls onInterrupt when stop is clicked', async () => {
    const onInterrupt = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatComposer
        streaming
        initialized
        activity="outputting"
        onSend={noop}
        onInterrupt={onInterrupt}
        onResolveApproval={noop}
      />
    );

    const stopButton = screen.getByRole('button', { name: /stop/i });
    await user.click(stopButton);

    expect(onInterrupt).toHaveBeenCalled();
  });

  it('does not render token stats when tokenUsage is undefined', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});
