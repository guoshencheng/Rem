import type Database from 'better-sqlite3';

/** Backfills durable counters without touching legacy tables or Journal facts. */
export function migrateRuntimeExecutionBudgets(db: Database.Database): void {
  const runs = db.prepare('SELECT id, tenant_id, updated_at FROM runtime_runs').all() as Array<{ id: string; tenant_id: string; updated_at: string }>;
  const countNodes = db.prepare('SELECT COUNT(*) AS count FROM runtime_execution_nodes WHERE run_id=?');
  const entries = db.prepare('SELECT message_json FROM runtime_execution_entries WHERE run_id=? AND message_json IS NOT NULL');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO runtime_execution_budgets
      (tenant_id,run_id,agent_runs,messages,tokens,updated_at)
    VALUES (?,?,?,?,?,?)
  `);
  db.transaction(() => {
    for (const run of runs) {
      const existing = db.prepare('SELECT 1 AS present FROM runtime_execution_budgets WHERE run_id=?').get(run.id);
      if (existing) continue;
      const nodeCount = (countNodes.get(run.id) as { count: number }).count;
      const rows = (entries.all(run.id) as Array<{ message_json: string }>).filter((row) => isBudgetMessage(row.message_json));
      let tokens = 0;
      for (const row of rows) tokens += readAssistantTokens(row.message_json);
      insert.run(run.tenant_id, run.id, Math.max(1, nodeCount), rows.length, tokens, run.updated_at);
    }
  })();
}

function isBudgetMessage(value: string): boolean {
  try {
    const role = (JSON.parse(value) as { role?: unknown }).role;
    return role === 'user' || role === 'assistant' || role === 'toolResult';
  } catch {
    return false;
  }
}

function readAssistantTokens(value: string): number {
  try {
    const parsed = JSON.parse(value) as { role?: unknown; usage?: { totalTokens?: unknown } };
    const tokens = parsed.role === 'assistant' ? parsed.usage?.totalTokens : undefined;
    return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : 0;
  } catch {
    return 0;
  }
}
