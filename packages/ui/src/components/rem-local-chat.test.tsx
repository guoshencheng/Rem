/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const loadMock = vi.fn();
const saveMock = vi.fn();
const initMock = vi.fn();
const createSessionMock = vi.fn();
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
    createSession = createSessionMock;
  },
}));

vi.mock('./rem-chat', () => ({
  RemChat: ({ sessionId }: { sessionId: string }) => <div data-testid="rem-chat" data-session={sessionId} />,
}));

import { RemLocalChat } from './rem-local-chat';

const CRED = { provider: 'minimax-openai', apiKey: 'sk-x', model: 'MiniMax-M3' };

describe('RemLocalChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMock.mockResolvedValue(undefined);
    saveMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({ sessionId: 'created-session-1', workspace: 'default', updatedAt: Date.now(), messageCount: 0 });
    window.history.replaceState(null, '', '/');
  });

  it('shows credential setup when no credential stored', async () => {
    loadMock.mockResolvedValue(null);
    render(<RemLocalChat />);
    await waitFor(() => expect(screen.getByText('Connect a provider')).toBeTruthy());
    expect(localAgentServiceCtor).not.toHaveBeenCalled();
  });

  it('renders RemChat directly with provided sessionId', async () => {
    loadMock.mockResolvedValue(CRED);
    render(<RemLocalChat sessionId="s-123" />);
    await waitFor(() => expect(screen.getByTestId('rem-chat')).toBeTruthy());
    expect(screen.getByTestId('rem-chat').getAttribute('data-session')).toBe('s-123');
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('creates a session when sessionId is absent and writes it to URL', async () => {
    loadMock.mockResolvedValue(CRED);
    render(<RemLocalChat />);
    await waitFor(() => expect(screen.getByTestId('rem-chat')).toBeTruthy());
    expect(createSessionMock).toHaveBeenCalledWith('default');
    expect(screen.getByTestId('rem-chat').getAttribute('data-session')).toBe('created-session-1');
    expect(window.location.search).toContain('session=created-session-1');
  });

  it('saves credential via setup then creates session', async () => {
    loadMock.mockResolvedValue(null);
    render(<RemLocalChat />);
    await waitFor(() => expect(screen.getByText('Connect a provider')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByTestId('rem-chat')).toBeTruthy());
    expect(saveMock).toHaveBeenCalled();
  });
});
