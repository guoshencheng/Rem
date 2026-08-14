import type Database from 'better-sqlite3';
import type { RunExecutionBudget } from '../../../domain/run/execution-models.js';
import type { RuntimeExecutionBudgetRepository } from '../../../sdk/runtime-storage-repositories.js';
import type { RuntimeExecutionBudgetRow } from './runtime-row-types.js';
import { mapExecutionBudgetRow } from './runtime-row-mappers.js';
import { executionBudgetToRow } from './runtime-row-serializers.js';
import { runtimeConflict, sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeExecutionBudgetRepository implements RuntimeExecutionBudgetRepository {
  constructor(private readonly db: Database.Database) {}

  insert(budget: RunExecutionBudget): void {
    const row = executionBudgetToRow(budget);
    sqliteAction('inserting execution budget', () => this.db.prepare(`
      INSERT INTO runtime_execution_budgets (tenant_id,run_id,agent_runs,messages,tokens,updated_at)
      VALUES (@tenant_id,@run_id,@agent_runs,@messages,@tokens,@updated_at)
    `).run(row));
  }

  get(runId: string): RunExecutionBudget | null {
    return sqliteAction('reading execution budget', () => {
      const row = this.db.prepare('SELECT * FROM runtime_execution_budgets WHERE run_id=?').get(runId) as RuntimeExecutionBudgetRow | undefined;
      return row ? mapExecutionBudgetRow(row) : null;
    });
  }

  update(budget: RunExecutionBudget): void {
    const row = executionBudgetToRow(budget);
    sqliteAction('updating execution budget', () => {
      const result = this.db.prepare(`
        UPDATE runtime_execution_budgets SET tenant_id=@tenant_id,agent_runs=@agent_runs,
          messages=@messages,tokens=@tokens,updated_at=@updated_at WHERE run_id=@run_id
      `).run(row);
      if (result.changes !== 1) runtimeConflict('Execution budget does not exist');
    });
  }
}
