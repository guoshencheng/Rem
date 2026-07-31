import type Database from 'better-sqlite3';
import type { AgentProfile } from '../../../agent-profile/model.js';
import type { AgentProfileStore } from '../../../agent-profile/store.js';

interface Row { id: string; name: string; system_prompt: string | null; model_json: string | null; tool_policy_json: string | null; created_at: string; updated_at: string }

export class SqliteAgentProfileStore implements AgentProfileStore {
  constructor(private readonly db: Database.Database) {}
  async save(value: AgentProfile): Promise<void> {
    this.db.prepare(`INSERT INTO agent_profiles VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, system_prompt=excluded.system_prompt,
      model_json=excluded.model_json, tool_policy_json=excluded.tool_policy_json, updated_at=excluded.updated_at`)
      .run(value.agentProfileId, value.name, value.systemPrompt ?? null,
        value.model ? JSON.stringify(value.model) : null, value.toolPolicy ? JSON.stringify(value.toolPolicy) : null,
        value.createdAt.toISOString(), value.updatedAt.toISOString());
  }
  async get(id: string): Promise<AgentProfile | null> {
    return this.convert(this.db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as Row | undefined);
  }
  async list(): Promise<AgentProfile[]> {
    return (this.db.prepare('SELECT * FROM agent_profiles ORDER BY created_at').all() as Row[]).map((row) => this.convert(row)!);
  }
  async delete(id: string): Promise<void> { this.db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(id); }
  private convert(row?: Row): AgentProfile | null {
    return row ? { agentProfileId: row.id, name: row.name, systemPrompt: row.system_prompt ?? undefined,
      model: row.model_json ? JSON.parse(row.model_json) : undefined,
      toolPolicy: row.tool_policy_json ? JSON.parse(row.tool_policy_json) : undefined,
      createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) } : null;
  }
}
