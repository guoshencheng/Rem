// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  api: {
    listSessions: vi.fn(),
    getChat: vi.fn(),
    listRuns: vi.fn(),
    getRunInspector: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    interrupt: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({ api: mocks.api }));
vi.mock('@/components/top-bar', () => ({ TopBar: () => null }));
vi.mock('@/components/status-bar', () => ({ StatusBar: () => null }));
vi.mock('@/components/session-list', () => ({
  SessionList: ({ sessions, onSelect }: { sessions: Array<{ sessionId: string }>; onSelect: (id: string) => void }) => (
    <div>{sessions.map((session) => <button key={session.sessionId} onClick={() => onSelect(session.sessionId)}>{session.sessionId}</button>)}</div>
  ),
}));
vi.mock('@/components/chat-view', () => ({ ChatView: () => null }));
vi.mock('@/components/runtime-execution-inspector', () => ({ RuntimeExecutionInspector: () => null }));
vi.mock('@/components/new-session-dialog', () => ({ NewSessionDialog: () => null }));
vi.mock('@/components/workbench-shell', () => ({
  WorkbenchShell: ({ sessionPanel, children }: { sessionPanel: ReactNode; children: ReactNode }) => (
    <main>{sessionPanel}{children}</main>
  ),
}));

import { App } from '@/app';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('App Session loading', () => {
  it('首页只请求列表，选中 Session 后只加载一次 entries', async () => {
    mocks.api.listSessions.mockResolvedValue([
      {
        sessionId: 'session-1', tenantId: 'local-web', contexts: { bindings: [] },
        createdAt: new Date(), updatedAt: new Date(), messageCount: 0,
      },
      {
        sessionId: 'session-2', tenantId: 'local-web', contexts: { bindings: [] },
        createdAt: new Date(), updatedAt: new Date(), messageCount: 1,
      },
    ]);
    mocks.api.getChat.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(mocks.api.listSessions).toHaveBeenCalledTimes(1));
    expect(mocks.api.getChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'session-1' }));
    await waitFor(() => expect(mocks.api.getChat).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'session-2' }));
    await waitFor(() => expect(mocks.api.getChat).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'session-1' }));
    await waitFor(() => expect(mocks.api.getChat).toHaveBeenCalledTimes(3));
  });
});
