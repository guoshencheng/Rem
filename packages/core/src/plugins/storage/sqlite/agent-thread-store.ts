import type Database from 'better-sqlite3';
import type { AgentThread } from '../../../session/agent-thread/model.js';
import type { AgentThreadStore } from '../../../session/agent-thread/store.js';

interface Row { id: string; session_id: string; agent_profile_id: string; role: AgentThread['role']; lifecycle: AgentThread['lifecycle']; created_at: string; updated_at: string }

export class SqliteAgentThreadStore implements AgentThreadStore {
  constructor(private readonly db: Database.Database) {}
  async save(value: AgentThread): Promise<void> {
    this.db.prepare(`INSERT INTO agent_threads VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET agent_profile_id=excluded.agent_profile_id, role=excluded.role,
      lifecycle=excluded.lifecycle, updated_at=excluded.updated_at`)
      .run(value.agentThreadId, value.sessionId, value.agentProfileId, value.role, value.lifecycle,
        value.createdAt.toISOString(), value.updatedAt.toISOString());
  }
  async get(id: string): Promise<AgentThread | null> {
    return this.convert(this.db.prepare('SELECT * FROM agent_threads WHERE id = ?').get(id) as Row | undefined);
  }
  async listBySession(sessionId: string): Promise<AgentThread[]> {
    return (this.db.prepare('SELECT * FROM agent_threads WHERE session_id = ? ORDER BY created_at').all(sessionId) as Row[])
      .map((row) => this.convert(row)!);
  }
  async delete(id: string): Promise<void> { this.db.prepare('DELETE FROM agent_threads WHERE id = ?').run(id); }
  private convert(row?: Row): AgentThread | null {
    return row ? { agentThreadId: row.id, sessionId: row.session_id, agentProfileId: row.agent_profile_id,
      role: row.role, lifecycle: row.lifecycle, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) } : null;
  }
}
