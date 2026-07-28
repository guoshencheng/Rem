/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RemApp } from './rem-app';
import type { IAgentService } from 'rem-agent-bridge/client';

function mockService(overrides: Partial<IAgentService> = {}): IAgentService {
  return {
    listWorkspaces: async () => [{ path: 'default', createdAt: Date.now() }],
    addWorkspace: async (path: string) => ({ path, createdAt: Date.now() }),
    removeWorkspace: async () => {},
    run: async () => {},
    interrupt: async () => {},
    reset: async () => {},
    createSession: async () => ({ sessionId: 's1', workspace: 'default', updatedAt: Date.now(), messageCount: 0 }),
    listSessions: async () => [],
    searchSessions: vi.fn(async () => [{ sessionId: 's1', workspace: 'default', title: 'hello', updatedAt: Date.now(), messageCount: 1 }]),
    getMessages: async () => [],
    updateSession: async () => {},
    deleteSession: async () => {},
    stream: (signal?: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        while (!signal?.aborted) {
          await new Promise(() => {});
        }
      },
    }),
    listPendingApprovals: async () => [],
    resolveApproval: async () => false,
    getTodos: async () => [],
    ...overrides,
  };
}

describe('RemApp', () => {
  it('renders sidebar after loading workspaces', async () => {
    render(<RemApp service={mockService()} />);
    await waitFor(() => expect(screen.getByText('Rem Agent')).toBeTruthy());
  });

  it('routes search through service.searchSessions', async () => {
    const service = mockService();
    render(<RemApp service={service} />);
    await waitFor(() => expect(screen.getByPlaceholderText('Search...')).toBeTruthy());
    // 输入触发 300ms debounce 后的 onSearch
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'hello' } });
    await waitFor(() => expect(service.searchSessions).toHaveBeenCalledWith('default', 'hello'), { timeout: 2000 });
  });
});
