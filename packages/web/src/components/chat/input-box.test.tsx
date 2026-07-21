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

describe('InputBox attachments', () => {
  it('adds an image chip on paste and sends parts', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['fake-png-bytes'], 'p.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    expect(await screen.findByAltText('p.png')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'look' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    const payload = onSend.mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual({ type: 'text', text: 'look' });
    expect(payload[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('removes a chip via the x button', async () => {
    renderInputBox();
    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['fake'], 'p.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    const removeBtn = await screen.findByRole('button', { name: /remove p\.png/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByAltText('p.png')).not.toBeInTheDocument();
  });

  it('rejects non-text non-image files with an inline error', async () => {
    renderInputBox();
    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['x'], 'a.bin', { type: 'application/octet-stream' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
  });
});
