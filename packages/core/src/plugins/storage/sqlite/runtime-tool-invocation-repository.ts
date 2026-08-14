import type Database from 'better-sqlite3';
import type { ToolInvocation } from '../../../domain/run/types.js';
import type { RuntimeToolInvocationRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeToolInvocationRow } from './runtime-row-types.js';
import { mapToolInvocationRow } from './runtime-row-mappers.js';
import { toolInvocationToRow } from './runtime-row-serializers.js';
import { runtimeConflict, sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeToolInvocationRepository implements RuntimeToolInvocationRepository {
  constructor(private readonly db: Database.Database) {}

  insert(invocation: ToolInvocation): void {
    const row = toolInvocationToRow(invocation);
    sqliteAction('inserting runtime tool invocation', () => this.db.prepare(`
      INSERT INTO runtime_tool_invocations
        (id, tenant_id, session_id, run_id, node_id, tool_call_id, tool_name, status, side_effect,
         supports_idempotency_key, input_json, result_json, error, created_at, updated_at)
      VALUES (@id, @tenant_id, @session_id, @run_id, @node_id, @tool_call_id, @tool_name, @status, @side_effect,
        @supports_idempotency_key, @input_json, @result_json, @error, @created_at, @updated_at)
    `).run(row));
  }

  get(invocationId: string): ToolInvocation | null {
    return sqliteAction('reading runtime tool invocation', () => {
      const row = this.db.prepare('SELECT * FROM runtime_tool_invocations WHERE id = ?').get(invocationId) as RuntimeToolInvocationRow | undefined;
      return row ? mapToolInvocationRow(row) : null;
    });
  }

  getByRunAndCall(runId: string, toolCallId: string, nodeId?: string): ToolInvocation | null {
    return sqliteAction('reading runtime tool invocation by call', () => {
      const row = (nodeId === undefined
        ? this.db.prepare("SELECT * FROM runtime_tool_invocations WHERE run_id = ? AND tool_call_id = ? ORDER BY node_id LIMIT 1").get(runId, toolCallId)
        : this.db.prepare('SELECT * FROM runtime_tool_invocations WHERE run_id = ? AND node_id = ? AND tool_call_id = ?').get(runId, nodeId, toolCallId)) as RuntimeToolInvocationRow | undefined;
      return row ? mapToolInvocationRow(row) : null;
    });
  }

  update(invocation: ToolInvocation): void {
    const row = toolInvocationToRow(invocation);
    sqliteAction('updating runtime tool invocation', () => {
      const result = this.db.prepare(`
        UPDATE runtime_tool_invocations SET tenant_id=@tenant_id, session_id=@session_id,
          run_id=@run_id, node_id=@node_id, tool_call_id=@tool_call_id, tool_name=@tool_name, status=@status,
          side_effect=@side_effect, supports_idempotency_key=@supports_idempotency_key,
          input_json=@input_json, result_json=@result_json, error=@error,
          created_at=@created_at, updated_at=@updated_at WHERE id=@id
      `).run(row);
      if (result.changes !== 1) runtimeConflict('Runtime tool invocation does not exist');
    });
  }

  listByRun(runId: string): ToolInvocation[] {
    return sqliteAction('listing runtime tool invocations', () => {
      const rows = this.db.prepare('SELECT * FROM runtime_tool_invocations WHERE run_id = ? ORDER BY created_at, id').all(runId) as RuntimeToolInvocationRow[];
      return rows.map(mapToolInvocationRow);
    });
  }
}
