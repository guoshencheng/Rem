/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const loadMock = vi.fn();
const saveMock = vi.fn();
const initMock = vi.fn();
const localAgentServiceCtor = vi.fn();

vi.mock('rem-agent-bridge/local', () => ({
  CredentialStore: class {
    load = loadMock;
    save = saveMock;
  },
  LocalAgentService: class {
    constructor(opts: unknown) {
      localAgentServiceCtor(opts);
    }
    init = initMock;
  },
}));

vi.mock('./rem-app', () => ({
  RemApp: () => <div data-testid="rem-app" />,
}));

import { RemLocalApp } from './rem-local-app';

describe('RemLocalApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMock.mockResolvedValue(undefined);
    saveMock.mockResolvedValue(undefined);
  });

  it('shows credential setup when no credential stored', async () => {
    loadMock.mockResolvedValue(null);
    render(<RemLocalApp />);
    await waitFor(() => expect(screen.getByText('Connect a provider')).toBeTruthy());
    expect(localAgentServiceCtor).not.toHaveBeenCalled();
  });

  it('saves credential and constructs LocalAgentService', async () => {
    loadMock.mockResolvedValue(null);
    render(<RemLocalApp />);
    await waitFor(() => expect(screen.getByText('Connect a provider')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test-key' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', apiKey: 'sk-test-key' })));
    await waitFor(() => expect(localAgentServiceCtor).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('rem-app')).toBeTruthy());
  });

  it('renders RemApp directly when credential exists', async () => {
    loadMock.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-x', model: 'claude-sonnet-4-5' });
    render(<RemLocalApp />);
    await waitFor(() => expect(screen.getByTestId('rem-app')).toBeTruthy());
    expect(localAgentServiceCtor).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ provider: 'anthropic' }),
    }));
  });
});
