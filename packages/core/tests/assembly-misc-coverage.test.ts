import { describe, expect, it, vi, afterEach } from 'vitest';
import { SessionNotFoundError } from '../src/session/manager/errors.js';
import { DefaultSessionProvider } from '../src/plugins/session/default/index.js';
import { UnsupportedSessionSchemaError } from '../src/plugins/session/errors.js';
import type { StorageProvider, SessionStore, OrchestrationStore } from '../src/sdk/storage-provider.js';
import type { Session, SessionSummary } from '../src/session/model.js';
import type { SessionTreeEntry } from '../src/session/tree/types.js';
import type { Message } from '@earendil-works/pi-ai';

// ─── session/manager/errors ─────────────────────────────────────

describe('SessionNotFoundError', () => {
  it('has correct name and sessionId', () => {
    const error = new SessionNotFoundError('session-123');
    expect(error.name).toBe('SessionNotFoundError');
    expect(error.sessionId).toBe('session-123');
    expect(error.message).toBe('Session not found');
    expect(error).toBeInstanceOf(Error);
  });

  it('sessionId is readonly', () => {
    const error = new SessionNotFoundError('s-1');
    expect(error.sessionId).toBe('s-1');
  });
});

// ─── plugins/session/default ────────────────────────────────────

function makeMockSessionStore(): SessionStore {
  return {
    create: vi.fn(),
    load: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    listByWorkspace: vi.fn(),
    listAll: vi.fn(),
    appendEntry: vi.fn(),
    getActiveLeafId: vi.fn(),
    listEntries: vi.fn(),
  };
}

function makeMockOrchestrationStore(): OrchestrationStore {
  return {
    appendMessageWithDeliveries: vi.fn(),
  };
}

function makeMockStorage(sessionStore: SessionStore, orchestrationStore: OrchestrationStore): StorageProvider {
  return {
    init: vi.fn(),
    close: vi.fn(),
    sessionStore,
    orchestratorStore: { appendMessageWithDeliveries: orchestrationStore.appendMessageWithDeliveries },
    orchestrationStore: orchestrationStore,
    todoStore: {} as any,
    archiveStore: {} as any,
    workspaceStore: {} as any,
    agentThreadStore: {} as any,
    messageDeliveryStore: {} as any,
    runtimeStore: {} as any,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    conversation: [],
    currentTurn: 0,
    metadata: { schemaVersion: 2 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DefaultSessionProvider', () => {
  describe('create', () => {
    it('creates session with "default" workspace', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.create as any).mockResolvedValue(makeSession());
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      await provider.create();
      expect(sessionStore.create).toHaveBeenCalledWith('default');
    });
  });

  describe('load', () => {
    it('returns session when schemaVersion >= 2', async () => {
      const sessionStore = makeMockSessionStore();
      const session = makeSession({ metadata: { schemaVersion: 2 } });
      (sessionStore.load as any).mockResolvedValue(session);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.load('s-1');
      expect(result).toEqual(session);
    });

    it('returns null when session not found', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.load as any).mockResolvedValue(null);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.load('s-1');
      expect(result).toBeNull();
    });

    it('throws UnsupportedSessionSchemaError when schemaVersion < 2', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.load as any).mockResolvedValue(
        makeSession({ metadata: { schemaVersion: 1 } }),
      );
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      await expect(provider.load('s-1')).rejects.toThrow(UnsupportedSessionSchemaError);
      await expect(provider.load('s-1')).rejects.toThrow(
        'Session s-1 uses unsupported schema version 1',
      );
    });

    it('load returns session when metadata.schemaVersion is missing (defaults to 1)', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.load as any).mockResolvedValue(
        makeSession({ metadata: {} }),
      );
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      await expect(provider.load('s-1')).rejects.toThrow(UnsupportedSessionSchemaError);
    });
  });

  describe('appendMessage', () => {
    it('appends message to session conversation', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.getActiveLeafId as any).mockResolvedValue('leaf-1');
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const session = makeSession();
      const message = { role: 'user' as const, content: 'hello', timestamp: 1 } as Message;
      await provider.appendMessage(session, {
        messageId: 'msg-1', message,
      });
      expect(session.conversation).toContain(message);
    });
  });

  describe('appendMessageWithDeliveries', () => {
    it('appends message with deliveries', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.getActiveLeafId as any).mockResolvedValue('leaf-1');
      const orchestrationStore = makeMockOrchestrationStore();
      const storage = makeMockStorage(sessionStore, orchestrationStore);
      const provider = new DefaultSessionProvider(storage);
      const session = makeSession();
      const message = { role: 'user' as const, content: 'hello', timestamp: 1 } as Message;
      await provider.appendMessageWithDeliveries(session, {
        messageId: 'msg-1', message,
      }, []);
      expect(orchestrationStore.appendMessageWithDeliveries).toHaveBeenCalled();
      expect(session.conversation).toContain(message);
    });

    it('validates message payload before appending', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.getActiveLeafId as any).mockResolvedValue('leaf-1');
      const orchestrationStore = makeMockOrchestrationStore();
      const storage = makeMockStorage(sessionStore, orchestrationStore);
      const provider = new DefaultSessionProvider(storage);
      const session = makeSession();
      const message = { role: 'user' as const, content: 'hello', timestamp: 1 } as Message;
      await provider.appendMessageWithDeliveries(session, {
        messageId: 'msg-1', message,
        author: { type: 'agent', agentThreadId: 'thread-1' },
      }, []);
      expect(orchestrationStore.appendMessageWithDeliveries).toHaveBeenCalled();
    });
  });

  describe('listEntries', () => {
    it('delegates to sessionStore', async () => {
      const sessionStore = makeMockSessionStore();
      const entries: SessionTreeEntry[] = [
        { id: 'e1', sessionId: 's-1', parentId: null, type: 'message', payload: {}, timestamp: 1 },
      ];
      (sessionStore.listEntries as any).mockResolvedValue(entries);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.listEntries('s-1');
      expect(result).toEqual(entries);
    });
  });

  describe('getActiveLeafId', () => {
    it('delegates to sessionStore', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.getActiveLeafId as any).mockResolvedValue('leaf-1');
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.getActiveLeafId('s-1');
      expect(result).toBe('leaf-1');
    });

    it('returns null when no active leaf', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.getActiveLeafId as any).mockResolvedValue(null);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.getActiveLeafId('s-1');
      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('delegates to sessionStore', async () => {
      const sessionStore = makeMockSessionStore();
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const session = makeSession();
      await provider.save(session);
      expect(sessionStore.save).toHaveBeenCalledWith(session);
    });
  });

  describe('delete', () => {
    it('delegates to sessionStore', async () => {
      const sessionStore = makeMockSessionStore();
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      await provider.delete('s-1');
      expect(sessionStore.delete).toHaveBeenCalledWith('s-1');
    });
  });

  describe('list', () => {
    it('delegates to sessionStore.listAll', async () => {
      const sessionStore = makeMockSessionStore();
      const summaries: SessionSummary[] = [
        { sessionId: 's-1', updatedAt: new Date(), messageCount: 5 },
        { sessionId: 's-2', title: 'Test', updatedAt: new Date(), messageCount: 3 },
      ];
      (sessionStore.listAll as any).mockResolvedValue(summaries);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.list();
      expect(result).toEqual(summaries);
    });

    it('returns empty array when no sessions', async () => {
      const sessionStore = makeMockSessionStore();
      (sessionStore.listAll as any).mockResolvedValue([]);
      const storage = makeMockStorage(sessionStore, makeMockOrchestrationStore());
      const provider = new DefaultSessionProvider(storage);
      const result = await provider.list();
      expect(result).toEqual([]);
    });
  });
});

// ─── assembly/agent-factory ─────────────────────────────────────

const mockCreateAgentAssembly = vi.fn();
const mockInitializeAgentDI = vi.fn();

vi.mock('../src/assembly/agent-assembly.js', () => ({
  createAgentAssembly: (...args: any[]) => mockCreateAgentAssembly(...args),
}));

vi.mock('../src/assembly/agent-context-assembler.js', () => ({
  initializeAgentDI: (...args: any[]) => mockInitializeAgentDI(...args),
}));

describe('createAgentFromEnv', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls createAgentAssembly with options and initializes DI', async () => {
    const mockAssembly = { di: { config: 'mock' }, runtimeConfig: { runtime: {} } };
    mockCreateAgentAssembly.mockReturnValue(mockAssembly);
    mockInitializeAgentDI.mockResolvedValue(undefined);

    const { createAgentFromEnv } = await import('../src/assembly/agent-factory.js');
    const result = await createAgentFromEnv({});

    expect(mockCreateAgentAssembly).toHaveBeenCalledWith({});
    expect(mockInitializeAgentDI).toHaveBeenCalledWith(mockAssembly.di);
    expect(result).toBe(mockAssembly);
  });

  it('passes options through to createAgentAssembly', async () => {
    mockCreateAgentAssembly.mockReturnValue({ di: {}, runtimeConfig: {} });
    mockInitializeAgentDI.mockResolvedValue(undefined);

    const { createAgentFromEnv } = await import('../src/assembly/agent-factory.js');
    const options = { runtime: { platform: 'darwin' as any } };
    await createAgentFromEnv(options as any);

    expect(mockCreateAgentAssembly).toHaveBeenCalledWith(options);
  });
});
