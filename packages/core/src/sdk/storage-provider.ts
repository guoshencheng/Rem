import type { Message } from '@earendil-works/pi-ai';
import type { Usage } from '@earendil-works/pi-ai';
import type { Session, SessionSummary } from '../session/model.js';
import type { SessionTreeEntry } from '../session/tree/types.js';
import type { TodoItem } from '../capabilities/todo/types.js';
import type { AgentThreadStore } from '../session/agent-thread/store.js';
import type { MessageDelivery } from '../orchestration/delivery-model.js';
import type { MessageDeliveryStore } from '../orchestration/delivery-store.js';

export interface ArchiveRecord {
  id: string;
  sessionId: string;
  compressedAt: Date;
  version: number;
  parentArchiveId?: string;
  conversationSnapshot: Message[];
  summary: string;
  tokenUsageBefore?: Usage;
  tokenUsageAfter?: Usage;
  metadata?: Record<string, unknown>;
}

export interface ArchiveStore {
  save(record: ArchiveRecord): Promise<void>;
  get(id: string): Promise<ArchiveRecord | null>;
  listBySession(sessionId: string): Promise<ArchiveRecord[]>;
  getLatest(sessionId: string): Promise<ArchiveRecord | null>;
}

export interface WorkspaceRecord {
  path: string;
  createdAt: number;
}

export interface WorkspaceStore {
  list(): Promise<WorkspaceRecord[]>;
  add(path: string): Promise<WorkspaceRecord>;
  remove(path: string): Promise<void>;
}

export interface StorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly sessionStore: SessionStore;
  readonly todoStore: TodoStore;
  readonly archiveStore: ArchiveStore;
  readonly workspaceStore: WorkspaceStore;
  readonly agentThreadStore: AgentThreadStore;
  readonly messageDeliveryStore: MessageDeliveryStore;
  readonly orchestrationStore: OrchestrationStore;
}

export interface OrchestrationStore {
  appendMessageWithDeliveries(entry: SessionTreeEntry, deliveries: MessageDelivery[]): Promise<void>;
}

export interface TodoStore {
  getBySession(sessionId: string): Promise<TodoItem[]>;
  replaceForSession(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]>;
}

export interface SessionStore {
  create(workspace: string): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  listByWorkspace(workspace: string): Promise<SessionSummary[]>;
  listAll(): Promise<SessionSummary[]>;

  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getActiveLeafId(sessionId: string): Promise<string | null>;
  listEntries(sessionId: string): Promise<SessionTreeEntry[]>;
}
