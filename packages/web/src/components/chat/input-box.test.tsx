/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputBox } from './input-box';

const noop = () => {};

function renderInputBox(overrides: Partial<Parameters<typeof InputBox>[0]> = {}) {
  return render(
    <InputBox
      streaming={false}
      initialized
      onSend={noop}
      onInterrupt={noop}
      onResolveApproval={noop}
      {...overrides}
    />,
  );
}

describe('InputBox IME handling', () => {
  it('does not send on Enter during IME composition', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'nihao' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends on Enter after composition ends', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '你好' } });
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('你好');
  });

  it('sends on Enter for plain (non-IME) input', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    await user.type(textarea, 'Hello{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
