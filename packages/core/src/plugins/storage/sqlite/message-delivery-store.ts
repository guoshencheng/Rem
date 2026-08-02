import type Database from 'better-sqlite3';
import type { MessageDelivery } from '../../../orchestration/delivery-model.js';
import type { MessageDeliveryStore } from '../../../orchestration/delivery-store.js';

interface DeliveryRow {
  id: string; session_id: string; kind: MessageDelivery['kind']; batch_id: string; message_id: string;
  root_user_message_id: string; target_agent_thread_id: string; requested_by_agent_thread_id: string | null;
  status: MessageDelivery['status']; attempt: number; depth: number; error: string | null;
  created_at: string; updated_at: string;
}

export class SqliteMessageDeliveryStore implements MessageDeliveryStore {
  constructor(private readonly db: Database.Database) {}

  async createBatch(items: MessageDelivery[]): Promise<void> {
    this.db.transaction(() => items.forEach((item) => this.insert(item)))();
  }
  async get(id: string): Promise<MessageDelivery | null> {
    return toDelivery(this.db.prepare('SELECT * FROM message_deliveries WHERE id = ?').get(id) as DeliveryRow | undefined);
  }
  async listByRoot(sessionId: string, rootId: string): Promise<MessageDelivery[]> {
    return this.list('session_id = ? AND root_user_message_id = ?', sessionId, rootId);
  }
  async listQueued(sessionId: string, rootId: string): Promise<MessageDelivery[]> {
    return this.list("session_id = ? AND root_user_message_id = ? AND status = 'queued'", sessionId, rootId);
  }
  async claim(id: string): Promise<boolean> {
    const result = this.db.prepare(`UPDATE message_deliveries SET status='processing', attempt=attempt+1, updated_at=?
      WHERE id=? AND status='queued' AND NOT EXISTS (
        SELECT 1 FROM message_deliveries active
        WHERE active.target_agent_thread_id=message_deliveries.target_agent_thread_id
          AND active.status='processing')`).run(new Date().toISOString(), id);
    return result.changes === 1;
  }
  complete(id: string): Promise<void> { return this.terminal(id, 'completed'); }
  fail(id: string, error: string): Promise<void> { return this.terminal(id, 'failed', error); }
  async interruptRoot(sessionId: string, rootId: string): Promise<number> {
    return this.db.prepare(`UPDATE message_deliveries SET status='interrupted', updated_at=?
      WHERE session_id=? AND root_user_message_id=? AND status IN ('queued','processing')`)
      .run(new Date().toISOString(), sessionId, rootId).changes;
  }
  async recoverProcessing(): Promise<number> {
    return this.db.prepare("UPDATE message_deliveries SET status='interrupted', updated_at=? WHERE status='processing'")
      .run(new Date().toISOString()).changes;
  }
  insert(item: MessageDelivery): void {
    this.db.prepare(`INSERT INTO message_deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.deliveryId, item.sessionId, item.kind, item.batchId, item.messageId, item.rootUserMessageId,
        item.targetAgentThreadId, item.requestedByAgentThreadId ?? null, item.status, item.attempt, item.depth,
        item.error ?? null, item.createdAt.toISOString(), item.updatedAt.toISOString());
  }
  private async terminal(id: string, status: 'completed' | 'failed', error?: string): Promise<void> {
    const result = this.db.prepare(`UPDATE message_deliveries SET status=?, error=?, updated_at=?
      WHERE id=? AND status='processing'`).run(status, error ?? null, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`Invalid Delivery transition: ${id} -> ${status}`);
  }
  private list(where: string, ...params: string[]): MessageDelivery[] {
    return (this.db.prepare(`SELECT * FROM message_deliveries WHERE ${where} ORDER BY created_at, rowid`).all(...params) as DeliveryRow[])
      .map((row) => toDelivery(row)!);
  }
}

function toDelivery(row?: DeliveryRow): MessageDelivery | null {
  return row ? {
    deliveryId: row.id, sessionId: row.session_id, kind: row.kind, batchId: row.batch_id,
    messageId: row.message_id, rootUserMessageId: row.root_user_message_id,
    targetAgentThreadId: row.target_agent_thread_id,
    requestedByAgentThreadId: row.requested_by_agent_thread_id ?? undefined,
    status: row.status, attempt: row.attempt, depth: row.depth, error: row.error ?? undefined,
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
  } : null;
}
