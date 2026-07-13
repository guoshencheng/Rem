import type { Session, SessionSummary } from '../session.js';
import type { Rule, RuleSource } from '../security/rules/rule.js';
import type { TodoItem } from '../todo/types.js';
import type { ModelMessage, LanguageModelUsage } from '../types.js';

export interface ArchiveRecord {
  id: string;
  sessionId: string;
  compressedAt: Date;
  version: number;
  parentArchiveId?: string;
  conversationSnapshot: ModelMessage[];
  summary: string;
  tokenUsageBefore?: LanguageModelUsage;
  tokenUsageAfter?: LanguageModelUsage;
  metadata?: Record<string, unknown>;
}

export interface ArchiveStore {
  save(record: ArchiveRecord): Promise<void>;
  get(id: string): Promise<ArchiveRecord | null>;
  listBySession(sessionId: string): Promise<ArchiveRecord[]>;
  getLatest(sessionId: string): Promise<ArchiveRecord | null>;
}

export interface StorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly sessionStore: SessionStore;
  readonly ruleStore: RuleStorage;
  readonly todoStore: TodoStore;
  readonly archiveStore: ArchiveStore;
}

export interface TodoStore {
  getBySession(sessionId: string): Promise<TodoItem[]>;
  replaceForSession(sessionId: string, todos: TodoItem[]): Promise<void>;
}

export interface SessionStore {
  create(workspace: string): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  listByWorkspace(workspace: string): Promise<SessionSummary[]>;
  listAll(): Promise<SessionSummary[]>;
}

export interface RuleStorage {
  loadAll(): Promise<Rule[]>;
  loadBySource(source: RuleSource): Promise<Rule[]>;
  saveApproved(rule: Omit<Rule, 'source'>): Promise<void>;
}
