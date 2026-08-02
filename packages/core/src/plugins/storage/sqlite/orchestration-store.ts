import type Database from 'better-sqlite3';
import type { MessageDelivery } from '../../../orchestration/delivery-model.js';
import type { OrchestrationStore } from '../../../sdk/storage-provider.js';
import type { SessionTreeEntry } from '../../../session/tree/types.js';
import { SqliteMessageDeliveryStore } from './message-delivery-store.js';

export class SqliteOrchestrationStore implements OrchestrationStore {
  private readonly deliveries: SqliteMessageDeliveryStore;

  constructor(private readonly db: Database.Database) {
    this.deliveries = new SqliteMessageDeliveryStore(db);
  }

  async appendMessageWithDeliveries(entry: SessionTreeEntry, deliveries: MessageDelivery[]): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
        entry.id, entry.sessionId, entry.parentId, entry.type, JSON.stringify(entry.payload), entry.timestamp,
      );
      this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(entry.id, entry.sessionId);
      deliveries.forEach((delivery) => this.deliveries.insert(delivery));
    })();
  }
}
