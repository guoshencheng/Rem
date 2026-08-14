import type Database from 'better-sqlite3';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery } from '../../../domain/run/execution-models.js';
import type { RuntimeExecutionEntryRepository, RuntimeExecutionNodeRepository, RuntimeDeliveryRepository } from '../../../sdk/runtime-execution-repositories.js';
import type { RuntimeExecutionEntryRow, RuntimeExecutionNodeRow, RuntimeDeliveryRow } from './runtime-row-types.js';
import { mapDeliveryRow, mapExecutionEntryRow, mapExecutionNodeRow } from './runtime-execution-row-mappers.js';
import { deliveryToRow, executionEntryToRow, executionNodeToRow } from './runtime-execution-serializers.js';
import { runtimeConflict, sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeExecutionNodeRepository implements RuntimeExecutionNodeRepository {
  constructor(private readonly db: Database.Database) {}
  insert(node: RunExecutionNode): void { const row = executionNodeToRow(node); sqliteAction('inserting execution node', () => { assertRunTenant(this.db, node.runId, node.tenantId); assertParentNode(this.db, node.parentNodeId, node.runId, node.tenantId); this.db.prepare(`INSERT INTO runtime_execution_nodes (id,tenant_id,run_id,parent_node_id,kind,role,agent_id,agent_revision,status,depth,created_at,started_at,finished_at,updated_at) VALUES (@id,@tenant_id,@run_id,@parent_node_id,@kind,@role,@agent_id,@agent_revision,@status,@depth,@created_at,@started_at,@finished_at,@updated_at)`).run(row); }); }
  get(nodeId: string): RunExecutionNode | null { return sqliteAction('reading execution node', () => { const row = this.db.prepare('SELECT * FROM runtime_execution_nodes WHERE id=?').get(nodeId) as RuntimeExecutionNodeRow | undefined; return row ? mapExecutionNodeRow(row) : null; }); }
  listByRun(runId: string): RunExecutionNode[] { return sqliteAction('listing execution nodes', () => (this.db.prepare('SELECT * FROM runtime_execution_nodes WHERE run_id=? ORDER BY created_at,id').all(runId) as RuntimeExecutionNodeRow[]).map(mapExecutionNodeRow)); }
  update(node: RunExecutionNode): void { const row = executionNodeToRow(node); sqliteAction('updating execution node', () => { assertRunTenant(this.db, node.runId, node.tenantId); assertParentNode(this.db, node.parentNodeId, node.runId, node.tenantId); const result = this.db.prepare('UPDATE runtime_execution_nodes SET tenant_id=@tenant_id,run_id=@run_id,parent_node_id=@parent_node_id,kind=@kind,role=@role,agent_id=@agent_id,agent_revision=@agent_revision,status=@status,depth=@depth,created_at=@created_at,started_at=@started_at,finished_at=@finished_at,updated_at=@updated_at WHERE id=@id').run(row); if (result.changes !== 1) runtimeConflict('Execution node does not exist'); }); }
}

export class SqliteRuntimeExecutionEntryRepository implements RuntimeExecutionEntryRepository {
  constructor(private readonly db: Database.Database) {}
  append(entry: RunExecutionEntry): void { const row = executionEntryToRow(entry); sqliteAction('appending execution entry', () => { assertRunTenant(this.db, entry.runId, entry.tenantId); assertOptionalNode(this.db, entry.nodeId, entry.runId, entry.tenantId); this.db.prepare('INSERT INTO runtime_execution_entries (id,tenant_id,run_id,node_id,sequence,kind,message_json,data_json,audience,visibility,created_at) VALUES (@id,@tenant_id,@run_id,@node_id,@sequence,@kind,@message_json,@data_json,@audience,@visibility,@created_at)').run(row); }); }
  get(entryId: string): RunExecutionEntry | null { return sqliteAction('reading execution entry', () => { const row = this.db.prepare('SELECT * FROM runtime_execution_entries WHERE id=?').get(entryId) as RuntimeExecutionEntryRow | undefined; return row ? mapExecutionEntryRow(row) : null; }); }
  nextSequence(runId: string): number { return sqliteAction('reading execution entry sequence', () => (this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM runtime_execution_entries WHERE run_id=?').get(runId) as { sequence: number }).sequence); }
  listByRun(runId: string, afterSequence: number, limit: number): RunExecutionEntry[] { return sqliteAction('listing execution entries', () => (this.db.prepare('SELECT * FROM runtime_execution_entries WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(runId, afterSequence, limit) as RuntimeExecutionEntryRow[]).map(mapExecutionEntryRow)); }
  listByNode(runId: string, nodeId: string, afterSequence: number, limit: number): RunExecutionEntry[] { return sqliteAction('listing node execution entries', () => (this.db.prepare('SELECT * FROM runtime_execution_entries WHERE run_id=? AND node_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(runId, nodeId, afterSequence, limit) as RuntimeExecutionEntryRow[]).map(mapExecutionEntryRow)); }
}

export class SqliteRuntimeDeliveryRepository implements RuntimeDeliveryRepository {
  constructor(private readonly db: Database.Database) {}
  insert(delivery: RunDelivery): void { const row = deliveryToRow(delivery); sqliteAction('inserting runtime delivery', () => { assertRunTenant(this.db, delivery.runId, delivery.tenantId); assertOptionalNode(this.db, delivery.nodeId, delivery.runId, delivery.tenantId); assertOptionalNode(this.db, delivery.requestedByNodeId, delivery.runId, delivery.tenantId); this.db.prepare('INSERT INTO runtime_deliveries (id,tenant_id,run_id,node_id,kind,batch_id,depth,status,requested_by_node_id,source_entry_id,result_entry_id,attempt,error_code,created_at,updated_at) VALUES (@id,@tenant_id,@run_id,@node_id,@kind,@batch_id,@depth,@status,@requested_by_node_id,@source_entry_id,@result_entry_id,@attempt,@error_code,@created_at,@updated_at)').run(row); }); }
  get(deliveryId: string): RunDelivery | null { return sqliteAction('reading runtime delivery', () => { const row = this.db.prepare('SELECT * FROM runtime_deliveries WHERE id=?').get(deliveryId) as RuntimeDeliveryRow | undefined; return row ? mapDeliveryRow(row) : null; }); }
  listByRun(runId: string): RunDelivery[] { return sqliteAction('listing runtime deliveries', () => (this.db.prepare('SELECT * FROM runtime_deliveries WHERE run_id=? ORDER BY created_at,id').all(runId) as RuntimeDeliveryRow[]).map(mapDeliveryRow)); }
  listByBatch(runId: string, batchId: string): RunDelivery[] { return sqliteAction('listing runtime delivery batch', () => (this.db.prepare('SELECT * FROM runtime_deliveries WHERE run_id=? AND batch_id=? ORDER BY created_at,id').all(runId, batchId) as RuntimeDeliveryRow[]).map(mapDeliveryRow)); }
  listByNode(runId: string, nodeId: string): RunDelivery[] { return sqliteAction('listing node runtime deliveries', () => (this.db.prepare('SELECT * FROM runtime_deliveries WHERE run_id=? AND node_id=? ORDER BY created_at,id').all(runId, nodeId) as RuntimeDeliveryRow[]).map(mapDeliveryRow)); }
  claimQueued(runId: string, deliveryId: string, now: Date): RunDelivery | null {
    return sqliteAction('claiming runtime delivery', () => {
      const updated = this.db.prepare("UPDATE runtime_deliveries SET status='running',attempt=attempt+1,updated_at=? WHERE id=? AND run_id=? AND status='queued'")
        .run(now.toISOString(), deliveryId, runId);
      if (updated.changes !== 1) return null;
      const row = this.db.prepare('SELECT * FROM runtime_deliveries WHERE id=?').get(deliveryId) as RuntimeDeliveryRow | undefined;
      return row ? mapDeliveryRow(row) : null;
    });
  }
  update(delivery: RunDelivery): void { const row = deliveryToRow(delivery); sqliteAction('updating runtime delivery', () => { assertRunTenant(this.db, delivery.runId, delivery.tenantId); assertOptionalNode(this.db, delivery.nodeId, delivery.runId, delivery.tenantId); assertOptionalNode(this.db, delivery.requestedByNodeId, delivery.runId, delivery.tenantId); const result = this.db.prepare('UPDATE runtime_deliveries SET tenant_id=@tenant_id,run_id=@run_id,node_id=@node_id,kind=@kind,batch_id=@batch_id,depth=@depth,status=@status,requested_by_node_id=@requested_by_node_id,source_entry_id=@source_entry_id,result_entry_id=@result_entry_id,attempt=@attempt,error_code=@error_code,created_at=@created_at,updated_at=@updated_at WHERE id=@id').run(row); if (result.changes !== 1) runtimeConflict('Runtime delivery does not exist'); }); }
}

function assertRunTenant(db: Database.Database, runId: string, tenantId: string): void {
  const row = db.prepare('SELECT tenant_id FROM runtime_runs WHERE id=?').get(runId) as { tenant_id?: unknown } | undefined;
  if (!row) runtimeConflict('Runtime run does not exist');
  if (row.tenant_id !== tenantId) runtimeConflict('Runtime run tenant does not match child record');
}

function assertOptionalNode(db: Database.Database, nodeId: string | undefined, runId: string, tenantId: string): void {
  if (nodeId === undefined) return;
  const row = db.prepare('SELECT run_id,tenant_id FROM runtime_execution_nodes WHERE id=?').get(nodeId) as { run_id?: unknown; tenant_id?: unknown } | undefined;
  if (!row) return;
  if (row.run_id !== runId || row.tenant_id !== tenantId) runtimeConflict('Execution node ownership does not match child record');
}

function assertParentNode(db: Database.Database, nodeId: string | undefined, runId: string, tenantId: string): void {
  if (nodeId === undefined) return;
  const row = db.prepare('SELECT run_id,tenant_id FROM runtime_execution_nodes WHERE id=?').get(nodeId) as { run_id?: unknown; tenant_id?: unknown } | undefined;
  if (!row || row.run_id !== runId || row.tenant_id !== tenantId) runtimeConflict('Parent execution node ownership does not match child record');
}
